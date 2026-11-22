# SprintRoom on DeepSpace

Migration of the original Node/SSE prototype (`../sprintroom`) to the official DeepSpace SDK (`deepspace@0.44.2`).
Scaffolded with `npm create deepspace@latest` (starter template). **Not deployed.**

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

## Decisions needed before first deploy

* **Source authority:** the first source-producing action permanently picks DeepSpace-hosted git or a GitHub remote. Default here is DeepSpace source.
* **App name/subdomain** (`name` in `wrangler.toml`, currently `sprintroom-deepspace`).
* **AI billing:** insights are user-billed. A user with no credits gets the rule-based fallback and a toast.
