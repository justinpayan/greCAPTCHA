#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["torch", "transformers>=4.45", "accelerate"]
#
# [[tool.uv.index]]
# name = "pytorch-cu128"
# url = "https://download.pytorch.org/whl/cu128"
# explicit = true
#
# [tool.uv.sources]
# torch = { index = "pytorch-cu128" }
# ///
"""Local-LLM refinement helper for transcribe_and_clean.py.

Run by the parent as `uv run --script llm_speaker_refine.py`, which provisions
torch/transformers in an isolated env on first use. Both tasks share one model
load. Progress goes to stderr; the last stdout line is the JSON result.

Two tasks, both deliberately incapable of introducing content:

  boundary_cases -- "where does the speaker change?"
      The model answers with a single integer index. It never emits transcript
      text, so its output can only move a speaker label.

  restyle_cases -- "repunctuate and recapitalise this"
      The model returns the same words with different punctuation and casing.
      The parent checks the reply position by position: token count must match
      and every token must be identical once case and punctuation are
      stripped. Any chunk that fails is discarded and the original kept, so an
      added, dropped, reordered or reworded token cannot survive.

Protocol -- JSON on stdin:
    {"model": "Qwen/Qwen2.5-7B-Instruct", "device": "auto",
     "boundary_cases": [{"id": 0, "split": 12, "speaker_a": "SPEAKER_00",
                         "speaker_b": "SPEAKER_01", "words": ["So", "what", ...]}],
     "restyle_cases":  [{"id": 0, "text": "so what got you interested"}]}

JSON on stdout (last line):
    {"results":  [{"id": 0, "split": 14}],
     "restyled": [{"id": 0, "text": "So, what got you interested?"}]}
"""

from __future__ import annotations

import json
import re
import sys
import time

BOUNDARY_SYSTEM = (
    "You correct speaker-diarization boundaries in transcripts of two-person "
    "interviews. You answer with a single integer and nothing else."
)

BOUNDARY_TEMPLATE = """Below is a numbered run of consecutive words from a two-person conversation. \
Exactly one speaker change happens inside it: an earlier stretch is spoken by A, and \
everything from some index onward is spoken by B.

Words:
{listing}

An automatic system guessed the change starts at index {split}. Using grammar, \
sentence boundaries, and question/answer structure, decide the correct index.

Reply with ONLY the integer index of the first word spoken by B."""

RESTYLE_SYSTEM = (
    "You are a transcript copy-editor. You repair punctuation and "
    "capitalisation in verbatim speech without altering a single word."
)

RESTYLE_TEMPLATE = """Repunctuate and recapitalise the transcript line below so it reads clearly.

Absolute rules:
- Do NOT add, delete, reorder or replace any word.
- Do NOT change spelling or word forms. Keep contractions and colloquialisms \
exactly as written: "gonna" stays "gonna", "cause" stays "cause".
- You may ONLY change capitalisation and punctuation ( . , ? ! ; : ' " ).
- Keep it verbatim speech. Do not tidy grammar, do not finish incomplete \
sentences, do not merge or split words.
- Output the corrected line and nothing else: no preamble, no quotation marks \
around it, no markdown.

Line:
{text}"""

FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")
THINK = re.compile(r"<think>.*?</think>", re.S)


def strip_thinking(reply: str) -> str:
    """Drop a reasoning model's <think> block.

    Reasoning is also suppressed at the template level, but not every model
    honours that, and a block truncated by the token budget leaves an unclosed
    tag with no answer after it -- that reply is unusable, so return nothing
    and let the caller keep the original.
    """
    reply = THINK.sub("", reply)
    if "<think>" in reply:
        return ""
    return reply.replace("</think>", "").strip()


def clean_reply(reply: str) -> str:
    """Strip the wrappers a chat model tends to add around plain text."""
    s = strip_thinking(reply).strip()
    s = FENCE.sub("", s).strip()
    for q in ('"', "'", "“", "‘"):
        if len(s) > 1 and s[0] == q:
            s = s[1:].strip()
            break
    for q in ('"', "'", "”", "’"):
        if len(s) > 1 and s[-1] == q:
            s = s[:-1].strip()
            break
    return " ".join(s.split())


def generate(tok, model, system: str, user: str, max_new: int) -> str:
    import torch

    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    text = None
    for extra in ({"enable_thinking": False}, {"thinking": False}, {}):
        try:
            text = tok.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True, **extra
            )
            break
        except Exception:
            continue
    if text is None:
        text = f"{system}\n\n{user}\n"
    inputs = tok(text, return_tensors="pt").to(model.device)
    with torch.inference_mode():
        out = model.generate(
            **inputs,
            max_new_tokens=max_new,
            do_sample=False,
            temperature=None,
            top_p=None,
            top_k=None,
            pad_token_id=tok.pad_token_id or tok.eos_token_id,
        )
    return tok.decode(out[0][inputs["input_ids"].shape[-1] :], skip_special_tokens=True)


def main() -> int:
    payload = json.load(sys.stdin)
    b_cases = payload.get("boundary_cases") or payload.get("cases") or []
    r_cases = payload.get("restyle_cases") or []
    if not b_cases and not r_cases:
        print(json.dumps({"results": [], "restyled": []}))
        return 0

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    model_id = payload["model"]
    device = payload.get("device", "auto")
    print(f"[llm] loading {model_id} (first run downloads weights) ...",
          file=sys.stderr, flush=True)

    tok = AutoTokenizer.from_pretrained(model_id)

    # A multimodal checkpoint needs its own auto class; AutoModelForCausalLM
    # either refuses it or loads something that will not generate sensibly.
    auto_cls = AutoModelForCausalLM
    try:
        from transformers import AutoConfig

        arch = (AutoConfig.from_pretrained(model_id).architectures or [""])[0]
        if any(k in arch for k in ("ConditionalGeneration", "ImageTextToText", "VL", "Vision")):
            from transformers import AutoModelForImageTextToText

            auto_cls = AutoModelForImageTextToText
            print(
                f"[llm] note: {model_id} is a multimodal checkpoint ({arch}); "
                "a text-generation model will be faster and more reliable here",
                file=sys.stderr, flush=True,
            )
    except Exception as exc:
        print(f"[llm] could not inspect architecture ({exc}); assuming causal LM",
              file=sys.stderr, flush=True)

    kwargs: dict = {"dtype": "auto"}
    if device == "auto":
        kwargs["device_map"] = "auto" if torch.cuda.is_available() else "cpu"
    else:
        kwargs["device_map"] = device
    try:
        model = auto_cls.from_pretrained(model_id, **kwargs)
    except TypeError:  # transformers < 4.56 spells it torch_dtype
        kwargs["torch_dtype"] = kwargs.pop("dtype")
        model = auto_cls.from_pretrained(model_id, **kwargs)
    model.eval()
    print(
        f"[llm] loaded; {len(b_cases)} boundaries, {len(r_cases)} restyle chunks",
        file=sys.stderr,
    )

    # A reasoning model spends its budget thinking before it answers; a plain
    # one needs only the digits.
    thinks = "<think>" in (getattr(tok, "chat_template", "") or "")
    boundary_budget = 512 if thinks else 12
    if thinks:
        print("[llm] reasoning template detected; using a larger answer budget",
              file=sys.stderr, flush=True)

    results = []
    t0 = time.time()
    for n, case in enumerate(b_cases, 1):
        listing = "\n".join(f"{i}: {w}" for i, w in enumerate(case["words"]))
        reply = strip_thinking(
            generate(
                tok, model, BOUNDARY_SYSTEM,
                BOUNDARY_TEMPLATE.format(listing=listing, split=case["split"]), boundary_budget,
            )
        )
        m = re.search(r"\d+", reply)
        if not m:
            continue
        split = int(m.group())
        if not (1 <= split <= len(case["words"]) - 1):
            continue
        results.append({"id": case["id"], "split": split})
        if n % 10 == 0 or n == len(b_cases):
            print(f"[llm] boundaries {n}/{len(b_cases)}  ({time.time() - t0:.0f}s)",
                  file=sys.stderr, flush=True)

    restyled = []
    for n, case in enumerate(r_cases, 1):
        text = case["text"]
        budget = min(2048, len(tok(text)["input_ids"]) * 2 + 64)
        if thinks:
            budget += 1024  # headroom for the reasoning block we then strip
        reply = clean_reply(
            generate(tok, model, RESTYLE_SYSTEM, RESTYLE_TEMPLATE.format(text=text), budget)
        )
        if reply:
            restyled.append({"id": case["id"], "text": reply})
        if n % 5 == 0 or n == len(r_cases):
            print(f"[llm] restyle {n}/{len(r_cases)}  ({time.time() - t0:.0f}s)",
                  file=sys.stderr, flush=True)

    print(json.dumps({"results": results, "restyled": restyled}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
