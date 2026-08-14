# ResearchCAPTCHA

ResearchCAPTCHA is a manuscript-specific assessment tool for checking whether a
claimed author understands the work they report contributing. It generates
fill-in-the-blank questions from a PDF through OpenRouter, presents a
Duolingo-style word-bank interface, and passes attempts scoring at least 80%.

## Features

- PDF upload with a free-form contribution statement
- Configurable question and distractor counts
- Searchable live OpenRouter model catalog with recommended models highlighted
- Selectable PDF processing through Cloudflare AI, Mistral OCR, or a model's
  native file support
- One-question-at-a-time quiz with drag, click, keyboard, previous/next, and
  direct question navigation
- Server-side answer key and deterministic per-blank grading
- SQLite audit record containing the claim, settings, model, parser, answers,
  score, and timestamps

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
DATABASE_URL=./data/research-captcha.db
```

Start the development server:

```bash
npm run dev
```

Open `http://localhost:3000`. The `data` directory and SQLite table are created
automatically on the first server request. They are excluded from git.

## Model selection

The start screen retrieves OpenRouter's current model catalog and lets you
search all text-output models. A curated set of current Claude Sonnet, GPT,
Gemini Pro, and DeepSeek model families is placed first and labeled
Recommended. Recommendations are convenience labels, not guarantees: model
availability, prices, context limits, and structured-output behavior can change
upstream.

The exact OpenRouter model ID used for each assessment is stored with the quiz.
There is no hard-coded `GPT-5.6 Sol` entry because OpenRouter must expose a valid
model ID before it can be called.

## PDF processing options

- **Cloudflare AI** converts PDFs to Markdown and is currently the free default.
- **Mistral OCR** is paid per page and is the better choice for scanned,
  image-heavy, or complex-layout papers.
- **Native** sends the PDF directly to a compatible model and incurs that
  model's normal input-token charges. The UI disables this option unless the
  selected catalog entry advertises file input.

PDFs are limited to 25 MB by the application. Password-protected, damaged, very
large, or unusually structured manuscripts may fail. Extraction quality
directly affects question quality.

## Data and security

The browser uploads the PDF to the local Next.js server. The server sends it to
OpenRouter using the selected file-parser configuration; the OpenRouter API key
is never returned to browser code. PDFs are processed in memory and are not
stored locally. Generated answer keys remain in SQLite and are omitted from all
pre-submission responses.

This MVP has no user authentication. Run it only in a trusted environment until
authentication, authorization, rate limiting, retention controls, and a
production database are added.

## Inspecting the database

The application stores its records in `data/research-captcha.db`. This is a
binary SQLite database and should not be opened as a normal text file.

The easiest way to browse it is with Drizzle Studio:

```bash
npx drizzle-kit studio
```

Open the URL printed in the terminal and select the `quizzes` table.

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
  id,
  paper_name,
  model_id,
  pdf_engine,
  score,
  passed,
  status,
  created_at
FROM quizzes
ORDER BY created_at DESC;
```

Use `.quit` to exit. The `questions_json` column contains the generated
questions and answer key, while `answers_json` contains the submitted answers.
These columns can be lengthy and may contain sensitive research data.

## Useful commands

```bash
npm run dev          # development server
npm run build        # production build
npm run start        # run a production build
npm run db:generate  # generate Drizzle migration files after schema changes
npm run db:push      # push the Drizzle schema manually
```
