# Unfamiliar-paper selection prompt

An operator prompt, not a card prompt: paste it into a chat with a **search-capable** model,
attach the participant's own manuscript, and fill the two placeholders. It returns five candidate
unfamiliar papers for the §8.2 condition.

The stratum is not your free choice at session time — the **Experiments** tab shows which one the
next participant is allocated (balanced in-field / out-of-field), so read it there first and put
that value in `{{STRATUM}}`.

---

## The prompt

```
You are helping select a paper for a controlled study. Attached is a manuscript written by {{PARTICIPANT_NAME}}, one of its authors. I need five candidate papers by other people that this person is unlikely to have read, all of them {{STRATUM}} for them.

Definitions, which govern everything below.

IN-FIELD means their training transfers: the notation, methods and background concepts are ones they already hold, and they could read the paper without learning a new apparatus. Same research area, different research group.

OUT-OF-FIELD means their training does not transfer: the background concepts are ones they have no reason to know. It does not mean unreadable. The paper must still be a normal empirical or theoretical paper that an intelligent outsider can follow at the level of its claims, because a participant who cannot parse the abstract at all tells us nothing.

STEP 1 — Identify the person, and say how.

Use the attached manuscript as ground truth: its author list, affiliation, topic and references are the anchor. Then search for this person's publication record.

Report what you found as a short profile: their research area, subfield, the methods they work with, their affiliation and career stage, their most cited work, and the venues they publish in. Cite a source for each claim — their scholar profile, lab page, arXiv listing, or a specific paper.

Name disambiguation is the failure mode that ruins everything downstream. If more than one researcher shares this name, say so explicitly, state which one you concluded is the author of the attached manuscript, and give the evidence that settles it. If you cannot settle it confidently, stop and tell me rather than guessing.

STEP 2 — Define their familiarity neighbourhood.

Before choosing anything, list what this person is likely to have already read:
- their own papers and their coauthors' papers;
- work by their advisor, their lab, and their institution's group in this area;
- the papers their attached manuscript cites, and well-known papers that cite it;
- the canonical or widely discussed papers of their subfield, including anything that circulated heavily on social media or won an award;
- the standard venues they attend, whose proceedings they will have browsed.

Everything in that neighbourhood is disqualified. Say what you excluded and why, briefly.

STEP 3 — Select five candidates.

Constraints on every candidate:
- A real paper, posted to arXiv in 2025 or 2026, with a resolvable arXiv ID. Quote the first sentence of its abstract verbatim as evidence you actually retrieved it. Do not offer a paper you cannot verify exists; five verified candidates matter more than five interesting titles.
- Not authored by this person, their coauthors, their advisor, or their institution.
- Outside the familiarity neighbourhood from Step 2.
- Low visibility: few citations, no award, no viral thread. A paper they would have encountered by accident is useless to me.
- Comparable in difficulty to the attached manuscript — similar length, similar density of mathematics, a similar number of experiments or results. If the unfamiliar paper is markedly harder than their own, any score difference I measure is about difficulty rather than about authorship, which destroys the comparison.
- Self-contained enough to be read cold: it states its own research question and what it found, rather than depending on a companion paper.

Make the five diverse, so that one wrong guess about this person does not invalidate the whole set. For in-field, five different research groups. For out-of-field, five different fields.

STEP 4 — Report.

Rank them best fit first, and for each give:
1. Title, authors, arXiv ID and link, posting date, primary arXiv category.
2. The first sentence of the abstract, quoted.
3. One sentence on what the paper is about.
4. Why it is {{STRATUM}} for this person specifically, referring to the profile from Step 1 rather than to the field in general.
5. Why they are unlikely to know it, referring to the neighbourhood from Step 2.
6. Difficulty match to the attached manuscript: length, mathematical density, number of results, and whether you judge it easier, comparable, or harder.
7. The single most likely reason this person might in fact already know it. Every candidate gets one; if you cannot think of one you have not looked hard enough.
8. Your confidence that they have not read it, as high, medium or low.

End with the one candidate you would pick if you had to choose, and the one you consider riskiest, each in a sentence.

Do not pad the list to five with papers you doubt. If you can only verify three that meet the constraints, give me three and say what blocked the others.
```

---

## Using the output

Paste the winning candidate's PDF into a new question set and name it for the stratum, so the
generated bank and the experiment agree about which paper was which.

Two things the prompt deliberately does not do:

**It cannot guarantee unfamiliarity.** It lowers the hit rate; the screening question at the start
of the session — *"have you read this paper before?"* — is what actually enforces it. §8.2 already
requires that screen and requires logging the swap rate, which is why the prompt returns five
candidates rather than one: a swap should cost you the next line of the list, not a new search
while a paid participant waits.

**It does not rate difficulty for the record.** §8.2 asks both researchers to rate candidate
difficulty and to report inter-rater agreement. The model's difficulty judgement in field 6 is a
filter to stop you shortlisting something wildly harder than the participant's own paper; it is not
one of the two ratings, and using it as one would collapse the agreement measure you are meant to
report.

## A note on searching a named participant

This prompt sends a real person's name to a search-capable model in order to profile their
research background. Worth being deliberate about:

- It is publication-record research, and should stay that way. Nothing in the prompt asks for
  anything personal, and the profile it returns should be discarded if it drifts there.
- The output names the participant, so it is study data: keep it under the same retention terms as
  everything else in §12, not in a chat history.
- §12 should say that selecting the unfamiliar paper involves looking up the participant's
  published work. It is benign and participants would expect it, which is exactly why it costs
  nothing to disclose and looks bad to omit.
