# Deployment status and checklist: sprintroom-deepspace

**Status: DEPLOYED to production on 2026-11-22.**

| | |
|---|---|
| Live URL | https://sprintroom-deepspace.app.space |
| GitHub (private) | https://github.com/Ujang-shi/sprintroom-deepspace |
| App id | `app_01M80N6R3Q48X85XZAFT6JD49E` |
| Release | `rel_01M82XFP6H7W949R7Q01VYBPM4` (source revision 1, branch `main`, clean worktree) |
| Source authority | **GitHub** (latched by the first deploy; confirmed with `deepspace app source`) |
| Edge / data plane | both confirmed serving at deploy time |

## 1. Pre-deploy checks (all passed)
- [x] `origin` = private `Ujang-shi/sprintroom-deepspace`; `main` clean and equal to `origin/main`
- [x] Authenticated DeepSpace account (Ujang-shi); source was unclaimed before deploy
- [x] Type-check, lint, `vite build` clean; unit tests 31/31; `deepspace test run all` 13/13 (+1 opt-in spec skipped)
- [x] No secrets tracked in git or present in `dist`: literal values from `.dev.vars`, the CLI token and test-account credentials were searched for and not found. The deploy upload skips `.dev.vars` / `.env*`.
- [x] Rule-based fallback verified with a no-credit account (402 from the AI service, app keeps working)

## 2. Production smoke test (two real test accounts, live URL)
Run against https://sprintroom-deepspace.app.space with `sprintroom-ada@deepspace.test` (owner) and `sprintroom-grace@deepspace.test` (viewer), signed in through real DeepSpace auth in two separate browser contexts. **9/9 steps passed on the second run** (see issue 1 for the first run).

| # | Check | Result |
|---|---|---|
| 1 | Both users authenticate | PASS; each browser shows its own identity |
| 2 | Owner creates a project and tasks | PASS |
| 3 | Live sync between sessions | PASS: invited viewer sees the project and both new tasks with no reload; presence shows "1 Online Now" in each session |
| 4 | Viewer cannot modify or delete | PASS: no write controls in the UI, and direct API calls `createTask`, `updateTask`, `deleteTask`, `deleteProject` all returned `forbidden`; nothing persisted |
| 5 | Persistence after refresh | PASS for both users |
| 6 | AI Sprint Insights | **Fallback path verified, AI success path not verified in production.** The test account has no credits, so the AI service returned 402 (`Payment Required`) and the app showed "Rule-based" insights without error. |

Credits: no credits purchased, no payment method added, no subscription. Your account still shows 500 of 500; the only AI spend ever is 1 anthropic call ($0.0002), made in local testing before deploy (`source: "ai"`).

## 3. Remaining issues
1. **First production run failed at the invite step** (viewer did not appear within 20s). The second run, with nothing changed, passed. I did not capture the first run's `addMember` response, so the cause is unconfirmed. The likely cause is that grace had never opened the production app, and an invite needs the invitee to have a `users` row (documented behavior). Worth watching if real users report "not found" on invites.
2. **One orphaned smoke project** (`PROD-SMOKE <timestamp>`, owned by the ada test account) remains in production from the failed first run. The app has no delete-project control, and project ids are not exposed in the UI. It is only visible to the ada test account.
3. **AI success path in production is unverified.** It was verified locally with your account's credits. Production uses each clicking user's own credits; users without credits get the rule-based fallback.
4. Unknown URLs return HTTP 200 with the app shell and render the 404 inside the app (same as local). Not a functional problem.
5. Two throwaway test accounts still exist (`npx deepspace test accounts clear --label sprintroom-e2e` removes them). Their users also exist in production.
6. The production smoke script was a one-off (not committed), and the opt-in credit-spending spec `tests/real-ai-rbac.spec.ts` needs `RUN_REAL_AI=1`.

## 4. Operations
```bash
npx deepspace status            # app + release state
npx deepspace logs              # production logs
npx deepspace releases          # release history
npx deepspace rollback          # restore the previous release (secrets kept)
npx deepspace app undeploy      # remove the app entirely
```
Redeploy: commit to `main`, push, then `npx deepspace deploy` from a clean checkout. Do not run `deepspace push` (source authority is GitHub). Changing `name` in `wrangler.toml` renames the app and its URL and needs `--rename`.
