# SprintRoom (DeepSpace)

Real-time sprint planning: projects, a kanban task board, live teammates, project-level roles and AI-written sprint insights. Built on the official [DeepSpace](https://docs.deep.space) SDK (`deepspace@0.44.2`), migrated from an earlier Node/JSON prototype.

- **Live app:** https://sprintroom-deepspace.app.space
- **Source (private):** https://github.com/Ujang-shi/sprintroom-deepspace (GitHub is the app's permanent source authority)

## Features
- **Auth:** DeepSpace accounts (sign in with the platform overlay); every server action verifies the caller's JWT.
- **Real-time records:** projects, tasks and insights are live-synced across browsers (Durable Object records).
- **Project RBAC:** per project, **owner** (everything incl. members and delete), **editor** (tasks, insights), **viewer** (read-only). Reads are filtered per project by the platform; every write is a server action that re-checks the caller's role.
- **Presence:** "N online now" and who is viewing which task.
- **AI Sprint Insights:** `claude-haiku-5-5` through the DeepSpace AI proxy, billed to the user who clicks the button. Without credits (or on any AI error) the app shows the original rule-based summary, tagged "Rule-based".
- **Invites:** by email or exact display name, with a role. Shows progress, a success message and a clear error. The teammate must have opened SprintRoom once; the dialog retries briefly for a teammate who just signed in.
- **Delete project (owner only):** confirmation dialog that requires typing the project name; the server independently allows only the owner, and cascades tasks, insights and memberships.

## Develop
Node 22.15+, 24 or 26 (not 25) and npm 11.6+.
```bash
npm install
npx deepspace auth login        # interactive terminal
npm run dev                     # local dev server
npm run type-check && npm run lint
npm run test:unit               # vitest
npx deepspace test run all      # unit + smoke + api + e2e (e2e needs test accounts)
```
End-to-end specs need two `@deepspace.test` accounts named `ada` and `grace`; without them those specs skip:
```bash
printf '%s' "<password>" | npx deepspace test accounts create --email sprintroom-ada@deepspace.test   --name ada   --label sprintroom-e2e --password-stdin
printf '%s' "<password>" | npx deepspace test accounts create --email sprintroom-grace@deepspace.test --name grace --label sprintroom-e2e --password-stdin
# remove later:  npx deepspace test accounts clear --label sprintroom-e2e --yes
```

## Production checks (saved scripts)
```bash
npm run smoke:prod                              # 9-step two-account smoke test against the live URL (cleans up after itself)
RUN_REAL_AI=1 node scripts/prod-ai-check.mjs    # ONE real AI request on your own credits; opt-in, never buys credits
```
`SMOKE_URL` overrides the target; `SMOKE_OWNER` / `SMOKE_VIEWER` pick the accounts.

## Deploy
Commit and push to `main`, then `npx deepspace deploy` from a clean checkout. Do **not** run `deepspace push` (it would claim DeepSpace as source). See [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) for status, results and limitations, and [SPRINTROOM.md](SPRINTROOM.md) for the architecture and RBAC model.

## Limitations
See the "Remaining limitations" section of [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md).
