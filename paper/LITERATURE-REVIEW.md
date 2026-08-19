# Verifying Author Accountability in the Age of Generative AI

**A background literature review**

Research questions under review:

- **A1** — Can we check whether authors *verified* the contents of their paper?
- **A2** — Failing that, can we check whether authors are *capable* of verifying it?
- **A3** — Can we do either *without* relying on common demographic indicators, avoiding the bias and discrimination inherent in those metrics?

---

## 0. Executive summary

The literature does not yet contain a solution to A1–A3, but it contains a great deal that
constrains the shape of one. Five findings dominate:

1. **A1 is close to impossible as a forensic problem, and this is now a formal result, not a
   hunch.** Every artifact-side signal (text style, keystroke timing, watermarks) can be shown to
   be either evadable or non-identifying. The strongest negative result is that keystroke-based
   provenance has *zero mutual information* with text origin under a copy-type attack — a human
   retyping LLM output produces genuine motor signals.
2. **A1 has nonetheless been attempted at scale in 2026, and the results are a cautionary tale.**
   NeurIPS 2026's Position Paper Track desk-rejected 18.4% of submissions on AI-detector scores
   with no appeal. Critically, one of its three rejection thresholds combined a detector score
   with a **solo-authorship flag** — i.e. the venue used a structural proxy for *independent
   researchers* as evidence of misconduct. This is precisely the A3 failure mode, committed by a
   top venue, and it is the single most useful case study available.
3. **A2 is a fundamentally different kind of problem, and this reframing is the key move.**
   Verifying *capability to verify* is not forensics; it is **measurement**. That relocates the
   problem into assessment/psychometrics, where there is a mature literature (validity,
   reliability, assessment security, viva voce, evaluative judgement) that the publishing world
   has essentially not touched.
4. **A3 is harder than "don't use demographics."** The fairness-without-demographics literature
   establishes that omitting protected attributes does not prevent disparate impact — models
   readily reconstruct them from proxies. Worse, *detecting* disparate impact requires the
   demographic data you are trying not to use. This is a real, unresolved tension that any
   proposal must confront rather than assume away.
5. **The biggest structural gap:** education has spent three years building comprehension-based
   assurance mechanisms for exactly this problem (student submits work they didn't write and don't
   understand). Scholarly publishing has borrowed almost none of it. There is no published
   instrument for comprehension-based author verification in peer review. That gap is the
   contribution space.

---

## 1. The empirical picture: how big is the problem?

### 1.1 Submission volume

| Venue | Signal |
|---|---|
| NeurIPS | 15,671 submissions (2024) → 21,575 (2025) |
| ICML | +44.9% YoY (2023→2024), +25.4% (2025) |
| TMLR | Submissions **tripled** in one year; **single-author submissions grew 13-fold** |
| arXiv CS | Stopped accepting review articles and position papers without prior peer review (Oct 2025), citing hundreds of AI-generated papers per month |

TMLR's own announcement of annual author submission quotas states the observation directly:
authors were submitting **as many as five papers in a day**. This corroborates the anecdote in the
project framing. TMLR's response was a *generalized harmonic quota* — submission cost scaling with
coauthor count (2 solo-authored papers/year for regular authors, up to 9 for 9-author submissions;
doubled for active reviewers/editors), counting from 1 Jan 2026 with enforcement from 1 Jul 2026 —
plus "greater editorial oversight of low quality work and stronger enforcement of TMLR policies,
which will result in desk rejection and/or prohibiting authors from submission."

Note what TMLR did **not** do: it did not attempt to verify author understanding. It priced
submission. This is the "structural mechanism" family (§6) and it is currently winning on
deployability.

### 1.2 Prevalence of LLM-generated text

- **≥13.5%** of 2024 biomedical abstracts show LLM processing, reaching **40%** in some
  subcorpora (Science Advances, excess-vocabulary method).
- Computer Science: up to **17.5%** of abstracts modified by Feb 2024.
- Nature portfolio: ~**7%** for 2024.

These use *excess vocabulary* / distributional shift methods on populations, which is far more
defensible than per-document classification — a distinction that matters enormously for A3 and is
frequently elided (§4.1).

### 1.3 The threat model is escalating beyond "lazy author"

Two papers reframe the problem as adversarial rather than merely careless:

- **Agentic denominator gaming** (arXiv 2605.09915): an actor deploys agents to flood a venue with
  plausible-but-low-quality papers. The goal is *not* acceptance — it is inflating the denominator
  so that, at a stable acceptance rate, a small set of targeted legitimate papers gains
  probability. Mitigation, the authors argue, requires system-level policy and incentive reform,
  not detection.
- **Sakana's AI Scientist-v2** produced a fully AI-generated paper that passed peer review at an
  ICLR workshop (mean score 6.33), withdrawn by protocol. Existence proof that the artifact alone
  can clear a review bar.

This matters for the research design: a mechanism that only deters careless authors but not
motivated adversaries addresses the smaller half of the problem.

---

## 2. The 2026 natural experiment: what venues actually did

This is the most valuable and least-cited body of evidence for the project. Four primary sources,
all verified directly.

### 2.1 NeurIPS 2026 Position Paper Track — the A3 cautionary tale

Partnered with **Pangram** (commercial AI detector). Of 969 submissions:

- Default detector settings: 28.2% (273) flagged as substantially AI-written. Comparators: FAccT
  2025 ≈ 1%; NeurIPS 2025 ≈ 8.2%.
- Window-size sensitivity: default windows flagged **42.7%**; recalibrating to 100-word windows
  dropped this to **12.7%**. *Outcomes were highly sensitive to a parameter authors could not see.*
- **178 submissions (18.4%) desk-rejected with no appeal**, via three thresholds:
  - Pangram > 0.9 → 77 papers
  - Pangram > 0.8 **paired with a solo-authorship flag** → 79 papers
  - Pangram > 0.5 **where authors had explicitly denied any AI use** → 22 papers
- **123 (12.7%) conditionally rejected**, required to produce **version history documentation**
  (pre-AI and post-AI writing checkpoints) by 15 June 2026.

Three observations the project should build on:

- The **second threshold is an A3 violation in the wild.** Solo authorship is not a demographic
  attribute in the protected-class sense, but it is a near-perfect structural proxy for
  independent researchers, early-career researchers without collaborators, and researchers outside
  well-resourced institutions. Using it as a *multiplier on suspicion* is textbook proxy
  discrimination (§7). Notably, 79 of 178 rejections — 44% — depended on it.
- The **third threshold penalises denial**, which inverts the burden of proof: a low detector score
  becomes actionable *because* the author asserted innocence.
- The **conditional tier is the closest thing in existence to a deployed A1 mechanism.** Requiring
  version history is a process-provenance demand (§5). Whether authors could actually satisfy it,
  and who could not, is an unpublished empirical question that is directly answerable and would
  make an excellent study.

The track drew substantial public backlash over false positives and the absence of appeal.

### 2.2 ICML 2026 — a genuinely rigorous detection design

ICML targeted *reviewers* rather than authors, but the methodology is the best-engineered
detection scheme in the corpus and transfers directly.

Method (from Rao, Kumar, Lakkaraju & Shah, PLOS ONE 2025 / arXiv 2503.15772): embed **indirect
prompt injection** in submission PDFs instructing any LLM to include two phrases drawn from a
170,000-phrase dictionary. Probability of a specific pair arising naturally ≈ 1 in 10^10. Frontier
LLMs complied at >80% in pre-deadline tests.

Results: 795 reviews (~1%) from Policy-A (no-LLM) reviewers flagged; 506 unique reviewers; **497
papers desk-rejected**, corresponding to 398 reciprocal reviewers who violated rules they had
explicitly agreed to. 51 reviewers (~10% of violators) who used LLMs in >half their reviews had all
reviews deleted and were removed from the pool.

Why this design is important for A1–A3:

- It produces a **statistically bounded false-positive rate** (stated: 0.0001 for a single Policy-A
  review) rather than a model-confidence score.
- **Every flag was manually verified by a human** before consequences.
- It is **content-independent**: the signal has no correlation with writing style, English
  fluency, or author background. It is therefore *structurally* A3-compliant in a way that
  stylometric detection can never be.
- Its limitation is that it detects *LLM use in producing a specific artifact under a rule the
  subject consented to*, which is a much narrower claim than "the author verified the content."

The consent framing is worth stealing. ICML also runs a **two-policy system** (A: LLM use in
reviewing prohibited; B: permitted for comprehension and polishing but not for judgement), with
authors declaring which policy their paper requires and reciprocal accountability — a reviewer who
is an author on a Policy-A paper must themselves follow Policy A.

### 2.3 ICLR 2026 — evidence-standard conservatism

ICLR used LLM detection tools only to *triage*, and took action solely when area chairs found
**concrete evidence** — hallucinated references, false claims. Undisclosed extensive LLM use →
desk rejection. Reviewers submitting poor LLM-generated reviews face desk rejection of their own
submissions.

This is the opposite pole from NeurIPS: detector-as-prior, human-found-defect as evidence.
The contrast between ICLR's and NeurIPS's evidence standards, applied in the same season, is a
ready-made comparative case study.

### 2.4 Synthesis of venue practice

| Venue | Mechanism | Evidence standard | A3 exposure |
|---|---|---|---|
| TMLR | Submission quotas (harmonic, coauthor-scaled) | None needed | Low — but penalises solo authors by design |
| ICML 2026 | Watermark via prompt injection + manual verify | Statistical, bounded FPR | Very low |
| ICLR 2026 | Detector triage → human-found concrete defect | Human adjudication | Low–moderate |
| NeurIPS 2026 PPT | Detector score thresholds + solo-author flag | Classifier output | **High — realised** |

---

## 3. Why A1 is the hard one: the conceptual problem

"Did the author verify the contents?" is a claim about a **private mental event in the past**. No
artifact inspection can establish it. The literature approaches it through four proxies, each of
which substitutes a different, weaker question:

| Proxy | Actual question answered | Gap to A1 |
|---|---|---|
| Text forensics | Was this text machine-generated? | AI-written ≠ unverified; human-written ≠ verified |
| Process provenance | Was this text typed/edited by a human over time? | Typing ≠ understanding |
| Artifact defects | Does the paper contain errors a verifier would have caught? | Absence of evidence; sound papers can be unverified |
| Attestation | Does the author *claim* to have verified? | Unfalsifiable; see AI Ghostwriter Effect |

The fourth is worth dwelling on. ICMJE authorship criteria and Science's per-author email
verification already require every author to affirm accountability for the whole work. These
mechanisms are universal and have completely failed to prevent the current situation, because they
are costless assertions. **Any A1 proposal that reduces to a stronger attestation is
re-implementing something already known not to work.**

The **AI Ghostwriter Effect** (Draxler et al., TOCHI 2024; arXiv 2303.03283) supplies the
psychological mechanism: across two studies (n=30, n=96), users **do not perceive ownership** of
AI-generated text yet **still self-declare as authors** and refrain from declaring AI authorship.
Ownership rose with degree of user influence on the text. This is the exact population the project
targets, and it shows the failure is not primarily deceptive — it is a genuine
ownership/declaration mismatch. Disclosure requirements do not fix a mismatch people do not
perceive themselves to have.

Supporting evidence on the mechanism: the automation-bias and cognitive-offloading literature
finds significant negative correlation between frequent AI use and critical thinking, mediated by
offloading, with users under-verifying outputs they cannot interrogate. The "author who doesn't
understand their own paper" is a predicted outcome, not an anomaly.

---

## 4. Approach family 1 — Artifact-side detection (and its A3 collision)

### 4.1 The bias result that constrains everything

**Liang et al., "GPT detectors are biased against non-native English writers," Patterns 4:100779
(2023)** (arXiv 2304.02819). Over half of non-native-authored TOEFL essays were misclassified as
AI-generated; near-perfect accuracy on US 8th-grade essays. Proposed mechanism: low perplexity
from reduced lexical variability.

This single result is the reason A3 is in the research question at all, and it is the load-bearing
citation for the whole project. Its implication is stronger than usually acknowledged: the bias is
not an implementation defect to be patched, it is **intrinsic to perplexity-based detection**,
because the property being measured (linguistic predictability) is genuinely correlated with
non-native writing.

### 4.2 Current detector performance and the contested picture

Detector quality has improved markedly since 2023, and the project must engage with this honestly
rather than treating 2023 results as settled.

Pangram specifically: a June 2026 peer-reviewed study (Vrije Universiteit Brussel) on 160 academic
papers found it the only tool to reliably detect AI content — 97.5% on fully AI-written, 95% on
"humanized" text. Vendor-reported FPR ≈ 0.01% overall, ≈0.004% on academic essays. Chicago Booth's
"Artificial Writing and Automated Detection" (1,992 human pre-2020 texts + 1,992 AI texts) found
Pangram best at minimizing false positives, near-zero across most thresholds.

But: it matches human judgment only 83% of the time on English essays, and **highly structured or
formulaic writing — explicitly including some non-native-speaker output — remains more likely to
trigger false positives.** The bias has narrowed; it has not been shown to be eliminated. And note
the base-rate arithmetic: at NeurIPS's scale, even a 0.1% FPR across ~20,000 submissions is ~20
falsely accused papers, each a career-relevant harm with no appeal.

A useful framing paper: **"Uncertainty in Authorship: Why Perfect AI Detection Is Mathematically
Impossible"** (arXiv 2509.11915).

### 4.3 Stylometry and watermarking

- Stylometry can separate human and LLM text in short samples, and even attribute *which* LLM,
  including for code. But LLMs substantially alter linguistic patterns under simple prompt
  instructions, so the signal is adversarially fragile.
- Output watermarking (Kirchenbauer-style) achieves >97% TPR at hundreds of tokens, but is fragile
  under paraphrase/compression, inapplicable to legacy or open-weight generations, and requires
  pipeline access. Not usable for submission screening.
- **Injected watermarking** (ICML's approach, §2.2) is the exception that works, because the
  venue controls the input the LLM sees. It generalizes to authors only in narrow settings (e.g.
  detecting LLM use on venue-supplied text), not to papers authors write themselves.

### 4.4 Defect-based screening: the most A3-safe artifact signal

Hallucinated citations are a **verifiable, objective, content-side** defect. If an author cites a
paper that does not exist, they demonstrably did not verify their own reference list. This is a
direct — if partial and one-sided — instrument for A1.

Tooling exists and is maturing: CheckIfExist (multi-source validation against CrossRef, Semantic
Scholar, OpenAlex); HalluCiteChecker; CiteAudit ("You Cited It, But Did You Read It?" — a
benchmark for verifying scientific references, arXiv 2602.23452); GPTZero's hallucination
detector; SwanRef. Hallucinated citations have been documented in papers *accepted* at NeurIPS and
ICLR.

Why this family deserves serious weight in the project:

- It is **demographically neutral by construction** — a DOI either resolves or it does not.
- It produces **evidence, not suspicion**, satisfying due-process objections.
- It aligns with ICLR 2026's actual practice (act on concrete defects).
- It is **asymmetric**: it identifies non-verification but cannot certify verification. It answers
  "¬A1" reliably and "A1" not at all.

CiteAudit's framing — did you read what you cited — is the closest existing work to an operational
verification check, and extending it (from existence to *claim-support*: does the cited work
actually support the sentence citing it?) is an obvious and tractable direction.

---

## 5. Approach family 2 — Process provenance

The idea: bind the writing process to the artifact. Version history, keystroke dynamics,
cryptographic checkpointing. NeurIPS 2026's conditional tier demanded exactly this.

**Commercial:** WriteStamp (keystroke-level recording, signed Proof-of-Human certificates for
schools, publishers, competitions); Authored (behavioral biometric certification via keystroke
dynamics and typing rhythm).

**The decisive negative result.** *On the Insecurity of Keystroke-Based AI Authorship Detection:
Timing-Forgery Attacks Against Motor-Signal Verification* (arXiv 2601.17280, Jan 2026):

- **Copy-type attack**: a human transcribes LLM output, producing authentic motor signals.
- **Timing forgery**: automated interval synthesis via histogram sampling, statistical
  impersonation, and generative LSTM.
- All attacks achieved **≥99.8% evasion against five classifiers.**
- Formally: under copy-type, there is **zero mutual information** between keystroke features and
  text provenance. The architectural error is "treating a body-produced signal as evidence of a
  mind-produced text."
- The authors' own prescription is the useful part: provenance requires signals **entangled with
  semantic content** — revision trajectories reflecting genuine iterative refinement,
  **challenge-response protocols forcing on-the-fly composition**, or cryptographic commitments
  binding intermediate drafts to output.

That middle prescription is a direct pointer to A2.

**Privacy tension.** *Privacy-Preserving Proof of Human Authorship via Zero-Knowledge Process
Attestation* (arXiv 2603.00179) names the "privacy–attestation paradox": behavioral biometrics are
GDPR Article 9 special-category data. It proposes ZK proofs (Groth16 over arithmetic circuits,
Pedersen commitments, Bulletproof range proofs) attesting that behavioral metrics fall in human
ranges without revealing them; <30s proving for a one-hour session, 8.2ms verification.

⚠️ **Provenance caveat on these two sources:** both are single-author (David Condrey) arXiv
preprints, apparently part of a cluster with arXiv 2603.00177, and are not peer-reviewed. The
copy-type argument is sound on its own logic and worth citing for the *argument*; the empirical
evasion rates and the ZK performance figures should be treated as unverified.

**Equity objection to the whole family.** Process attestation requires authors to have used
compliant, instrumented tooling from the start. It disadvantages anyone writing in LaTeX locally,
without institutional infrastructure, offline, or across devices — which correlates with exactly
the populations A3 is meant to protect. NeurIPS's version-history demand is retroactive: authors
who did nothing wrong but wrote in vim have no artifact to produce. **Process provenance converts
a tooling-access inequality into an integrity verdict.**

---

## 6. Approach family 3 — Structural and incentive mechanisms

These bypass A1/A2 entirely by changing what it costs to submit. Currently the most-deployed
family.

- **Quotas.** TMLR's harmonic coauthor-scaled quota (§1.1). *Dissecting Submission Limit in
  Desk-Rejections: A Mathematical Analysis of Fairness in AI Conference Policies* (arXiv
  2502.00690) analyses fairness properties of such limits.
- **Reciprocal review.** ICLR 2026: every submission nominates an author-reviewer; nominating an
  irresponsible reviewer → desk rejection; the nominee must have ≥1 prior accepted paper at
  ICLR/NeurIPS/ICML or equivalent. CoRL 2026 similar. Gaming analysis exists (*Which Coauthor
  Should I Nominate in My 99 ICLR Submissions?*, OpenReview QvN5FZ3tNW).
- **Token/currency systems.** *From Volunteerism to Duty: Reforming Peer Review with Tokens* (CACM);
  blockchain token systems; auction-based review-slot bidding forcing authors to price their own
  conviction.
- **Reputation staking**: stakers take reputation penalties proportional to stake if a staked item
  is retracted, bonuses if it scores well.
- **Honest self-assessment elicitation**: *Eliciting Honest Information From Authors Using
  Sequential Review* (arXiv 2311.14619); the ICML 2023 ranking experiment on author
  self-assessment (rejoinder at arXiv 2605.25172).
- **Decoupling**: *The Impact Market to Save Conference Peer Review: Decoupling Dissemination and
  Credentialing* (arXiv 2512.14104).
- **Bidirectional accountability**: *Position: The AI Conference Peer Review Crisis Demands Author
  Feedback and Reviewer Rewards* (arXiv 2505.04966, Kim, Lee & Lee; ICML 2025 Position Oral).

**A3 assessment.** Superficially neutral, but not automatically so. ICLR's prior-publication
eligibility requirement for nominated reviewers directly excludes genuine newcomers and
independent researchers. Quotas scaled by coauthor count penalise solo authors — who include both
the AI-paper-mill operator and the legitimate unaffiliated researcher, and the mechanism cannot
tell them apart. **Every structural mechanism surveyed here trades A3 exposure for
deployability**, and the trade is usually not made explicit.

---

## 7. The A3 constraint, taken seriously

### 7.1 Omitting demographics does not achieve neutrality

The fairness-without-demographics literature is unambiguous. Even without direct use of protected
attributes, rules act as **proxies** producing disparate impact; ML models are efficient at
recovering unobserved sensitive attributes. Key entry points: *Fairness Without Demographic Data:
A Survey of Approaches* (ACM 10.1145/3617694.3623234); *A Survey on Fairness Without Demographics*
(OpenReview 3HE4vPNIfX); *Fairness without Demographics through Adversarially Reweighted Learning*
(arXiv 2006.13114); *Hunting for Discriminatory Proxies in Linear Regression Models* (arXiv
1810.07155); Veale & Binns, *Fairer machine learning in the real world* (Big Data & Society, 2017).

Legal framing: **disparate treatment** (explicit use of a protected class) vs **disparate impact**
(indirect). A3 as posed guards against the former. The literature's central lesson is that the
latter is the actual risk, and it survives the removal of demographic features.

**Concrete instances relevant to this project:**

| Ostensibly non-demographic signal | What it proxies |
|---|---|
| Perplexity / text fluency | Native-speaker status (Liang et al.) |
| Solo authorship | Independent / unaffiliated / early-career (NeurIPS 2026) |
| Prior publication at top venues | Institutional access, seniority, Global North |
| Version-history availability | Tooling and infrastructure access |
| Oral fluency in English | Native-speaker status, speech disability |
| Response latency in live checks | Disability, timezone, connectivity |

### 7.2 The measurement paradox

To verify that a mechanism has no disparate impact, you must measure outcomes **by group** — which
requires the demographic data A3 seeks to avoid collecting. The literature offers partial routes
(proxy-based auditing, e.g. BISG; adversarial reweighting on worst-case subgroups without labels)
but notes that incorrect proxies produce sub-optimal solutions and **BISG specifically overestimates
disparate impact.**

For this project this means A3 should be operationalised as an **auditing commitment** — the
mechanism will be validated against disparate impact using voluntarily disclosed or
proxy-estimated group data — rather than as a *design* commitment to blindness. Blindness alone
provably does not deliver the goal.

### 7.3 Baseline: peer review is already biased

Any new mechanism should be compared against the status quo, not against perfection.

- **Prestige bias** is documented in CS conferences (PLOS ONE 10.1371/journal.pone.0264131).
- Double-blind review **moderately** reduces it: the top third of research groups by citation
  receive significantly lower ratings under double-blind, but the reduction is generally
  insufficient to change acceptance rates (Sun et al., JASIST 2022; Tomkins et al.).
- Single-blind review is associated with biases on gender, nationality, language, and institution
  type.
- Independent researchers face documented reviewer/editor bias associating affiliation with
  trustworthiness; Global South authors face language-based gatekeeping, with rejection on
  English-quality grounds functioning as a gatekeeping mechanism.

**Implication:** the relevant question is not "is the new check unbiased?" but "is it *less*
biased than the discretionary editorial judgement it replaces?" A well-specified comprehension
instrument could plausibly beat a reviewer's gut feeling about whether an author "seems like" they
understand their work. That is a defensible framing and an empirically testable one.

---

## 8. Approach family 4 — A2 as measurement: the education literature

This is the least-exploited and most promising body of work. Education faced an
isomorphic problem three years earlier and responded with theory, instruments, and evaluation.

### 8.1 The reframe: from integrity to validity

**Phillip Dawson (CRADLE, Deakin)** provides the key conceptual apparatus.

- *Defending Assessment Security in a Digital World* (Routledge, 2020) defines **assessment
  security** as "measures taken to harden assessment against attempts to cheat… approaches to
  detect and evidence attempts to cheat, as well as measures to make cheating more difficult" —
  explicitly *adversarial, punitive and evidence-based*. Its two components: **authentication**
  and **control of circumstances.**
- *Validity matters more than cheating* (Assessment & Evaluation in Higher Education, 2024) is the
  pivot. The argument: stop moralising about cheating, focus on whether the assessment actually
  measures what it claims. "The future of digital assessment lies not in ever more invasive forms
  of surveillance, but in assessment design that promotes learning while being resistant to
  cheating."

**Translated to this project:** A1 is an assessment-security question (adversarial, punitive,
evidence-based, and — per §3–§5 — largely unwinnable). A2 is an **assessment-validity** question.
Asking "can this author verify this paper?" is asking for a valid measurement of a construct. That
brings in the entire validity/reliability toolkit: construct definition, standard setting,
inter-rater reliability, differential item functioning (which is, notably, the psychometric
machinery for *detecting bias without relying on it* — directly relevant to A3).

This reframe is, in my judgement, the strongest available foundation for the project.

### 8.2 Evaluative judgement

**Tai, Ajjawi, Boud, Dawson & Panadero**, "Developing evaluative judgement," *Higher Education*
(2018): evaluative judgement is "the capability to make decisions about the quality of work of
oneself and others." Extended in *Developing evaluative judgement for a time of generative
artificial intelligence* (A&E in HE, 2024), which proposes three foci: evaluative judgement of GenAI
*outputs*, of GenAI *processes*, and GenAI assessment of student evaluative judgement.

**This is the construct A2 is actually asking about.** "Capable of verifying" ≈ "possesses
evaluative judgement with respect to this artifact." Naming it this way connects the project to an
established, operationalised, and measurable construct rather than an ad-hoc one. See also the 2026
scoping review of pedagogical approaches (10.1080/02602938.2026.2672116).

### 8.3 Oral / interactive assessment: the leading candidate mechanism

The oral defence is the education sector's answer, and the arguments transfer cleanly: the written
work is the foundation, the oral examination probes comprehension through targeted follow-up
questions that a ghost-written submission cannot prepare for. Macquarie (law), UNSW, and Guelph
have published operational guidance.

Automation is active: *Automated Viva Voce Using Generative AI for Student Coursework
Authentication* (ICETAI 2025, ACM 10.1145/3766557.3766564); *Using LLMs to support assessment of
student work in higher education: a viva voce simulator* (arXiv 2511.05530); *Scalable and
Personalized Oral Assessments Using Voice AI* (arXiv 2603.18221). Interactive viva voce simulation
frameworks combine LLM agents, dialogue managers, and evaluation modules in phase-based
assessment.

**The A3 problem with orals is serious and must be confronted head-on.** The evidence is genuinely
mixed:

*Against:*
- Speech-related disabilities and conditions affecting verbal fluency face barriers written
  formats avoid.
- Non-native speakers face compounded difficulty articulating knowledge under time pressure in a
  second language.
- Non-native English accents cause stereotyping and negative judgement — including in a randomised
  controlled pilot on examiner scoring in OSCEs (PMC7429462).
- Marking cannot be anonymous, opening bias on gender, ethnicity, language skill, and answering
  speed.
- Women report more public-speaking fear and classroom-speaking anxiety
  (10.1080/02602938.2025.2580622).

*For:*
- Some research finds **no evidence** of particular student groups being disadvantaged relative to
  written assessment, and concludes orals are *more* inclusive because they accommodate different
  learning needs, e.g. dyslexia.
- Students with anxiety accommodations found an **AI examiner less stressful** than a senior
  professor (arXiv 2603.18221) — suggesting automation may *remove* some barriers while creating
  others, population-dependent.

Fenton, *Reconsidering the Use of Oral Exams and Assessments* (Educational Researcher, 2025) and
AIR's *The Validity of Oral Accommodation in Testing* are the methodological references. The
sector's own recommendation: examining bodies **must establish and publish** validity, reliability
and fairness data, with ongoing review mechanisms.

**The design implication for A2 is precise:** an oral/interactive check is defensible only if
(a) it is scored on *content* rather than *fluency*, with rubrics and rater training that
explicitly separate the two; (b) it permits asynchronous and written response modalities as
equivalent alternatives; (c) it is machine-mediated to reduce interpersonal bias; and (d) its
differential item functioning is measured and published. Every one of those is a research task.

### 8.4 Policy frameworks: TEQSA and the two-lane debate

Australia's TEQSA (panel led by Jason Lodge, UQ) has published the most developed regulatory
thinking: *Assessment reform for the age of artificial intelligence* (Nov 2023), *Enacting
assessment reform in a time of artificial intelligence* (Sep 2025), and a Jun 2026 resource on
assurance of learning.

The **two-lane approach** (Danny Liu & Adam Bridgeman, Sydney): one lane where AI use is
prohibited/restricted, one where it is unrestricted. Documented criticisms — threats to equity,
limited validity of "secure" tasks, poor pedagogy, erosion of academic freedom — are directly
relevant, since a "verified track" vs "open track" for publishing would be the obvious naive
transplant and inherits all four objections.

TEQSA's more sophisticated move is **programmatic assurance**: assure learning across a *group* of
units in programme context rather than per-artifact. Transplanted: assess an author's demonstrated
capability across their *body of work and engagement over time*, not per-submission. This is
substantially cheaper at scale and much harder to game than a single check, and it is the idea I
would prioritise investigating.

### 8.5 Contract cheating: the base-rate warning

The pre-LLM literature on contract cheating is the most direct precedent for A1 and it is
pessimistic. Ghostwriting is "the less detectable form of misconduct"; detection is very hard;
finding evidence sufficient to penalise is the core difficulty; educators must be careful about
accusations without hard evidence. Manual tactics reduce to comparing work against the student's
known writing style and language proficiency — i.e. **exactly the demographically-loaded heuristics
A3 forbids.** Bibliographic forensics has been proposed for formalising academic-judgement evidence
(10.1007/978-3-031-12680-2_13), which connects back to citation auditing (§4.4). Multidimensional
approaches are the consensus recommendation (10.1080/2331186X.2021.1885837).

**The transferable lesson:** a decade of contract-cheating research converged on "detection alone
does not work; combine deterrence, design, and evidence." A1-only proposals are re-running a
settled experiment.

---

## 9. Gaps in the literature

Ranked by how well a contribution would fit the stated research questions.

1. **No comprehension-based author verification instrument exists for scholarly publishing.**
   Education has viva voce with rubrics, validity studies, and accessibility guidance. Publishing
   has attestation checkboxes. Nobody has built or validated the transplant. This is the clearest
   open contribution.
2. **No published analysis of A3 properties of the 2026 venue interventions.** The NeurIPS
   solo-authorship threshold is an unexamined natural experiment in proxy discrimination with
   public numbers (79/178 rejections). An audit of who was rejected, by affiliation status and
   author-count, is feasible and would be widely read.
3. **Nobody has measured whether the version-history demand is satisfiable.** NeurIPS's 123
   conditional cases produced an unpublished natural dataset on who can and cannot produce writing
   provenance. The equity implications (§5) are hypothesised but unmeasured.
4. **Citation verification stops at existence, not support.** CiteAudit gestures at "did you read
   it." Extending to *does the cited work support the claim it is attached to* yields a
   demographically neutral, evidence-producing, partially automatable ¬A1 test. Strong
   deployability.
5. **No construct definition for "author verification capability."** A2 presumes a construct
   nobody has specified. Evaluative judgement (§8.2) is the natural parent construct but has not
   been specialised to "can verify a specific technical artifact."
6. **Differential item functioning has never been applied to research-integrity checks.** DIF is
   the standard psychometric method for detecting whether an item behaves differently across
   groups matched on ability. It is the most promising technical route to satisfying A3 rigorously
   and appears nowhere in this literature.
7. **Programmatic (longitudinal) rather than per-submission assurance is unexplored in
   publishing.** TEQSA's framing (§8.4) suggests assessing engagement over a body of work; the
   publishing analogue is untried.
8. **No cost model.** Every proposal — orals, provenance, citation audits — has a per-submission
   cost. At 21,575 NeurIPS submissions, feasibility is the binding constraint and nobody has
   costed it.

---

## 10. Assessment of the research questions as posed

**A1 is likely the wrong target and I would recommend reframing it.** It is unfalsifiable in
principle (§3), its proxies are individually defeated (§4–§5), and its one deployed instance
produced a fairness scandal (§2.1). The salvageable version is **asymmetric and defect-based**:
*can we detect authors who demonstrably did* ***not*** *verify?* Citation auditing answers this
with objective evidence and no demographic exposure. It will not certify good actors, but it does
not need to — desk rejection only requires establishing ¬A1.

**A2 is the strong question, and the reframe from forensics to measurement is the project's main
intellectual opportunity.** It is tractable, it has a parent construct (evaluative judgement), it
has an existing instrument family (interactive orals), and it has a validity framework (Dawson).
Its central risk is precisely A3 — orals carry documented accent, language, disability and anxiety
bias — but unlike detector bias, *this* bias is measurable and mitigable with known psychometric
methods (content-vs-fluency rubric separation, modality alternatives, machine mediation, DIF
analysis).

**A3 as stated is necessary but insufficient, and should be strengthened.** "Avoid demographic
indicators" prevents disparate treatment, not disparate impact (§7.1). Recommend restating as:
*no mechanism shall rely on signals that function as proxies for protected or
structurally-disadvantaged status, and disparate impact shall be empirically audited and
published.* Note that this commits the project to some group-level measurement, and that tension
(§7.2) is worth making explicit in the paper rather than eliding.

**A missing fourth question.** All three are about *screening*. The venue evidence (§6) suggests
the highest-leverage interventions are structural — quotas, reciprocal obligation, decoupled
credentialing — and that these are also where A3 harms are being incurred silently (prior-publication
eligibility, coauthor-scaled quotas). A companion question — *what structural mechanisms reduce
unverified submissions without proxy discrimination?* — would let the project speak to what venues
are actually doing.

---

## 11. Suggested next steps

1. Pull the NeurIPS 2026 PPT OpenReview data and audit the 178 rejections by author count and
   affiliation status. Highest-value, most-tractable empirical contribution; directly tests A3.
2. Read Dawson, *Validity matters more than cheating* (2024) and Tai et al. (2018) in full before
   fixing the framing. These determine whether the project is a detection paper or a measurement
   paper.
3. Specify the A2 construct. What does "capable of verifying this paper" decompose into? Candidate
   facets: reproduce a derivation, identify a planted error, explain a design choice's alternatives,
   predict a result's sensitivity to a stated assumption, locate the claim a given citation supports.
4. Prototype the planted-error probe. Given a submission, auto-generate comprehension items whose
   answers are recoverable only from genuine understanding. Note the reverse-QA literature
   (arXiv 2410.15512) and the NeurIPS'24 checklist-assistant experiment (arXiv 2411.03417) as
   starting points, and that limiting question generators to title+abstract forces whole-paper
   comprehension.
5. Design the DIF study up front. Whatever instrument emerges, plan differential item functioning
   analysis by native-language status and affiliation from the beginning — it is the A3 answer and
   it constrains item design.
6. Cost it. Per-submission minutes and dollars at 20k submissions, versus reviewer hours saved.

---

## 12. Key sources

**Primary — venue actions (all verified directly)**
- NeurIPS 2026 Position Paper Track — <https://blog.neurips.cc/2026/06/02/ai-generated-papers-in-the-neurips-2026-position-paper-track/>
- ICML 2026, On Violations of LLM Review Policies — <https://blog.icml.cc/2026/03/18/on-violations-of-llm-review-policies/>
- ICML 2026 LLM Policy — <https://icml.cc/Conferences/2026/Intro-LLM-Policy>
- ICLR 2026 Response to LLM-Generated Papers and Reviews — <https://blog.iclr.cc/2025/11/19/iclr-2026-response-to-llm-generated-papers-and-reviews/>
- TMLR, Annual Author Submission Quotas — <https://medium.com/@TmlrOrg/annual-author-submission-quotas-for-tmlr-1db785e51548>
- arXiv CS policy change on review/position papers — <https://blog.arxiv.org/2025/10/31/attention-authors-updated-practice-for-review-articles-and-position-papers-in-arxiv-cs-category/>

**Detection and its bias**
- Liang et al. (2023), GPT detectors are biased against non-native English writers, *Patterns* 4:100779 — <https://arxiv.org/abs/2304.02819>
- Rao, Kumar, Lakkaraju & Shah, Detecting LLM-Generated Peer Reviews, *PLOS ONE* (2025) — <https://arxiv.org/abs/2503.15772>
- Uncertainty in Authorship: Why Perfect AI Detection Is Mathematically Impossible — <https://arxiv.org/pdf/2509.11915>
- Pangram technical report — <https://arxiv.org/pdf/2402.14873>
- Delving into LLM-assisted writing in biomedical publications through excess vocabulary, *Science Advances* — <https://www.science.org/doi/10.1126/sciadv.adt3813>

**Process provenance** *(both Condrey preprints unrefereed — cite the argument, not the numbers)*
- On the Insecurity of Keystroke-Based AI Authorship Detection — <https://arxiv.org/abs/2601.17280>
- Privacy-Preserving Proof of Human Authorship via Zero-Knowledge Process Attestation — <https://arxiv.org/abs/2603.00179>

**Authorship psychology and accountability**
- Draxler et al., The AI Ghostwriter Effect, *TOCHI* (2024) — <https://arxiv.org/abs/2303.03283>
- ICMJE authorship criteria; CRediT taxonomy; MeRIT (*Nat. Commun.* s41467-023-37039-1)

**Assessment / education (the A2 foundation)**
- Dawson, *Defending Assessment Security in a Digital World* (Routledge, 2020)
- Dawson et al., Validity matters more than cheating, *A&E in HE* (2024) — <https://www.tandfonline.com/doi/full/10.1080/02602938.2024.2386662>
- Tai, Ajjawi, Boud, Dawson & Panadero, Developing evaluative judgement, *Higher Education* (2018) — <https://link.springer.com/article/10.1007/s10734-017-0220-3>
- Developing evaluative judgement for a time of generative AI, *A&E in HE* (2024) — <https://www.tandfonline.com/doi/full/10.1080/02602938.2024.2335321>
- Fenton, Reconsidering the Use of Oral Exams and Assessments, *Educational Researcher* (2025) — <https://journals.sagepub.com/doi/10.3102/0013189X251333638>
- TEQSA, Enacting assessment reform in a time of artificial intelligence (2025) — <https://www.teqsa.gov.au/sites/default/files/2025-09/enacting-assessment-reform-in-a-time-of-artificial-intelligence.pdf>
- Giving voice to women students: designing oral assessments for inclusion and validity — <https://www.tandfonline.com/doi/full/10.1080/02602938.2025.2580622>
- RCT on non-native English accents and examiner scores in OSCEs — <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7429462/>

**Fairness without demographics (the A3 foundation)**
- Fairness Without Demographic Data: A Survey of Approaches — <https://dl.acm.org/doi/fullHtml/10.1145/3617694.3623234>
- Fairness without Demographics through Adversarially Reweighted Learning — <https://arxiv.org/pdf/2006.13114>
- Hunting for Discriminatory Proxies in Linear Regression Models — <https://arxiv.org/pdf/1810.07155>
- Veale & Binns, Fairer machine learning in the real world, *Big Data & Society* (2017)
- Prestige bias in peer review, *PLOS ONE* 10.1371/journal.pone.0264131
- Sun et al., Does double-blind peer review reduce bias?, *JASIST* (2022)

**Structural mechanisms**
- Dissecting Submission Limit in Desk-Rejections — <https://arxiv.org/pdf/2502.00690>
- Position: The AI Conference Peer Review Crisis Demands Author Feedback and Reviewer Rewards — <https://arxiv.org/abs/2505.04966>
- Position: Academic Conferences are Potentially Facing Denominator Gaming — <https://arxiv.org/abs/2605.09915>
- The Impact Market to Save Conference Peer Review — <https://arxiv.org/pdf/2512.14104>
- Eliciting Honest Information From Authors Using Sequential Review — <https://arxiv.org/pdf/2311.14619>
- From Volunteerism to Duty: Reforming Peer Review with Tokens, *CACM* 10.1145/3770921

**Citation verification**
- CiteAudit: You Cited It, But Did You Read It? — <https://arxiv.org/pdf/2602.23452>
- CheckIfExist — <https://arxiv.org/html/2602.15871>
- HalluCiteChecker — <https://arxiv.org/pdf/2604.26835>

**Adversarial context**
- Lin, Hidden Prompts in Manuscripts Exploit AI-Assisted Peer Review, *CACM* — <https://arxiv.org/abs/2507.06185>
- The AI Scientist-v2 — <https://arxiv.org/abs/2504.08066>

---

### Verification status

Directly fetched and confirmed: the four venue blog/policy posts, TMLR quota announcement, and the
two Condrey preprints. Everything else rests on search-engine retrieval of titles/abstracts and
should be confirmed against the source before citation — particularly the 2026 arXiv entries,
where I have not independently verified author lists or peer-review status. The two Condrey
preprints are explicitly flagged as unrefereed in §5.
