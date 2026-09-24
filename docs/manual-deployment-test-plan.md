# Manual deployment test plan

Use restricted, short-lived OpenRouter keys and a low-cost file-capable model. Create three
greCAPTCHA accounts: one assessor/professor and two examinees. Keep each account in a separate
browser profile so browser storage and sessions cannot leak between roles.

## Pre-deployment checks

Run the deterministic suite, production type check/build, and optional paid provider smoke:

```powershell
npm run lint
npm test
npm run build
$env:RUN_LIVE_OPENROUTER_TEST="1"
$env:OPENROUTER_TEST_API_KEY="your-restricted-test-key"
$env:OPENROUTER_TEST_MODEL="provider/file-capable-model"
npm run test:live-openrouter
```

Remove the live-test variables afterward. Before deploying:

1. Back up the production volume.
2. Confirm the migration containing `openrouter_credentials`, `conference_submissions`,
   `attempt_feedback`, and workflow columns is present.
3. Set a stable `OPENROUTER_CREDENTIAL_ENCRYPTION_KEY` containing exactly 32 random bytes
   encoded as base64. Never rotate it without first disconnecting/reconnecting professor keys.
4. Keep `RATE_LIMIT_SALT`, `PUBLIC_BASE_URL`, and the encryption key stable across deploys.

## Deployment preflight

1. Confirm `/api/health` returns `{"ok":true}`.
2. Run:

   ```powershell
   $env:RUN_DEPLOYED_SMOKE_TEST="1"
   $env:DEPLOYED_BASE_URL="https://your-domain.example"
   npm run test:deployed
   ```

3. Confirm unauthenticated `/take/...` and `/conference/...` links redirect to `/login` while
   preserving the original path in `next`.
4. Confirm unauthenticated credential, conference, grading, feedback, and question-set APIs
   return 401 without revealing whether a token, attempt, or template exists.

## Track A: course workflow

### Professor credential and template

1. Sign in as the professor and create a **Course** template with one deterministic question
   and one free-response question.
2. Select **Connect professor OpenRouter account**. Complete OAuth/PKCE using a key with a small
   positive spending limit and near-term expiration.
3. Try a key without a spending limit, without an expiration, and with exhausted credit.
   Confirm each is rejected with an actionable message.
4. Reload and sign out/in. Confirm the server still reports the professor credential as
   connected and never displays the plaintext key.
5. Inspect SQLite, logs, exports, and backups. `openrouter_credentials` should contain
   ciphertext, IV, and authentication tag, but no `sk-or-...` value. Job payloads/results and
   request logs must also contain no plaintext key.

### Generate, take, and auto-grade

1. Generate a small course question set and publish its `/take/...` link.
2. Open it as examinee A, sign in, answer all questions, and submit.
3. Confirm grading starts immediately without asking the examinee or professor for another key.
   The pending screen should move from queued/running to the result automatically.
4. Confirm the professor did not need an open browser window when the examinee submitted.
5. Open the same link again as examinee A and confirm it returns to the same attempt.
6. Open it as examinee B and confirm a separate blank attempt is created.
7. Confirm each examinee sees only their own attempt and result; the professor sees both
   usernames and reports.

### Course feedback

1. After examinee A's result appears, enter an optional comment and submit it.
2. Reload the result. Confirm the comment is read-only and cannot be changed or submitted again.
3. Open the report as the professor. Confirm the exact comment and timestamp appear.
4. For examinee B, use **Submit without comment**. Confirm that decision is also locked and the
   professor report distinguishes it from feedback not yet submitted.

## Track B: conference workflow

### Reusable template link and examinee-funded generation

1. As the assessor, create and save a **Conference** template, then select **Publish and copy
   conference link**. Confirm the URL begins `/conference/`.
2. Open the link as examinee A. Upload a PDF and contribution statement.
3. Generate once with a pasted OpenRouter key. Confirm the pasted field clears and the key is
   absent from SQLite, job JSON, logs, exports, and backups.
4. Repeat with examinee B using browser OAuth/PKCE. Confirm browser storage is scoped to
   examinee B's greCAPTCHA account and cannot be used by another account in that profile.
5. Confirm each upload creates a distinct question set/attempt owned by the assessor but bound
   to the uploading examinee. One examinee must not be able to poll or open the other's job.
6. Revoke the conference link and confirm new visits fail while already-created attempts remain.

### Examinee-funded grading

1. Finish examinee A's conference assessment.
2. Confirm submission does not start grading until the examinee supplies a key again.
3. Submit a pasted key on the completion screen. Confirm the field clears, grading begins
   immediately, and the result appears without assessor action.
4. Finish examinee B's assessment and select the connected browser PKCE key at grading.
5. Confirm no generation or grading key appears in the database, logs, or report.
6. Attempt to call the conference grading endpoint as the assessor, examinee A for examinee B,
   and an unrelated account. Confirm all are denied.
7. Submit feedback and verify the same immutability and assessor-report behavior as Track A.

## Authorization and isolation

1. Attempt to read another assessor's template, publish/revoke its conference link, inspect its
   encrypted credential status, open its outline, or poll its jobs. Confirm denial.
2. Confirm a taker cannot access assessor-only outlines or exports.
3. Confirm an assessor cannot use the examinee feedback endpoint unless that account is also the
   attempt's recorded taker.
4. Disconnect the professor credential. Confirm course generation/grading fails clearly rather
   than falling back to another account's key.
5. Reconnect a new professor key and confirm subsequent course work uses it.

## Restart and recovery matrix

Test each case with a single Railway instance:

1. **Course or conference generation:** restart during generation. The temporary key must not
   survive; the job should fail explicitly. Retry course generation with the registered
   professor credential, or conference generation with a freshly supplied examinee key.
2. **Course grading:** restart while grading. The job should return to the queue and resume using
   the professor's encrypted credential. Answers must remain submitted and no key prompt should
   appear.
3. **Conference grading:** restart while grading. The job should fail because its temporary key
   was discarded. Returning examinees should be prompted to supply a key again; retry must reuse
   the submitted answers rather than create a new attempt.
4. Repeat with expired, exhausted, revoked, and malformed keys. Errors must be visible and jobs
   must not silently remain queued.

## Export, responsive UI, and final checks

1. Test desktop and narrow mobile layouts for template workflow selection, both key panels,
   `/take/` and `/conference/` pages, grading progress, results, feedback, and assessor reports.
2. Export assessor attempts. Confirm expected usernames, answers, `workflow_type`,
   `examinee_feedback`, and `examinee_feedback_submitted_at` are present.
3. Confirm a second feedback POST returns 409 and no update endpoint exists.
4. Search Railway logs and a database copy for the exact test key strings.
5. Restart once after all work completes. Confirm templates, conference submissions, attempts,
   grades, encrypted professor credential metadata, and feedback remain available.
6. Restore the pre-test backup or delete test accounts and revoke all OpenRouter test keys.
