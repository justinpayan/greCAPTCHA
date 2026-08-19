# ResearchCAPTCHA

ResearchCAPTCHA is a manuscript-specific assessment tool for checking whether a
claimed author understands the work they report contributing. It generates
reusable mixed-format question sets from a PDF through OpenRouter and records
fresh, sequential attempts with rubric-based feedback.

## Features

- Password-gated researcher interface with an unauthenticated participant link
- PDF upload with a free-form contribution statement
- Repeatable fill-in-the-blank, multiple-choice, and free-response configuration
  cards with editable generation prompts
- Searchable live OpenRouter model catalog with recommended models highlighted
- Selectable PDF processing through Cloudflare AI, Mistral OCR, or a model's
  native file support
- Named, searchable saved question sets that can start multiple fresh attempts
- Searchable attempt list for resuming an assessment already under way
- Participant links that ship disabled, so they can be sent out before a session and
  armed when it starts
- Paired experiments: a generated participant ID, one attempt per paper, and
  counterbalanced block order and unfamiliar-paper stratum
- A Start landing page before every question set, so the first question's clock begins
  when the participant presses Start
- Chained experiment runs: both blocks back to back with no score shown between them,
  and one combined reveal at the end — in the dashboard, or from one participant link
- Optional per-attempt question randomization
- Researcher-facing assessment plan page with per-item descriptions and progress
- Nameable question cards for per-family grouping in analysis
- Warm-up cards asked first and excluded from the overall score
- Named, reusable study set templates with autosave and restore across restarts
- Locked one-question-at-a-time progression with server-recorded elapsed time
- Per-question soft time limits and timing telemetry: time to first interaction,
  total duration, and overrun against the limit
- An enforced overall time limit per question set, measured as the sum of question
  durations so a paused session costs nothing
- Per-attempt option to hide the on-screen countdown while still recording timing
- Deterministic fill-in-the-blank and multiple-choice grading, LLM rubric grading
  for free response
- LaTeX in questions, options and rubrics typeset with KaTeX, offline and with a
  currency-safe `$` rule
- Neutral overall and per-question scores with a read-only answer review
- Skippable questions, recorded as skipped rather than merely scored zero

## Local setup

Requirements:

- Node.js 20 or newer
- An [OpenRouter](https://openrouter.ai/) API key with access to the model you
  select

Install dependencies:

```bash
npm install
```

Copy `.env.example` to `.env.local` and add your key:

```dotenv
OPENROUTER_API_KEY=your_key_here
GEMINI_API_KEY=optional_google_ai_studio_key
DATABASE_URL=./data/research-captcha.db
RESEARCHER_PASSWORD=required_for_any_deployment
```

Start the development server:

```bash
npm run dev
```

Open `http://localhost:3000`. Checked-in Drizzle migrations run automatically
when the server first opens the database. The `data` directory and database are
excluded from git.

## Building question sets

The generation screen starts with one fill-in-the-blank card. Add any number of
fill-in-the-blank, multiple-choice, or free-response cards, then edit each card's
default prompt and question count. Fill-in-the-blank cards also specify
distractors per blank, and multiple-choice cards specify options per question.
Cards are generated in creation order.

Multiple-choice questions have exactly one correct answer and are graded
deterministically, so they need no grading call. The model supplies the correct
answer plus distractors rather than an index into an option list, which makes a
miscounted key impossible; a generation that repeats the correct answer as a
distractor, duplicates options, or returns the wrong number of them is rejected
rather than stored. Options are shuffled once when the set is built and then
fixed, so every attempt on a set sees an identical form. Set options per question
to 2 for true/false items.

Each multiple-choice question also carries a one or two sentence rationale for
its correct answer. It is withheld for the whole attempt and shown only on the
read-only review after scoring, alongside which option was chosen.

The default multiple-choice prompt targets planted-error detection: a claim about
the paper where one option states what the manuscript actually reports and the
rest are plausible but false variants. Like the other cards, it is fully editable
per card.

Each card makes one OpenRouter generation request containing the PDF. At the end
of an attempt, each free-response card makes one additional grading request
containing that card's questions, rubrics, and submitted answers. A card with
five free-response questions therefore uses one generation call and one grouped
grading call, not one grading call per question.

Generation cards run sequentially. Every card after the first receives the
questions and answer criteria generated by earlier cards and is instructed not
to repeat or closely paraphrase them.

Give the set a **Test set name** to identify it later. Leaving it blank falls back to
the PDF filename, and a set can be renamed at any time from the saved-set list without
touching its questions, attempts, or answers.

**Load saved set** shows every saved set — name, paper, question count, how many attempts
it has already produced, and its model — with a search box filtering on any of those. Pick
one to start a fresh attempt with its own answers, timings, scores, and optional randomized
order. **Resume attempt** shows every attempt with its progress, status, and score, and
reopens one exactly where it was left.

Each saved set carries an **Overview** button, which opens the set's contents without creating an
attempt to see them. It lists every item with its type, card name, soft limit, warm-up marker and
generated description, alongside the set's model, extractor, overall limit, attempt and experiment
counts, and the date it was generated. Items appear in stored order — warm-ups only move to the
front when an attempt is built, and the rest are shuffled only if that attempt randomizes them.

**Renaming happens on that page**, in a Set name field, rather than as an inline edit in the list:
inspecting a set and naming it are the same act, and the old inline rename gave no way to see what
you were naming. Leaving the field blank falls back to the PDF filename. Renaming touches nothing
else — the questions, every attempt on the set and their answers are unaffected.

**The overall time limit is editable there too**, in minutes, so a ceiling can be set or changed
after the bank was generated rather than only on the generation screen. One **Save changes** button
sends whichever of the two fields actually changed, so saving a name cannot clear a limit or the
reverse.

Changing the limit also applies it to attempts on the set that **have not started** — one prepared
the night before would otherwise keep the budget it was created with, and an edit made on the
morning of a session would silently do nothing for the attempts about to be run. An attempt already
under way keeps the budget it began with, because someone answering question four should not have
their remaining time change underneath them. The confirmation says which happened, for instance
*"Overall limit set to 12 minutes. Also applied to 2 attempts that have not started."*

Both lists carry a **Delete** button per row, each asking for confirmation first. Deleting
an attempt removes its answers and timings and keeps the question set. Deleting a set
cascades: every attempt on it and every answer in those attempts goes with it, and the
confirmation says how many before you agree. Neither can be undone, so take a backup first
if the data matters:

```bash
sqlite3 data/research-captcha.db ".backup 'backup-$(date +%F).db'"
```

Neither list needs an ID. IDs are no longer shown in the interface, so nothing
researcher-facing appears on screen during a session; they remain available in the
database if you need them.

## Study set templates

The generation screen carries a **Study set template** panel holding everything below it
except the PDF and the contribution statement: the model, the PDF extractor, every question
card with its type, count, options or distractors, soft limit, warm-up flag and prompt, plus
the randomize and hide-countdown toggles. Those two stay per-paper, so one template runs
across every participant's manuscript.

Name a setup and press **Save template** to keep it. Saving under a name that already exists
replaces that template rather than creating a duplicate. Pick a saved template from the
dropdown to load it; **Delete selected** removes it after a confirmation and leaves your
current setup alone. If a loaded template names a model that is no longer in the live
OpenRouter catalog, everything else is applied and the model selection is left unchanged
with a notice.

Separately, the current setup is autosaved as you edit and restored the next time the start
screen opens. This survives a page reload, a browser restart, and a server restart, because
it is stored in SQLite rather than in the browser — `study_templates` holds the named
templates, and `app_state` holds the single autosaved draft under the key `template_draft`.
Both export with the rest of the study data, so the exact configuration used on a session
day is part of the record.

## Moving between screens

The dashboard's screens — a set overview, an assessment plan, a landing page, the questions, a
result — are all one route, swapped in React state. That meant the browser's Back button left the
app: from anywhere in the dashboard it went to `/login`, which reads as being signed out.

Back now walks the screens instead. One history entry is pushed per screen layer and popped off in
step, so:

| From | Back goes to |
| --- | --- |
| Set overview | the dashboard |
| Assessment plan page | the dashboard |
| Landing page, questions, or results | the plan page they were opened from |
| A chained experiment run, at any point | the dashboard |
| The dashboard | `/login`, which really is the previous page |

The landing page, the questions and the results are one layer, not three. They are a single act on
one attempt, and going "back" from a graded result to the question that produced it would mean
nothing — so moving between them replaces the screen rather than stacking another entry.

The in-app **Back to dashboard** buttons rewind the history rather than clearing state directly, so
both they and the browser button run through the same path. That is what keeps the layer stack and
the history at the same depth; if they diverged, Back would start skipping screens or leave for the
login page again.

Leaving a screen never loses anything: every answer, timing and score lives on the server, so
returning to a plan page and re-entering resumes exactly where the assessment was.

## The assessment plan page

Generating a set, loading a saved set, or resuming an attempt all land on a **plan page**
rather than the first question. It lists every item in the order it will be asked, with its
position, type colour and label, card name, soft limit, warm-up marker, an
**Answered / Pending** state, and a one-sentence description of what the item probes,
generated with the question and stored with it.

This page is for the researcher, not the participant. It names what each item is testing,
so it must not be left on screen once the assessment is handed over — the page says so
itself. The test-taking screens continue to receive none of it: the payload for a question
carries only `blockId`, `id`, `options`, `prompt`, `timeLimitSeconds`, and `type`.

The button adapts to the attempt's state:

| State | Button |
| --- | --- |
| Nothing answered | **Start assessment** |
| Partly answered | **Resume assessment**, continuing at the next unanswered question |
| All answered, not graded | **Grade and show results** |
| Graded | **Show results**, loading the stored result |

The third row matters for recovery. If the grading call fails when the last answer is
submitted, the answers stay locked and the attempt stays ungraded; opening its plan page and
pressing the button grades it without re-answering anything. This is the offline-fallback
path §11.1 of the research plan asks for.

**Resume attempt** on the start screen lists every attempt with its progress and status,
and reopens one on its plan page, keeping every answer and timing.

## LaTeX in questions

Questions generated from a manuscript routinely contain mathematics, so any text a question
carries is typeset with [KaTeX](https://katex.org/) before it is shown. That covers the question
prompt, the word bank and its blanks, multiple-choice options, the rationale, the rubric and its
criteria, the grading feedback, the participant's own response on the review, and the item
descriptions on the plan page.

| Delimiter | Renders as |
| --- | --- |
| `$$…$$`, `\[…\]` **alone on a line** | display math, centred on its own line |
| `$$…$$`, `\[…\]` **mid-sentence** | inline math |
| `\(…\)`, `$…$` | inline math |

Display math is only display when it stands alone. A model writing grading feedback reaches for
`$$` around every fragment, and display math is a centred block with margins above and below — so
a sentence mentioning three quantities came out as three centred lines with the prose stranded
between them. Mid-sentence, inline is both what was meant and what reads.

A formula that fails in the mode it was given is retried in the other one before falling back to
its source, because a few environments — `align`, `equation` — exist only in display mode and one
written mid-sentence would otherwise show as raw TeX.

**Double-escaped commands are repaired before rendering.** A model writing JSON reaches for
`"\\\\lambda"` about as often as `"\\lambda"`, and the first parses to the two characters `\\`
followed by `lambda`. In TeX `\\` is a line break, so KaTeX faithfully renders a break and then the
letters, with no parse error to catch it — a rubric criterion read *mathcalO(lambda3)* instead of
𝒪(λ³). Counting the backslash run is what makes the repair safe: an odd number before a letter is a
real command and is left alone, including a genuine line break followed by `\alpha`, while an even
number is halved. It happens at render time rather than at generation, so sets already in the
database display correctly without being regenerated — though their stored text, and so the
`grader_feedback` and rubric strings in an export, keep the extra backslashes.

Typeset formulas are the only elements `MathText` emits; the prose between them is returned as
fragments, with no element of its own. That is deliberate. A stylesheet rule for bare spans inside
a list — `.free-review li span { display: block }`, written for the guidance line under a rubric
criterion — matched every run as well, so a criterion mentioning three quantities broke into one
line per symbol. Rules like that now have nothing to catch in prose, and the one that caused it is
scoped to a direct child.

KaTeX is a dependency rather than a CDN script, and its fonts are emitted into the build, so
typesetting works with no network at all — which matters for the local-first laptops in §11.1.

**The single `$` is guarded**, because these papers discuss money as well as mathematics. The
content must hug its delimiters, as TeX requires; a backslash, `^`, `_` or brace accepts it
outright; otherwise a leading digit is read as currency and rejected. So `$n$` and `$x$` typeset —
single-letter variables are everywhere — while "$30 for the session and $10 more" stays prose.
The known blemish is that `$thirty$` would be typeset, italic where it should be upright.

**Malformed LaTeX falls back to its source.** Anything KaTeX refuses to parse is shown exactly as
written, delimiters included, rather than vanishing or rendering as a red error in the middle of a
timed question. The splitter is lossless by construction: reassembling its segments reproduces the
input exactly, which is asserted over every case in its tests.

KaTeX runs with `trust: false`, so `\href`, `\url` and `\includegraphics` are inert — a model
that emits `\href{javascript:…}` produces literal red text, no anchor and no `href` attribute.
The only HTML inserted is KaTeX's own escaped output, which matters because this text comes from a
model and, on the review screen, from the participant.

## The landing page before a question set

Every question set opens on a landing page with a single **Start** button. It names the paper,
says how many questions there are and that each answer locks when submitted, and mentions the
soft time limit only when a countdown will actually be visible — an attempt configured to hide
the countdown is meant not to make time salient.

**Pressing Start is what starts the clock.** That is the substance of this page, not the
wording on it. Serving a question stamps its `started_at`, so before this existed the first
question's timer began whenever the page happened to load — while a participant was still
settling in, or while a laptop was being turned around on a desk. `GET /api/attempts/<id>/intro`
reads without serving, so the landing page can sit on screen indefinitely and the first
question still records from the moment the participant chose to begin.

The page is skipped for an attempt already under way. Its clock is running, so offering a Start
button would misrepresent the state; a refresh mid-assessment resumes at the current question
exactly as before.

It appears on all three routes into a question set:

| Route | Behaviour |
| --- | --- |
| A participant opening their link | Lands on Start; the researcher never starts their clock for them |
| **Start assessment** on the plan page | Hands over on the landing page, so the participant presses Start after the laptop reaches them |
| Each block of a chained experiment run | Both blocks land on Start, still with no score or review between them |

In a chained run the page also shows **Paper 1 of 2**, and says nothing about which paper is
which. Because the second block now waits on Start, this is where §8.3's 3-minute supervised
skim and §8.4's micro-break fit — the gap the immediate jump did not leave room for.

`/api/attempts/<id>/intro` is participant-accessible for GET only and carries no card names,
item descriptions or warm-up flags; `/outline`, which does, stays behind the password. The same
holds for the chained link's `/api/experiments/<id>/session`. A closed
link answers 403 there in the same shape as the question endpoint, so an early visitor sees the
same "not open yet" screen.

## Skipping a question

Every question carries a **Skip** beside its submit button, for all three types. It is plain
underlined text rather than a button, so it stays available without competing with Submit —
though it is still a real `<button>` underneath, so it keeps keyboard focus and screen-reader
semantics.

Skipping submits nothing, locks the question at **0**, and moves to the next one. There is no
confirmation, matching Submit, which also locks without asking, and no way back — the
progression is forward-only. The clock behaves exactly as it would for an answer: the time
spent before skipping is recorded, along with time-to-first-interaction if they touched the
answer before giving up.

A skip is recorded as a skip, not merely as a zero:

- `attempt_answers.skipped` is set and `answer_json` stays null;
- the review screen marks the question **Skipped**, reads "Skipped after 12s" instead of
  "Answered in 12s", and shows the correct answer as it does for a wrong one;
- the CSV export carries a `skipped` column, and `response` is empty on those rows while
  `correct_answer` is still reported.

That separation is the point. A skip and a wrong answer both score 0, so without the flag the
two would be indistinguishable in the data — and "declined to answer" is a different behaviour
from "tried and missed", one an analysis may well want to exclude rather than count as a
failure. Both readings stay available because the score and the flag are stored side by side.

A skipped free-response question is **not** sent to the grader. It already carries its score
and its own feedback, so grading a blank answer against a rubric would waste a call and invite
the model to award partial credit for nothing. A block whose free-response questions were all
skipped makes no request at all.

## Experiments

An **experiment** is one participant's paired session: the same assessment on the paper they
uploaded to us and on an unfamiliar paper we chose for them (research plan §8.2, which calls
the second one the *foreign* paper). It is created from the **Experiments** tab by choosing two
existing question sets — own paper first, unfamiliar paper second — and it produces:

- a generated **participant ID**: four characters from an alphabet with no `O`/`0` or `I`/`1`,
  since the code gets read aloud and written on forms;
- **two attempts**, one per paper, each tagged with its condition;
- a **counterbalanced block order**, and an **unfamiliar-paper stratum** of in-field or
  out-of-field.

Both links are created disabled, like any attempt, so a pair can be prepared the night before
and armed block by block during the session. Neither attempt serves a question at creation, so
no clock starts.

### How the two allocations stay balanced

Neither is an independent coin flip. With N≈24 a fair coin lands on a 16/8 split often enough
to matter, so both use **minority-fill**: the cell with fewer experiments gets the next one,
and only an exact tie is broken at random.

| Allocation | Balanced across | Result |
| --- | --- | --- |
| Unfamiliar-paper stratum | all experiments | in-field and out-of-field within one of each other |
| Block order | each stratum separately | own-first and unfamiliar-first within one of each other, inside each stratum *and* overall |

Balancing order *within* stratum rather than globally costs nothing and additionally stops
order from correlating with stratum.

Because the stratum decides which unfamiliar paper is appropriate, the creation form shows
what the next experiment will get **before** you create it, both in the notice and on the
picker's own label — so you can pick the unfamiliar paper's question set to match. When the cells are level it says so instead of promising a stratum it
would then re-roll.

### What the participant is told about the papers

Inside an experiment the papers are called **Paper 1** and **Paper 2** and nothing else. A
filename can betray which of the two is the participant's own — `my-chi-submission-final.pdf`
next to an arXiv name settles it — and the whole own-versus-unfamiliar contrast depends on them
not knowing.

So the name is *withheld* rather than hidden in the markup. `paperName` in the served question,
and in the graded result, is `Paper 1` or `Paper 2` for an experiment's attempts; the filename is
never sent to the participant's browser, so a network tab reveals nothing. This matters
mid-session, because a chained run hands the first block's graded result over while the second
block is still ahead.

A standalone attempt keeps its real filename: with no second paper there is nothing to give
away, and the name is what makes the screen recognisable.

The **model is not named either**. The question screens used to carry the model ID under the
title; a participant has no use for it, knowing which model wrote and marks their items could
plausibly shape how they answer, and it is study configuration rather than something they are
owed. Like the paper name it is withheld rather than hidden: `modelId` is no longer part of the
served attempt at all.

The researcher's own views are unaffected — the plan page names the model, and the plan page, the
experiment card and the `paper_name` and `model_id` columns of the CSV export all name the real
papers and models.

### One link that runs both blocks

**Copy session link** on the experiment card hands out a single URL — `/experiment/<id>` —
that runs both blocks in order for a remote session. It behaves like the researcher-driven run:
each block opens on its own landing page, no score or review appears between them, and one
combined reveal follows the second block.

The button is **enabled only when both blocks' links are enabled**. A chained link that runs
into a disabled block leaves the participant stranded halfway through, having finished the first
paper and facing a "not open yet" page — worse than not handing out the link at all. Reloading
the link resumes: a block already graded is collected from the server rather than remembered in
the browser, so a refresh or a closed laptop loses nothing.

On the participant's reveal the blocks are labelled **Paper 1** and **Paper 2**, never "own" or
"unfamiliar". The researcher-driven run keeps the condition labels, since only the researcher
sees that screen before the debrief.

The link grants no more than the two individual links already do.
`GET /api/experiments/<id>/session` returns attempt IDs and their positions and nothing else —
no condition, no paper names, no participant ID — and each attempt still gates itself on its own
link switch. It is the only experiment endpoint open to participants: the experiment list, the
create call and the delete all answer 401 without the password, as does `POST` to the session
path itself.

### Running both blocks in one go

**Run both blocks** on the experiment card runs the whole session without returning to the
dashboard. The moment the last answer of the first block is submitted, the second paper's landing page
appears — no score, no answer review, nothing in between. The participant presses **Start**
when they are ready, which is what starts that block's clock.

That gap matters more than the convenience does. Showing the first block's review would hand
the participant the item formats, the grader's standards and a set of worked answers while a
scored block is still ahead of them, which is the reasoning behind §8.4's rule that the
LLM-assist retry always runs last. The result is held in memory and revealed only at the end.

The button also resumes and reveals:

| State of the experiment | What the button does |
| --- | --- |
| Neither block started | Runs block 1, then block 2 |
| First block finished | Steps over it and runs the remaining block |
| Both finished | Goes straight to the session reveal |

At the end, one page carries both blocks: each score side by side, then each block's full
answer review in the order they were taken.

During the run the header shows **Paper 1 of 2**, so the question counter restarting makes
sense. It deliberately says nothing about which paper is which — the participant is never told
which one we consider theirs.

The blocks run in the researcher's browser, so the participant link switches are irrelevant
here: a signed-in session bypasses them. Nothing needs arming for an in-person session.

The landing page between blocks is where §8.3's 3-minute supervised skim and §8.4's
micro-break fit: nothing is timed while it is on screen, so the proctor can run both before the
participant presses Start.

Deleting an experiment deletes both attempts and their answers; the confirmation counts the
answers at stake first. The two question sets are kept. Two deletions are refused rather than
silently doing damage: a single attempt that is one block of an experiment, and a question set
an experiment depends on (the error names the participants).

Attempt-level fields — `participant_id`, `condition`, `block_position`, `foreign_stratum` —
are in the CSV export, since the primary measure Δ = score(own) − score(foreign) cannot be
computed without knowing which attempt is which.

**One caveat if you run two laptops.** Balance is computed from the database the app is
running against. Per §11.1 each laptop has its own, so two laptops produce two independently
balanced sequences: each is within one of even, and the merged set within two. Creating all
experiments on one machine avoids this entirely.

## Enabling and disabling a participant link

Participant links are usually sent out before a session, so **a new attempt is created with
its link disabled**. The link is safe to mail immediately: anyone who opens it early sees a
*not open yet* page instead of the first question, and no clock starts.

The switch sits beside the link on the plan page, and on every row of **Resume attempt** so
several links can be armed at once without opening each attempt:

| Link state | Participant opening the link | Researcher pressing the plan page button |
| --- | --- | --- |
| Disabled | *Not open yet* page | Starts the assessment normally |
| Enabled | Answers the assessment | Starts the assessment normally |

The researcher's password session bypasses the flag, which is what lets an in-person session
run without arming anything. So *disabled* governs the mailed link, not the password holder.
This follows the same rule as the rest of the access control: under `next dev` with no
`RESEARCHER_PASSWORD` set, every request counts as the researcher, so a disabled link still
opens locally. Set the variable to see what a participant sees.

The flag is checked on every participant request — opening the page, fetching a question, and
submitting an answer — so disabling a link mid-session halts it at once and the participant
sees a *paused* page. Nothing already submitted is lost, and enabling it again resumes at the
next unanswered question. An answer typed but not yet submitted when the link is disabled is
lost, so disabling a live session interrupts it rather than pausing it politely.

Attempts created before this flag existed remain enabled, so nothing already in flight
changed when the column was added.

Question one's clock starts when the question is first served, not when the attempt is
created. This matters here: attempts are often created days before the session, and stamping
the clock at creation would record question one as having taken days.

## Question type colours

Each of the three question types carries a colour used consistently across the interface —
on its **Add** button, as a coloured left edge and chip on its generation card, on the
question card during an attempt, and on its review card:

| Type | Colour |
| --- | --- |
| Fill in the blank | Green |
| Multiple choice | Blue |
| Free response | Amber |

Colour never carries meaning on its own: every coloured element also names its type in text.
Chip text sits at 6.6:1 or better against its background and the card edge accents at 3.4:1
or better, so the coding survives greyscale printing and colour-vision deficiency.

## Naming cards

Every question card takes an optional **Card name**, such as `F1 planted error` or
`F6 warm-up`. The name becomes the card's heading on the generation screen, with the
question type shown beneath it, which keeps a long list of cards readable.

The name is researcher-facing only. It is stripped from everything the browser receives
during an attempt and from the graded result, so a name describing what an item probes
cannot cue the participant. It is instead snapshotted onto each answer row as
`attempt_answers.block_name` when the question is first served, which makes per-family
analysis a plain `GROUP BY`:

```sql
SELECT
  block_name AS family,
  COUNT(*) AS items,
  ROUND(AVG(score), 1) AS mean_score,
  ROUND(AVG(duration_ms)) AS mean_ms
FROM attempt_answers
WHERE submitted_at IS NOT NULL
GROUP BY block_name
ORDER BY family;
```

Names are saved with study set templates, so a template carries its family labels with it.
Leaving a name blank falls back to the generic type label everywhere.

## Warm-up cards

Any card can be marked **Warm-up**. Its questions are asked first, in card order, and are
excluded from the overall score.

Warm-ups always lead the attempt, ahead of every scored question, regardless of where the
card sits in the set. Randomizing question order shuffles the scored questions only, so
every participant meets the same orientation items in the same sequence and their latencies
stay comparable. The score is an equal-weight average across scored questions only; warm-ups
are still graded, timed, and shown in the review, and the result carries
`scoredQuestionCount` and `warmupQuestionCount` alongside it.

The flag is not sent to the browser during the attempt. A participant told that an item does
not count would have no reason to engage with it, which would destroy its value as a
per-participant latency baseline. The review screen labels warm-ups after scoring instead.

## Per-question timing

Every question card accepts an optional **soft time limit** in seconds. Leave it
blank and the question is untimed. The limit is applied to every question that
card generates and is snapshotted onto each attempt's answer row when the
question is first served, so editing a set later never rewrites recorded timings.

The limit is *soft*. It is shown to the participant as a countdown that keeps
counting once it passes, the overrun is recorded, and nothing else changes:
answers are never cut off, auto-submitted, or penalised, and the score is
unaffected.

Four values are recorded per question, all stamped by the server:

| Column | Meaning |
| --- | --- |
| `first_interaction_at` / `first_interaction_ms` | When the participant first selected a word or typed, and how long after the question appeared |
| `duration_ms` | Serve to submission |
| `time_limit_seconds` | The soft limit in force when the question was served, or null if untimed |
| `overrun_ms` | Milliseconds beyond the limit, `0` if within it, null if untimed |

### The overall time limit

The generation screen takes an **Overall time limit** in whole minutes, stored on the question set
and snapshotted onto each attempt at creation, so editing a set never changes the budget of an
attempt already under way. Leave it blank for no limit. It travels in study set templates, so one
template carries the same ceiling across every participant's paper.

Unlike the per-question soft limits, **this one is enforced**. The rule is that no further question
is served once the budget is spent:

| Moment | What happens |
| --- | --- |
| An answer is submitted that spends the budget | The answer counts, then the attempt closes and grades |
| The budget is spent while a question sits open | The countdown closes the attempt; that question keeps the time it had accumulated |
| A question is requested with the budget already spent | The attempt closes instead of serving it |

An answer already entered is never snatched back — the bell stops the assessment moving on, it
does not discard work. Anything not answered is recorded **timed out**: scored 0, but flagged
separately from a skip, because "ran out of time" and "declined to answer" are different behaviours
and merging them would mislead §10's per-family analysis. The review labels those items *Out of
time* and the CSV carries a `timed_out` column.

**Elapsed time is the sum of the per-question durations**, not wall-clock from the first question.
The consequence is worth knowing: pausing a session by disabling its link costs nothing against the
budget, and neither does a reload or a closed laptop. In ordinary use the two measures agree within
a second or two, since one question is served the instant the last is submitted.

Enforcement is server-side. The participant's countdown only asks the server to close promptly; the
server re-checks the budget and hands back the current question if the client fired early, so a
wrong clock or a replayed request cannot end an assessment. A participant who closes the tab is
closed out on their next request instead. That also means hiding the on-screen countdown does not
disable the limit — the clock still runs, it is only invisible.

### Hiding the countdown

Both start screens carry a **Hide the on-screen countdown** toggle. Turning it on
removes the timer from the test-taking interface entirely — no countdown and no
elapsed clock, on timed and untimed questions alike. Nothing else changes: soft
limits still apply, and all four values above are still recorded exactly as they
would be otherwise.

The choice is fixed for the whole attempt so every question in a run is answered
under the same condition, and it is stored on the attempt as `countdown_hidden`,
since whether a participant could see a clock plausibly affects their pacing. The
post-attempt review still shows per-question timings either way.

### Timing authority

The browser reports only *that* a first interaction happened; the server stamps
*when*. A client can therefore delay that timestamp but never move it earlier,
and repeat reports are ignored. Timers in the interface are display-only —
timing authority stays on the server, as does the elapsed time replayed after a
page refresh.

Deliberately not collected: tab-visibility, blur, and paste telemetry. The study
design supersedes these with proctoring, so they are out of scope here.

## Model selection

The start screen retrieves OpenRouter's current model catalog and lets you
search all text-output models. A curated set of current Claude Sonnet, GPT,
Gemini Pro, and DeepSeek model families is placed first and labeled
Recommended. Recommendations are convenience labels, not guarantees: model
availability, prices, context limits, and structured-output behavior can change
upstream.

The default is `google/gemini-3.7-flash` when it is available in the live catalog. It
supports native PDF input, has a 1M-token context, and is several times cheaper per token
than the Pro models, which matters when generating banks across a whole prototyping set.
A restored draft or a loaded template overrides the default with its own stored model.
The exact model ID is stored with the reusable question set and the same model
grades its free-response answers.

If `GEMINI_API_KEY` is present and the selected model ID begins with
`google/gemini-`, generation and free-response grading are sent directly to the
Google Gemini API. PDFs use Gemini's native document input in that case. If the
environment variable is absent, the same model is called through OpenRouter.
The application does not fall back to OpenRouter when a configured Gemini key
returns an API error, avoiding unexpected OpenRouter charges.

## PDF processing options

- **Native** is the default and sends the PDF directly to a compatible model,
  incurring that model's normal input-token charges.
- **Cloudflare AI** converts PDFs to Markdown and is currently free.
- **Mistral OCR** is paid per page and is the better choice for scanned,
  image-heavy, or complex-layout papers.

PDFs are limited to 25 MB by the application. Password-protected, damaged, very
large, or unusually structured manuscripts may fail. Extraction quality
directly affects question quality.

## Hosting through Cloudflare Tunnel

The app runs on your own machine and `cloudflared` dials out to Cloudflare, which serves a
public hostname. No inbound port is opened, there is no server to maintain, and the study
database never leaves the machine — which is the easiest arrangement to describe in an IRB
protocol that limits access to the named researchers.

### 1. Move the domain's DNS to Cloudflare

The domain stays registered with Namecheap; Cloudflare only becomes its DNS provider.

1. In the Cloudflare dashboard, **Add a site**, enter your domain, and pick the Free plan.
2. Cloudflare scans your existing records and shows two nameservers, like
   `dana.ns.cloudflare.com` and `rick.ns.cloudflare.com`. Copy both.
3. In Namecheap: **Domain List → Manage → Nameservers → Custom DNS**, replace the entries
   with Cloudflare's two, and save.
4. Wait for Cloudflare to report the zone **Active**. Usually minutes, occasionally hours.

Check any existing records survived the scan before switching, especially MX records if the
domain carries email.

### 2. Create the tunnel

```bash
brew install cloudflared
cloudflared tunnel login                      # opens a browser, pick the zone
cloudflared tunnel create research-captcha    # writes ~/.cloudflared/<UUID>.json
cloudflared tunnel route dns research-captcha rc.yourdomain.org
```

Copy `cloudflared/config.example.yml` to `~/.cloudflared/config.yml` and fill in the tunnel
UUID, your username, and the hostname.

### 3. Configure and run the app

`.env.local` needs the API keys plus:

```dotenv
RESEARCHER_PASSWORD=something_long_and_random
PUBLIC_BASE_URL=https://rc.yourdomain.org
```

`PUBLIC_BASE_URL` is what participant links are built from. Without it the link is built
from whatever origin *your* browser is on, so working at `localhost:3000` would hand
participants a `localhost` link that cannot work.

```bash
npm ci
npm run build
npm run start:tunnel     # binds 127.0.0.1 only
cloudflared tunnel run research-captcha
```

`start:tunnel` binds the loopback interface rather than every interface, so the app is
reachable only through the tunnel and not to anyone else on the same wifi.

To keep it up between sessions, `cloudflared service install` registers the tunnel as a
launchd service, and `caffeinate -s` prevents the machine sleeping mid-assessment. A laptop
that sleeps takes the tunnel down and strands a participant part-way through.

### 4. Check it end to end

`https://rc.yourdomain.org/api/health` should return `{"ok":true}` from another network —
a phone on cellular is the quickest test. `https://rc.yourdomain.org/` should redirect to
the sign-in page.

### Notes

- **Timings include the round trip.** `duration_ms` is measured server-side from serve to
  submit, so a remote participant's latency is inside it. In-person and remote timings are
  not directly comparable; treat the mode as a covariate.
- **Work as the researcher on `http://127.0.0.1:3000`, not through the tunnel.** Cloudflare
  returns error 524 when an origin takes longer than 100 seconds, a ceiling that cannot be
  raised on the Free or Pro plans. Question generation carries a PDF and routinely exceeds
  it. Going direct on this machine avoids the limit entirely, and `PUBLIC_BASE_URL` keeps
  participant links pointing at the public hostname anyway.
- **The final answer of a free-response set can hit the same limit**, because submitting it
  triggers grading. The answer is locked either way; if the participant sees an error,
  grade the attempt afterwards from its plan page.
- **Nothing runs in Docker.** SQLite in WAL mode over a macOS Docker bind mount has known
  file-locking problems, and the database needs to stay directly reachable on the host for
  `drizzle-kit studio` and end-of-day export.

## Access control

The interface has two audiences with different access.

**The researcher interface is behind a password.** Set `RESEARCHER_PASSWORD` and sign in at
`/login`; the session lasts 12 hours and **Sign out** clears it. The cookie holds a SHA-256
derivation rather than the password, and is `httpOnly`. This covers the start screen and
every endpoint that lists, generates, renames, grades, or plans — including
`/api/attempts/<id>/outline`, which carries card names and item descriptions.

Locally under `next dev` the password is optional, so development needs no sign-in. In a
production build it is **required**: with the variable unset every researcher route returns
503 rather than being served, so a deployment that forgets it is locked rather than open.

**The participant assessment is not behind the password.** `/attempt/<id>` opens the
assessment directly, along with the three endpoints it needs — reading the current
question, submitting an answer, and reporting first interaction. The attempt ID in the URL
is the capability, so treat a participant link like a key: anyone holding it can answer
that attempt **while the link is enabled**. IDs are UUIDs and are not listed anywhere
unauthenticated.

The allowlist is method-aware, so the endpoints it opens are opened only for the method the
participant needs. `GET /api/attempts/<id>` is open; `PATCH` on the same path, which enables
or disables the link, and `DELETE`, which destroys the attempt, both stay behind the
password.

Copy the link from the **Participant link** field on the assessment plan page. For an
in-person session, ignore it and use **Start assessment** on the same page instead.

A participant who reloads their link resumes at the current question with its server-side
timer intact, rather than losing the session.

## Data and security

The browser uploads the PDF to the local Next.js server. The server sends it to
OpenRouter using the selected file-parser configuration; the OpenRouter API key
is never returned to browser code. PDFs are processed in memory and are not
stored locally. Generated answer keys remain in SQLite and are omitted from all
pre-submission responses.

Question timing is authoritative server-side wall-clock time. It starts when the
current question is first served and ends when its answer is submitted. A page
refresh does not reset the timer. Submitted answers are locked, and later
questions are not returned until the current answer is accepted.

Each question contributes equally to the overall score. A fill-in-the-blank
question receives partial credit based on its proportion of correct blanks; a
multiple-choice question receives 100 or 0; a free-response question receives a
0–100 rubric score from the set's model.
There is no passing threshold or pass/fail classification.

The researcher interface is password-gated (see **Access control**), but this MVP
still has no per-user accounts, rate limiting, retention controls, or audit log,
and it stores everything in a local SQLite file. Anyone with the researcher
password has full access to every set and every attempt.

## Exporting responses

**Export all attempts as CSV** on the Load saved set and Resume attempt tabs downloads every
recorded answer across every attempt, one row per question served, with attempt and set
fields denormalized onto each row so the file stands alone with no joins.

The answer grain is deliberate: the per-family discrimination index needs `block_name`,
per-item `score` and per-item timing on the same row, which an attempt-level summary cannot
reconstruct. Columns cover the attempt (`attempt_id`, `set_name`, `paper_name`, `model_id`,
`attempt_status`, `attempt_score`, `randomize`, `countdown_hidden`, timestamps), the
experiment it belongs to if any (`participant_id`, `experiment_id`, `condition`,
`block_position`, `foreign_stratum` — all empty for a standalone attempt), the item
(`position`, `question_id`, `block_name`, `question_type`, `warmup`, `time_limit_seconds`),
its timing (`started_at`, `first_interaction_at`, `first_interaction_ms`, `submitted_at`,
`duration_ms`, `overrun_ms`), and the answer itself (`score`, `skipped`, `timed_out`,
`response`, `correct_answer`, `correct`, `grader_feedback`).

`response` is the submitted free-response text, the chosen option's label, or the chosen
label per blank. Fields are RFC 4180 quoted, so commas, quotation marks, and newlines inside
a free-response answer survive a round trip through any CSV reader.

A row with an empty `submitted_at` is a question the participant reached but did not answer,
which is how you see where an attempt stopped. Filter those out, and filter
`warmup = false`, to get the scored set:

```python
import csv, collections, statistics
rows = [r for r in csv.DictReader(open("research-captcha-answers-2026-08-17.csv"))
        if r["submitted_at"] and r["warmup"] == "false"]
by_family = collections.defaultdict(list)
for r in rows:
    by_family[r["block_name"]].append(float(r["score"]))
```

For the paired own-versus-unfamiliar comparison, average each participant's scored items per
condition and difference them:

```python
per_cell = collections.defaultdict(list)
for r in rows:
    if r["participant_id"]:
        per_cell[(r["participant_id"], r["condition"])].append(float(r["score"]))
deltas = {
    pid: statistics.mean(per_cell[(pid, "own")]) - statistics.mean(per_cell[(pid, "foreign")])
    for pid, condition in per_cell
    if condition == "own" and (pid, "foreign") in per_cell
}
```

The file contains submitted responses and answer keys, so treat it as sensitive research
data under the retention terms in the IRB protocol.

## Inspecting the database

The application stores its records in `data/research-captcha.db`. This is a
binary SQLite database and should not be opened as a normal text file.

The easiest way to browse it is with Drizzle Studio:

```bash
npx drizzle-kit studio
```

Open the URL printed in the terminal. Reusable content is in `question_sets`,
runs are in `attempts`, and locked answers and timings are in `attempt_answers`.

On Windows, you can alternatively install and use the SQLite command-line
client:

```powershell
winget install SQLite.SQLite
sqlite3 ".\data\research-captcha.db"
```

After opening SQLite, this query displays a summary of all attempts:

```sql
.headers on
.mode column

SELECT
  a.id AS attempt_id,
  a.question_set_id,
  qs.paper_name,
  qs.model_id,
  a.randomize,
  a.countdown_hidden,
  a.score,
  a.status,
  a.created_at,
  a.completed_at
FROM attempts AS a
JOIN question_sets AS qs ON qs.id = a.question_set_id
ORDER BY a.created_at DESC;
```

Question-level timing and scoring can be inspected with:

```sql
SELECT
  attempt_id,
  question_id,
  question_type,
  first_interaction_ms,
  duration_ms,
  time_limit_seconds,
  overrun_ms,
  score,
  submitted_at
FROM attempt_answers
ORDER BY started_at;
```

Use `.quit` to exit. `question_sets.questions_json` contains questions, rubrics,
and answer keys. `attempt_answers.answer_json` contains submissions. These
columns may contain sensitive research data.

## Database migrations and reset

`src/db/schema.ts` is the schema definition, and checked-in SQL migrations live
under `drizzle/`. Generate a migration after changing the schema:

Migrations run when `src/db/index.ts` is first imported, and `next build` imports it from
several worker processes at once. Both the WAL switch and the migrations need brief
exclusive access to the database, so both run under a cross-process file lock
(`src/db/migration-lock.ts`), which writes `<database>.migrate.lock` beside the database
for the duration. Whoever acquires it second finds the work already done and does nothing.
A lock left behind by a killed process is reclaimed after 60 seconds; waiting on a live one
times out after 30. If you ever see the timeout and no migration is running, delete the
lock file.


```bash
npm run db:generate
```

The application applies pending migrations on startup. To intentionally start
over during local development, stop the server, back up anything needed, delete
`data/research-captcha.db` plus any adjacent `-wal` and `-shm` files, and restart
the server. This permanently removes all saved sets and attempts.

## Useful commands

```bash
npm run dev          # development server
npm run build        # production build
npm run start        # run a production build
npm run db:generate  # generate Drizzle migration files after schema changes
npm run db:migrate   # apply pending migrations explicitly
npm run db:push      # push the Drizzle schema manually
```
