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
2. Confirm the migrations containing `openrouter_credentials`, `conference_submissions`,
   `attempt_feedback`, `attempt_question_feedback`, and workflow columns are present.
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

1. Sign in as the professor, select **Course** in the workflow control above the dashboard tabs,
   and confirm both question-set creation tabs show course credential controls. Create a template
   with one deterministic question and one free-response question.
2. Select **Connect with PKCE**. Complete OAuth/PKCE using a key with a small positive spending
   limit and near-term expiration. Disconnect, then paste an app-specific key with the same
   safeguards and select **Save pasted key**. Confirm both paths report the same metadata-only
   connected state.
3. Replace the pasted key once with another pasted key and once through PKCE. Confirm there is
   still only one stored professor credential and subsequent Course grading uses the replacement.
4. Try pasted keys without a spending limit, without an expiration, and with exhausted credit.
   Confirm each is rejected with an actionable message and the password-style input clears
   without displaying any part of the submitted key.
5. Reload and sign out/in. Confirm the server still reports the professor credential as
   connected and displays only generic connection, spending-limit, and expiration status. It
   must never display the plaintext key, a shortened `sk-or-...` value, or a credential label.
6. Inspect SQLite, logs, exports, and backups. `openrouter_credentials` should contain
   ciphertext, IV, and authentication tag, but no `sk-or-...` value. Job payloads/results and
   request logs must also contain no plaintext key.

### Generate, take, and auto-grade

1. Generate a small course question set and publish its `/take/...` link.
2. Open it as examinee A, sign in, answer all questions, and select submit. Confirm the
   irreversible-submission prompt appears even with an answer in every question, cancel it once,
   then confirm and submit. Repeat with an unanswered question and confirm the prompt also states
   the unanswered count.
3. Confirm grading starts immediately without asking the examinee or professor for another key.
   The pending screen should move from queued/running to the result automatically.
4. Confirm the professor did not need an open browser window when the examinee submitted.
5. Open the same link again as examinee A and confirm it returns to the same attempt.
6. Open it as examinee B and confirm a separate blank attempt is created.
7. Confirm each examinee sees only their own attempt and result; the professor sees both
   usernames and reports.
8. Try to create another test using the same name with different capitalization. Confirm it is
   rejected without starting generation.

### Course feedback

1. After examinee A's result appears, confirm every question review has its own optional feedback
   box. Enter different comments for at least two questions and submit them together.
2. Reload the result. Confirm every submitted comment is read-only and the feedback cannot be
   submitted again.
3. Open the report as the professor. Confirm each comment appears with the correct question and
   the attempt-wide submission timestamp appears.
4. For examinee B, use **Submit without comments**. Confirm that decision is also locked and the
   professor report distinguishes it from feedback not yet submitted.

## Track B: conference workflow

### Reusable template link and examinee-funded generation

1. As the assessor, select **Conference** in the workflow control above the dashboard tabs and
   confirm both the default and Advanced creation pages omit the manuscript upload,
   contribution statement, and OpenRouter key/PKCE controls.
2. On the default page, enter a test-set name, choose the required model, and select **Create
   and copy conference link**. Confirm the template is saved and the copied URL begins
   `/conference/`.
3. Repeat from Advanced with a custom question configuration. Load the saved template and
   confirm its test-set name, model, and configuration are restored. Confirm no assessor PDF,
   contribution statement, or API key is requested.
4. Try to create a second template using the same name with different capitalization. Confirm it
   is rejected, while updating the currently selected template under its own name still succeeds.
5. Open the link as examinee A. Confirm the fixed model is shown, then upload a PDF and
   contribution statement.
6. Generate once with a pasted OpenRouter key. Confirm the pasted field clears and the key is
   absent from SQLite, job JSON, logs, exports, and backups.
7. Repeat with examinee B using browser OAuth/PKCE. Confirm browser storage is scoped to
   examinee B's greCAPTCHA account and cannot be used by another account in that profile.
8. Confirm each upload creates a distinct question set/attempt owned by the assessor but bound
   to the uploading examinee. One examinee must not be able to poll or open the other's job.
9. Revoke the conference link and confirm new visits fail while already-created attempts remain.

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

1. Test desktop and narrow mobile layouts for the global workflow control above the dashboard
   tabs, both creation forms, the Course credential panel, `/take/` and `/conference/` pages,
   grading progress, results, feedback, and assessor reports. Switch workflows with an
   incompatible saved template selected and confirm the template selection clears; load a saved
   template and confirm the global control changes to its workflow. Confirm the dashboard labels
   owner-side results as **Tests I've Created** and taker-side results as **Tests I've Taken**.
   Confirm neither creation form nor the participant/review screens show per-question countdown
   or soft-limit controls. With an overall limit configured, confirm only the overall countdown
   appears and expires as expected; without one, confirm no countdown appears. In both cases,
   confirm exported `duration_ms` and first-interaction timing fields are still populated.
2. Open **Tests I've Created** and confirm each Course question set and each Conference template
   appears once as a top-level test, including tests with no attempts. Confirm Conference
   examinee-generated question sets do not appear as separate tests. Search by test name,
   workflow, model, examinee username, manuscript name, and attempt status.
3. Expand both a Course and Conference test. Confirm all and only their attempts appear beneath
   them, and that graded attempts open their reports. Delete one attempt and confirm its answers,
   grade, timing, and feedback disappear while the parent test and its other attempts remain.
4. From each top-level test, create or copy its invitation and successfully open it as another
   account. Revoke a Conference invitation and confirm new visits fail; republish it and confirm
   the newly copied link works. Confirm Course invitations remain reusable.
5. Delete a Course test with attempts and verify the confirmation states how many attempts will
   be lost, then confirm the set and every child attempt disappear. Delete a Conference test and
   confirm its template, invitation, submissions, generated manuscript sets, attempts, reports,
   feedback, and files all disappear. Confirm another creator's tests are unchanged.
6. Export assessor attempts. Confirm expected usernames, answers, `workflow_type`,
   `examinee_feedback`, and `examinee_feedback_submitted_at` are present, and that each answer row
   contains only the comment submitted for that question.
7. Confirm a second feedback POST returns 409 and no update endpoint exists.
8. Search Railway logs and a database copy for the exact test key strings.
9. Restart once after all work completes. Confirm templates, conference submissions, attempts,
   grades, encrypted professor credential metadata, and feedback remain available.
10. Restore the pre-test backup or delete test accounts and revoke all OpenRouter test keys.
