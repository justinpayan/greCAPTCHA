# ResearchCAPTCHA

ResearchCAPTCHA is a manuscript-specific assessment tool. Researchers upload a
paper and contribution statement, generate a reusable question set through
OpenRouter, and run timed participant assessments with rubric-based feedback.

It supports fill-in-the-blank, multiple-choice, and free-response questions;
saved sets and templates; paired experiments; participant links; CSV export;
and SQLite backups. Answer keys and researcher-only metadata are never sent to
the participant during an assessment.

## Local setup

Requirements: Node.js 20+ and an [OpenRouter](https://openrouter.ai/) API key.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. The database is created under `data/`, and
checked-in Drizzle migrations run automatically on startup.

Minimum `.env.local` configuration:

```dotenv
OPENROUTER_API_KEY=your_key_here
DATABASE_URL=./data/research-captcha.db
```

For a deployment, also set:

```dotenv
RESEARCHER_PASSWORD=use-a-long-random-password
PUBLIC_BASE_URL=https://your-public-hostname.example
```

`GEMINI_API_KEY` is optional. When set, Gemini models are sent directly to the
Google API; otherwise they use OpenRouter. See `.env.example` for backup
settings.

## Researcher workflow

1. Sign in at `/login`.
2. Upload a PDF and enter the contribution statement.
3. Choose a model and PDF extractor, then configure question cards. Cards can
   be fill-in-the-blank, multiple-choice, or free response, with optional
   prompts, card names, warm-up status, and soft time limits.
4. Generate and review the question set. Saved sets can be renamed, inspected,
   reused, or deleted.
5. Create an attempt from a saved set, or create a paired experiment with an
   own-paper and unfamiliar-paper block.
6. Use the assessment plan to start an in-person session or copy a participant
   link. New participant links are disabled until they are ready to use.
7. Export responses with **Export all attempts as CSV**.

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
- Experiments counterbalance paper order and unfamiliar-paper stratum. A
  chained experiment link runs both blocks and reveals results together.

## Access and data

The researcher interface requires `RESEARCHER_PASSWORD` in production.
Participant links are capability URLs, so treat them as sensitive. The server
keeps API keys and answer keys private, and timing is recorded authoritatively
on the server.

The app stores research data in SQLite at `DATABASE_URL`. Exports contain
submitted responses, scores, answer keys, and timing data; handle them under
the study's retention and privacy requirements. This MVP has one researcher
password rather than per-user accounts, and does not provide rate limiting or
an audit log.

Enable backups with:

```dotenv
BACKUP_DIR=./backups
BACKUP_INTERVAL_MINUTES=60
BACKUP_KEEP=48
```

Backups include a consistent database snapshot and CSV export. For a quick
manual local backup:

```bash
sqlite3 data/research-captcha.db ".backup 'backup-$(date +%F).db'"
```

## Production and Cloudflare Tunnel

The app can run locally while Cloudflare Tunnel provides the public participant
hostname. Set `PUBLIC_BASE_URL` to that hostname so copied links are usable by
participants.

```bash
npm ci
npm run build
npm run start:tunnel
cloudflared tunnel run research-captcha
```

Use `cloudflared tunnel login`, create a tunnel, route its DNS hostname, and
configure `cloudflared/config.example.yml` as described by Cloudflare. Run the
researcher dashboard directly on `127.0.0.1:3000`; long PDF generation and
grading requests can exceed Cloudflare's proxy timeout. The
`npm run start:tunnel:verbose` command enables request logging without logging
request bodies.

## Development commands

```bash
npm run dev          # development server
npm run build        # production build
npm run start        # run a production build
npm run db:generate  # generate a migration after changing the schema
npm run db:migrate   # apply pending migrations explicitly
npm run db:push      # push the Drizzle schema manually
npx drizzle-kit studio
```

Schema definitions live in `src/db/schema.ts`; checked-in migrations live in
`drizzle/`. To reset local data, stop the server and remove the database plus
its `-wal` and `-shm` files. This permanently deletes saved sets, attempts, and
answers.