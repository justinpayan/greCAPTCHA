# Comprehension-Based Author Verification: Research & Design Plan

**Target:** CHI 2027, deadline 10 Sept 2026
**Team:** Balint, Justin
**Status:** plan v2, 8 Aug 2026 — *revised for in-person, 1-hour sessions*

Design decisions locked: **open-book tightly timed** · **within-subjects counterbalanced** ·
**fixed-form with inert adaptive logging** · **D4 as offline red-team** ·
**in-person proctored, 60 min, researcher-supplied hardware**

> **What going in-person changes.** Three things, in order of importance.
> **(1)** Proctoring closes adversary E and lets you *control* LLM access rather than merely detect
> it — which means you can run a real human-with-LLM adversary condition under observation (§7.3),
> which is far stronger evidence than an offline simulation. **(2)** The study now measures the
> *proctored* variant, so the unproctored deployment claim must be carried explicitly by §7 rather
> than assumed. **(3)** Session-integrity engineering (§8.5 in v1) mostly disappears, freeing build
> time — spend it on §7.3 and the interview protocol. A semi-structured debrief plus retrospective
> think-aloud replaces a survey-only RQ6, which materially upgrades the qualitative contribution.

---

## 0. What this paper claims

Three claims, in priority order. If the timeline collapses, cut from the bottom.

1. **C1 (empirical, primary).** A short, open-book, time-boxed comprehension test discriminates
   authors from non-authors of the same paper, and does so with a false-accusation rate low enough
   to be worth discussing. Evidence: within-person score gap, ROC, and the *left tail of the author
   score distribution*.
2. **C2 (design, primary).** A characterisation of *which item families discriminate* — with the
   key finding that discrimination comes from item design, not from withholding the paper. Evidence:
   per-family discrimination index, LLM-assist resistance, author-latency profiles.
3. **C3 (sociotechnical, secondary).** Whether the people subject to such a test find it fair,
   useful, and legitimising — the question NeurIPS 2026 never asked before deploying a detector.
   Evidence: post-test survey, contest-a-grade logs, qualitative coding.

**The A3 through-line.** Every claim is reported alongside a fairness audit. The lit review's
central finding is that omitting demographics prevents disparate *treatment*, not disparate
*impact*. This paper's stance: collect group data, never score on it, audit with it, publish the
audit. Say this explicitly in the paper — it's a methodological contribution in a subfield that
has been doing the opposite.

**Positioning.** The comparison class is not "perfect verification." It is (a) NeurIPS 2026's
detector-score desk rejection with no appeal, and (b) the status quo of an unfalsifiable
attestation checkbox. Beating either is a publishable bar.

---

## 1. Construct and threat model

### 1.1 The construct

Do not call this "did they write it." Call it what it is:

> **Author verification capability**: the capacity to reason about a specific artifact in ways
> that require having engaged with its construction — beyond what its text alone supports.

Parent construct: **evaluative judgement** (Tai, Ajjawi, Boud, Dawson & Panadero 2018), specialised
to a single technical artifact. Naming the parent buys you a validity framework and a citation
lineage, and it reframes the paper from forensics to measurement — which is what makes it a CHI
paper rather than a security paper.

Three facets, which become the item families in §3:

| Facet | Definition | Why the paper's text alone is insufficient |
|---|---|---|
| **V1 Referential control** | Knowing what the artifact actually says, without searching | Search is possible but *costly*; authors pay ~0 |
| **V2 Counterfactual reasoning** | Predicting how results/claims change under perturbation | Requires a model of the pipeline, not a lookup |
| **V3 Tacit rationale** | Justifying choices whose reasons are not stated | Genuinely absent from the artifact |

### 1.2 Threat model — be explicit, reviewers will push

| Adversary | Capability | In scope? |
|---|---|---|
| **A. Cold non-author** | Has the paper, no prior exposure, timed | ✅ Foreign-paper condition |
| **B. Prepared non-author** | Skimmed the paper first (the realistic AI-submitter: they prompted it, picked the topic, skimmed the output) | ✅ 3-min supervised skim, §8.3 |
| **C. LLM-assisted non-author** | Has a frontier model open beside the paper | ✅ **Live, observed, in-person — §7.3.** Existential |
| **D. Scope-gaming author** | Declares a narrow contribution to shrink the test | ✅ Offline red-team, §6 |
| **E. Proctored evasion** | Second monitor, earpiece, confederate | ✅ **Closed by proctoring** |

**Adversary C is the one that can kill the paper.** A reviewer will write "why can't they just use
ChatGPT?" in the first paragraph of their review. §7 answers it, and the answer must be in the
abstract.

**In-person changes how C is measured, and this is the main methodological gain.** In an online
study you can only *simulate* the LLM-assisted attacker offline. In person you can hand a
participant a frontier model, tell them to beat the test on a paper they did not write, watch them
do it, and time it. That converts §7 from a simulation into an observed human-adversary experiment
— including the human overhead (reading the item, formulating a prompt, parsing the answer, typing
it) that an offline battery silently omits and that the timing defence depends on.

**The cost, stated plainly.** Proctoring closes E by fiat, so the study measures the *ceiling* of
what comprehension testing achieves when evasion is off the table. Deployment at OpenReview scale
is unproctored. The paper must therefore be explicit that C1 is a proctored-condition result, and
that the unproctored case rests on §7's timing argument plus the option of proctoring a
high-stakes subset — the same position the education literature reached on viva voce. Do not let
this sit in Limitations; put it in the framing.

---

## 2. Research questions

| RQ | Brainstorm ref | Method | §|
|---|---|---|---|
| **RQ1** Which item families discriminate authors from non-authors under open-book timing? | D1 | Per-family discrimination index from the user study + prototyping | 3, 8 |
| **RQ2** Can an LLM generate discriminating, valid, objectively-gradable items unsupervised? | D2 | Item-bank audit: validity rate, author-answerability, human review | 4 |
| **RQ3** Can an LLM grade open-ended responses in agreement with humans, without fluency bias? | D3 | IRR vs. two human annotators; fluency-perturbation experiment | 5, 9 |
| **RQ4** Can scope declaration be exploited to evade the test? | D4 | Offline red-team, 2 researchers | 6 |
| **RQ5** How well does the end-to-end scheme perform, and is it resistant to LLM assistance? | D5 | Within-subjects study + adversarial offline eval | 7, 8 |
| **RQ6** Do subjects find it fair, useful, and legitimising? | — (implicit in criteria) | Post-test survey + qualitative coding | 8.6 |
| **RQ7** Does performance differ by native-English status, career stage, or paper age? | A3 | Pre-registered fairness audit | 9 |

---

## 3. Item design (D1) — the core contribution

### 3.1 The open-book design principle

Locking open-book changes everything about D1. Under open-book, **an item's difficulty for a
non-author is its search cost, not its obscurity.** Three consequences:

1. **Lookup items are worthless.** Your example "What is the FPR of experiment X?" is a
   `Ctrl+F` away. Cut this entire class.
2. **Timing becomes the discriminating mechanism, not the item.** An author answers from an
   internal model; a non-author must locate, read, and integrate. Set per-item timers from the
   *author* latency distribution (§3.4). This is the paper's key design insight and it is worth
   stating as such.
3. **Some items must have no answer in the paper at all** (V3), so search cost is infinite and
   only domain reasoning or authorship helps.

### 3.2 Item families

Six families. Bloom level, facet, format, and predicted discrimination noted. Predictions are
falsifiable — record them now and report hits/misses, reviewers love this.

---

**F1 · Planted-error detection** — *V1, Bloom: Understand/Evaluate, T/F or MC, predicted **HIGH***

A statement about the paper, subtly false. The author knows instantly; the non-author must verify
by search, and well-built distractors make search expensive and error-prone.

> *"The ablation in §5.2 shows that removing the attention gate costs 4.1 points of accuracy.
> True or false?"* (It costs 4.1 points to remove the **positional encoding**; the gate costs 1.3.)

**Not in your brainstorm and I think it's the strongest family.** Cheap to generate (perturb a
true statement), objectively gradable, high ceiling for authors, punishing search cost for
non-authors, and naturally short-timed. Prioritise this in prototyping.

Design rules: perturb a *value or referent*, never a qualitative direction (too easy). Keep the
false version plausible. Never perturb something restated elsewhere in the paper.

---

**F2 · Counterfactual computation** — *V2, Bloom: Apply, numeric entry, predicted **MEDIUM***

Your Table-1 example. Requires knowing which numbers matter and how they combine.

> *"If every row of Table 2 dropped by 2pp, what would the reported mean improvement over the
> baseline become?"*

Honest caveat: a non-author with the table can often just do the arithmetic. Raise discrimination
by requiring the participant to know *which* subset of rows enters the headline number — i.e.
make the aggregation non-obvious from the table alone.

---

**F3 · Unstated rationale** — *V3, Bloom: Analyse, open-ended, predicted **HIGH but confounded***

> *"Why is a paired test appropriate for the §4 comparison but not for the §5 data?"*

Highest discrimination, but **it conflates authorship with field expertise** — an in-field
non-author may answer well. This is the study's main internal-validity threat and is why §8.2
splits the foreign-paper condition by field distance. Report F3 discrimination separately for
in-field vs out-of-field non-authors; if it collapses in-field, that is a real and reportable
finding, not a failure.

---

**F4 · Provenance-of-decision MC** — *V3, Bloom: Understand, MC, predicted **HIGH***

> *"Which of these was the binding constraint that led to n=500 rather than n=2000?
> (a) compute budget (b) annotator availability (c) IRB cap (d) baseline API rate limits"*

Only the author knows. **Grading requires ground truth from the author**, so this family only
works if the author supplies the key — impossible in real deployment for the *accused*, but fine
in the study, and fine in deployment if the key is elicited at submission time and checked later.
Flag the deployment asymmetry explicitly; it's an interesting design point.

---

**F5 · Cross-reference integration** — *V1+V2, Bloom: Analyse, open/MC, predicted **MEDIUM***

> *"The dashed line in Fig. 3 dips at step 400. Which experimental condition is it, and which
> design choice in §3 explains the dip?"*

Requires binding a figure to a method section. Search-resistant because the binding is implicit.

---

**F6 · Warmup / orientation** — *V1, Bloom: Remember, MC, predicted **NEAR-ZERO***

> *"What is the primary evaluation dataset?"*

**Keep despite zero discrimination.** Purposes: calibrate the interface, reduce anxiety, provide a
latency baseline per participant, and give a floor so nobody scores 0 (an A3 and ethics concern).
Exclude from the scored total; report separately. Say in the paper that these are deliberately
non-discriminating — it pre-empts "your test has useless items."

### 3.3 Form composition

Fixed **8 scored items + 2 unscored warmups** per paper. *(Reduced from 10 scored in v1 to fund the
in-person LLM-assist block, §7.3. The trade is deliberate: per-item discrimination gets noisier,
family-level discrimination is unaffected, and you gain the study's strongest adversarial evidence.)*

| Family | Count | Format | Timer |
|---|---|---|---|
| F6 warmup | 2 | MC | 45s, unscored |
| F1 planted error | 3 | T/F + confidence | 45s |
| F2 counterfactual | 2 | numeric | 105s |
| F3 unstated rationale | 1 | open-ended | 150s |
| F4 provenance MC | 1 | MC | 60s |
| F5 cross-reference | 1 | open-ended | 120s |

Ceiling ≈ **12.75 min/paper**; expected ~7 min for authors. Held constant across conditions so
timing is comparable.

Sample sizes at N=24: 384 scored item-responses total; F1 gets 144, F2 96, F3/F4/F5 48 each.
Family-level discrimination is well-supported; **per-item** D has n=24 per condition and should be
reported as exploratory with CIs, not as point estimates.

If G1 prototyping shows F3 carrying most of the discrimination, promote it back to 2 items and drop
one F2 — decide at the item-bank freeze, not during data collection.

**Collect a confidence rating on every item.** Cheap, and it gives you a second signal:
non-authors who guess correctly should show low confidence. A confidence-weighted score may
outperform raw score as a classifier — a nice secondary result at zero extra cost.

### 3.4 Timer calibration — do this in prototyping, not in the study

Timers are the anti-LLM mechanism (§7), so they must be set empirically:

1. Balint + Justin answer items on **their own** papers, untimed, latency logged.
2. Set each family's timer at the **90th percentile of author latency**, floored at 45s.
3. Verify: authors comfortable, LLM round-trip (read → copy → prompt → wait → parse → type)
   infeasible.

Report the author latency distributions as a figure. This is the empirical backing for the
"timing is the mechanism" argument.

### 3.5 Item-quality criteria (operationalising your list)

| Criterion | Operationalisation | Gate |
|---|---|---|
| Objective answer | Two researchers independently derive the same key from the paper | 100%, else discard |
| **Author-answerable** | ≥1 verified author of that paper answers correctly, timed | **Hard gate — see below** |
| Not overly burdensome | Author median latency < 60% of timer | ≥80% of items |
| Discriminating | Discrimination index D = P(correct \| author) − P(correct \| non-author) | Report; target D ≥ 0.3 |
| Useful to test-taker | Post-hoc survey rating ≥4/7 on "made me think about my paper" | Report |

**Your open question — "does the question need a clear answer for someone who definitely wrote the
paper?" — the answer is yes, and it is a hard gate, not a nicety.** Without it, an item the author
fails is indistinguishable from a bad item, and item quality becomes confounded with your outcome
variable. Enforce it two ways: (a) pre-filter the bank against researcher-authored papers during
prototyping; (b) in the study, treat per-item author-correct-rate as the post-hoc quality filter
and report results both with and without low-quality items excluded.

---

## 4. Item generation (D2)

### 4.1 Pipeline

```
paper PDF
  ↓ parse (GROBID or PyMuPDF → structured sections, tables, figure captions)
  ↓ FACT EXTRACTION      → atomic verifiable claims w/ section anchors
  ↓ FAMILY-SPECIFIC GEN  → one prompt per family, k=5 candidates each
  ↓ AUTO-FILTER          → answer-in-abstract? duplicate? ungradable? ambiguous?
  ↓ ADVERSARIAL FILTER   → discard if a no-context LLM answers correctly (§7.1)
  ↓ HUMAN REVIEW         → 2 researchers, keep/revise/discard  [study only]
  ↓ item bank (10 items: 8 scored + 2 warmup) + rubrics + keys
```

Two filters do most of the work and are worth naming in the paper:

- **Answer-leakage filter.** Discard any item answerable from title + abstract alone. Test by
  giving a model *only* the abstract; if it answers correctly, the item probes surface text.
- **No-context filter.** Discard any item a model answers correctly with *no paper at all* — it's
  testing field knowledge, not this artifact. (Directly mitigates the F3 confound.)

### 4.2 Model selection

Prototyping compares four generators on the same papers; **the study uses exactly one** to avoid
confounding item source with condition.

| Model | Role |
|---|---|
| **Kimi K3** (open weights) | The deployment story — OpenReview could self-host. Prioritise. |
| **Claude Fable / Sonnet** | Quality ceiling; Sonnet as the cost-realistic option |
| **GPT-5** | Cross-vendor generality check |

Selection metric: **validity rate** = fraction of generated items passing all §3.5 gates without
revision. Report per model, per family. This is RQ2's answer and a clean table.

Secondary: does the open-weights model's item bank discriminate as well as the frontier model's?
If yes, that's the single most deployment-relevant sentence in the paper.

### 4.3 Prototyping paper set (your §"Prototyping", made concrete)

Per researcher, 6 papers:

| Slot | Balint | Justin |
|---|---|---|
| Own paper ×2 | own | own |
| In-field, not own | — | — |
| Out-of-field, hard | dense OR theory | dense OR theory |
| Out-of-field, easy | LLM-applied-to-X | LLM-applied-to-X |
| Wildcard | detailed physics | observational social science |

Target from your brainstorm, now a measurable gate: **own paper passable in <5 min; random paper
not passable in <30 min.** Track both. If the second fails, the item families are wrong — that is
the Aug 28 kill signal.

Prefer **2025–2026 arXiv papers** for the foreign pool so generators are less likely to be drawing
on memorised content.

---

## 5. Grading (D3)

### 5.1 Design

- **Closed items** (F1, F2, F4): programmatic. No LLM. Numeric entry uses a tolerance band set at
  item-authoring time.
- **Open items** (F3, F5): LLM grader with an item-specific rubric generated *alongside* the item
  and frozen before data collection.
- **Blinding is mandatory.** The grader sees the paper, the item, the rubric, and the response —
  never the condition, never the participant. Enforce at the API boundary, note it in the paper.
- **Partial credit**: 3-level rubric (0 / 0.5 / 1). Report both partial-credit and binarised
  scoring; if conclusions differ, that itself is a finding about threshold brittleness.
- Grade each open response **3× at temperature 0 with shuffled rubric order**; report
  self-consistency. Cheap reliability evidence.

### 5.2 Validating the grader (RQ3)

1. **Human IRR.** Both researchers independently grade 100% of open responses against the same
   rubric, blind. Report Cohen's κ (human–human) and κ (LLM–human-consensus). Target κ > 0.7.
2. **Participant adjudication.** Participants see their grades and can contest (§11.3). Contest
   rate and upheld rate are direct evidence.
3. **Fluency-perturbation experiment — the most important A3 test in this plan.** See §9.2.

### 5.3 Scoring and thresholds

Do **not** fix a 30% threshold a priori. Instead:

- Report the full ROC of score → authorship, with AUC and bootstrap CIs.
- Report the **operating point at FPR ≤ 1%** and the TPR achieved there.
- State the base-rate arithmetic in the discussion: at NeurIPS's 21,575 submissions, a 1% FPR is
  ~215 false accusations. Therefore the honest deployment framing is **triage feeding human
  review**, not automated verdict — aligning with ICLR 2026's evidence standard and against
  NeurIPS 2026's. This paragraph is the paper's policy contribution.

### 5.4 Inert adaptive logging

Per the locked decision: run a Bayesian updater silently.

- Prior: P(author) = 0.5 (report sensitivity to 0.9, the realistic deployment base rate).
- Per item, update using the item's empirically-estimated likelihoods P(correct | author) and
  P(correct | non-author) — **estimated by leave-one-participant-out** to avoid circularity.
- Log the posterior trajectory. Post hoc, evaluate stopping rules at thresholds (0.05, 0.95).
- Headline result: *"adaptive stopping would have reached the same verdict in N̄ items"* —
  a system contribution with no live-adaptive engineering risk.

---

## 6. Scope declaration red-team (D4)

Two researchers, ~2 days, no participants. The property under test is **security, not usability**:

> Can an author shrink the test by declaring a narrow contribution, such that passing no longer
> requires understanding the paper?

**Protocol.**

1. Pick 4 multi-contribution papers (2 own, 2 foreign; ideally genuine ML+X collaborations).
2. For each, generate item banks under three declarations: *full*, *honest-narrow*,
   *dishonest-narrow* (a scope the declarer did not actually do).
3. Measure:
   - **Coverage retention** — does a narrow declaration still yield items requiring genuine
     engagement, or does it degenerate to warmups?
   - **Evasion gain** — does a non-author score higher under dishonest-narrow than under full?
   - **Honest-author cost** — is an honest narrow contributor *penalised* by out-of-scope items?
     (The A3-adjacent failure mode: a scope mechanism that punishes honest specialists.)

**Predicted failure and its mitigation.** Narrow declarations shrink the bank and inflate scores.
Mitigation to test: hold the item count fixed and require the declarant to answer *integration*
items — how their part interfaces with the rest — which every genuine contributor can answer and
no outsider can. If that works, it's a clean design finding and a good subsection.

---

## 7. Adversarial evaluation — the existential test

**This section must exist and its result must be in the abstract.** If a non-author with the paper
and a frontier model passes, the mechanism is dead in unproctored deployment.

### 7.1 Offline LLM-assist battery

No participants. For every item in the bank, run:

| Condition | Setup |
|---|---|
| **No context** | Item only. *Any correct answer ⇒ discard the item* (field-knowledge probe) |
| **Abstract only** | Leakage filter (§4.1) |
| **Full paper** | The realistic attack. Paper + item in context |
| **Full paper + agentic** | Model may re-read, search the PDF, self-critique |
| **Full paper + time budget** | Attack simulated under the item's actual timer, including human copy/paste/read overhead |

Report per-family LLM pass rate. This gives **broad coverage** across the whole item bank at zero
participant cost, and doubles as item-bank QA. It is no longer the headline adversarial result —
§7.3 is.

### 7.2 Live LLM-assisted adversary block (in-person, observed) — **new, the headline**

Six minutes at the end of the foreign-paper block. This is the single biggest gain from running
in person.

**Protocol.** After the participant completes the foreign paper unaided, tell them plainly:

> *"Now we'd like you to try to beat the system. Here is a frontier model with the paper already
> loaded. You'll re-attempt up to 5 items you got wrong, under the same time limits. You keep the
> pass bonus if you succeed."*

- Items: up to 5 previously-failed items from the same foreign paper, same timers, same interface.
- Model: one frontier chat model in a side panel, paper pre-loaded, participant free to prompt
  however they like.
- The researcher **observes and takes structured notes** (§8.6): prompting strategy, where the
  clock was lost, whether they abandoned the model.
- All prompts and completions logged.

**Measures.**
- **LLM lift** = P(correct on retry | failed unaided). The deployment-relevant number.
- **Wall-clock breakdown**: read item → formulate prompt → wait → parse → answer. This is the
  quantity the timing defence rests on, and it is the number an offline battery cannot produce.
- **Timeout rate** under LLM assistance vs unaided.
- Per-family lift — expect F1/F2/F5 to be liftable, F3/F4 far less so.

**Why within-person retry rather than a separate arm.** It costs no between-subjects cell (so the
in-field/out-of-field split in §8.2 survives), it conditions on items the participant demonstrably
could not answer alone — isolating the model's contribution — and it gives paired data.

**Ordering is load-bearing:** always last. Once a participant has seen the model's answers, their
unaided performance is contaminated, so this block can never precede a scored block.

**Ethics note for IRB.** Explicitly instructing participants to defeat a system is unusual enough
that the protocol should name it: it is a red-team task on a research prototype, no deception, no
real-world consequence, and the bonus is paid either way.

### 7.3 The likely result, and how to frame it honestly

Expect frontier models to do **well** on F1, F2, F5 given the full paper. F3 and F4 should hold up
(unstated rationale, private decisions). **Do not oversell.** The defensible claim is:

> The test is not LLM-*proof*; it is LLM-*costly*. Discrimination under open-book comes from the
> conjunction of item family and time budget: at a 45s ceiling calibrated to author latency, the
> LLM-assisted attack loses on wall-clock even where it wins on accuracy.

That is why §3.4's latency calibration matters, and why timers must be justified by data rather
than picked. §7.2 supplies the measurement — observed human-plus-model wall-clock against a timer
set from author latency. **This is the paper's answer to the reviewer's first objection, and it is
now an empirical result rather than an argument.**

**Two outcomes, both publishable — decide the framing when the data lands, not before.**

- *LLM lift is low under the timer.* Then the timing defence works, and the claim is that
  comprehension testing is viable even unproctored. Strongest version of the paper.
- *LLM lift is high.* Then unproctored deployment is not viable, and the contribution becomes:
  comprehension testing works **as a proctored or semi-proctored mechanism** — which is exactly
  the position the education literature reached on viva voce, and which maps onto a realistic
  deployment (proctor the subset already flagged by cheaper signals, e.g. citation auditing).
  Still a CHI paper; different title.

Pre-register both framings so the second cannot be read as a post-hoc rescue.

Residual limitation to state either way: the study proctors, so adversary E is closed by
construction. Unproctored deployment reopens it.

---

## 8. User study (D5)

### 8.1 Participants and logistics

- **Target N = 24** (minimum 20, stretch 30). CMU SCS MS/PhD/postdoc + word-of-mouth.
- **Eligibility:** ≥1 first-author paper at a peer-reviewed venue.
- **Identity verification:** now trivial and strictly better than online — CMU ID checked in
  person at the door. The whole design rests on them genuinely having authored the uploaded paper,
  and in-person verification removes the weakest link in the v1 plan.
- **Compensation:** flat **$30** (up from $25 — in-person adds travel and a fixed slot) plus a
  **$10 bonus for passing, in either condition**, plus the same $10 retained if they beat the
  system in the §7.2 LLM block. Worst case ≈ **$40 × 30 = $1,200.**

  Bonus-for-passing-either-way is deliberate: maximum effort in the own-paper condition *and* a
  paid red-team in the foreign condition. Say this in the paper; it strengthens the adversarial
  claim.

**Throughput — the new binding constraint.**

| | |
|---|---|
| Session | 60 min + 10 min reset/notes = **70 min per slot** |
| Per researcher per day | ~5 slots (5.8 h) — hard ceiling, degrades after |
| Two researchers in parallel | ~10/day nominal, **6–8/day realistic** |
| Aug 31 – Sep 4 (5 days) | 30–40 slot capacity |

N=24 is comfortably achievable **only if recruitment and scheduling are in place before Sep 1.**
Capacity is not the risk; filled slots are.

**New logistics that did not exist in v1 — all must be done by Aug 21:**

- **Book two rooms** for Aug 31 – Sep 4, full days. Quiet, closable door, no foot traffic. Two
  rooms is what makes parallel sessions possible; a single room halves capacity.
- **Two identical laptops**, same screen size, same browser, same PDF viewer, same zoom default.
  Standardised hardware removes a nuisance variable that online studies simply eat.
- **Scheduling system** with automated reminders (Calendly or equivalent). Assume **20% no-show** —
  over-book accordingly and keep a same-day standby list.
- **Paper upload ≥24 h before the slot**, enforced at booking. Item generation is not a live
  operation (§8.4).
- **Payment mechanics** — gift cards physically on hand, plus a receipt/tracking sheet.

### 8.2 Design

Within-subjects, both papers, **order counterbalanced**.

```
                      ┌─ own paper  ─┐
participant ──────────┤              ├── counterbalanced order
                      └─ foreign     ─┘
                            │
                    randomised between subjects:
                    ├─ in-field foreign   (n≈12)
                    └─ out-of-field foreign (n≈12)
```

**The in-field/out-of-field split is not optional.** Without it, a reviewer correctly objects that
you built a field-knowledge test, not an authorship test — the F3 confound from §3.2. With it, the
own-vs-foreign contrast stays at full N=24 (paired), and the in-vs-out contrast at n≈12 per cell is
underpowered but directionally informative. Report the second as exploratory and say so.

**Foreign paper assignment.** Curated pool of 2025–2026 arXiv papers, stratified by field and
rated for difficulty by both researchers (report inter-rater agreement on difficulty). Screen with
*"Have you read this paper before?"* — swap if yes. Log the swap rate.

### 8.3 On adversary B (prepared non-author)

The cold-non-author is a **weaker** adversary than the real AI-submitter, who at least skimmed
their own output. Fix: a **3-minute supervised skim** of the foreign paper before its block begins
(reduced from 5 min in v1 to fit the hour).

In-person makes this cleaner than it would have been online — the skim is genuinely timed and
genuinely observed, so "3 minutes of preparation" means exactly that rather than an honour-system
claim. Record skim behaviour on the observation sheet: which sections they went to, whether they
read linearly or hunted, whether they took notes. **No notes may be carried into the block** — say
so up front.

### 8.4 Procedure — 60 minutes

Paper upload, scope declaration, and eligibility all happen **at booking, ≥24 h ahead**. Item banks
are pre-generated overnight and human-checked before the slot. Nothing is generated live: it costs
3–5 min of dead time and introduces a mid-session failure mode you cannot recover from with a
participant sitting there.

| Step | Ceiling | Expected |
|---|---|---|
| Greet, CMU ID check, consent, recording consent | 5 | 5 |
| Instructions + interface tutorial (1 practice item) | 3 | 3 |
| **Block A** (order-randomised) | 16 | 10 |
| Micro-break | 1 | 1 |
| **Block B** | 16 | 10 |
| **§7.2 LLM-assist retry** (foreign items, always last) | 6 | 6 |
| Grade reveal + contest affordance | 3 | 3 |
| Post-test survey *(flex — see below)* | 4 | 4 |
| Semi-structured interview + retrospective think-aloud | 8 | 8 |
| Debrief, payment | 2 | 2 |
| | **64** | **52** |

Block content: own paper = 8 scored + 2 warmup, 12.75 min ceiling. Foreign paper = 3-min skim
+ the same form, 15.75 min ceiling. Authors finish well under ceiling, so **52 min is the realistic
session and 64 the worst case.**

**Three ordering rules that matter:**

1. **Paper order is counterbalanced** (own-first / foreign-first), randomised at booking.
2. **The LLM-assist block always runs last**, even when the foreign paper was Block A. Otherwise a
   participant who has seen model answers carries format knowledge and strategy into a still-scored
   block. The cost — a ~15-min gap between the foreign block and its retry — is acceptable and
   arguably more realistic.
3. **The survey is the flex item.** If a session runs long, send it as a link afterwards. The
   interview cannot be moved: it is the qualitative contribution and it depends on the researcher
   having just watched the session.

### 8.5 Proctoring and session control

Proctoring replaces most of v1's anti-cheat engineering. Keep only what serves measurement:

- **Server-side timestamps** for every item start/submit — still needed, because latency is a
  primary measure and §7.2 depends on it. Client clock ignored.
- **Researcher-supplied laptop**, single browser window, no other applications open. The LLM is
  physically unavailable until §7.2, when it is deliberately provided.
- **Single sitting by construction.** Drop the session token, wall-clock lock, and resume logic —
  they no longer earn their build cost.
- **Drop `visibilitychange` / paste telemetry entirely.** It existed to infer cheating you can now
  simply observe, and v1 already noted it is an A3 hazard (it proxies for screen-reader use,
  translation tools, and second-language workflows). Removing it is a small privacy win worth one
  sentence in the paper.
- **Item timers server-enforced**, late submissions marked. Unchanged.

**The proctor does not grade.** State this prominently. It is the design property that lets you
claim the security benefit of proctoring without importing the interpersonal-bias cost the
oral-exam literature documents — accent stereotyping, examiner effects, differential rapport.
Grading stays automated and blind to condition; the human in the room controls circumstances only.
This is a genuine contribution and it directly answers the accessibility objections to viva voce
catalogued in the background review.

### 8.6 Observation protocol — data you cannot get online

Structured sheet, completed by the researcher during and immediately after each session. Keep it
**behavioural, not impressionistic** — a researcher who can see the participant is a researcher
who can accidentally record demographic impressions, which is exactly what A3 forbids.

Per block, record: PDF navigation (scroll/search/section-jumping counts, coarse), whether they
searched at all, visible abandonment or guessing, timer expiries, and unprompted verbal reactions
(verbatim only).

Per §7.2 LLM block: prompting strategy (paste-item / paraphrase / multi-turn), number of turns,
whether they abandoned the model, and where the clock was lost.

**Prohibited fields**, stated in the protocol so it's a design commitment rather than an
intention: no notes on accent, fluency, apparent ethnicity, gender, age, or demeanour.

**Audio recording** of the interview only — not the test blocks. Separate consent checkbox;
participation permitted if declined, in which case the researcher takes written notes.

### 8.7 Interview and retrospective think-aloud (8 min)

Replaces v1's survey-only RQ6 and is the main qualitative upgrade from going in person.

**Retrospective think-aloud (4 min).** Cue from the participant's own logged responses — pull the
2–3 items with the longest latency or an incorrect answer and ask what they were doing. Do *not*
run concurrent think-aloud: it would contaminate latency, which is a primary measure and the basis
of the §7.3 timing argument.

**Semi-structured interview (4 min).** Fixed core, free follow-up:

1. Did the test feel fair? Where did it feel unfair?
2. Would a system like this accept you, assuming you're acting in good faith?
3. Would it catch someone who submitted a paper they didn't understand?
4. Would it increase or decrease your trust in a venue that used it?
5. What would you change?

Both researchers use the same guide. Log deviations.

### 8.8 Measures

**Primary**
- Within-person score gap Δ = score(own) − score(foreign). *Paired Wilcoxon signed-rank.*

**Secondary**
- ROC/AUC of score → authorship; operating point at FPR ≤ 1%.
- Author score distribution, with explicit attention to the **left tail** — the false-accusation
  risk, and the metric NeurIPS 2026 should have reported.
- Per-family discrimination index D (per-item D reported as exploratory, §3.3).
- Time to complete, per condition and per family; separately for correctly vs incorrectly
  classified participants.
- Confidence-weighted score as an alternative classifier.
- Grader IRR (§5.2); adaptive stopping length (§5.4).

**Adversarial (§7.2) — new, and headline**
- LLM lift = P(correct on retry | failed unaided), overall and per family.
- Observed wall-clock breakdown of the human-plus-model loop vs. the item timer.
- Timeout rate, LLM-assisted vs unaided.

**Perceptual (RQ6)** — 7-point unless noted. *Time-budgeted: inline ratings must stay under
~90 s total across both blocks, or they eat the interview.*
- **Inline, one item only:** "How difficult was that?" (~5 s per item).
- **At grade reveal, for 4 sampled items:** difficulty-if-not-author; fairness; "made me think
  about my paper"; "was this graded correctly?" (binary + free text).
- **Post-test survey:** felt fair; confidence it would accept a trustworthy me; confidence it would
  catch bad actors; effect on trust/respect for the venue; would recommend deployment; free text.
- **Interview + think-aloud (§8.7):** the primary qualitative source.

**Observational (§8.6)** — navigation and search behaviour; LLM prompting strategy; abandonment.

### 8.9 Power

Only large effects matter here: if authors and non-authors are not separated by a large margin,
the mechanism is not viable regardless of significance. So powering on large effects is
substantively, not just pragmatically, correct — make that argument in the paper.

Paired Wilcoxon, α = .05 two-sided:

| Effect (d) | N=20 | N=24 | N=30 |
|---|---|---|---|
| 0.8 | 0.72 | 0.80 | 0.88 |
| 1.0 | 0.87 | 0.92 | 0.97 |
| 1.2 | 0.95 | 0.98 | 0.99 |

N=24 gives >0.90 power for d ≥ 1.0. Adequate for C1.

---

## 9. Fairness audit (A3)

### 9.1 Stance

Pre-register this sentence: *demographic attributes are collected, never used in scoring, and used
solely for disparate-impact auditing.* This is the lit review's §7.2 tension resolved in the only
coherent direction, and stating it plainly is a contribution — the alternative (blindness) provably
does not deliver the goal.

Collect, post-hoc, optional, after the test so it cannot affect behaviour: native-English status,
years since the paper was published, career stage, affiliation type, whether they consider
themselves an independent researcher.

Report differential performance descriptively. **Do not claim a DIF analysis at N=24** — you cannot
support it. Say so, and note that a properly-powered DIF study is the natural follow-on. Reviewers
respect a stated limit far more than an overreach.

### 9.2 Fluency-perturbation experiment (the strongest A3 evidence, and it is cheap)

Because it is controlled, this beats the underpowered demographic breakdown.

1. Take every correct open-ended response from the study.
2. Produce three variants holding **content constant**: fluent native-like; non-native-like
   (article/preposition irregularities, simpler subordination, L1-transfer patterns); terse/telegraphic.
3. Grade all variants with the blinded LLM grader.
4. **Any grade drift across variants is grader fluency bias**, measured directly.

This is the mechanism Liang et al. (2023) identified in detectors, tested in graders. If drift is
non-zero, the mitigation — instruct the grader to score content only, re-measure, report the
delta — is itself a finding. Run it even if everything else is cut.

### 9.3 Design commitments to state in the paper

- No scoring on writing quality, fluency, or latency. *(Tab-switch and paste telemetry are now
  not collected at all — §8.5.)*
- No scoring on author count, affiliation, or seniority. **Explicitly contrast with NeurIPS 2026's
  solo-authorship threshold** (79 of 178 no-appeal rejections). This is the motivating example and
  it belongs in the intro.
- **The proctor controls circumstances but does not grade** (§8.5). This is the design property
  that separates the mechanism from viva voce: it buys assessment security without importing
  examiner bias. Make the argument explicitly against the accent-stereotyping and examiner-effect
  findings in the background review.
- **Observation sheets exclude demographic and demeanour fields** by protocol (§8.6).
- Contestability is built in (§11.3), against NeurIPS's no-appeal precedent.

### 9.4 New A3 limitation introduced by going in-person

An in-person study recruits whoever can physically reach the room during the first week of
semester. That plausibly skews toward local, full-time, unencumbered participants and against
remote, caregiving, part-time, and disabled researchers — the last being a group whose treatment by
timed testing is one of the central A3 questions. Online recruitment would have been broader on
exactly the dimensions A3 cares about.

State this as a sampling limitation, and offer the mitigation: recruit deliberately across career
stage and native-language status within the constraint (§9.1), and note that a broader remote
replication is the natural follow-on. Do not paper over it — the §9.2 fluency-perturbation
experiment is controlled and carries the A3 argument regardless of who walks through the door.

---

## 10. Analysis plan

Pre-register before data collection (OSF, ~1 page) — cheap, and it protects the confirmatory claims.

**Confirmatory**
- H1: Δ > 0. Paired Wilcoxon.
- H2: AUC > 0.8. Bootstrap CI, 10k resamples.
- **H3 (new): LLM lift < 0.5** on previously-failed foreign-paper items under the item timer.
  Exact binomial on paired retry outcomes. *Pre-register both framings from §7.3 so a high-lift
  result is reported as a finding, not a rescue.*

**Exploratory (labelled as such)**
- Per-family and per-item D; in-field vs out-of-field; confidence weighting; adaptive stopping;
  latency; demographic breakdowns; per-family LLM lift; offline battery vs observed human-plus-model.

**Qualitative.** Interview transcripts and free text. Both researchers open-code, reconcile into a
shared codebook, report κ. Target themes: perceived fairness, perceived usefulness, deployment
concerns, suggested modifications, and — new from the think-aloud — *strategies used when the item
was hard*, which is direct evidence about what the items actually measure.

**Transcription** is now on the critical path: ~24 × 8 min of audio. Auto-transcribe same-day,
spot-correct only the passages you quote. Do not plan to transcribe verbatim in full.

**Exclusions,** pre-specified: participants failing ID verification; sessions with a material
protocol deviation (logged by the proctor); items failing the author-answerable gate (report with
and without). *The >75-min wall-clock exclusion is dropped — sessions are now bounded by the slot.*

---

## 11. System build

### 11.1 Stack — run it **locally on each laptop**

Still a custom web app, not Qualtrics. But in-person flips the deployment decision: **run the app
locally on each session laptop**, not on a VM.

```
FastAPI + SQLite (local)  ·  React + PDF.js  ·  local timing authority
Network needed ONLY for: open-item grading at reveal, and the §7.2 LLM panel
End of day: export JSON per laptop → merge → analysis repo
```

Rationale: a wifi drop mid-session with a paid participant sitting in the room is an unrecoverable
failure that local-first eliminates entirely. Item banks are pre-generated the night before, so
generation never needs network during a session either.

**Network-failure fallback, spec it explicitly:** if the grading API is unreachable at grade
reveal, show closed-item grades (programmatic, always available), mark open items "pending", and
email results afterwards. Only 2 open responses per paper are affected. The session continues.

**Timing authority** moves from server to the local backend — same guarantee, since the participant
never controls the machine. Do not put timers in client JS.

### 11.2 Build order (strictly by risk)

1. Item generation pipeline + bank inspection UI ← *highest risk, build first*
2. Test-taking UI: local timers, PDF pane, inline difficulty rating
3. Grading + rubrics + blinding boundary + offline fallback
4. **§7.2 LLM-assist panel** — side-by-side model with paper pre-loaded, full prompt/completion
   logging *(replaces v1's telemetry/session-integrity slot; roughly the same build cost, far more
   scientific value)*
5. Grade reveal + contest affordance
6. Post-test survey (Qualtrics is fine here — it's the flex item and can be sent afterwards)
7. Inert Bayesian logger
8. Export/merge script — trivial, but do not discover it's missing on Sep 4

**Dropped from v1:** `visibilitychange`/blur telemetry, paste detection, session tokens, wall-clock
locks, resume logic. Proctoring supersedes all of it. That is roughly a day of build time returned
— spend it on item quality at G1.

**Non-software artifacts, easy to forget:** observation sheet (paper is fine, and faster than a
form), interview guide, consent forms, ID-check log, payment tracking sheet, room signage.

### 11.3 Contest-a-grade affordance

Small build, disproportionate CHI value. After grades are revealed, the participant may contest any
item with a free-text argument. Log the argument; log whether the LLM (given rubric + response +
argument) upholds or overturns; **do not** let it change the participant's payment.

Two payoffs: it operationalises your "recourse" idea, and it directly addresses the
contestability gap that made NeurIPS 2026's no-appeal policy a scandal. Analyse qualitatively —
were good arguments upheld and bad ones rejected?

---

## 12. IRB

**Likely exempt**, Category 2 (educational tests / survey / interview procedures) or Category 3
(benign behavioural intervention). In-person adds three items to v1's list — address all five
head-on:

1. **Identifiable data.** Andrew IDs, uploaded papers, and now an in-person ID check. Protocol:
   verify identity at consent, assign a study ID, **de-link before analysis**, store the mapping
   separately with access limited to the two researchers, destroy at publication.
2. **Psychological risk.** Being told you failed a test on your own paper is genuinely
   distressing — and *more so face-to-face*, which the application should acknowledge rather than
   minimise. Mitigations: the $10 bonus is paid on passing either condition; the debrief states
   plainly that this is an unvalidated research prototype and the result is not an assessment of
   them or their work; withdrawal at any point with full payment; results never shared with anyone;
   **the proctor is trained not to react to a participant's performance.**
3. **Audio recording (new).** ⚠️ *The main new IRB risk, because recording identifiable audio can
   trigger limited IRB review under 2(iii) and add a week you do not have.*
   **Recommended protocol:** written notes are the **default**; audio is **optional** via a separate
   consent checkbox; if recorded, transcribe within 48 h, de-identify the transcript, **destroy the
   audio within 30 days**. Design the analysis so it works with notes alone — then recording is a
   bonus rather than a dependency, and the application reads as low-risk.
4. **Red-team instruction (new).** §7.2 explicitly asks participants to try to defeat the system.
   Name it in the protocol: no deception, a research prototype, no real-world consequence, bonus
   paid regardless of outcome. Reviewers dislike discovering this in the materials rather than the
   narrative.
5. **Direct observation (new).** State that observation is behavioural and structured, that
   demographic and demeanour fields are prohibited by protocol (§8.6), and that observation notes
   are keyed to study ID only.

Also cover: no deception beyond withholding the specific hypothesis; data-retention period;
uploaded-paper handling (participant-owned preprints/published work, not redistributed);
compensation schedule; and the physical location of sessions.

**Submit Mon 11 Aug.** CMU exempt determinations typically run 1–2 weeks; the plan has no slack for
a second round, so over-specify rather than under-specify. If the recording question looks like it
will cause a second round, **drop audio and proceed with notes** — the interview survives it.

---

## 13. Timeline and gates

| Dates | Work | Gate |
|---|---|---|
| **Aug 10–14** | Finalise plan. **Submit IRB Mon 11.** **Book two rooms Mon 11 — do this first, before anything else.** Build generation pipeline. Both researchers run own + foreign papers across 4 models. Calibrate timers (§3.4). Draft pre-registration. | **G1 (Fri 14):** ≥1 model produces ≥5 valid items/paper. Author <5 min, foreign not-passable <30 min. **Rooms confirmed.** *Fail ⇒ revise families over the weekend, do not proceed.* |
| **Aug 17–21** *(Justin away)* | Balint solo: build test-taking UI + local grading + §7.2 LLM panel. Run §7.1 offline battery. Run §6 scope red-team. **Stand up scheduling + booking-with-upload flow.** Prep two laptops to identical spec. In-person pilot with 1–2 friends, **timed against the 60-min budget.** | **G2 (Fri 21):** full 60-min session runnable end to end on the actual hardware, in the actual room, inside the hour. Offline LLM-assist results known. |
| **Aug 24–28** | Justin returns. Finalise system, survey, **observation sheet, interview guide, consent forms.** Dress rehearsal ×2 with both researchers proctoring. Freeze item bank and rubrics. Post pre-registration. **Open recruitment + booking Mon 24.** Draft intro / related work / method. | **G3 — Fri 28, the CHI go/no-go.** Criteria below. **≥16 slots booked** or recruitment is failing. |
| **Aug 31–Sep 4** | Run sessions, ~3/day/researcher in parallel. **Same-day: export data, auto-transcribe, write up observation notes.** Rolling grading and IRR annotation — never batch to the end. | **G4 (Thu 3):** ≥20 sessions complete, or trigger the wider recruitment call and add Sat Sep 5 slots. |
| **Sep 4–9** | Finish annotation, analysis, figures. Write results/discussion. Internal read Mon 8. | |
| **Sep 10** | **CHI deadline.** | |

**Three schedule changes forced by going in-person:**

- **Book rooms on day one.** Rooms for the first week of semester are the one dependency you cannot
  buy back later, and no amount of engineering slack substitutes for a room.
- **The Aug 17–21 pilot must be a real timed run** on the real hardware in the real room. A
  desk-check will not surface that the session is 68 minutes.
- **Same-day transcription and note write-up.** Twenty-four sessions of audio and observation notes
  left until Sep 4 will not be processed in time.

**Two changes to your timeline that I think are load-bearing:**

- **Recruitment opens Aug 24, not Aug 31.** Recruiting 24 CMU grads for 70-minute in-person slots in the
  first week of the fall semester takes lead time. Starting recruitment the same week you run
  sessions is the most likely cause of an under-powered study.
- **Paper drafting starts Aug 24, in parallel.** Sep 4–9 is five days for annotation, analysis, and
  a full CHI paper. Intro, related work, and method do not depend on results — write them during
  the Aug 24–28 window.

### G3 — explicit go/no-go criteria (Fri 28 Aug)

Proceed to CHI only if **all** hold:

1. Own-paper form completable in <8 min by its author, at ≥80% correct.
2. Foreign-paper form yields ≤50% for a cold non-author within the timers.
3. ≥5 of 8 scored items show pilot discrimination D ≥ 0.3.
4. Grader κ vs human > 0.6 on pilot data.
5. **Full session completes inside 60 minutes, twice, on the real hardware, with both researchers
   proctoring** — measured, not estimated.
6. **≥16 slots booked** for Aug 31 – Sep 4.
7. IRB approval in hand.

If 1–3 fail, the item design is wrong — retarget for a spring venue. If 5 fails, cut the survey to
a post-session link and drop one F2 item before cutting the interview. If 6 fails, widen
recruitment immediately and add Sat Sep 5.

**Note what is no longer a gate.** v1 made "LLM-assist pass rate below author pass rate" a
go/no-go criterion. It shouldn't be, now that §7.2 measures it live: a high-lift result is a
*finding* about proctored-vs-unproctored deployment (§7.3), not a reason to abandon the paper.
Keep it as a pre-registered outcome with two framings, not a kill switch.

---

## 14. Risks

| Risk | L | Impact | Mitigation |
|---|---|---|---|
| **Recruitment / no-shows** | **High** | Underpowered | *Now the top risk.* Fixed slots + travel is a much bigger ask than a link. Open Aug 24; $30 flat; assume 20% no-show and over-book; standby list; widen beyond SCS at G4 |
| **No room available** | Med | **Fatal** | Book Mon 11 Aug, before any engineering. Fallback: a shared office and staggered single-track sessions at half throughput |
| Sept 4–9 too short | **High** | Rushed paper | Draft Aug 24–28; grade and transcribe same-day; freeze scope at G3 |
| F3 field-knowledge confound | **High** | Threatens C1 | In/out-of-field split (§8.2); no-context filter (§4.1); report separately |
| **Session overruns the hour** | **High** | Cuts the interview | Measure at G2 on real hardware; survey is the designated flex item (§8.4); expected 52 min against a 64-min ceiling |
| LLM-assist defeats the test (§7) | Med | *Reframes, no longer fatal* | Two pre-registered framings (§7.3); proctored-deployment story survives a high-lift result |
| IRB delay, incl. audio recording | Med | Blocks Aug 31 | Submit Aug 11; audio optional with notes as default (§12); friends-only fallback pilot |
| Item bank too easy / too hard | Med | Weak D | Calibrate at G1; hold a reserve item pool |
| Grader fluency bias | Med | Threatens A3 | §9.2 perturbation experiment; content-only rubric instruction |
| Author fails own paper (old papers) | Med | Inflates FP | Collect paper age; pre-register as a covariate; recommend recent uploads |
| **Proctor inconsistency between researchers** | Med | Confound | Shared script; both proctor a dress rehearsal; log deviations; include proctor identity as a covariate |
| **In-person sample skew** | Med | Weakens A3 claims | Acknowledge (§9.4); recruit deliberately across career stage and language background; lean on §9.2 |

---

## 15. Deliverables

**Code & data** — generation pipeline; test-taking app incl. LLM-assist panel; item banks with keys
and rubrics; de-identified response data; **§7.2 prompt/completion logs**; analysis notebooks;
pre-registration.

**Study materials** — consent forms; **observation sheet**; **interview guide**; proctor script;
de-identified interview transcripts; codebook.

**Paper artifacts** — Fig 1 system diagram · Fig 2 author-latency distributions with timer overlay ·
Fig 3 score distributions (own / in-field / out-of-field, left tail annotated) · Fig 4 ROC with
FPR ≤ 1% operating point · **Fig 5 LLM-assist wall-clock breakdown against item timers — the §7.2
headline** · Table 1 per-family discrimination and LLM lift · Table 2 per-model item validity
rates · Table 3 fairness audit + fluency-perturbation drift.

---

## Appendix A — open items needing a decision before G1

1. **Foreign-paper pool curation.** Who builds it, and what is the difficulty rubric? Needed by
   Aug 14 for the in/out-of-field split to work.
2. **F4 ground truth.** Requires the author to supply keys for provenance items. In-person makes
   this *easier* than v1 assumed: booking already happens ≥24 h ahead with an upload step, so
   participants can author their F4 keys then, asynchronously, at zero cost to the 60-minute
   session. **Recommend doing this** — it was the main argument for dropping F4, and it no longer
   applies.
3. **Scope declaration in the study.** Participants declare scope at upload (§8.4) — is that used
   to filter their own-paper items, or collected and ignored? Using it makes the study more
   realistic; ignoring it keeps the own-paper condition clean. **Recommend: collect, ignore for
   scoring, report the distribution** — it tells you how narrow real first-authors' scopes are,
   which informs the D4 deployment argument at no cost.
4. **Pre-registration venue and timing.** OSF, posted by Aug 28.
5. **Audio recording — decide by Aug 11**, because it goes in the IRB application. Recommendation
   in §12: request it as optional with notes as the default path, so a slow determination cannot
   block Aug 31.
6. **Do researchers proctor participants they know?** Word-of-mouth recruitment plus in-person
   sessions means proctoring friends — which affects participant candour in the interview, effort
   in the red-team block, and proctor consistency. **Recommend cross-assignment where feasible**
   (Balint proctors Justin's recruits and vice versa), and log the relationship as a covariate
   where it isn't.
7. **Session slot length.** Book **70-minute** slots, not 60 — the extra 10 covers reset, notes,
   and overrun. Booking back-to-back 60s guarantees the day slips by mid-afternoon.
