#!/usr/bin/env python3
"""Transcribe a folder of audio with WhisperX, then clean the transcripts.

Stage 1 (transcribe)
    Runs WhisperX once per audio file through `uvx`, with diarization, and
    writes the raw word-level JSON to <output_dir>/raw/.

Stage 2 (clean)
    Pure-stdlib, deterministic cleanup of that JSON, in this order:
      * diarization repair -- short speaker islands re-absorbed, and stranded
        fragments ("Oh,") moved to the speaker they are prosodically glued to,
        judged by the silence on each side rather than by wording
      * conservative filler-word removal (um / uh / erm / ...)
      * stutter collapse on function words ("the the" -> "the")
      * abandoned restarts dropped ("It's been... It's been fine" -> the second)
      * verbatim repeats of the previous segment dropped, the survivor's
        timestamp widened to span both
      * Whisper decoding loops collapsed (an n-gram repeated back to back)
      * regrouping into speaker turns

    Nothing is ever rewritten or paraphrased: every output token is a token
    WhisperX emitted. Two checks enforce that per file -- an exact accounting
    (every input token is either kept or dropped by a named pass) and a
    multiset containment test (no token appears in the output more often than
    in the source). A failure is reported and exits non-zero.

    With --llm MODEL a local Hugging Face model additionally
      * picks the true split point at ambiguous speaker boundaries, answering
        with a bare integer, so it can only move a speaker label; and
      * repunctuates and recapitalises each turn for readability.

    The restyled text is checked position by position against what WhisperX
    originally emitted: same token count, and every token identical once case
    and punctuation are stripped. A chunk that fails is discarded and the
    original kept, so the model can change how a line is punctuated but never
    which words it contains. Use --llm-tasks to run only one of the two.

Outputs, per audio file, in <output_dir>:
    raw/<stem>.json         verbatim WhisperX output
    <stem>.clean.json       cleaned segments with word-level timings + stats
    <stem>.clean.txt        [HH:MM:SS] SPEAKER_00: text

Examples:
    export HF_TOKEN=hf_...
    ./scripts/transcribe_and_clean.py scripts/                     # test.mp3
    ./scripts/transcribe_and_clean.py interviews/ -o out/ -v
    ./scripts/transcribe_and_clean.py interviews/ -o out/ --skip-transcribe
    ./scripts/transcribe_and_clean.py interviews/ -o out/ --skip-existing   # only new files
    ./scripts/transcribe_and_clean.py interviews/ -o out/ --llm Qwen/Qwen2.5-7B-Instruct
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import textwrap
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
LLM_HELPER = SCRIPT_DIR / "llm_speaker_refine.py"

AUDIO_EXTS = {
    ".mp3", ".wav", ".m4a", ".m4b", ".flac", ".ogg", ".oga", ".opus",
    ".aac", ".wma", ".mp4", ".mkv", ".mov", ".webm", ".avi",
}

# --------------------------------------------------------------------------
# Filler vocabulary
# --------------------------------------------------------------------------

# Non-lexical vocalisations only. These carry no propositional content, so
# dropping them cannot change what a speaker meant.
FILLERS_CONSERVATIVE = {
    "um", "umm", "ummm", "uhm", "uhmm",
    "uh", "uhh", "uhhh",
    "er", "err", "erm", "ermm",
    "ah", "ahh", "ahhh",
    "mm", "mmm", "hmm", "hmmm", "hm",
    "mhm", "mhmm", "mm-hmm", "mmhmm", "uh-huh", "uhhuh",
}

# Only used at --filler-level moderate. These *can* be meaningful, which is
# why they are off by default.
FILLERS_MODERATE_SINGLE = {"like", "basically", "literally", "actually"}
FILLERS_MODERATE_PHRASE = [
    ("you", "know"),
    ("i", "mean"),
    ("sort", "of"),
    ("kind", "of"),
]

# Words safe to de-duplicate when repeated back-to-back. Content words are
# excluded on purpose: "very very good" and "no no no" are not stutters.
STUTTER_WORDS = {
    "a", "an", "and", "as", "at", "be", "but", "did", "do", "does", "for",
    "had", "has", "have", "he", "i", "i'm", "if", "in", "is", "it", "it's",
    "its", "my", "of", "on", "or", "she", "so", "that", "the", "then",
    "there", "they", "they're", "this", "to", "was", "we", "we're", "were",
    "what", "when", "with", "you", "your",
}

SENT_END = re.compile(r"[.!?…]['\"”’)\]]*$")
_STRIP_CHARS = "\"'“”‘’„«».,!?;:()[]{}…—–-  "


def norm_word(text: str) -> str:
    """Casefolded, punctuation-stripped form used for all comparisons."""
    t = unicodedata.normalize("NFKC", text).strip().lower()
    return t.strip(_STRIP_CHARS)


# --------------------------------------------------------------------------
# Word stream
# --------------------------------------------------------------------------


@dataclass
class Word:
    text: str
    start: Optional[float]
    end: Optional[float]
    score: Optional[float]
    speaker: Optional[str]
    seg: int
    removed: Optional[str] = None  # None | filler | stutter | false_start | repeat | duplicate
    lead_trimmed: bool = False  # a dropped token sat immediately before this one
    orig_text: str = ""  # exactly as WhisperX emitted it; the restyle baseline

    def __post_init__(self) -> None:
        if not self.orig_text:
            self.orig_text = self.text


def load_words(data: dict) -> list[Word]:
    """Flatten WhisperX JSON into one word stream.

    Word-level speaker labels are preferred over segment-level ones because
    WhisperX assigns them from the diarization overlap directly.
    """
    words: list[Word] = []
    for si, seg in enumerate(data.get("segments") or []):
        seg_spk = seg.get("speaker")
        raw_words = seg.get("words") or []
        if raw_words:
            seg_words: list[Word] = []
            for w in raw_words:
                text = str(w.get("word") or "").strip()
                if not text:
                    continue
                seg_words.append(
                    Word(
                        text=text,
                        start=_as_float(w.get("start")),
                        end=_as_float(w.get("end")),
                        score=_as_float(w.get("score")),
                        speaker=w.get("speaker") or seg_spk,
                        seg=si,
                    )
                )
            # Numerals and symbols often come back unaligned; anchor them to
            # the segment's own span rather than to distant neighbours.
            fill_within_segment(seg_words, _as_float(seg.get("start")), _as_float(seg.get("end")))
            words.extend(seg_words)
        else:
            # No alignment for this segment: spread the segment span evenly.
            toks = str(seg.get("text") or "").split()
            if not toks:
                continue
            s = _as_float(seg.get("start"))
            e = _as_float(seg.get("end"))
            for i, tok in enumerate(toks):
                ws = we = None
                if s is not None and e is not None and e >= s:
                    step = (e - s) / len(toks)
                    ws, we = s + i * step, s + (i + 1) * step
                words.append(Word(tok, ws, we, None, seg_spk, si))
    return words


def _as_float(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fill_within_segment(seg_words: list[Word], s: Optional[float], e: Optional[float]) -> None:
    """Interpolate missing word timings inside one segment, bounded by its span."""
    if not seg_words or s is None or e is None or e < s:
        return
    if all(w.start is not None and w.end is not None for w in seg_words):
        return
    head = Word("", s, s, None, None, -1)
    tail = Word("", e, e, None, None, -1)
    padded = [head] + seg_words + [tail]
    fill_timings(padded)


def fill_timings(words: list[Word]) -> None:
    """Interpolate timings for tokens WhisperX could not align."""
    n = len(words)
    known = [i for i, w in enumerate(words) if w.start is not None and w.end is not None]
    if not known:
        for i, w in enumerate(words):
            w.start, w.end = float(i), float(i) + 1.0
        return
    first, last = known[0], known[-1]
    for i in range(first):
        words[i].start = words[i].end = words[first].start
    for i in range(last + 1, n):
        words[i].start = words[i].end = words[last].end
    for a, b in zip(known, known[1:]):
        if b - a <= 1:
            continue
        t0 = words[a].end or 0.0
        t1 = words[b].start or t0
        step = max(0.0, t1 - t0) / (b - a)
        for k in range(a + 1, b):
            words[k].start = t0 + step * (k - a - 1)
            words[k].end = t0 + step * (k - a)
    for w in words:  # monotonicity guard
        if w.end is None or w.start is None:
            w.start, w.end = w.start or 0.0, w.end or (w.start or 0.0)
        if w.end < w.start:
            w.end = w.start


def fill_speakers(words: list[Word]) -> None:
    """Forward- then backward-fill any word the diarizer left unlabelled."""
    last: Optional[str] = None
    for w in words:
        if w.speaker:
            last = w.speaker
        elif last:
            w.speaker = last
    nxt: Optional[str] = None
    for w in reversed(words):
        if w.speaker:
            nxt = w.speaker
        elif nxt:
            w.speaker = nxt
    for w in words:
        if not w.speaker:
            w.speaker = "SPEAKER_00"


# --------------------------------------------------------------------------
# Deterministic cleaning passes
# --------------------------------------------------------------------------


def remove_fillers(words: list[Word], level: str, extra: set[str]) -> int:
    if level == "none" and not extra:
        return 0
    singles = set(extra)
    phrases: list[tuple[str, ...]] = []
    if level in ("conservative", "moderate"):
        singles |= FILLERS_CONSERVATIVE
    if level == "moderate":
        singles |= FILLERS_MODERATE_SINGLE
        phrases += FILLERS_MODERATE_PHRASE
    phrases.sort(key=len, reverse=True)

    norms = [norm_word(w.text) for w in words]
    removed = 0
    i = 0
    while i < len(words):
        hit = False
        for ph in phrases:
            L = len(ph)
            if tuple(norms[i : i + L]) == ph and all(w.removed is None for w in words[i : i + L]):
                for w in words[i : i + L]:
                    w.removed = "filler"
                removed += L
                i += L
                hit = True
                break
        if hit:
            continue
        if norms[i] in singles and words[i].removed is None:
            words[i].removed = "filler"
            removed += 1
        i += 1
    return removed


def drop_truncated(words: list[Word]) -> int:
    """Remove obvious cut-off words such as 'th-' or 'wh-'."""
    pat = re.compile(r"^[A-Za-z]{1,3}-[,.]?$")
    removed = 0
    for w in words:
        if w.removed is None and pat.match(w.text.strip()):
            w.removed = "filler"
            removed += 1
    return removed


def collapse_stutters(words: list[Word]) -> int:
    """'the the thing' -> 'the thing', keeping the widest timestamp."""
    live = [w for w in words if w.removed is None]
    removed = 0
    for a, b in zip(live, live[1:]):
        if a.removed is not None:
            continue
        na, nb = norm_word(a.text), norm_word(b.text)
        if na and na == nb and na in STUTTER_WORDS and a.speaker == b.speaker:
            b.start = a.start  # the surviving token now covers both
            a.removed = "stutter"
            removed += 1
    return removed


def collapse_repeats(words: list[Word], min_n: int, max_n: int = 25) -> tuple[int, int]:
    """Collapse an immediately repeated run of >= min_n words.

    Targets Whisper's decoding loops ("the same sentence three times"). The
    n-gram floor keeps genuine short echoes ("no no", "I know I know") intact.
    """
    if min_n <= 0:
        return 0, 0
    live = [w for w in words if w.removed is None]
    norms = [norm_word(w.text) for w in live]
    n_words = 0
    n_groups = 0
    i = 0
    while i < len(live):
        best = 0
        upper = min(max_n, (len(live) - i) // 2)
        for n in range(upper, min_n - 1, -1):
            if norms[i : i + n] != norms[i + n : i + 2 * n]:
                continue
            if not all(norms[i : i + n]):
                continue
            if len({w.speaker for w in live[i : i + 2 * n]}) != 1:
                continue
            best = n
            break
        if not best:
            i += 1
            continue
        n = best
        spk = live[i].speaker
        j = i + n
        while (
            j + n <= len(live)
            and norms[i : i + n] == norms[j : j + n]
            and all(w.speaker == spk for w in live[j : j + n])
        ):
            for w in live[j : j + n]:
                w.removed = "repeat"
            n_words += n
            n_groups += 1
            j += n
        keep_last = live[i + n - 1]
        keep_last.end = max(keep_last.end or 0.0, live[j - 1].end or 0.0)
        i = j
    return n_words, n_groups


def smooth_speakers(words: list[Word], max_island: int, max_gap: float) -> int:
    """Re-absorb short speaker islands wedged inside another speaker's turn.

    Islands are handled shortest-first, and a run whose neighbour was just
    relabelled is deferred to the next pass. Without that, a one-word
    diarization error can make the correct run beside it look like the island.

    `max_gap` here is deliberately tiny: a genuine short turn (a back-channel
    like "Right." or "Mm-hmm") sits behind a real pause, while a diarization
    glitch lands mid-stream with no pause at all. Only the latter is absorbed.
    """
    if max_island <= 0:
        return 0
    live = [w for w in words if w.removed is None]
    total = 0
    for _ in range(10):
        runs: list[list[Any]] = []
        for w in live:
            if runs and runs[-1][0] == w.speaker:
                runs[-1][1].append(w)
            else:
                runs.append([w.speaker, [w]])

        cands = []
        for k in range(1, len(runs) - 1):
            spk, grp = runs[k]
            pspk, pgrp = runs[k - 1]
            nspk, ngrp = runs[k + 1]
            if pspk != nspk or pspk == spk or len(grp) > max_island:
                continue
            if (grp[0].start or 0.0) - (pgrp[-1].end or 0.0) > max_gap:
                continue
            if (ngrp[0].start or 0.0) - (grp[-1].end or 0.0) > max_gap:
                continue
            cands.append((len(grp), k, pspk, grp))

        cands.sort(key=lambda c: (c[0], c[1]))  # shortest island wins the tie
        dirty: set[int] = set()
        changed = 0
        for _len, k, pspk, grp in cands:
            if {k - 1, k, k + 1} & dirty:
                continue
            for w in grp:
                w.speaker = pspk
            dirty |= {k - 1, k, k + 1}
            changed += len(grp)
        total += changed
        if not changed:
            break
    return total


def reattach_orphan_runs(
    words: list[Word], max_len: int, tight_gap: float, margin: float
) -> int:
    """Move a stranded fragment to the speaker it is prosodically glued to.

    Diarization routinely mislabels the opening word or two of a turn, leaving
    a fragment like "Oh," attached to the previous speaker's run. The giveaway
    is gap asymmetry: a long silence *inside* the run just before the fragment,
    and almost none at the speaker boundary right after it. That means the
    fragment opens the next turn rather than closing the last one.

    Only fragments up to `max_len` words move, only across a boundary with no
    real pause, and only when the silence on the far side is at least `margin`
    seconds longer. A boundary with a genuine pause on both sides is left
    alone, as is any run this would empty.
    """
    if max_len <= 0:
        return 0
    live = [w for w in words if w.removed is None]
    total = 0
    for _ in range(5):
        runs: list[list[Word]] = []
        for w in live:
            if runs and runs[-1][0].speaker == w.speaker:
                runs[-1].append(w)
            else:
                runs.append([w])

        best: Optional[tuple[float, int, str, list[Word]]] = None
        for i in range(len(runs) - 1):
            cur, nxt = runs[i], runs[i + 1]
            boundary_gap = (nxt[0].start or 0.0) - (cur[-1].end or 0.0)
            if boundary_gap > tight_gap:
                continue  # a real pause: the boundary is credible as-is

            # Tail of `cur` that actually belongs to the next speaker.
            if not SENT_END.search(cur[-1].text.strip()):
                for m in range(1, min(max_len, len(cur) - 1) + 1):
                    inner = (cur[-m].start or 0.0) - (cur[-m - 1].end or 0.0)
                    if inner >= boundary_gap + margin:
                        cand = (inner - boundary_gap, i, nxt[0].speaker, cur[-m:])
                        if best is None or cand[0] > best[0]:
                            best = cand

            # Head of `nxt` that actually belongs to the previous speaker.
            if not SENT_END.search(cur[-1].text.strip()):
                for m in range(1, min(max_len, len(nxt) - 1) + 1):
                    inner = (nxt[m].start or 0.0) - (nxt[m - 1].end or 0.0)
                    if inner >= boundary_gap + margin:
                        cand = (inner - boundary_gap, i, cur[-1].speaker, nxt[:m])
                        if best is None or cand[0] > best[0]:
                            best = cand

        if best is None:
            break
        _score, _i, target, grp = best
        for w in grp:
            w.speaker = target
        total += len(grp)
    return total


ABANDONED = re.compile(r"(\.{2,}|…|[-–—])$")


def collapse_false_starts(words: list[Word], max_k: int = 8) -> int:
    """Drop an attempt the speaker abandoned and immediately restarted.

    "It's been... It's been a bit tough" -> "It's been a bit tough". Only fires
    when the first copy visibly trails off (ellipsis or dash), which is how
    Whisper marks a self-repair; the later, completed attempt is the one kept,
    and it inherits the abandoned attempt's start time.
    """
    live = [w for w in words if w.removed is None]
    norms = [norm_word(w.text) for w in live]
    removed = 0
    i = 1
    while i < len(live):
        best = 0
        upper = min(max_k, i, len(live) - i)
        for k in range(upper, 1, -1):
            if norms[i - k : i] != norms[i : i + k]:
                continue
            if not all(norms[i - k : i]):
                continue
            if len({w.speaker for w in live[i - k : i + k]}) != 1:
                continue
            if not ABANDONED.search(live[i - 1].text.strip()):
                continue
            best = k
            break
        if not best:
            i += 1
            continue
        k = best
        live[i].start = live[i - k].start
        for w in live[i - k : i]:
            w.removed = "false_start"
        removed += k
        i += k
    return removed


def merge_duplicate_source_segments(words: list[Word], dup_max_gap: float) -> int:
    """Drop a WhisperX segment that repeats the one before it verbatim.

    The surviving copy's timestamp is widened to cover both, so a phrase
    emitted twice on consecutive timestamps becomes one entry spanning them.
    """
    live = [w for w in words if w.removed is None]
    if not live:
        return 0
    blocks: list[list[Word]] = []
    for w in live:
        if blocks and blocks[-1][0].seg == w.seg:
            blocks[-1].append(w)
        else:
            blocks.append([w])

    removed = 0
    keep = blocks[0]
    for blk in blocks[1:]:
        same_text = [norm_word(w.text) for w in keep] == [norm_word(w.text) for w in blk]
        same_spk = keep[0].speaker == blk[0].speaker
        gap = (blk[0].start or 0.0) - (keep[-1].end or 0.0)
        if same_text and same_spk and gap <= dup_max_gap and any(norm_word(w.text) for w in keep):
            for w in blk:
                w.removed = "duplicate"
            removed += len(blk)
            keep[-1].end = max(keep[-1].end or 0.0, blk[-1].end or 0.0)
        else:
            keep = blk
    return removed


def mark_lead_trimmed(words: list[Word]) -> None:
    """Flag live words whose immediate predecessor was dropped."""
    prev_removed = False
    for w in words:
        if w.removed is None:
            w.lead_trimmed = prev_removed
            prev_removed = False
        else:
            prev_removed = True


# --------------------------------------------------------------------------
# Segmentation and rendering
# --------------------------------------------------------------------------


def group_segments(words: list[Word], max_gap: float, max_dur: float) -> list[list[Word]]:
    """Group the live word stream into speaker turns."""
    groups: list[list[Word]] = []
    cur: list[Word] = []
    for w in (x for x in words if x.removed is None):
        if not cur:
            cur = [w]
            continue
        prev = cur[-1]
        gap = (w.start or 0.0) - (prev.end or 0.0)
        too_long = (
            max_dur > 0
            and ((w.end or 0.0) - (cur[0].start or 0.0)) > max_dur
            and bool(SENT_END.search(prev.text.strip()))
        )
        if w.speaker != prev.speaker or gap > max_gap or too_long:
            groups.append(cur)
            cur = [w]
        else:
            cur.append(w)
    if cur:
        groups.append(cur)
    return groups


def render_text(group: list[Word], recapitalize: bool) -> str:
    parts = [w.text.strip() for w in group if w.text.strip()]
    s = " ".join(parts)
    s = re.sub(r"\s+([,.!?;:%])", r"\1", s)
    s = re.sub(r"\s{2,}", " ", s).strip()
    s = re.sub(r"^[,;:]+\s*", "", s)
    # Only re-capitalise when a dropped filler used to hold that position, so
    # we never touch casing the transcriber actually produced.
    if recapitalize and s and getattr(group[0], "lead_trimmed", False):
        m = re.match(r"\W*(\w+)", s)
        # Skip anything already carrying case, so "iPhone" survives intact.
        if m and m.group(1).isalpha() and m.group(1).islower():
            i = m.start(1)
            s = s[:i] + s[i].upper() + s[i + 1 :]
    return s


def build_segments(
    groups: list[list[Word]], recapitalize: bool, dup_max_gap: float
) -> tuple[list[dict], int]:
    """Render groups to segments, merging consecutive duplicates."""
    out: list[dict] = []
    merged = 0
    for grp in groups:
        text = render_text(grp, recapitalize)
        if not text:
            continue
        seg = {
            "start": round(min(w.start or 0.0 for w in grp), 3),
            "end": round(max(w.end or 0.0 for w in grp), 3),
            "speaker": grp[0].speaker,
            "text": text,
            "words": [
                {
                    "word": w.text,
                    "start": round(w.start, 3) if w.start is not None else None,
                    "end": round(w.end, 3) if w.end is not None else None,
                    "score": round(w.score, 4) if w.score is not None else None,
                    "speaker": w.speaker,
                }
                for w in grp
            ],
            "merged_duplicates": 0,
        }
        norm = " ".join(norm_word(w.text) for w in grp).strip()
        if out:
            prev = out[-1]
            same = (
                prev["speaker"] == seg["speaker"]
                and prev["_norm"] == norm
                and norm
                and seg["start"] - prev["end"] <= dup_max_gap
            )
            if same:
                # Same words said again back-to-back: one entry, widened span.
                prev["end"] = max(prev["end"], seg["end"])
                prev["merged_duplicates"] += 1
                merged += 1
                continue
        seg["_norm"] = norm
        out.append(seg)
    for i, seg in enumerate(out):
        seg.pop("_norm", None)
        seg["id"] = i
    return out, merged


def fmt_ts(seconds: float) -> str:
    s = max(0, int(round(seconds)))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def render_txt(segments: list[dict], source: str, width: int) -> str:
    speakers = sorted({s["speaker"] or "?" for s in segments})
    label_w = max((len(s) for s in speakers), default=10)
    lines = [f"# {source}", f"# speakers: {', '.join(speakers) or 'none'}", ""]
    for seg in segments:
        prefix = f"[{fmt_ts(seg['start'])}] {(seg['speaker'] or '?'):<{label_w}}: "
        body = textwrap.wrap(
            seg["text"],
            width=max(20, width - len(prefix)),
            break_on_hyphens=False,
            break_long_words=False,
        ) or [""]
        lines.append(prefix + body[0])
        for extra in body[1:]:
            lines.append(" " * len(prefix) + extra)
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# Integrity check
# --------------------------------------------------------------------------


def verify(words: list[Word], segments: list[dict], counts: dict) -> list[str]:
    """Prove no content was invented or silently altered.

    1. Exact accounting: every input token is either kept or removed by a
       named pass.
    2. Per-position identity: restyling may change a word's case and the
       punctuation around it, never its letters. Checked against the text
       WhisperX originally emitted, not against the current text, so a
       restyled word cannot vouch for itself.
    3. Multiset containment: the rendered output contains no token that the
       transcript did not already contain, at no higher multiplicity.
    """
    problems: list[str] = []
    total = len(words)
    kept = sum(1 for w in words if w.removed is None)
    by_reason = Counter(w.removed for w in words if w.removed is not None)
    accounted = kept + sum(by_reason.values())
    if accounted != total:
        problems.append(f"token accounting mismatch: {accounted} != {total}")
    for reason, key in (
        ("filler", "fillers_removed"),
        ("stutter", "stutters_collapsed"),
        ("false_start", "false_start_words_removed"),
        ("repeat", "repeat_words_removed"),
        ("duplicate", "duplicate_words_removed"),
    ):
        if by_reason.get(reason, 0) != counts.get(key, 0):
            problems.append(
                f"{reason} count mismatch: marked {by_reason.get(reason, 0)} vs reported {counts.get(key, 0)}"
            )

    altered = [
        (w.orig_text, w.text) for w in words if norm_word(w.text) != norm_word(w.orig_text)
    ]
    for before, after in altered[:5]:
        problems.append(f"restyle altered a word: {before!r} -> {after!r}")
    if len(altered) > 5:
        problems.append(f"...and {len(altered) - 5} more altered words")

    source = Counter(n for n in (norm_word(w.orig_text) for w in words) if n)
    rendered = Counter()
    for seg in segments:
        for tok in seg["text"].split():
            n = norm_word(tok)
            if n:
                rendered[n] += 1
    for tok, c in rendered.items():
        if c > source.get(tok, 0):
            problems.append(
                f"hallucination check failed: '{tok}' appears {c}x in output, {source.get(tok, 0)}x in source"
            )
    return problems


# --------------------------------------------------------------------------
# Optional LLM speaker-boundary refinement
# --------------------------------------------------------------------------


def llm_candidates(groups: list[list[Word]], window: int, limit: int) -> list[dict]:
    """Find speaker switches that look unreliable.

    A switch mid-sentence, or with no pause at all, is the usual diarization
    error. Clean switches after a full stop with a real pause are left alone.
    """
    cands: list[dict] = []
    for i in range(len(groups) - 1):
        a, b = groups[i], groups[i + 1]
        if a[-1].speaker == b[0].speaker:
            continue
        mid_sentence = not SENT_END.search(a[-1].text.strip())
        gap = (b[0].start or 0.0) - (a[-1].end or 0.0)
        score = (1.0 if mid_sentence else 0.0) + (1.0 if gap < 0.15 else 0.0)
        if score <= 0:
            continue
        left, right = a[-window:], b[:window]
        cands.append(
            {
                "id": len(cands),
                "score": score,
                "split": len(left),
                "speaker_a": a[-1].speaker,
                "speaker_b": b[0].speaker,
                "words": [w.text for w in left + right],
                "_words": left + right,
            }
        )
    cands.sort(key=lambda c: -c["score"])
    return cands[:limit]


def restyle_chunks(groups: list[list[Word]], chunk_size: int) -> list[dict]:
    """Split each turn into chunks the model can repunctuate in one pass.

    Chunks never straddle a speaker turn, and a chunk is extended past its
    nominal size to the next sentence end where one is close, so the model
    rarely has to punctuate a fragment it cannot see the end of.
    """
    cases: list[dict] = []
    for grp in groups:
        i = 0
        while i < len(grp):
            j = min(i + chunk_size, len(grp))
            limit = min(i + chunk_size * 2, len(grp))
            while j < limit and not SENT_END.search(grp[j - 1].text.strip()):
                j += 1
            chunk = grp[i:j]
            cases.append(
                {
                    "id": len(cases),
                    "text": " ".join(w.text for w in chunk),
                    "_words": chunk,
                }
            )
            i = j
    return cases


def allowed_split_range(words: list[Word], old: int, max_gap: float) -> tuple[int, int]:
    """Positions the LLM is allowed to move a speaker boundary to.

    A boundary sitting in a real silence is already well evidenced, so it does
    not move at all. Otherwise the boundary may slide only within the run of
    positions where speech is continuous -- it may never be swept across a
    pause, because that pause is stronger evidence than the model's guess.
    """

    def gap_at(i: int) -> float:
        return (words[i].start or 0.0) - (words[i - 1].end or 0.0)

    n = len(words)
    if not (1 <= old <= n - 1) or gap_at(old) > max_gap:
        return old, old
    lo = old
    while lo - 1 >= 1 and gap_at(lo - 1) <= max_gap:
        lo -= 1
    hi = old
    while hi + 1 <= n - 1 and gap_at(hi + 1) <= max_gap:
        hi += 1
    return lo, hi


def accept_restyle(new_text: str, chunk: list[Word]) -> bool:
    """Apply a restyled chunk only if it is the same words, differently dressed.

    Token count must match exactly and every token must be identical once case
    and punctuation are stripped. That admits "so what" -> "So, what?" and
    rejects a dropped word, a reordering, "gonna" -> "going to", or anything
    the model decided to add.
    """
    toks = new_text.split()
    if len(toks) != len(chunk):
        return False
    if any(norm_word(t) != norm_word(w.text) for t, w in zip(toks, chunk)):
        return False
    for t, w in zip(toks, chunk):
        w.text = t
    return True


def apply_llm(groups: list[list[Word]], args: argparse.Namespace) -> dict:
    """One subprocess, one model load, both refinement tasks."""
    do_bounds = args.llm_tasks in ("both", "boundaries")
    do_style = args.llm_tasks in ("both", "restyle")

    bounds = llm_candidates(groups, args.llm_window, args.llm_max_boundaries) if do_bounds else []
    styles = restyle_chunks(groups, args.llm_restyle_chunk) if do_style else []

    info: dict = {
        "model": args.llm,
        "tasks": args.llm_tasks,
        "boundaries_considered": len(bounds),
        "boundaries_moved": 0,
        "words_reassigned": 0,
        "restyle_chunks": len(styles),
        "restyle_accepted": 0,
        "restyle_rejected": 0,
    }
    if not bounds and not styles:
        return info
    if not LLM_HELPER.exists():
        info["error"] = f"helper not found: {LLM_HELPER}"
        return info

    payload = {
        "model": args.llm,
        "device": args.llm_device,
        "boundary_cases": [
            {k: c[k] for k in ("id", "split", "speaker_a", "speaker_b", "words")} for c in bounds
        ],
        "restyle_cases": [{k: c[k] for k in ("id", "text")} for c in styles],
    }
    # stdout is the JSON channel, so it is captured; stderr is left attached to
    # the terminal so weight downloads and per-chunk progress are visible. A
    # silent multi-gigabyte download is indistinguishable from a hang.
    try:
        proc = subprocess.run(
            ["uv", "run", "--script", str(LLM_HELPER)],
            input=json.dumps(payload),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE if args.quiet else None,
            timeout=args.llm_timeout or None,
        )
    except subprocess.TimeoutExpired:
        info["error"] = (
            f"llm helper exceeded --llm-timeout ({args.llm_timeout}s); "
            "deterministic result kept"
        )
        return info
    if proc.returncode != 0:
        info["error"] = f"llm helper exited {proc.returncode}"
        if proc.stderr:
            info["stderr_tail"] = proc.stderr[-800:]
            sys.stderr.write(proc.stderr[-2000:])
        return info
    try:
        result = json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as exc:
        info["error"] = f"unparseable llm output: {exc}"
        return info

    # --- speaker boundaries: the reply is an int, so only labels can move ---
    by_id = {c["id"]: c for c in bounds}
    claimed: set[int] = set()
    for r in result.get("results", []):
        c = by_id.get(r.get("id"))
        if not c:
            continue
        words = c["_words"]
        ids = {id(w) for w in words}
        if ids & claimed:  # overlapping windows: first one wins
            continue
        try:
            split = int(r["split"])
        except (KeyError, TypeError, ValueError):
            continue
        old = c["split"]
        # Bound the move twice over: by window, and by the timing evidence. A
        # boundary that already sits in a real silence is well evidenced, and a
        # move that would sweep the boundary across one is contradicting the
        # audio -- the model is only useful where the pauses are ambiguous.
        lo, hi = allowed_split_range(words, old, args.llm_boundary_gap)
        lo = max(lo, old - args.llm_window // 2, 1)
        hi = min(hi, old + args.llm_window // 2, len(words) - 1)
        split = max(lo, min(hi, split))
        if split == old:
            continue
        claimed |= ids
        for w in words[:split]:
            w.speaker = c["speaker_a"]
        for w in words[split:]:
            w.speaker = c["speaker_b"]
        info["boundaries_moved"] += 1
        info["words_reassigned"] += abs(split - old)

    # --- restyling: each chunk is verified before it is allowed to land ---
    style_by_id = {c["id"]: c for c in styles}
    seen: set[int] = set()
    for r in result.get("restyled", []):
        c = style_by_id.get(r.get("id"))
        if not c or c["id"] in seen:
            continue
        seen.add(c["id"])
        if accept_restyle(str(r.get("text") or ""), c["_words"]):
            info["restyle_accepted"] += 1
        else:
            info["restyle_rejected"] += 1
    info["restyle_rejected"] += len(styles) - len(seen)
    return info


# --------------------------------------------------------------------------
# Cleaning driver
# --------------------------------------------------------------------------


def cleaning_params(args: argparse.Namespace) -> dict:
    """Every setting that affects the cleaned output.

    Recorded in each .clean.json so a later --skip-existing run can tell
    "already done" from "done with different settings".
    """
    return {
        "filler_level": args.filler_level,
        "collapse_stutters": args.collapse_stutters,
        "drop_truncated": args.drop_truncated,
        "min_repeat_ngram": args.min_repeat_ngram,
        "speaker_island": args.speaker_island,
        "speaker_island_gap": args.speaker_island_gap,
        "speaker_orphan": args.speaker_orphan,
        "speaker_orphan_margin": args.speaker_orphan_margin,
        "drop_false_starts": args.drop_false_starts,
        "max_gap": args.max_gap,
        "max_segment_duration": args.max_segment_duration,
        "dup_max_gap": args.dup_max_gap,
        "recapitalize": args.recapitalize,
        "llm_model": args.llm,
        "llm_tasks": args.llm_tasks if args.llm else None,
    }


def expected_outputs(
    audio: Path, out_dir: Path, raw_dir: Path, args: argparse.Namespace
) -> list[Path]:
    """The files a complete run leaves behind for this audio file."""
    if args.skip_clean:
        return [raw_dir / f"{audio.stem}.json"]
    return [out_dir / f"{audio.stem}.clean.json", out_dir / f"{audio.stem}.clean.txt"]


def already_processed(
    audio: Path, out_dir: Path, raw_dir: Path, args: argparse.Namespace
) -> tuple[bool, str]:
    """Is this file done, and done with the settings in force now?

    Returns (skip, note). A source file edited since its outputs were written
    is not considered done, so re-dropping a corrected recording under the same
    name still reprocesses it.
    """
    targets = expected_outputs(audio, out_dir, raw_dir, args)
    missing = [t.name for t in targets if not t.exists()]
    if missing:
        return False, ""
    try:
        src_mtime = audio.stat().st_mtime
    except OSError:
        src_mtime = 0.0
    if any(t.stat().st_mtime < src_mtime for t in targets):
        return False, "source is newer than its outputs"

    note = ""
    clean_json = out_dir / f"{audio.stem}.clean.json"
    if clean_json.exists():
        try:
            stored = json.loads(clean_json.read_text(encoding="utf-8")).get("cleaning") or {}
        except (OSError, ValueError):
            stored = {}
        if stored:
            current = cleaning_params(args)
            drift = sorted(k for k, v in current.items() if stored.get(k) != v)
            if drift:
                note = "settings differ from this run: " + ", ".join(drift)
    return True, note


def clean_transcript(data: dict, args: argparse.Namespace, source: str) -> dict:
    words = load_words(data)
    if not words:
        return {
            "source_audio": source,
            "language": data.get("language"),
            "speakers": [],
            "speakers_detected_raw": [],
            "duration": 0.0,
            "cleaning": {},
            "stats": {"words_in": 0, "words_kept": 0, "segments_in": 0, "segments_out": 0},
            "integrity": {"verified": True, "problems": []},
            "warnings": ["no words in transcript"],
            "segments": [],
        }

    fill_timings(words)
    fill_speakers(words)
    speakers_in = sorted({w.speaker for w in words if w.speaker})

    counts = {"words_in": len(words)}
    # Smooth first: the stutter, duplicate and repeat passes all compare
    # speaker labels, so they need trustworthy ones.
    counts["speaker_words_smoothed"] = smooth_speakers(
        words, args.speaker_island, args.speaker_island_gap
    )
    counts["speaker_words_reattached"] = reattach_orphan_runs(
        words, args.speaker_orphan, args.speaker_island_gap, args.speaker_orphan_margin
    )
    counts["speaker_words_smoothed"] += smooth_speakers(
        words, args.speaker_island, args.speaker_island_gap
    )
    extra = load_extra_fillers(args.filler_file)
    counts["fillers_removed"] = remove_fillers(words, args.filler_level, extra)
    if args.drop_truncated:
        counts["fillers_removed"] += drop_truncated(words)
    counts["stutters_collapsed"] = collapse_stutters(words) if args.collapse_stutters else 0
    counts["false_start_words_removed"] = (
        collapse_false_starts(words) if args.drop_false_starts else 0
    )
    counts["duplicate_words_removed"] = merge_duplicate_source_segments(words, args.dup_max_gap)
    rep_words, rep_groups = collapse_repeats(words, args.min_repeat_ngram)
    counts["repeat_words_removed"] = rep_words
    counts["repeat_groups_collapsed"] = rep_groups
    mark_lead_trimmed(words)

    groups = group_segments(words, args.max_gap, args.max_segment_duration)
    llm_info = None
    if args.llm:
        llm_info = apply_llm(groups, args)
        groups = group_segments(words, args.max_gap, args.max_segment_duration)

    segments, merged = build_segments(groups, args.recapitalize, args.dup_max_gap)
    counts["duplicate_segments_merged"] = merged
    counts["words_kept"] = sum(1 for w in words if w.removed is None)
    counts["segments_in"] = len(data.get("segments") or [])
    counts["segments_out"] = len(segments)

    problems = verify(words, segments, counts)

    out = {
        "source_audio": source,
        "language": data.get("language"),
        "speakers": sorted({s["speaker"] for s in segments if s["speaker"]}),
        "speakers_detected_raw": speakers_in,
        "duration": round(max((s["end"] for s in segments), default=0.0), 3),
        "cleaning": {**cleaning_params(args), "llm": llm_info},
        "stats": counts,
        "integrity": {"verified": not problems, "problems": problems},
        "segments": segments,
    }
    return out


def load_extra_fillers(path: Optional[str]) -> set[str]:
    if not path:
        return set()
    out: set[str] = set()
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.add(norm_word(line))
    return out


# --------------------------------------------------------------------------
# Transcription driver
# --------------------------------------------------------------------------


def build_whisperx_cmd(audio: Path, raw_dir: Path, args: argparse.Namespace, refresh: bool) -> list[str]:
    cmd = ["uvx"]
    if refresh:
        cmd.append("--refresh")
    cmd += ["--python", args.uv_python, f"whisperx@{args.whisperx_version}", str(audio)]
    cmd += ["--model", args.model]
    cmd += ["--output_dir", str(raw_dir)]
    cmd += ["--output_format", args.output_format]
    cmd += ["--device", args.device]
    cmd += ["--compute_type", args.compute_type]
    cmd += ["--batch_size", str(args.batch_size)]
    if args.language and args.language != "auto":
        cmd += ["--language", args.language]
    if args.diarize:
        cmd += ["--diarize"]
        if args.min_speakers:
            cmd += ["--min_speakers", str(args.min_speakers)]
        if args.max_speakers:
            cmd += ["--max_speakers", str(args.max_speakers)]
    if args.hf_token:
        cmd += ["--hf_token", args.hf_token]
    for extra in args.whisperx_arg or []:
        cmd += extra.split(" ", 1) if " " in extra else [extra]
    return cmd


def redact(cmd: list[str], token: Optional[str]) -> str:
    shown = [("<HF_TOKEN>" if token and c == token else c) for c in cmd]
    return " ".join(shown)


def find_audio(root: Path, recursive: bool) -> list[Path]:
    it = root.rglob("*") if recursive else root.glob("*")
    return sorted(p for p in it if p.is_file() and p.suffix.lower() in AUDIO_EXTS)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="transcribe_and_clean.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("input_dir", type=Path, help="folder containing audio files")
    p.add_argument("-o", "--output-dir", type=Path, default=None,
                   help="where to write results (default: <input_dir>/transcripts)")
    p.add_argument("-r", "--recursive", action="store_true", help="descend into subfolders")
    p.add_argument("-q", "--quiet", action="store_true",
                   help="capture WhisperX and model output instead of streaming it "
                        "(shown only on failure)")
    p.add_argument("-v", "--verbose", action="store_true", help="extra diagnostics on failure")

    g = p.add_argument_group("stages")
    g.add_argument("--skip-transcribe", action="store_true", help="clean existing raw JSON only")
    g.add_argument("--skip-clean", action="store_true", help="transcribe only")
    g.add_argument("--overwrite", action="store_true", help="re-transcribe even if raw JSON exists")
    g.add_argument("--skip-existing", action="store_true",
                   help="skip any file whose outputs already exist, so dropping a new "
                        "recording into the folder processes only that one")
    g.add_argument("--dry-run", action="store_true", help="print the WhisperX commands and exit")

    w = p.add_argument_group("whisperx")
    w.add_argument("--model", default="large-v2")
    w.add_argument("--language", default="en", help="'auto' to detect per file (default: en)")
    w.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    w.add_argument("--compute-type", default="float16", help="float16 | int8 | float32")
    w.add_argument("--batch-size", type=int, default=16)
    w.add_argument("--no-diarize", dest="diarize", action="store_false", default=True)
    w.add_argument("--min-speakers", type=int, default=2)
    w.add_argument("--max-speakers", type=int, default=2)
    w.add_argument("--output-format", default="json", help="json (default) or 'all' to also get srt/vtt")
    w.add_argument("--hf-token", default=os.environ.get("HF_TOKEN"), help="default: $HF_TOKEN")
    w.add_argument("--whisperx-version", default="3.8.6")
    w.add_argument("--uv-python", default="3.12")
    w.add_argument("--refresh", choices=["first", "always", "never"], default="first",
                   help="uvx --refresh policy (default: first file only)")
    w.add_argument("--whisperx-arg", action="append", metavar="ARG",
                   help="extra flag passed through to whisperx (repeatable)")

    c = p.add_argument_group("cleaning")
    c.add_argument("--filler-level", choices=["none", "conservative", "moderate"], default="conservative")
    c.add_argument("--filler-file", help="extra filler words, one per line")
    c.add_argument("--no-collapse-stutters", dest="collapse_stutters", action="store_false", default=True)
    c.add_argument("--drop-truncated", action="store_true", help="also drop cut-off words like 'th-'")
    c.add_argument("--no-drop-false-starts", dest="drop_false_starts", action="store_false", default=True,
                   help="keep abandoned restarts like 'It\'s been... It\'s been a bit tough'")
    c.add_argument("--min-repeat-ngram", type=int, default=3,
                   help="collapse immediately repeated runs of >= N words (0 disables)")
    c.add_argument("--speaker-island", type=int, default=2,
                   help="max words of a speaker island re-absorbed into its neighbours")
    c.add_argument("--speaker-orphan", type=int, default=2,
                   help="max words of a stranded run moved to the speaker it abuts (0 disables)")
    c.add_argument("--speaker-orphan-margin", type=float, default=0.5,
                   help="how much longer the pause on the far side must be to justify the move")
    c.add_argument("--speaker-island-gap", type=float, default=0.25,
                   help="an island is only absorbed if the pause each side is under this "
                        "(keeps genuine back-channels like 'Right.')")
    c.add_argument("--max-gap", type=float, default=2.0, help="silence that starts a new segment")
    c.add_argument("--max-segment-duration", type=float, default=30.0, help="0 disables")
    c.add_argument("--dup-max-gap", type=float, default=2.0,
                   help="max silence between identical segments still merged")
    c.add_argument("--no-recapitalize", dest="recapitalize", action="store_false", default=True)
    c.add_argument("--wrap", type=int, default=100, help="line width of the .txt output")

    l = p.add_argument_group(
        "optional local LLM (speaker boundaries + punctuation/casing; never wording)"
    )
    l.add_argument("--llm", metavar="MODEL", help="e.g. Qwen/Qwen3.5-4B")
    l.add_argument("--llm-tasks", choices=["both", "boundaries", "restyle"], default="both",
                   help="boundaries = speaker fixes only; restyle = punctuation/casing only")
    l.add_argument("--llm-restyle-chunk", type=int, default=80,
                   help="words per restyle request (chunks never cross a speaker turn)")
    l.add_argument("--llm-device", default="auto")
    l.add_argument("--llm-window", type=int, default=12, help="words of context each side of a boundary")
    l.add_argument("--llm-max-boundaries", type=int, default=200)
    l.add_argument("--llm-boundary-gap", type=float, default=0.4,
                   help="the model may not move a speaker boundary across a pause "
                        "longer than this; pauses outrank its guess")
    l.add_argument("--llm-timeout", type=float, default=3600,
                   help="give up on the model after this many seconds and keep the "
                        "deterministic result (0 disables)")

    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)

    if not args.input_dir.is_dir():
        print(f"error: {args.input_dir} is not a directory", file=sys.stderr)
        return 2
    out_dir = args.output_dir or (args.input_dir / "transcripts")
    raw_dir = out_dir / "raw"
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    audio = find_audio(args.input_dir, args.recursive)
    if not audio:
        print(f"error: no audio files in {args.input_dir} "
              f"(looked for {', '.join(sorted(AUDIO_EXTS))})", file=sys.stderr)
        return 1
    print(f"Found {len(audio)} audio file(s) in {args.input_dir}")

    if args.skip_existing and args.overwrite:
        print("error: --skip-existing and --overwrite contradict each other; pick one",
              file=sys.stderr)
        return 2

    if not args.skip_transcribe and args.diarize and not args.hf_token:
        print("error: diarization needs a Hugging Face token.\n"
              "       export HF_TOKEN=hf_... (and accept the pyannote model terms), or\n"
              "       pass --hf-token, or run with --no-diarize.", file=sys.stderr)
        return 2

    if args.dry_run:
        pending = [
            a for a in audio
            if not (args.skip_existing and already_processed(a, out_dir, raw_dir, args)[0])
        ]
        if args.skip_existing:
            print(f"{len(audio) - len(pending)} already processed, {len(pending)} to do")
        for i, a in enumerate(pending):
            refresh = args.refresh == "always" or (args.refresh == "first" and i == 0)
            print(redact(build_whisperx_cmd(a, raw_dir, args, refresh), args.hf_token))
        return 0

    failures: list[str] = []
    skipped: list[str] = []
    drifted: list[str] = []
    summaries: list[tuple[str, dict]] = []
    transcribed = 0

    for i, a in enumerate(audio):
        raw_json = raw_dir / f"{a.stem}.json"

        if args.skip_existing:
            done, note = already_processed(a, out_dir, raw_dir, args)
            if done:
                skipped.append(a.name)
                if note:
                    drifted.append(a.name)
                    print(f"\n[{i + 1}/{len(audio)}] {a.name}")
                    print(f"  skipped: already processed, but {note}")
                continue

        print(f"\n[{i + 1}/{len(audio)}] {a.name}")

        if not args.skip_transcribe:
            if raw_json.exists() and not args.overwrite:
                print(f"  transcribe: skipped, {raw_json.name} exists (use --overwrite)")
            else:
                refresh = args.refresh == "always" or (args.refresh == "first" and transcribed == 0)
                cmd = build_whisperx_cmd(a, raw_dir, args, refresh)
                print(f"  transcribe: {redact(cmd, args.hf_token)}")
                proc = subprocess.run(
                    cmd,
                    stdout=subprocess.PIPE if args.quiet else None,
                    stderr=subprocess.STDOUT if args.quiet else None,
                    text=True,
                )
                transcribed += 1
                if proc.returncode != 0:
                    if args.quiet and proc.stdout:
                        sys.stderr.write(proc.stdout[-4000:])
                    print(f"  transcribe: FAILED (exit {proc.returncode})", file=sys.stderr)
                    failures.append(a.name)
                    continue

        if args.skip_clean:
            continue
        if not raw_json.exists():
            print(f"  clean: FAILED, no {raw_json}", file=sys.stderr)
            failures.append(a.name)
            continue

        try:
            data = json.loads(raw_json.read_text(encoding="utf-8"))
        except ValueError as exc:
            print(f"  clean: FAILED, bad JSON in {raw_json.name}: {exc}", file=sys.stderr)
            failures.append(a.name)
            continue

        try:
            result = clean_transcript(data, args, a.name)
        except Exception as exc:  # noqa: BLE001 - one bad file must not stop the batch
            print(f"  clean: FAILED, {type(exc).__name__}: {exc}", file=sys.stderr)
            if args.verbose:
                import traceback

                traceback.print_exc()
            failures.append(a.name)
            continue

        (out_dir / f"{a.stem}.clean.json").write_text(
            json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        (out_dir / f"{a.stem}.clean.txt").write_text(
            render_txt(result["segments"], a.name, args.wrap), encoding="utf-8"
        )
        st = result["stats"]
        print(f"  clean: {st.get('segments_in', 0)} -> {st['segments_out']} segments, "
              f"{st.get('words_in', 0)} -> {st.get('words_kept', 0)} words "
              f"(-{st.get('fillers_removed', 0)} filler, -{st.get('stutters_collapsed', 0)} stutter, "
              f"-{st.get('false_start_words_removed', 0)} false-start, "
              f"-{st.get('repeat_words_removed', 0)} repeat, "
              f"-{st.get('duplicate_words_removed', 0)} duplicate), "
              f"{st.get('duplicate_segments_merged', 0)} dup turns merged, "
              f"{st.get('speaker_words_smoothed', 0) + st.get('speaker_words_reattached', 0)} "
              f"speaker words fixed")
        integrity = result.get("integrity", {})
        if not integrity.get("verified", True):
            print("  clean: INTEGRITY CHECK FAILED", file=sys.stderr)
            for prob in integrity["problems"]:
                print(f"    - {prob}", file=sys.stderr)
            failures.append(a.name)
        else:
            print("  clean: integrity verified (no invented or altered content)")
        llm = result["cleaning"].get("llm")
        if llm:
            if llm.get("error"):
                print(f"  llm: {llm['error']} (deterministic result kept)", file=sys.stderr)
            else:
                print(f"  llm: {llm['boundaries_moved']}/{llm['boundaries_considered']} boundaries "
                      f"moved ({llm['words_reassigned']} words reassigned), "
                      f"{llm['restyle_accepted']}/{llm['restyle_chunks']} restyle chunks accepted"
                      + (f", {llm['restyle_rejected']} rejected" if llm["restyle_rejected"] else ""))
        summaries.append((a.name, st))

    if skipped:
        print(f"\nSkipped {len(skipped)} already-processed file(s): "
              + ", ".join(skipped[:5]) + (" ..." if len(skipped) > 5 else ""))
    if drifted:
        print(f"{len(drifted)} of them were written with different cleaning settings and "
              "were left as they are;\nre-run without --skip-existing to redo them.")
    print(f"\nWrote {len(summaries)} cleaned transcript(s) to {out_dir}")
    if failures:
        print(f"Failures ({len(failures)}): {', '.join(failures)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
