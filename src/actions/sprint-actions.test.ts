import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import { makeSprintActions } from './sprint-actions'

type Rec = { recordId: string; data: Record<string, unknown>; createdBy: string; createdAt: string; updatedAt: string }

/** Minimal in-memory stand-in for the RBAC-bypassing action tools. */
function fakeTools(seed: Record<string, Rec[]> = {}) {
  const db: Record<string, Map<string, Rec>> = {}
  let n = 0
  const col = (c: string) => (db[c] ??= new Map())
  for (const [c, rows] of Object.entries(seed)) for (const r of rows) col(c).set(r.recordId, r)
  const ok = <T,>(data: T): ActionResult<T> => ({ success: true, data })
  const bad = (e: string): ActionResult<never> => ({ success: false, error: e })
  const match = (r: Rec, where: Record<string, unknown> = {}) => Object.entries(where).every(([k, v]) => r.data[k] === v)
  const tools = {
    async create(c: string, data: Record<string, unknown>, id?: string) {
      const recordId = id ?? `r${++n}`
      const prev = col(c).get(recordId)
      col(c).set(recordId, { recordId, data: { ...(prev?.data ?? {}), ...data }, createdBy: 'x', createdAt: '', updatedAt: '' })
      return ok({ recordId })
    },
    async update(c: string, id: string, patch: Record<string, unknown>) {
      const r = col(c).get(id)
      if (!r) return bad('not found')
      r.data = { ...r.data, ...patch }
      return ok({ recordId: id })
    },
    async remove(c: string, id: string) { col(c).delete(id); return ok({ recordId: id }) },
    async deleteWhere(c: string, where: Record<string, unknown>) {
      let deleted = 0
      for (const [id, r] of col(c)) if (match(r, where)) { col(c).delete(id); deleted++ }
      return ok({ deleted })
    },
    async get(c: string, id: string) { const r = col(c).get(id); return r ? ok({ record: r }) : bad('not found') },
    async query(c: string, o: { where?: Record<string, unknown> } = {}) {
      const records = [...col(c).values()].filter((r) => match(r, o.where))
      return ok({ records, count: records.length })
    },
    async integration() { return bad('unused') },
  }
  return { tools: tools as unknown as ActionTools, db }
}

const rec = (recordId: string, data: Record<string, unknown>): Rec => ({ recordId, data, createdBy: 'x', createdAt: '', updatedAt: '' })

const alice = 'u-alice', bob = 'u-bob', carol = 'u-carol', mallory = 'u-mallory'
const users = [
  rec(alice, { name: 'Alice', email: 'alice@x.test' }),
  rec(bob, { name: 'Bob', email: 'bob@x.test' }),
  rec(carol, { name: 'Carol', email: 'carol@x.test' }),
  rec(mallory, { name: 'Mallory', email: 'mallory@x.test' }),
]

let generate: Mock<(env: unknown, jwt: string, prompt: string) => Promise<string>>
let nowMs: number
const actions = () =>
  makeSprintActions<Record<string, never>>({ generateNarrative: (env, jwt, prompt) => generate(env, jwt, prompt), now: () => nowMs })

const run = async (
  name: string,
  userId: string,
  params: Record<string, unknown>,
  tools: ActionTools,
) => actions()[name]({ userId, params, tools, env: {}, callerJwt: `jwt-${userId}` })

/** Alice owns project P1; Bob is editor, Carol viewer, Mallory is not a member. */
async function world() {
  const w = fakeTools({ users })
  const created = await run('createProject', alice, { name: 'Launch' }, w.tools)
  expect(created.success).toBe(true)
  const projectId = (created.data as { projectId: string }).projectId
  expect((await run('addMember', alice, { projectId, identifier: 'bob@x.test', role: 'editor' }, w.tools)).success).toBe(true)
  expect((await run('addMember', alice, { projectId, identifier: 'Carol', role: 'viewer' }, w.tools)).success).toBe(true)
  return { ...w, projectId }
}

beforeEach(() => {
  generate = vi.fn().mockResolvedValue('Risk is low.\n- ship it')
  nowMs = Date.parse('2026-06-10T12:00:00Z')
})

describe('project creation & membership', () => {
  it('creator becomes owner with a name and deterministic membership id', async () => {
    const { db, projectId } = await world()
    const row = db.team_members.get(`${projectId}:${alice}`)!
    expect(row.data).toMatchObject({ role: 'owner', name: 'Alice', status: 'active', teamId: projectId })
  })

  it('rejects empty project names', async () => {
    const { tools } = fakeTools({ users })
    expect((await run('createProject', alice, { name: '   ' }, tools)).success).toBe(false)
  })

  it('only the owner can add members; editors and viewers are refused', async () => {
    const { tools, projectId } = await world()
    for (const who of [bob, carol]) {
      const r = await run('addMember', who, { projectId, identifier: 'mallory@x.test', role: 'editor' }, tools)
      expect(r).toMatchObject({ success: false, code: 'forbidden' })
    }
  })

  it('cannot add the owner role or an unknown user', async () => {
    const { tools, projectId } = await world()
    expect((await run('addMember', alice, { projectId, identifier: 'mallory@x.test', role: 'owner' }, tools)).success).toBe(false)
    expect(await run('addMember', alice, { projectId, identifier: 'nobody@x.test', role: 'editor' }, tools)).toMatchObject({ code: 'user_not_found' })
  })

  it('role changes work, but the owner cannot be demoted or removed', async () => {
    const { tools, projectId } = await world()
    expect((await run('setMemberRole', alice, { projectId, userId: carol, role: 'editor' }, tools)).success).toBe(true)
    expect(await run('setMemberRole', alice, { projectId, userId: alice, role: 'viewer' }, tools)).toMatchObject({ code: 'forbidden' })
    expect(await run('removeMember', alice, { projectId, userId: alice }, tools)).toMatchObject({ code: 'forbidden' })
  })

  it('removing a member unassigns their tasks and revokes access', async () => {
    const { tools, db, projectId } = await world()
    const t = await run('createTask', alice, { projectId, title: 'A', assigneeId: bob }, tools)
    const taskId = (t.data as { taskId: string }).taskId
    expect((await run('removeMember', alice, { projectId, userId: bob }, tools)).success).toBe(true)
    expect(db.tasks.get(taskId)!.data.assigneeId).toBeNull()
    expect((await run('createTask', bob, { projectId, title: 'B' }, tools)).success).toBe(false)
  })
})

describe('task RBAC', () => {
  it('owner and editor can create, update and delete tasks', async () => {
    const { tools, db, projectId } = await world()
    for (const who of [alice, bob]) {
      const t = await run('createTask', who, { projectId, title: `by ${who}`, priority: 'high' }, tools)
      expect(t.success).toBe(true)
      const taskId = (t.data as { taskId: string }).taskId
      expect(db.tasks.get(taskId)!.data).toMatchObject({ projectId, status: 'todo', priority: 'high' })
      expect((await run('updateTask', who, { taskId, status: 'doing', blocked: true }, tools)).success).toBe(true)
      expect(db.tasks.get(taskId)!.data).toMatchObject({ status: 'doing', blocked: 1 })
      expect((await run('deleteTask', who, { taskId }, tools)).success).toBe(true)
    }
  })

  it('viewer is read-only', async () => {
    const { tools, projectId } = await world()
    const t = await run('createTask', alice, { projectId, title: 'T' }, tools)
    const taskId = (t.data as { taskId: string }).taskId
    expect(await run('createTask', carol, { projectId, title: 'X' }, tools)).toMatchObject({ code: 'forbidden' })
    expect(await run('updateTask', carol, { taskId, status: 'done' }, tools)).toMatchObject({ code: 'forbidden' })
    expect(await run('deleteTask', carol, { taskId }, tools)).toMatchObject({ code: 'forbidden' })
  })

  it('non-members cannot act, and get "not found" (no existence oracle)', async () => {
    const { tools, projectId } = await world()
    const t = await run('createTask', alice, { projectId, title: 'T' }, tools)
    const taskId = (t.data as { taskId: string }).taskId
    expect(await run('createTask', mallory, { projectId, title: 'X' }, tools)).toMatchObject({ code: 'not_found' })
    expect(await run('updateTask', mallory, { taskId, title: 'pwn' }, tools)).toMatchObject({ code: 'not_found' })
    expect(await run('deleteTask', mallory, { taskId }, tools)).toMatchObject({ code: 'not_found' })
  })

  it('cross-project: an editor of project A cannot touch tasks of project B (projectId in params is ignored)', async () => {
    const { tools, db, projectId } = await world()
    const other = await run('createProject', mallory, { name: 'Secret' }, tools)
    const otherId = (other.data as { projectId: string }).projectId
    const t = await run('createTask', mallory, { projectId: otherId, title: 'private' }, tools)
    const taskId = (t.data as { taskId: string }).taskId
    // Bob is an editor of `projectId` and lies about the project in the request.
    expect(await run('updateTask', bob, { taskId, projectId, title: 'pwn' }, tools)).toMatchObject({ code: 'not_found' })
    expect(db.tasks.get(taskId)!.data.title).toBe('private')
  })

  it('validates input: status, priority, date and assignee membership', async () => {
    const { tools, projectId } = await world()
    expect(await run('createTask', alice, { projectId, title: 'x', status: 'nope' }, tools)).toMatchObject({ error: 'Invalid status' })
    expect(await run('createTask', alice, { projectId, title: 'x', priority: 'urgent' }, tools)).toMatchObject({ error: 'Invalid priority' })
    expect(await run('createTask', alice, { projectId, title: 'x', due: '06/10/2026' }, tools)).toMatchObject({ error: 'Invalid date' })
    expect(await run('createTask', alice, { projectId, title: 'x', assigneeId: mallory }, tools)).toMatchObject({ error: 'Assignee must be a project member' })
    expect(await run('createTask', alice, { projectId, title: '  ' }, tools)).toMatchObject({ error: 'Task title required' })
  })
})

describe('AI Sprint Insights', () => {
  it('editor generates and persists an AI briefing using the caller JWT', async () => {
    const { tools, db, projectId } = await world()
    await run('createTask', alice, { projectId, title: 'Overdue one', due: '2026-06-01' }, tools)
    const r = await run('generateInsights', bob, { projectId }, tools)
    expect(r).toMatchObject({ success: true, data: { source: 'ai' } })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0][1]).toBe(`jwt-${bob}`)
    expect(generate.mock.calls[0][2]).toContain('Overdue one')
    const row = db.sprint_insights.get(projectId)!.data
    expect(row).toMatchObject({ source: 'ai', model: 'claude-haiku-5-5', generatedBy: bob, summary: 'Risk is low.\n- ship it' })
    expect((row.metrics as { overdue: number }).overdue).toBe(1)
  })

  it('falls back to rule-based insights when the AI call fails', async () => {
    generate.mockRejectedValue(new Error('insufficient_credits'))
    const { tools, db, projectId } = await world()
    await run('createTask', alice, { projectId, title: 'Stuck', blocked: true }, tools)
    const r = await run('generateInsights', alice, { projectId }, tools)
    expect(r).toMatchObject({ success: true, data: { source: 'rules', aiError: 'insufficient_credits' } })
    expect(db.sprint_insights.get(projectId)!.data.summary).toContain('1 blocked task(s): Stuck')
  })

  it('viewers and non-members cannot generate; rapid repeats are served from cache unless forced', async () => {
    const { tools, projectId } = await world()
    expect(await run('generateInsights', carol, { projectId }, tools)).toMatchObject({ code: 'forbidden' })
    expect(await run('generateInsights', mallory, { projectId }, tools)).toMatchObject({ code: 'not_found' })
    await run('generateInsights', alice, { projectId }, tools)
    expect(await run('generateInsights', alice, { projectId }, tools)).toMatchObject({ data: { cached: true } })
    expect(generate).toHaveBeenCalledTimes(1)
    await run('generateInsights', alice, { projectId, force: true }, tools)
    expect(generate).toHaveBeenCalledTimes(2)
  })
})

describe('deleteProject authorization', () => {
  it('refuses viewers, editors and non-members, and keeps every row', async () => {
    const { tools, db, projectId } = await world()
    await run('createTask', alice, { projectId, title: 'T' }, tools)
    for (const who of [bob, carol, mallory]) {
      const r = await run('deleteProject', who, { projectId }, tools)
      expect(r.success).toBe(false)
      // non-members must not learn the project exists
      expect(r).toMatchObject({ code: who === mallory ? 'not_found' : 'forbidden' })
    }
    expect(db.projects.size).toBe(1)
    expect(db.tasks.size).toBe(1)
    expect(db.team_members.size).toBe(3)
  })

  it('ignores a client-supplied owner/role claim', async () => {
    const { tools, db, projectId } = await world()
    const r = await run('deleteProject', carol, { projectId, role: 'owner', ownerId: carol }, tools)
    expect(r).toMatchObject({ success: false, code: 'forbidden' })
    expect(db.projects.size).toBe(1)
  })

  it('is idempotent-safe: deleting an already deleted project is not_found', async () => {
    const { tools, projectId } = await world()
    expect((await run('deleteProject', alice, { projectId }, tools)).success).toBe(true)
    expect(await run('deleteProject', alice, { projectId }, tools)).toMatchObject({ success: false, code: 'not_found' })
  })
})

describe('addMember result', () => {
  it('returns the display name for the UI confirmation and a clear user_not_found message', async () => {
    const { tools, projectId } = await world()
    const ok = await run('addMember', alice, { projectId, identifier: 'mallory@x.test', role: 'viewer' }, tools)
    expect(ok).toMatchObject({ success: true, data: { role: 'viewer' } })
    expect((ok.data as { name: string }).name).toBeTruthy()
    const missing = await run('addMember', alice, { projectId, identifier: 'ghost@x.test', role: 'viewer' }, tools)
    expect(missing).toMatchObject({ success: false, code: 'user_not_found' })
    expect(missing.error).toMatch(/sign in once/)
  })
})

describe('deleteProject', () => {
  it('owner cascades tasks, insights and memberships; editor cannot', async () => {
    const { tools, db, projectId } = await world()
    await run('createTask', alice, { projectId, title: 'T' }, tools)
    await run('generateInsights', alice, { projectId }, tools)
    expect(await run('deleteProject', bob, { projectId }, tools)).toMatchObject({ code: 'forbidden' })
    expect((await run('deleteProject', alice, { projectId }, tools)).success).toBe(true)
    expect(db.projects.size).toBe(0)
    expect(db.tasks.size).toBe(0)
    expect(db.team_members.size).toBe(0)
    expect(db.sprint_insights.size).toBe(0)
  })
})
