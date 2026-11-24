# Deployment status and checklist: sprintroom-deepspace

## Status: deployed, up to date
| | |
|---|---|
| Live URL | https://sprintroom-deepspace.app.space |
| GitHub (private) | https://github.com/Ujang-shi/sprintroom-deepspace |
| App id | `app_01M80N6R3Q48X85XZAFT6JD49E` |
| Live release | #2 `rel_01M86D6NNXDMKJ3TE5CYM610EB` (2026-11-24), deployed from clean `main` at commit `9c253b9` |
| Previous release | #1 `rel_01M82XFP6H7W949R7Q01VYBPM4` (rollback available) |
| Source authority | GitHub (latched by the first deploy) |

**Deployed code = GitHub code.** The deploy ran from a clean checkout of `main` at `9c253b9` (equal to `origin/main`). The live client bundles were compared with a fresh build of that commit: **11 of 11 JS assets byte-identical**, and the live workspace bundle contains the Delete Project dialog. The CLI release list does not print a commit hash, so this byte comparison is the evidence. Commits after `9c253b9` change only tests, scripts and docs, not app code.

## What changed in this release (verified live)
- Invite dialog: progress ("Adding…" and a retry line), success toast, clear inline error; bounded retry (3 attempts, 1.5 s apart) for a teammate who just signed in.
- Owner-only **Delete Project** with typed-name confirmation; server-side owner check; cascades tasks, insights and memberships.

## Test results (actual, this round)
| Check | Result |
|---|---|
| Pre-deploy: git clean and equal to `origin/main`, type-check, lint, 42 unit tests, build | pass |
| Deploy | succeeded; edge and data plane confirmed; `/` and `/workspace` return 200 |
| **Production smoke** `npm run smoke:prod` (two fresh test accounts, real auth, two browser contexts) | **10/10 pass**: auth; create project; invite error feedback for an unknown user and success toast; live sync of project and tasks; presence; viewer UI read-only; viewer API calls (`createTask`, `updateTask`, `deleteTask`, `generateInsights`, `deleteProject`) all `forbidden`; data persists after reload; AI falls back to "Rule-based" (402 Payment Required, test accounts have no credits); owner deletes the project through the UI (Cancel keeps it, wrong name keeps the button disabled, exact name deletes, the viewer's session drops it live, gone after reload) |
| **Invite race on production** `npm run smoke:prod:race` (brand-new account invited the instant its workspace appears) | **pass**: `addMember` responses `user_not_found -> ok`; success shown 1.9 s after clicking. This is the window that caused the original intermittent failure. |
| Full local run `deepspace test run all` with test accounts | 42 unit + 15 smoke/api/e2e pass, 1 opt-in skipped, 0 failed |
| Production AI success path (previous round, one request, developer account) | pass (`source: "ai"`); no AI request was made this round |

Credits: no credits purchased, no payment method, no subscription. Your account shows 500 of 500 credits; lifetime usage is 2 anthropic calls, $0.0003 (one local test and one production check, both earlier; none this round).

All temporary test accounts were deleted again afterwards (3/3). The smoke and race scripts delete their own projects (the race script's own cleanup reported success).

## Operations
```bash
npx deepspace status | logs | releases
npx deepspace rollback <release-id>   # e.g. back to rel_01M82XFP6H7W949R7Q01VYBPM4
npx deepspace app undeploy            # remove the app entirely
```
Redeploy: commit and push to `main`, then `npx deepspace deploy` from a clean checkout. Do not run `deepspace push` (source authority is GitHub). Changing `name` in `wrangler.toml` renames the app and URL and needs `--rename`.

To rerun the checks you need test accounts (see README); use **fresh email addresses** each time (see limitations).

## Remaining limitations
- **Deleted test accounts leave their user records in production.** Reusing the same email later creates a second user with that email, and an invite then fails with "More than one user matches" (seen once this round). Use unique test emails. There is no tool here to purge those user rows, and the error text does not say the email itself is duplicated.
- An invite to someone who has never opened SprintRoom cannot succeed; the owner gets a clear error. No pending or email invitations.
- Project deletion is permanent (no undo). The typed-name confirmation is a UI safeguard; the server's owner check is the real protection.
- AI insights bill the user who clicks. Users without credits get the rule-based summary. Timeout and provider-error paths are covered by mocked unit tests only; the 402 fallback and the success path were exercised for real.
- End-to-end specs skip when no test accounts exist (8 specs), so a plain `deepspace test run all` on a fresh machine runs 42 unit + 8 smoke/api tests only.
- A scaffold test (`collab.spec.ts`, "API status page renders loading…") failed once in about 12 local runs and passed on every rerun; it is unrelated to SprintRoom code.
- The only external network dependency in the page is Google Fonts (DM Sans, Space Grotesk).
- Not personally verified by the app owner: everything above was run by the coding agent; see SUBMISSION.md for the split.
