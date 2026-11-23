# Deployment status and checklist: sprintroom-deepspace

## Status
- **Production is live** at https://sprintroom-deepspace.app.space (release `rel_01M82XFP6H7W949R7Q01VYBPM4`, deployed 2026-11-22, source = GitHub).
- **Newer code on `main` is NOT deployed.** The reliability changes below (invite feedback/retry, owner-only Delete Project, `addMember` result and message, new tests and scripts) are committed and pushed but have not been deployed; they await explicit approval. Production still runs the earlier build, so it has no Delete Project button and no invite retry/feedback.

| | |
|---|---|
| Live URL | https://sprintroom-deepspace.app.space |
| GitHub (private) | https://github.com/Ujang-shi/sprintroom-deepspace |
| App id | `app_01M80N6R3Q48X85XZAFT6JD49E` |
| Source authority | GitHub (latched by the first deploy) |

## Work completed in this round
1. **Intermittent invite failure: root cause found and reproduced on production.** A teammate's `users` row appears about 1-2 s after they first open the app, while their workspace is already visible. An invite sent in that window returns `user_not_found` (fresh account: failed before the app was ever opened, succeeded on the 5th poll, about 1.8 s after the workspace became visible). That matches the one failure seen in the first production smoke run.
   - Fix (local, undeployed): the invite dialog now shows "Adding…", a progress line while it retries `user_not_found` up to 3 attempts 1.5 s apart, a success toast ("Added X as Viewer") and a clear inline error ("…ask your teammate to open SprintRoom and sign in once, then try again"). The dialog stays open and usable on error. Other errors are not retried.
2. **Delete Project (owner only, local, undeployed):** red "Delete project" button visible only to owners; confirmation dialog requiring the exact project name; server action `deleteProject` re-checks `project.delete` (owner only; non-members get `not_found`, editors/viewers `forbidden`) and cascades tasks, insights and memberships.
3. **Leftover `PROD-SMOKE` project removed from production** using its owner account (it was the only project visible to that account; 0 remain). Done with the already-deployed `deleteProject` action.
4. **Production smoke test saved:** `scripts/prod-smoke.mjs` (`npm run smoke:prod`); cleans up its own project. Also `scripts/prod-ai-check.mjs` (opt-in, one AI request).
5. **Production AI success path verified, one request:** the deployed app returned `source: "ai"` for the developer account (real model response). Usage went from 1 to 2 anthropic calls, total $0.0003; credits remained 500 of 500. Its temporary project was deleted. No credits purchased, no payment method, no subscription.
6. **Temporary test accounts removed:** `sprintroom-ada`, `sprintroom-grace`, `sprintroom-hana` (3/3 deleted via `deepspace test accounts clear --label sprintroom-e2e --yes`).

## Test results (actual)
| Check | Result |
|---|---|
| `npm run type-check`, `npm run lint`, `npm run build` | clean |
| Unit tests (vitest) | **42/42 pass** (incl. invite retry logic, delete authorization for editor/viewer/non-member/forged role/double delete, `addMember` result and message) |
| `deepspace test run all` with test accounts (before deletion) | **15 passed, 1 opt-in skipped**, 0 failed, on the final run. Before that, 3 consecutive e2e runs were 15/15; one earlier run had a single failure in a scaffold test (`collab.spec.ts`, a transient "Loading…" assertion) that did not recur and does not touch SprintRoom code. |
| New e2e specs (`tests/project-lifecycle.spec.ts`) | pass with the new code; **both fail on the old code** (verified by stashing the source changes), so they do detect the old behavior |
| `deepspace test run all` now (accounts deleted) | 42 unit + 8 smoke/api pass; **8 e2e specs skip** until test accounts are recreated (see README) |
| Production smoke (`npm run smoke:prod`) against the **currently deployed** build | **9/9 pass**: auth, create project/tasks, live sync, presence, viewer UI read-only, viewer API refused (`createTask`, `updateTask`, `deleteTask`, `generateInsights`, `deleteProject` all `forbidden`), persistence after reload, AI fallback (`Payment Required` -> "Rule-based") |
| Production AI success path | pass (1 request, `source: "ai"`) |

Not tested on production (because undeployed): the invite retry/feedback UI and the Delete Project UI. They were verified only on the local dev server with real DeepSpace test accounts.

## To ship the new code (needs your approval)
```bash
git status                       # clean, on main, pushed
npm run type-check && npm run lint && npm run test:unit && npm run build
npx deepspace app source         # expect: GitHub
npx deepspace deploy --json      # ONLY after explicit approval
npm run smoke:prod               # needs test accounts recreated first (see README)
```
After deploying, run the smoke test again, and manually check the Delete Project dialog on production with a throwaway project.

## Rollback and operations
```bash
npx deepspace status | logs | releases
npx deepspace rollback           # restore the previous release (secrets kept)
npx deepspace app undeploy       # remove the app entirely
```
Do not run `deepspace push` (source authority is GitHub). Changing `name` in `wrangler.toml` renames the app and URL and needs `--rename`.

## Remaining limitations
- The new invite/delete UI is undeployed (see Status).
- An invite to someone who has never opened SprintRoom cannot succeed; the owner sees a clear error. There are no pending/email invitations.
- Deleting a project is permanent; there is no undo or soft delete. Other members' open tabs simply drop the project live.
- The delete confirmation (typed name) is a UI safeguard only; the real protection is the server-side owner check.
- AI insights bill the user who clicks; users without credits get the rule-based summary. AI timeout and provider-error paths are unit-tested with mocks only; the 402 fallback and the success path were exercised for real.
- The `users` records of the three deleted test accounts still exist in production's user table (test-account deletion does not remove app data); they own or belong to no projects.
- Unknown URLs return HTTP 200 and render the 404 in-app (same as the scaffold).
- A scaffold e2e test (`collab.spec.ts`, "API status page renders loading…") flaked once in about 8 runs; unrelated to SprintRoom.
- The opt-in specs/scripts spend real credits only when you set `RUN_REAL_AI=1`; they never buy credits.
