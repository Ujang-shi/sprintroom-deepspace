# SprintRoom on DeepSpace: submission writeup

- **Live app:** https://sprintroom-deepspace.app.space
- **Source (private GitHub; the app's permanent source authority):** https://github.com/Ujang-shi/sprintroom-deepspace
- **Summary:** the original Node/JSON-file/SSE prototype was migrated to the official DeepSpace SDK (`deepspace@0.44.2`, Cloudflare Workers + Durable Objects) in a separate scaffold, keeping the UI, markup and CSS (scoped under `.sr`) and the core features.

## Requirements and how each is met
| Requirement | Implementation | Where |
|---|---|---|
| Native authentication | `DeepSpaceAuthProvider`, `AuthOverlay`, `useAuth`; every server action verifies the caller's JWT. Replaces the prototype's display-name cookie login. | `src/pages/(app)/_layout.tsx`, `src/sprintroom/Workspace.tsx` |
| Persistent real-time records | Collections `projects`, `team_members`, `tasks`, `sprint_insights` in the platform's RecordRoom Durable Object, read with `useQuery` live subscriptions. Replaces `db.json` + SSE. | `src/schemas/sprint-schemas.ts` |
| Project-level RBAC | Roles **owner / editor / viewer** per project in `team_members`. Reads use the SDK `'team'` level, so the Durable Object filters rows and non-members never receive them. All client writes are disabled; every mutation is a server action that loads the caller's membership, derives the project from the stored record (never from request params) and checks a role matrix. Non-members get "not found". | `src/actions/sprint-actions.ts`, `src/lib/sprint.ts` |
| Multiplayer synchronization | Record subscriptions broadcast changes; verified live between two real browser sessions. | `Workspace.tsx` |
| Presence | `usePresenceRoom('project:<id>')`: "N online now" and per-task "X viewing". | `Workspace.tsx` |
| AI Sprint Insights | `createDeepSpaceAI(env,'anthropic')` + `generateText` (`claude-haiku-5-5`), called with the clicking user's JWT so it is billed to that user; result stored in `sprint_insights`; falls back to the original rule engine on any error or no credits, tagged "Rule-based". | `src/actions/index.ts`, `sprint-actions.ts` |
| At least 3 DeepSpace capabilities, documented | 7 used, listed in the next section and in `SPRINTROOM.md`. | |
| Tests run and fixed | See "Verification". | `src/**/*.test.ts`, `tests/*.spec.ts`, `scripts/` |
| Deployed | Live, from GitHub, with GitHub latched as source. Deployed code verified byte-identical to the build of the pushed commit. | `DEPLOY_CHECKLIST.md` |
| Approval before deploying or spending | Nothing was deployed or published without explicit approval; no credits purchased, no payment method, no subscription. | |

## Native DeepSpace SDK/platform capabilities vs external services
**Native to DeepSpace (SDK or platform):**
1. Authentication (`DeepSpaceAuthProvider`, `AuthOverlay`, `useAuth`, platform JWTs)
2. Persistent record storage and live queries (`RecordRoom`, `useQuery`, schemas + linter)
3. Role/team permissions (`'team'` read level, `team_members`, `lintSchemas`)
4. Presence (`usePresenceRoom`)
5. Server actions (`/api/actions/<name>`, RBAC-bypassing `tools` used only after explicit role checks)
6. Hosting, deploy, release history and rollback (`deepspace deploy`, `releases`, `rollback`)
7. DeepSpace AI proxy and user-billed credits (`createDeepSpaceAI`, `app usage`)

**External / third-party (reached through or alongside DeepSpace, not DeepSpace itself):**
- **Anthropic Claude model** (`claude-haiku-5-5`): the model provider behind the AI proxy; the app never holds an Anthropic key.
- **GitHub**: source repository and the app's source authority (via the `gh` CLI).
- **Google Fonts** (DM Sans, Space Grotesk): loaded by `index.html`.
- **Playwright**: browser test tooling (via `deepspace/testing`).

**Not used:** the DeepSpace integrations catalog (`src/integrations.ts` is untouched), payments, messaging, file uploads, cron/jobs, Yjs/canvas.

## Verification
### Performed by the coding agent (actually run; results in `DEPLOY_CHECKLIST.md`)
- Type-check, lint, `vite build`: clean.
- **42 unit tests** pass (RBAC matrix, action authorization incl. forged role and cross-project cases, delete cascade and authorization, AI success/fallback/cooldown with a mocked model, invite retry logic, schema lint).
- **15 smoke/API/e2e tests** pass locally with real DeepSpace test accounts, 1 opt-in test skipped. The new lifecycle tests fail on the pre-fix code (checked by stashing the fix).
- **Production smoke, 10/10** on the live URL with two real test accounts in separate browser contexts: auth, project and task creation, invite error and success feedback, live sync, presence, viewer UI read-only, viewer direct API calls refused (`forbidden`) for create/update/delete task, generate insights and delete project, persistence after reload, rule-based AI fallback, owner-only delete through the UI.
- **Invite race on production:** a brand-new account invited the instant its workspace appeared: first response `user_not_found`, retry succeeded 1.9 s after clicking (this was the root cause of the one intermittent failure).
- **Real AI success path on production:** one request on the developer account's free credits returned a real model response; lifetime usage 2 calls, $0.0003, credits 500 of 500.
- Deployed code vs GitHub: clean tree equal to `origin/main` at deploy; 11/11 live JS assets byte-identical to a build of that commit.
- Secrets: none tracked in git or in the build output (literal values from `.dev.vars`, the CLI token and test credentials searched for).

### Performed by you (the owner), as recorded in this session
- GitHub device authorization for the CLI (you entered the code at github.com/login/device).
- DeepSpace login (`npx deepspace auth login` in your own terminal).
- Decisions and approvals: GitHub as source authority, app name `sprintroom-deepspace`, private repo, each deployment, and use of your free credits for one AI request.

### Not verified by you yet (suggested personal 5-minute check)
Open the live URL with two real accounts: sign in, create a project, invite the second account as viewer, confirm it appears live, confirm the viewer has no add/delete controls, generate AI insights with your credits, and delete the project as owner. The agent's tests used throwaway `@deepspace.test` accounts (deleted afterwards), not real user accounts, and nothing in this document reflects a manual visual review of the UI.

## Known limitations
See the "Remaining limitations" section of `DEPLOY_CHECKLIST.md` (stale user rows from deleted test accounts can make a same-email invite "ambiguous"; no pending invitations; permanent deletion; AI is user-billed with a rule-based fallback; AI error paths other than 402 are mock-tested only).
