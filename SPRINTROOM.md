# SprintRoom on DeepSpace

Migration of the original Node/SSE prototype (`../sprintroom`) to the official DeepSpace SDK (`deepspace@0.44.2`).
Scaffolded with `npm create deepspace@latest` (starter template). **Not deployed.** Registered as `app_01M80N6R3Q48X85XZAFT6JD49E`; source: GitHub `Ujang-shi/sprintroom-deepspace` (private).

## What is implemented (and verified how)

| # | DeepSpace capability | Where | Status |
|---|---|---|---|
| 1 | **Native authentication** (`DeepSpaceAuthProvider`, `AuthOverlay`, `useAuth`, `signOut`, verified JWT on every action) | `src/pages/(app)/_layout.tsx`, `src/sprintroom/Workspace.tsx`, `src/actions` | Implemented. Replaces the insecure display-name cookie login. **Not yet verified in a browser** (needs login, see below). |
| 2 | **Persistent real-time records** (`RecordRoom` Durable Object, `useQuery` live subscriptions) | `src/schemas/sprint-schemas.ts`, `Workspace.tsx` | Implemented. Replaces `db.json` + SSE. Schema passes the SDK linter (unit test). **Live sync not yet verified in a browser.** |
| 3 | **Project-level RBAC** (`team_members` + `'team'` read level + role-checked server actions) | schemas + `src/actions/sprint-actions.ts`, `src/lib/sprint.ts` | Implemented. Unit-tested (see matrix). |
| 4 | **Multiplayer synchronization** (record subscriptions broadcast by the DO) | `Workspace.tsx` | Implemented; same mechanism as #2. |
| 5 | **Presence** (`usePresenceRoom('project:<id>')`: online teammates, who has a task open) | `Workspace.tsx` | Implemented; **not yet verified with two live sessions.** |
| 6 | **AI Sprint Insights** (`createDeepSpaceAI(env,'anthropic',{authToken})` + `generateText`, `claude-haiku-5-5`, billed to the calling user's credits, persisted in `sprint_insights`, falls back to the original rule engine) | `src/actions/index.ts`, `sprint-actions.ts` | Implemented; AI call is mocked in unit tests, **never run against the real model.** |
| 7 | **Server actions** (`/api/actions/<name>`, RBAC-bypassing tools used only after an explicit role check) | `src/actions/` | Implemented, unit-tested with an in-memory tools fake. |

Not used: payments, messaging, file uploads, cron, jobs, Yjs, external integrations (`integrations.ts` untouched).

## RBAC model

Roles per project (stored in `team_members.role`): **owner** (everything, incl. members, delete project), **editor** (tasks, generate insights), **viewer** (read-only).

* **Reads:** `projects`, `team_members`, `tasks`, `sprint_insights` use `read: 'team'`. The Durable Object filters rows before broadcast, so non-members never receive them.
* **Writes:** all four collections have `create/update/delete: false` for clients. Every mutation is a server action that (a) takes the verified `userId`, (b) loads the caller's `team_members` row, (c) derives the project from the *stored* record (never from request params), (d) checks `can(role, action)`. Non-members get "not found", not "forbidden".
* App-level `admin` has no extra project access (strict tenant isolation, including the app owner).
* Why not the SDK's `'team'` update/create level: `create` has no per-project check and `'team'` update would let viewers edit.

## Behavior changes vs. the prototype

* Login: real DeepSpace OAuth accounts instead of display-name login.
* Invite by **email or exact display name** (teammate must have opened the app once), with a role. Owner can change roles / remove members (their tasks are unassigned).
* Viewers see read-only task dialogs and no create/AI controls.
* Insights: counts are always live; the narrative is AI-written on demand (button), stored and shared with the team, tagged "AI" vs "Rule-based".
* UI: same markup/classes/CSS (scoped under `.sr`). Added: role badge, "N online now", per-task "X viewing" badge, team dialog.
* Task description is capped at 160 chars (as before, via `sanitize`).

## Commands

```bash
# Node must be 22.15+, 24, or 26 (NOT 25). npm >= 11.6.
npx deepspace auth login            # interactive terminal, GitHub/Google OAuth
npx deepspace app init --json       # registers the app, mints DEEPSPACE_APP_ID in wrangler.toml
npm run type-check && npm run lint
npm run test:unit                   # vitest (28 tests)
npx deepspace test run              # smoke + api (needs login)
npx deepspace test run all          # + e2e (needs 2 test accounts)
npx deepspace dev start
# deploy only after review:
git add -A && git commit -m "SprintRoom"
npx deepspace deploy
```

## Verified results (local dev server, real DeepSpace login and platform)

| Check | Result |
|---|---|
| SDK |  installed and CLI 0.44.2 |
| ,  | clean |
|  (vite build + prerender) | succeeds |
| Unit tests (vitest) | 31/31 pass (RBAC matrix, actions with in-memory tools, schema lint) |
|  (smoke, api, collab, sprintroom, insights) | 13/13 pass |
| Auth | two real  accounts sign in, each browser shows its own identity |
| Record sync + RBAC | non-member sees nothing; invited viewer sees the project **live**, sees tasks created by the owner live, has no write controls |
| Presence | owner sees the  indicator while the guest is connected |
| AI insights | real call reached the DeepSpace AI proxy; the throwaway test account has no credits, so the proxy returned 402 and the app **fell back to rule-based insights** as designed. **The success path (AI-written narrative) is NOT yet verified.** |

Not verified: server-side rejection of a viewer's direct action call is covered by unit tests only (the e2e checks that the controls are hidden); AI success path; production behavior (nothing is deployed).

### SDK quirk worked around
The Durable Object tells a connected user to re-subscribe when their  row changes, but it reads the user id from a key named . The membership column is therefore named  (not ); with  a newly invited user had to reload to see the project.

## Source authority
 currently reports **unclaimed**. It latches permanently on first use: a deploy with a GitHub remote claims GitHub.  is the private GitHub repo, and  must not be run (it would claim DeepSpace). Deploy only from a clean checkout of .

## Decisions needed before first deploy
* **Deployment approval** (not given yet).
* **AI billing:** insights are user-billed; a user with no credits gets the rule-based fallback.
