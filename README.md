# greCAPTCHA: Assessing Understanding as Evidence of Research Authorship Under Generative AI

Authors: Justin Payan*, Bálint Gyevnár*, Atoosa Kasirzadeh, Nihar B. Shah; (* equal contribution)

## Summary

greCAPTCHA is a manuscript-specific assessment tool. Researchers upload a
paper and contribution statement, generate a reusable question set through
OpenRouter, and run timed participant assessments with rubric-based feedback.

It supports fill-in-the-blank, multiple-choice, and free-response questions;
private saved sets and templates; participant links; per-account CSV export;
and SQLite backups. Answer keys and account-only metadata are never sent to
the participant during an assessment.

This repository provides supplementary material for the [paper](https://www.cs.cmu.edu/~nihars/preprints/greCAPTCHA.pdf) with the same title as the repo.
There are two primary artefacts:
1. **Prototype greCAPTCHA:** A web application to host a prototype greCAPTCHA assessment that elicits evidence about whether claimed authors understand their own paper and could take responsibility for them. See below for setup.
2. **Anonymized Participant Data:** An anonymized dataset of 31 participants' experience interacting with this system, found in the `data_anonymized/` folder.

If you use our work please cite it. A bibtex blurb is available [below](#please-cite).

## Local setup

Requirements: Node.js 20.9+. Set `OPENROUTER_CREDENTIAL_ENCRYPTION_KEY` to 32
random base64-encoded bytes before connecting a professor OpenRouter account.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. The database is created under `data/`, and
checked-in Drizzle migrations run automatically on startup.

Minimum `.env.local` configuration:

```dotenv
DATABASE_URL=./data/public-grecaptcha.db
RATE_LIMIT_SALT=a_stable_random_value
PUBLIC_BASE_URL=https://your-public-hostname.example
```

Keep `RATE_LIMIT_SALT` secret and stable. Use a fresh `DATABASE_URL` for the
public demo.

## Researcher workflow

1. Create an account at `/signup` with a username and password, or return
   through `/login`.
2. Choose **Course** or **Conference** with the workflow control above the
   dashboard tabs. The selection applies to both the default and custom-template
   creation forms.
3. For a course, connect the professor's app-specific OpenRouter key with OAuth
   PKCE or paste it directly, upload the course PDF, describe the material to
   cover, choose a model, and generate the question set. Either connection
   method stores one encrypted server credential for automatic grading.
4. For a conference, enter the test-set name and choose the required model and
   question configuration. **Create and copy conference link** saves the
   template and copies its reusable examinee invitation; the assessor does not
   upload a manuscript or provide an OpenRouter key.
5. Each conference examinee opens that invitation, uploads their manuscript and
   contribution statement, and supplies a pasted or browser-managed PKCE key to
   generate their assessment.
6. Course question sets use `/take/...` links. Each signed-in account receives
   one independent attempt for a shared course question set.
7. Submission starts grading immediately. Course grading uses the professor's
   encrypted registered key. Conference grading asks the examinee to supply
   their key again. After the result appears, the examinee may leave optional
   feedback beneath each question and submit all comments once; the submission
   is then immutable.
8. **Tests I've Created** lists Course tests and Conference invitations first.
   Expand a test to manage its individual attempts and grading reports. Invitation
   links and whole-test deletion live on the parent; reset, report, and
   single-attempt deletion actions live on each child attempt. Deleting a
   Conference test also deletes every generated manuscript, attempt, grade, and
   feedback record created from that invitation.
9. Export responses with **Export all attempts as CSV**.

Test names are unique per creator, case-insensitively, across generated Course
sets and saved Conference templates.

The plan page is researcher-only and includes item descriptions and progress.
The participant sees one question at a time plus a clickable overview of the
entire assessment. Drafts autosave, participants may revisit any question, and
answers are locked together only when the assessment is finally submitted.
Every manual submission asks for confirmation, including when every question
contains an answer.
Skipped and timed-out items remain distinct from ordinary wrong answers in the
review and export.

## Assessment behavior

- A landing page appears before each question set. Timing starts only when the
  participant presses **Start**.
- The taking screen has no per-question countdowns or soft limits. Question-open
  durations and first-interaction timings are still recorded for analysis.
- The optional overall set timer is enforced
  server-side; when it expires, all autosaved drafts are submitted as-is and
  genuinely unanswered questions are marked timed out.
- **Previous**, **Next**, and the numbered overview can open any question.
  **Submit assessment** finalizes all drafts, with a warning if any questions
  remain unanswered.
- Warm-up questions appear first and are excluded from the overall score.
- Fill-in-the-blank and multiple-choice items are graded deterministically;
  free responses are graded in grouped model calls using their rubrics.
- Questions, options, rubrics, feedback, and answers support LaTeX through
  KaTeX. Malformed math is shown as source text.
## Access and data

Accounts use scrypt password hashes and revocable, opaque server-side sessions.
Conference examinee keys are never stored by the server. A pasted or
browser-managed key is sent over HTTPS only for generation or grading, held in
process memory for that job, and discarded. Professor keys connected through
OAuth PKCE or direct paste are encrypted at rest with
`OPENROUTER_CREDENTIAL_ENCRYPTION_KEY` so course submissions can be graded
immediately even when the professor is offline. Every stored professor key must
have a positive spending limit and future expiration date.
Connected-key screens show only generic status and safeguard metadata, never a
plaintext or shortened key value.
Each account can access only its own sets, templates, attempts, and exports.
Participant links are capability URLs, so treat them as sensitive. The server
keeps API keys and answer keys private, and timing is recorded authoritatively
on the server.

The app stores research data in SQLite at `DATABASE_URL`. Exports contain
submitted responses, scores, answer keys, and timing data; handle them under
the study's retention and privacy requirements. Signup and login are throttled,
and per-account set/attempt limits are configurable. The app does not provide
email recovery or an audit log.

Enable backups with:

```dotenv
BACKUP_DIR=./data/backups
BACKUP_INTERVAL_MINUTES=60
BACKUP_KEEP=48
```

Backups include a consistent database snapshot. For a quick
manual local backup:

```bash
sqlite3 data/public-grecaptcha.db ".backup 'backup-$(date +%F).db'"
```

## Production on Railway

Railway Hobby is the intended low-cost deployment. The app runs as one
long-lived Node container with one persistent SQLite volume. Do not increase
the replica count: SQLite and a Railway volume belong to one service instance.

1. Push the repository to GitHub and create a Railway project from it. Railway
   detects `railway.toml` and builds the included `Dockerfile`.
2. Add a 1–5 GB volume mounted at `/app/data`.
3. Set `DATABASE_URL=./data/public-grecaptcha.db`,
   `BACKUP_DIR=./data/backups`, `RATE_LIMIT_SALT`, `PUBLIC_BASE_URL`, and
   `OPENROUTER_CREDENTIAL_ENCRYPTION_KEY`, plus the optional limits shown in
   `.env.example`. Keep both the salt and encryption key stable across deployments;
   replacing the encryption key makes registered professor credentials unreadable.
4. Generate a Railway HTTPS domain or attach a custom domain, then set
   `PUBLIC_BASE_URL` to that exact `https://` origin.
5. In the volume Backups tab, schedule daily, weekly, and monthly snapshots.
   Before a schema deployment, create and lock a manual snapshot.

The `/api/health` readiness probe checks the database and volume directory.
Question generation and free-response grading use SQLite-backed job metadata.
A restart interrupts jobs using temporary conference keys, while course grading
jobs resume from the encrypted professor credential. Run one Railway instance.
Two jobs run at once by default; adjust
`JOB_CONCURRENCY` between 1 and 4 only after checking memory and OpenRouter limits.

Railway volume snapshots can be restored from the Backups tab. To take an
off-platform copy, use Railway's volume file browser/CLI to download the newest
database backup directory. A volume wipe also removes Railway-hosted snapshots,
so retain occasional off-platform copies for important data.

This single-replica design is appropriate for roughly 5–50 concurrent demo
users. If write contention, high-availability requirements, or hundreds of
simultaneous users become likely, migrate the data and sessions to managed
Postgres and run the job worker as a separate service.

## Automated tests

The default suite uses a temporary SQLite database and deterministic fake
OpenRouter responses. Unexpected network requests fail, so it costs nothing
and requires no API key.

```bash
npm test
npm run test:watch
```

Tests cover account/session security, encrypted professor credentials, ephemeral
conference keys, course auto-grading, conference examinee-funded grading,
immutable per-question feedback, generation, assessment stages, tenant
isolation, duplicate job prevention, and bounded concurrent provider work.

There is also an explicitly opt-in live grading smoke test. It is excluded from
`npm test` and can spend OpenRouter credit. Set all three variables before
running it:

```bash
RUN_LIVE_OPENROUTER_TEST=1
OPENROUTER_TEST_API_KEY=your_test_key
OPENROUTER_TEST_MODEL=provider/model
npm run test:live-openrouter
```

Use a restricted low-balance key and a low-cost model. Never put test keys in
source control or CI logs.

After deployment, run the unauthenticated health/authentication smoke test:

```bash
RUN_DEPLOYED_SMOKE_TEST=1
DEPLOYED_BASE_URL=https://your-domain.example
npm run test:deployed
```

This checks health, login redirection for both link types, redesigned protected
API boundaries, and security headers without creating data. Then follow the
[manual deployment test plan](docs/manual-deployment-test-plan.md) with separate
evaluator and taker browser profiles.

## Development commands

```bash
npm run dev          # development server
npm run build        # production build
npm run start        # run a production build
npm run db:generate  # generate a migration after changing the schema
npm run db:migrate   # apply pending migrations explicitly
npm run db:push      # push the Drizzle schema manually
npm test             # deterministic mocked unit/integration suite
npx drizzle-kit studio
```

Schema definitions live in `src/db/schema.ts`; checked-in migrations live in
`drizzle/`. To reset local data, stop the server and remove the database plus
its `-wal` and `-shm` files. This permanently deletes saved sets, attempts, and
answers.

## Please cite
If you use our work please use the following citation (details TBC):

```
@misc{payan2026grecaptcha,
  title         = {{greCAPTCHA}: Assessing Understanding as Evidence of Research Authorship Under Generative {AI}},
  author        = {Payan, Justin and Gyevn{\'a}r, B{\'a}lint and Kasirzadeh, Atoosa and Shah, Nihar B.},
  year          = {2026},
  eprint        = {XXXX.XXXXX},
  archivePrefix = {arXiv},
  primaryClass  = {cs.XX},
  url           = {https://arxiv.org/abs/XXXX.XXXXX},
  note          = {Justin Payan and B{\'a}lint Gyevn{\'a}r contributed equally.}
}
```