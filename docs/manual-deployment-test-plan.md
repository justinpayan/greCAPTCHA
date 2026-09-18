# Manual deployment test plan

Use a low-limit, short-lived OpenRouter key and a low-cost model. Use three greCAPTCHA
accounts: one evaluator and two takers. Keep the evaluator in a normal browser window and
each taker in a separate private window or browser profile.

## Before deployment

Run the deterministic suite, production type check/build, and optional live provider smoke test:

```powershell
npm run lint
npm test
npm run build
$env:RUN_LIVE_OPENROUTER_TEST="1"
$env:OPENROUTER_TEST_API_KEY="your-restricted-test-key"
$env:OPENROUTER_TEST_MODEL="provider/file-capable-model"
npm run test:live-openrouter
```

The live smoke test makes paid model calls. Use a file-capable low-cost model and remove the
environment variables from the terminal when finished.

## Before testing

1. Back up the production volume and confirm the deployment applied all Drizzle migrations.
2. Open `/api/health`; verify it returns `{"ok":true}`.
3. Run the deployed smoke test:

   ```powershell
   $env:RUN_DEPLOYED_SMOKE_TEST="1"
   $env:DEPLOYED_BASE_URL="https://your-domain.example"
   npm run test:deployed
   ```

4. Confirm `/` redirects to `/login`, signup asks only for username and password, and an
   unauthenticated `/api/question-sets` request returns 401.

## Account and key handling

1. Create the evaluator and both taker accounts. Sign out and back in to each.
2. In the evaluator window, paste a test OpenRouter key and load the model catalog. Generate
   one small two-question set containing one multiple-choice and one free-response question.
3. Inspect the database and job rows if possible. Confirm the pasted key does not appear in
   `users`, `jobs.payload_json`, `jobs.result_json`, logs, exports, or backups.
4. Connect an OAuth PKCE key. Confirm OpenRouter performs the authorization and the callback
   returns to greCAPTCHA.
5. Try an OAuth key without a spending limit, then without an expiration. Confirm greCAPTCHA
   rejects each. Add a low limit and short future expiration in OpenRouter, reconnect/recheck,
   and confirm the key becomes usable.
6. Reload the browser and confirm the OAuth key remains available only for the same
   greCAPTCHA account. Sign into a different account in that browser and confirm it cannot use
   or inspect the connected key. Disconnect it and confirm browser storage is cleared.

## Reusable assessment link

1. Copy the reusable link from Recent question sets.
2. Open the same link as taker A, sign in, and complete the assessment.
3. Confirm the completion screen says the assessment is awaiting evaluation and does not make
   an OpenRouter grading call.
4. Open the same link again as taker A. Confirm it returns to the same pending attempt rather
   than creating another.
5. Open the same link as taker B. Confirm it creates a separate blank attempt.
6. Confirm each taker sees only their own entry under **My assessments** and the evaluator sees
   both usernames under **Attempts**.

## Manual evaluation and results

1. As a taker, attempt to call the evaluator-only evaluation endpoint or access the evaluator
   outline. Confirm access is denied.
2. As the evaluator, open taker A's submitted attempt. Confirm it says **Awaiting evaluation**
   and offers **Run evaluation** with pasted-key and OAuth-key choices.
3. Run evaluation with a pasted key. Confirm progress appears, the report is stored, and the
   key field clears.
4. Refresh taker A's **My assessments** tab and open the result. Confirm the overall score,
   question feedback, and “Completed by” username agree with the evaluator's report.
5. Confirm taker B remains ungraded and cannot see taker A's result.
6. Evaluate taker B with the OAuth key and repeat the cross-interface comparison.

## Failure and recovery

1. Start a generation job, then restart/redeploy the single Railway instance while it is
   running. Confirm the job reports interruption and requires the evaluator to provide a key
   again; confirm the key itself did not survive.
2. Retry the interrupted generation with a fresh key and confirm the saved upload completes.
3. Repeat the restart during evaluation. Confirm the attempt remains submitted and can be
   evaluated again without the taker resubmitting answers.
4. Use an invalid, expired, exhausted, or over-limit OAuth key and confirm errors are actionable
   and no job silently continues.

## Final checks

1. Test desktop and narrow mobile layouts for the three dashboard tabs, key panel, Recent
   question sets sidebar, pending screen, and result report.
2. Export evaluator attempts and confirm both taker usernames and expected answers are present.
3. Check Railway logs for uncaught errors and verify no API key values were logged.
4. Confirm the SQLite volume and app backups contain the new sets, attempts, and grades after a
   fresh deployment restart.
