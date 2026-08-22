# Family-specific generation prompts (F1–F6)

Ready-to-paste card prompts for the six item families in RESEARCH-PLAN.md §3.2.

Each block below goes into one question-type card's **generation prompt** textarea on the
ResearchCAPTCHA start screen. Do not restate the mechanical requirements — exact question
count, option counts, blank syntax, the 100-point rubric total, JSON conformance — the app
appends those itself (`src/lib/openrouter.ts`, per-type tail). These prompts carry item
*design* only.

## Card setup

Create cards in this order. Cards generate sequentially and each one is shown the questions
already generated, so ordering them as the form runs also gives the right presentation order.

Set each card's **Card name** to its family label (`F1 planted error`, `F2 counterfactual`,
and so on). The name is researcher-facing only and is stored on every answer row as
`block_name`, which is what turns the per-family discrimination index into a `GROUP BY`
rather than a join through block UUIDs.

| Family | Card type | Options | Count | Soft limit | Status |
|---|---|---|---|---|---|
| F6 warmup | Multiple choice | 4 | 2 | 45s | ✅ tick **Warm-up** |
| F1 planted error | Multiple choice | 4 | 3 | 45s | ✅ |
| F2 counterfactual | Free response | — | 2 | 105s | ⚠️ graded by rubric, not by key |
| F3 unstated rationale | Free response | — | 1 | 150s | ✅ |
| F4 provenance | Multiple choice | 4 | 1 | 60s | ⚠️ key is a guess |
| F5 cross-reference | Free response | — | 1 | 120s | ✅ |
| F7 background concept | Free response | — | 1–2 | 120s | ✅ new, see below |
| F8 load-bearing choice | Free response | — | 1 | 120s | ✅ new, order before F3 |
| F9 failure mode | Free response | — | 1 | 120s | ✅ new, check the wording |

For F5, set the PDF extractor to **Native** or **Mistral OCR**. Cloudflare's markdown
conversion degrades figures and captions, which is exactly what this family binds against.

---

## F1 · Planted-error detection

*V1 · multiple choice · predicted HIGH*

```
Generate planted-error detection items. Each item states a specific claim about this manuscript, and the participant must identify which version of the claim is what the paper actually reports.

Build each item from a single atomic, verifiable fact that appears exactly once in the paper: a numeric result, an ablation delta, a dataset or baseline name, a hyperparameter, a section or table attribution. Anchor the item to where that fact lives, such as "the ablation in Section 5.2" or "Table 3", so the key is checkable against a specific passage. Never include Section or Table names in the question text to avoid easily looking up the information.

Perturb a value or a referent, never a qualitative direction. Reassigning which component an effect belongs to, or which condition a number describes, is the target. Flipping "improves" to "degrades" is too easy and must not be used. Every incorrect option must be plausible enough that a reader who does not know the work has to locate and read the relevant passage to rule it out.

Never build an item on a fact the paper restates elsewhere, including in the abstract, a figure caption, or the conclusion. A restatement gives a non-author a cheap second place to check. Never build an item whose correct option can be identified by keyword overlap with the prompt, by grammar, by option length, or by being the most specific or most hedged option. Options must be mutually exclusive and comparable in length, specificity, and technical register.

Discard any candidate answerable from the title and abstract alone, and any candidate that someone who knows this field but has never read this paper would get right.
```

Setting options per question to 2 gives a two-alternative forced choice between a true and a
false variant of the same claim, which is the closest expressible form to the plan's "T/F"
and is stronger than a literal True/False toggle because it forces both variants to be read.
The plan pairs this family with a confidence rating, which the app cannot collect.

---

## F2 · Counterfactual computation

*V2 · numeric entry · predicted MEDIUM* — **runs on a free-response card; grading is not deterministic**

```
Generate counterfactual computation items. Each item states a hypothetical perturbation to the reported results and asks what a specific reported quantity would become under it.

The perturbation must be arithmetically well defined and must resolve to exactly one number. State the unit and the rounding you expect.

Discrimination in this family does not come from the arithmetic, which anyone holding the table can do. It comes from knowing which quantities enter the reported number. Build each item so the aggregation is not recoverable from the table alone: require the participant to know which subset of rows the headline figure averages over, which runs were excluded, which baseline an improvement is measured against, or which of several reported columns is the one the paper actually headlines. If the target can be computed by taking an unweighted mean of every visible row, the item is too easy and must be discarded.

Do not require external constants, unstated unit conversions, or more than three arithmetic operations. The item must be answerable without a calculator by someone who knows what the numbers mean.

End each item prompt by instructing the participant to answer with the number alone.

Give each item a single rubric criterion worth the whole 100 points, awarded only for the correct value within the stated rounding and zero otherwise. State that correct value explicitly in the criterion's guidance, so grading is a comparison rather than a recomputation. Award no partial credit for method, working, or a near-miss value, and no credit for explanation, fluency, or confidence. Accept the value written with or without its unit, with or without a leading zero, and as a percentage or a proportion where the item's rounding makes the two unambiguous.

Discard any candidate whose answer is stated anywhere in the paper, and any candidate answerable from the title and abstract alone.
```

Use a **free-response** card. The participant types the number into the response box and the
set's model grades it against the rubric. The "state the correct value in the guidance"
instruction is what makes this tolerable: it turns the grading call into a string comparison
the model performs, rather than asking it to redo the arithmetic and risk disagreeing with
its own key.

---

## F3 · Unstated rationale

*V3 · free response · predicted HIGH but confounded*

```
Generate unstated-rationale items. Each item asks the participant to justify a methodological or design choice whose reason is not stated in the manuscript.

Locate a choice the paper makes but does not explain: a test or estimator selected over an obvious alternative, a threshold or cut-off, an excluded condition, an ordering of stages, a control that is present or conspicuously absent. Ask why that choice is appropriate here and, where it sharpens the item, why it would not be appropriate for a specific other part of the paper.

The reason must be genuinely absent from the manuscript, so that no amount of searching the PDF produces it. If the paper explains the choice anywhere, including a footnote, an appendix, or a limitations paragraph, discard the item.

Ground every item in a specific named element of this paper: this comparison, this table, this preprocessing step. A question that could be asked of any paper in the field is testing field knowledge rather than authorship of this artifact, and must be discarded.

Build the rubric to award credit for reasoning that connects the choice to the specific properties of this study's data or design, and to withhold credit for a generically correct textbook justification that never touches this paper. Accept substantively equivalent reasoning and multiple valid explanations. Award no credit for fluency, length, confidence, or command of English; score only the content of the reasoning.
```

The final sentence is deliberate: it is the item-side half of the §9.2 fluency-perturbation
defence. The grading call needs the same instruction.

---

## F4 · Provenance-of-decision

*V3 · multiple choice · predicted HIGH* — **format works, ground truth does not**

```
Generate provenance-of-decision items. Each item asks which constraint, event, or consideration actually drove a concrete choice visible in the manuscript.

Anchor each item to a specific decision the paper reports without explaining its cause: a sample size, a stopping point, a chosen instrument or platform, an excluded condition, a scope restriction. Ask which factor was the binding one.

Every option must be a constraint that plausibly binds research of this kind: resource limits, availability of data or annotators, ethical or institutional approval, platform or rate limits, timing, licensing, or a pilot result. Options must be mutually exclusive, so exactly one can be the binding constraint, and none may be inferable from the manuscript's text, because the paper does not state the reason.

Do not make the correct option the one the field would guess by default. If a reader with no connection to this work would pick it at better than chance from the topic alone, the item is worthless and must be discarded.

In the rationale, state the evidence that led you to the key, and say plainly when the key is a conjecture that the manuscript does not support.
```

The rationale instruction is a triage aid for item review, not a fix. See the machinery note
below.

---

## F5 · Cross-reference integration

*V1+V2 · free response · predicted MEDIUM*

```
Generate cross-reference integration items. Each item requires binding a specific feature of a figure or table to the methodological choice elsewhere in the paper that explains it.

Point at a concrete, locatable feature: a curve that crosses another, a dip or plateau at a particular point, an outlying cell, a condition that behaves unlike its neighbours, a gap that narrows or widens. Ask the participant to identify which condition or series it is, and which design decision stated in the methods produces it.

The binding must be implicit. If the figure caption, axis labels, legend, or surrounding prose names the connection, a non-author finds it by reading one paragraph and the item does not discriminate. Choose features whose explanation is distributed across at least two distant parts of the paper.

Both halves must be objectively checkable against the manuscript: the identification of the series, and the design choice that accounts for it. Do not ask the participant to speculate about why the authors made a choice; that belongs to a different family.

Discard any candidate answerable from the caption alone, from the abstract, or from general knowledge of how such methods usually behave.

Build the rubric to allocate credit separately to the identification and to the explanation, so a participant who names the right series for the wrong reason is distinguishable from one who does neither. Award no credit for fluency, length, or confidence.
```

---

## F6 · Warmup / orientation

*V1 · multiple choice · predicted NEAR-ZERO* — tick **Warm-up** on the card

```
Generate orientation items. These are deliberately easy and are not intended to discriminate. Their purpose is to let the participant settle into the interface and to establish a per-participant latency baseline.

Ask for the most prominent facts of the paper: the primary evaluation dataset, the main task, the name of the headline method, the principal baseline it is compared against. Anyone who has read the abstract should answer correctly and quickly.

Keep each prompt to a single clause and each option to a few words. Options must be unambiguous, clearly distinct from one another, and drawn from the same category as the answer, so no option is eliminable on form alone. Nothing here should require reasoning, searching, or arithmetic.

Do not attempt to make these difficult. Do not include near-misses, trick options, or plausible-but-wrong variants.
```

---

---

## F7 · Background-concept understanding

*V3 · free response · predicted **LOW for authorship, HIGH for topic competence*** — **new family, not in §3.2**

Asks the participant to define or explain a concept the paper is built on. For a paper about
p-hacking: *what is p-hacking* — or, if that paper defines p-hacking itself, what the familywise
error rate is and why it bears on the design.

```
Generate background-concept items. Each item asks the participant to define or explain, in their own words, one concept the paper depends on but does not itself define — the presupposed background a competent member of this field carries into reading it, not the paper's own contribution.

Choose concepts that are load-bearing. If the participant misunderstood the concept, the paper's design, its choice of method, or its interpretation of its results would no longer make sense. A term mentioned once in passing is not load-bearing; the standard is that you could name a specific design decision or claim that depends on it.

The most important filter is that the paper must not define the concept. The participant answers with the paper in front of them, so a concept the paper explains in its own words is a lookup rather than a question. Prefer concepts the paper names and uses as though they need no introduction. Where the paper's own topic is a concept it does define, choose an adjacent concept it presupposes instead: for a paper about p-hacking that defines p-hacking, ask what a p-value means under the null hypothesis, what the familywise error rate is, or what pre-registration is for.

Never name a section, table, figure, or page in the question text, and never reuse the paper's own phrasing of the concept. Both point the participant at a passage to copy.

Ask for two things in each item, in this order: the definition or explanation itself, and one sentence on why the concept matters for the work reported here. The first half is what the item is for. The second half is what someone who does not understand the work cannot supply, and it is where an answer assembled from general knowledge alone reads as generic.

Build the rubric as an enumeration of the elements a correct definition must contain, each its own criterion with its own points, totalling 70, plus one criterion worth 30 for the connection to this paper. Name the required elements explicitly in the guidance, so grading is a check against a list rather than a judgement of quality. For at least one criterion, state a specific plausible-but-wrong answer that earns nothing — the near-miss someone with topic-adjacent familiarity would give — so an answer that circles the concept without stating it cannot collect points.

Award nothing for fluency, length, hedging, confidence, or restating the question. Accept any wording that carries the required elements, including informal phrasing, an example that entails the definition, and notation in place of prose. Do not require the participant's terminology to match the paper's.

Discard any candidate concept whose definition appears anywhere in the paper, any answerable from the title alone, and any that duplicates a concept an earlier card already covers.
```

Use a **free-response** card, count 1–2, soft limit around 120s. Name it `F7 background concept`
so per-family analysis groups it by `block_name` like the rest.

**For definitions only**, delete the two-part paragraph ("Ask for two things…") and change the
rubric paragraph to put all 100 points on the definition elements. The two-part form is a
deliberate hedge: a pure definition is answerable by anyone in the field, and the second sentence
is the only part of this family that carries authorship signal.

### What this family actually measures — state it before running it

**Not authorship.** Background concepts are field knowledge by construction, so an in-field
non-author should answer as well as the author. Predicted own-vs-unfamiliar gap: small. This is the
§3.2 F3 confound at its maximum, and pretending otherwise would be the kind of thing a reviewer
catches immediately.

What it does measure is **topic competence**, which is the adversary §0 actually cares about: the
submitter of a generated manuscript on a subject they cannot discuss. It also gives §8.2's
in-field/out-of-field split a manipulation check — predicted large in-field vs out-of-field gap on
this family specifically. If that gap fails to appear, the field-distance manipulation did not
work, and that is worth knowing before interpreting F3.

**Expect near-ceiling LLM lift (§7.2).** A model with no access to the paper defines p-hacking
correctly. This is the weakest family against the LLM-assisted adversary, and its lift should be
reported as a finding rather than buried — it is direct evidence about which facets of §1.1
survive model assistance and which do not.

Adopting it means a seventh family: §3.2 needs an F7 entry with its falsifiable prediction, and
§10's per-family discrimination table gains a row.

---

---

## F8 · Load-bearing choice

*V3 · free response · predicted **HIGH, confounded like F3***

Asks the participant to name the one design choice, assumption, or construct the paper stands on,
and to say what falls over without it.

```
Generate one item asking which single design choice, assumption, or construct this paper's conclusions depend on most, and what would go wrong without it.

Keep the question to one or two sentences, and ask for a short answer of two or three sentences. This item is about picking the right thing, not about writing at length.

Load-bearing means the conclusions travel through it: reverse it and a headline claim weakens, a comparison stops being fair, or a measure stops measuring what it is said to measure. Choices about convenience, cost, or presentation do not count, however prominently the paper discusses them.

Do not use anything the paper itself calls its key assumption, its main design decision, or its main limitation, and nothing from the abstract. The participant reads with the paper open, so those are lookups. Never name a section, table, or figure in the question text.

Reasonable people disagree about what matters most, so the rubric must not require the one choice you had in mind. In the guidance, list every choice in this paper that qualifies as load-bearing, and list the prominent ones that do not — the peripheral decisions a reader is most likely to offer instead. A peripheral answer earns nothing, however well it is argued.

Split the points between naming something from the qualifying list and saying what specifically stops holding without it, weighted towards the second. Award nothing for fluency, length, or for restating the paper's framing.
```

Use a **free-response** card, count 1, soft limit around 120s. Name it `F8 load-bearing choice`.

Two sub-asks, not three. An earlier draft also asked what would change had the choice gone the other
way, which made both the stem and the expected answer long enough to crowd out the rest of the form.
Naming the load-bearing choice and saying what fails without it already carries the signal; the
counterfactual mostly restated the second half at greater length.

### Order it before F3

If both are on the form, this card must come first. Cards generate in creation order and that is also
presentation order, so putting F3 above it would hand the answer over: *"why is a paired test
appropriate for this comparison"* tells the participant that the choice of test is what matters. The
same applies to F4, which names a decision in its stem. This item is only hard while the participant
still has to choose what is important.

### Why the rubric enumerates both lists

The grading call is an LLM against a rubric, so the rubric has to remove the judgement. Listing the
qualifying choices turns "is this the most crucial one?" into a membership check, and listing the
prominent peripheral ones stops a fluent answer about a real-but-minor decision from collecting
marks — the failure mode this family invites. It is the same move as stating the correct value in
F2's guidance.

Check that list before the session. The bank is human-checked anyway (§8.4), and this is the one
family where a generated answer key encodes a judgement about the paper that you may disagree with —
if the model's qualifying list is wrong, the item is unfair in a way no participant can recover from.

### What it measures

The same caution as F3, for the same reason: naming what a paper stands on is partly field expertise,
so an in-field non-author may do well. Report it beside F3 in the in-field / out-of-field breakdown
rather than pooling them.

What makes it harder to fake than F3 even so: the paper lists many design choices and only some are
load-bearing, so the selection itself carries signal before a word of explanation is written.

---

---

## F9 · Failure mode

*V3 · free response · predicted **HIGH, and the strongest family against adversary C***

Asks where the work stops working, and why.

```
Generate one item asking the participant to name a realistic condition under which this work's method or central finding would degrade, and to say why it would.

Keep the question to one or two sentences, and ask for a short answer of two or three sentences. Word it neutrally: a condition the work was not built for, not a flaw in it. A scored item that reads as an attack on the participant's own paper invites a defensive answer rather than an informative one.

The condition must be specific to this setup and plausible in this domain — a property of the data, a regime, a scale, a population, or an interaction this pipeline would mishandle. Its mechanism must follow from how this work is built, not from general methodological caution.

Do not use anything the paper names itself: its limitations, its future work, its statements about what it did not test, or anything in the abstract. The participant reads with the paper open, so those are lookups. Never name a section, table, or figure in the question text.

In the guidance, list the qualifying conditions for this paper, each with the mechanism that makes it fail. Any one of them earns the naming points, since reasonable people will pick different edges.

Then list the answers that earn nothing: that the sample is small, that the results may not generalise, that more data or more baselines are needed, that the method is untested in other settings, and anything else that could be written without having read this paper. A fluent, confident answer of exactly that kind is the most likely wrong answer here, and it must score zero.

Weight the mechanism above the condition. Award nothing for fluency, length, hedging, or for restating what the paper already says about its own scope.
```

Use a **free-response** card, count 1, soft limit around 120s. Name it `F9 failure mode`.

### The zero-credit list is the point

Every other family leans on timing to defend against a model open beside the paper (§7.3). This one
attacks the answer itself. Asked where a method breaks, a frontier model with the PDF produces
well-written generic caution — small sample, may not generalise, needs more baselines — because
that is what the genre supplies when the specifics are absent. Naming that shape as scoring zero
turns adversary C's characteristic output into a graded failure rather than something the clock has
to catch. Nothing else on the form has that property, which is why it is worth a slot even though
the facet is already crowded.

It cuts both ways, and say so in the paper: a genuine author who happens to answer at that level of
generality also scores zero. Report the family's own false-negative rate rather than folding it into
the total.

### Wording is a fairness matter, not politeness

§9 asks whether the instrument treats people equitably, and an item that reads as *what is wrong
with your work* is a poor measurement instrument before it is anything else — a defensive author
under-answers and scores like a non-author. Hence the instruction to phrase the condition as
something the work was not built for. Check the generated wording for this specifically; it is the
one thing here a model gets wrong in a way that looks fine.

### What it measures

Tacit rationale (V3), so it carries F3's confound: an in-field non-author can sometimes reason to a
real edge from the method alone. Report it beside F3 and F8 in the in-field / out-of-field
breakdown. What it adds over those two is that the answer lives nowhere in the artifact — the paper
states its scope, not its mechanisms of failure — which is the cleanest case of V3 on the form.

---

## Machinery gaps

### ⚠️ F2 — runs today, but grading goes through the LLM

The free-response card takes typed input, so this family is executable now. The other two
types are not substitutes: fill-in-the-blank presents a shared shuffled word bank the
participant selects from rather than a text field, and multiple choice lets the participant
back-solve by checking which offered number is consistent, which removes the computation the
family measures.

What free-response does not give is a deterministic key. An item whose answer is a single
number is the clearest case in the whole form of §3.5's "objective answer" criterion, and
routing it through the rubric grader adds grader variance to the one family that should have
none. It also spends a grading call per free-response card and puts arithmetic items into the
κ computation in §5.2, where disagreement is about the grader rather than the construct.

The rubric wording above mitigates this by naming the correct value in the criterion guidance,
so the grader compares rather than recomputes. If F2 survives G1, a short-answer type with an
exact-match key and numeric tolerance would remove the failure mode entirely — roughly the
shape of the multiple-choice work: schema, prepare function, a grading branch in
`answers/route.ts`, a review branch in `buildResult`, one input component. Worth doing only if
pilot grading actually disagrees with the keys.

### ✅ F6 — warm-up flag implemented

Tick **Warm-up** on the card. Its questions lead the attempt in card order, are never
shuffled into the sequence when randomization is on, and are excluded from the overall score
while still being graded, timed, and shown in the review. `AssessmentResult` carries
`scoredQuestionCount` and `warmupQuestionCount`.

The flag is stripped from the payload sent to the browser during the attempt, so a
participant cannot tell which items are unscored — otherwise the latency baseline this
family exists to provide would be worthless.

### ⚠️ F4 — the answer key is a guess

The app derives every key from the PDF. This family's ground truth exists only in the
author's head; §3.2 says the family "only works if the author supplies the key", and
Appendix A item 2 recommends eliciting keys at booking, ≥24h ahead. There is no
author-key-elicitation step and no way to override a generated key.

Until there is, F4 items are scored against the model's conjecture about why a decision was
made. The prompt above asks the generator to flag conjectural keys, which helps triage during
review but does not make the key correct.

### ⚠️ Confidence ratings — not collected on any family

§3.3 says to collect a confidence rating on every item, and lists F1 as "T/F + confidence".
Nothing in the schema or UI supports it. It is described as a cheap second signal and a
possible confidence-weighted classifier, so it is worth adding before data collection rather
than after.

### ⚠️ The two filters are not implemented

Every prompt above ends with a self-filtering instruction — discard if answerable from the
abstract, discard if answerable without the paper. This approximates §4.1's answer-leakage
and no-context filters, but a generator judging its own output is much weaker than running
them as separate passes with a model that is given only the abstract, or no paper at all.

The filters matter most for F3, where they are the stated mitigation for the field-knowledge
confound. Treat the in-prompt versions as a first pass, not as the filters the paper claims.

### ✅ Per-family timers

Supported. Each card carries a soft time limit, snapshotted per question at serve time, with
overrun recorded and never enforced. The §3.3 timer column drops straight in. Note the study
design assumes hard timers; these are soft by design decision, so either enforce them before
data collection or state the deviation.
