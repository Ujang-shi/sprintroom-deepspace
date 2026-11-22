# Production deployment checklist: sprintroom-deepspace

Status: **NOT DEPLOYED. Waiting for explicit owner approval.**

## 1. Already done (verified)
- [x] App registered: `app_01M80N6R3Q48X85XZAFT6JD49E` (in `wrangler.toml`, committed)
- [x] SDK `deepspace@0.44.2`; type-check, lint and `vite build` clean
- [x] Unit tests 31/31; `deepspace test run all` 13/13 (+ 1 opt-in spec, see below)
- [x] Real login, live sync, presence, project RBAC verified locally with two accounts
- [x] Real AI insight returned `source: "ai"` (1 anthropic call, $0.0002)
- [x] Viewer refused server-side (`forbidden`) on createTask, updateTask, deleteTask, generateInsights, addMember, setMemberRole, deleteProject; task unchanged
- [x] GitHub remote `origin` = private `Ujang-shi/sprintroom-deepspace`, `main` pushed, no secrets tracked

## 2. Decisions to confirm before deploying
- [ ] **Source authority**: currently `unclaimed`. The first deploy **permanently** claims GitHub because a GitHub remote exists. Never run `deepspace push` first (it would claim DeepSpace).
- [ ] **App name / URL**: `name = "sprintroom-deepspace"` in `wrangler.toml` fixes the subdomain. Changing it later needs `--rename`.
- [ ] **AI cost**: insights are billed to the *clicking user's* credits. Free plan = 500 credits. A user without credits silently gets rule-based insights (UI shows "Rule-based").
- [ ] Production data starts empty (local dev data is not migrated).

## 3. Pre-flight (run immediately before deploy)
```bash
git status                      # must be clean, on main, pushed
npm run type-check && npm run lint && npm run test:unit
npx deepspace test run all      # 13 pass, 1 skipped (opt-in spec)
npm run build
npx deepspace auth whoami       # still logged in
npx deepspace app source        # expect: unclaimed (before first deploy)
```

## 4. Deploy (only after approval)
```bash
npx deepspace deploy --json     # GitHub source: ships the current checkout
npx deepspace app source        # expect: github (latched)
npx deepspace status
```

## 5. Post-deploy smoke (production URL)
- [ ] Landing page loads; `/workspace` shows the signed-out card
- [ ] Sign in with a real account; create a project and a task
- [ ] Second account: invite as viewer; project appears live; no write controls
- [ ] Presence "N online now" shows with two sessions
- [ ] Generate AI insights once (spends your credits); tag shows "AI"
- [ ] `npx deepspace logs` shows no errors

## 6. Rollback
- `npx deepspace releases` then `npx deepspace rollback` (secrets are kept)
- `npx deepspace app undeploy` removes the app entirely

## 7. Housekeeping
- Delete throwaway test accounts: `npx deepspace test accounts clear --label sprintroom-e2e`
- Opt-in credit-spending test: `RUN_REAL_AI=1 npx deepspace test run e2e` (never part of the default run)

## 8. Known gaps / unresolved
- Production behavior is unverified (nothing deployed).
- Rule-based fallback on AI failure is verified (402 from a no-credit account); AI timeout and provider-error paths are unit-tested with mocks only.
- Viewer UI hiding and server refusals are tested; no browser test of a viewer clicking a stale (cached) control.
- Local dev data created before the `UserId` column rename is not compatible (local only).
