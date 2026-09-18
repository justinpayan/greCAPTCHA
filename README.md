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

Requirements: Node.js 20.9+. OpenRouter keys are supplied only when a user starts
generation or evaluation; they are not part of account creation.

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
2. Upload a PDF and enter the contribution statement.
3. Choose a model and PDF extractor, then configure question cards. Cards can
   be fill-in-the-blank, multiple-choice, or free response, with optional
   prompts, card names, warm-up status, and soft time limits.
4. Paste an OpenRouter key for this generation or connect a browser-managed
   OAuth PKCE key, then generate and review the question set.
5. Create an attempt from a saved set.
6. Copy a reusable participant link. Each signed-in account receives one
   independent attempt for that question set.
7. After a participant submits, open the attempt, provide an OpenRouter key,
   and select **Run evaluation**. The participant can revisit it under
   **My assessments** once the grade appears.
8. Export responses with **Export all attempts as CSV**.

The plan page is researcher-only and includes item descriptions and progress.
The participant sees only the current question. Submitted answers are locked;
questions may be skipped, and skipped or timed-out items remain distinct from
ordinary wrong answers in the review and export.

## Assessment behavior

- A landing page appears before each question set. The first question's clock
  starts only when the participant presses **Start**.
- Per-question limits are soft: they record overruns but never cut off an
  answer. An optional overall set limit is enforced server-side.
- Warm-up questions appear first and are excluded from the overall score.
- Fill-in-the-blank and multiple-choice items are graded deterministically;
  free responses are graded in grouped model calls using their rubrics.
- Questions, options, rubrics, feedback, and answers support LaTeX through
  KaTeX. Malformed math is shown as source text.
## Access and data

Accounts use scrypt password hashes and revocable, opaque server-side sessions.
OpenRouter keys are never stored by the server. A pasted or browser-managed key
is sent over HTTPS only when generation or evaluation is requested, held in
process memory for that job, and then discarded. OAuth PKCE keys are created
and retained in browser storage; greCAPTCHA requires those keys to have a
positive spending limit and future expiration date before use. Browser storage
is accessible to scripts running on this origin, so use a trusted device and
disconnect the key on shared computers. Each account can access only its own
sets, templates, attempts, and exports.
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
   `BACKUP_DIR=./data/backups`, `RATE_LIMIT_SALT`, `PUBLIC_BASE_URL`, and the
   optional limits shown in `.env.example`. Keep the salt stable across deployments.
4. Generate a Railway HTTPS domain or attach a custom domain, then set
   `PUBLIC_BASE_URL` to that exact `https://` origin.
5. In the volume Backups tab, schedule daily, weekly, and monthly snapshots.
   Before a schema deployment, create and lock a manual snapshot.

The `/api/health` readiness probe checks the database and volume directory.
Question generation and free-response grading use SQLite-backed job metadata,
but API keys exist only in the receiving Node process. Run one Railway instance.
A restart interrupts active jobs and requires the owner to paste or reconnect a
key and run them again. Two jobs run at once by default; adjust
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

Tests cover account/session security, non-persistence of API keys, generation,
manual evaluation, assessment stages, tenant isolation, duplicate job
prevention, and bounded concurrent provider work.

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

This checks health, login redirection, protected API access, and key security
headers without creating data. Then follow the
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