/**
 * SprintRoom server actions — the only write path for projects, members, tasks
 * and insights.
 *
 * Actions run RBAC-off (see src/server/action-routes.ts), so EVERY action here
 * re-derives authorization from `team_members` using the verified `userId`:
 *  - the project is taken from the stored record (never trusted from params)
 *  - the caller's project role must allow the operation (`can()` in lib/sprint)
 */

import type { ActionContext, ActionResult, ActionTools } from 'deepspace/worker'
import {
  PRIORITIES,
  PROJECT_ROLES,
  STATUSES,
  buildInsightPrompt,
  can,
  computeInsights,
  isDate,
  sanitize,
  type Insights,
  type InsightTask,
  type ProjectAction,
  type ProjectRole,
} from '../lib/sprint'

type Ctx<E> = ActionContext<E>
type Row = Record<string, unknown>

const fail = (error: string, code?: string): ActionResult => ({ success: false, error, ...(code ? { code } : {}) })
const ok = <T,>(data: T): ActionResult => ({ success: true, data })

export const INSIGHT_MODEL = 'claude-haiku-5-5'
const INSIGHT_COOLDOWN_MS = 10_000

export interface SprintActionDeps<E> {
  /** Produces the AI narrative; injected so tests never hit the network. */
  generateNarrative: (env: E, jwt: string, prompt: string) => Promise<string>
  now?: () => number
}

const memberId = (projectId: string, userId: string) => `${projectId}:${userId}`

async function getRole(tools: ActionTools, projectId: string, userId: string): Promise<ProjectRole | null> {
  if (!projectId || !userId) return null
  const res = await tools.get<Row>('team_members', memberId(projectId, userId))
  if (!res.success) return null
  const row = res.data.record.data
  if (row.teamId !== projectId || row.userId !== userId) return null
  if (row.status && row.status !== 'active') return null
  const role = String(row.role ?? '')
  return (PROJECT_ROLES as readonly string[]).includes(role) ? (role as ProjectRole) : null
}

/** Resolve project + caller role + permission in one place. */
async function authorize(
  tools: ActionTools,
  userId: string,
  projectId: unknown,
  action: ProjectAction,
): Promise<{ ok: true; projectId: string; role: ProjectRole; project: Row } | { ok: false; res: ActionResult }> {
  const id = sanitize(projectId, 200)
  if (!id) return { ok: false, res: fail('Project required', 'bad_request') }
  const role = await getRole(tools, id, userId)
  // Non-members get the same answer as a missing project: no existence oracle.
  if (!role) return { ok: false, res: fail('Project not found', 'not_found') }
  if (!can(role, action)) return { ok: false, res: fail('Your project role does not allow this', 'forbidden') }
  const project = await tools.get<Row>('projects', id)
  if (!project.success) return { ok: false, res: fail('Project not found', 'not_found') }
  return { ok: true, projectId: id, role, project: project.data.record.data }
}

async function activeMembers(tools: ActionTools, projectId: string) {
  const res = await tools.query<Row>('team_members', { where: { teamId: projectId }, limit: 500 })
  if (!res.success) return []
  return res.data.records.filter((r) => !r.data.status || r.data.status === 'active')
}

async function displayName(tools: ActionTools, userId: string): Promise<string> {
  const u = await tools.get<Row>('users', userId)
  if (u.success) {
    const d = u.data.record.data
    return sanitize(d.name || d.email || userId)
  }
  return userId
}

function parseTaskPatch(
  b: Row,
  memberIds: Set<string>,
  { partial }: { partial: boolean },
): { ok: true; data: Row } | { ok: false; error: string } {
  const data: Row = {}
  if (!partial || 'title' in b) {
    const title = sanitize(b.title)
    if (!title) return { ok: false, error: 'Task title required' }
    data.title = title
  }
  if ('description' in b) data.description = sanitize(b.description)
  if ('status' in b) {
    if (!(STATUSES as readonly string[]).includes(String(b.status))) return { ok: false, error: 'Invalid status' }
    data.status = b.status
  }
  if ('priority' in b) {
    if (!(PRIORITIES as readonly string[]).includes(String(b.priority))) return { ok: false, error: 'Invalid priority' }
    data.priority = b.priority
  }
  if ('blocked' in b) data.blocked = b.blocked ? 1 : 0
  if ('due' in b) {
    if (b.due !== null && b.due !== '' && !isDate(b.due)) return { ok: false, error: 'Invalid date' }
    data.due = b.due || null
  }
  if ('assigneeId' in b) {
    const a = b.assigneeId
    if (a !== null && a !== '' && !memberIds.has(String(a))) return { ok: false, error: 'Assignee must be a project member' }
    data.assigneeId = a || null
  }
  return { ok: true, data }
}

export function makeSprintActions<E>(deps: SprintActionDeps<E>): Record<string, (ctx: Ctx<E>) => Promise<ActionResult>> {
  const now = deps.now ?? Date.now

  return {
    createProject: async ({ userId, params, tools }) => {
      const name = sanitize(params.name)
      if (!name) return fail('Project name required', 'bad_request')
      const created = await tools.create('projects', { name, ownerId: userId })
      if (!created.success) return created
      const projectId = created.data.recordId
      const m = await tools.create(
        'team_members',
        { teamId: projectId, userId, status: 'active', role: 'owner', name: await displayName(tools, userId) },
        memberId(projectId, userId),
      )
      if (!m.success) {
        await tools.remove('projects', projectId)
        return m
      }
      return ok({ projectId })
    },

    addMember: async ({ userId, params, tools }) => {
      const a = await authorize(tools, userId, params.projectId, 'member.manage')
      if (!a.ok) return a.res
      const ident = sanitize(params.identifier || params.name)
      const role = String(params.role ?? 'editor')
      if (!ident) return fail('Enter a teammate email or display name', 'bad_request')
      if (role === 'owner' || !(PROJECT_ROLES as readonly string[]).includes(role)) return fail('Role must be editor or viewer', 'bad_request')
      let found = await tools.query<Row>('users', { where: { email: ident.toLowerCase() }, limit: 2 })
      if (!found.success || found.data.records.length === 0) found = await tools.query<Row>('users', { where: { name: ident }, limit: 2 })
      if (!found.success || found.data.records.length === 0) return fail('Ask your teammate to sign in once first', 'user_not_found')
      if (found.data.records.length > 1) return fail('More than one user matches - use their email', 'ambiguous')
      const target = found.data.records[0]
      const existing = await getRole(tools, a.projectId, target.recordId)
      if (existing === 'owner') return fail('That user already owns this project', 'bad_request')
      const res = await tools.create(
        'team_members',
        { teamId: a.projectId, userId: target.recordId, status: 'active', role, name: sanitize(target.data.name || target.data.email || target.recordId) },
        memberId(a.projectId, target.recordId),
      )
      return res.success ? ok({ userId: target.recordId, role }) : res
    },

    setMemberRole: async ({ userId, params, tools }) => {
      const a = await authorize(tools, userId, params.projectId, 'member.manage')
      if (!a.ok) return a.res
      const target = sanitize(params.userId, 200)
      const role = String(params.role ?? '')
      if (role === 'owner' || !(PROJECT_ROLES as readonly string[]).includes(role)) return fail('Role must be editor or viewer', 'bad_request')
      const current = await getRole(tools, a.projectId, target)
      if (!current) return fail('Member not found', 'not_found')
      if (current === 'owner') return fail('The owner role cannot change', 'forbidden')
      const res = await tools.update('team_members', memberId(a.projectId, target), { role })
      return res.success ? ok({ userId: target, role }) : res
    },

    removeMember: async ({ userId, params, tools }) => {
      const a = await authorize(tools, userId, params.projectId, 'member.manage')
      if (!a.ok) return a.res
      const target = sanitize(params.userId, 200)
      const current = await getRole(tools, a.projectId, target)
      if (!current) return fail('Member not found', 'not_found')
      if (current === 'owner') return fail('The owner cannot be removed', 'forbidden')
      // Unassign their open tasks so nothing points at a non-member.
      const theirs = await tools.query<Row>('tasks', { where: { projectId: a.projectId, assigneeId: target }, limit: 500 })
      if (theirs.success) for (const t of theirs.data.records) await tools.update('tasks', t.recordId, { assigneeId: null })
      const res = await tools.remove('team_members', memberId(a.projectId, target))
      return res.success ? ok({ userId: target }) : res
    },

    deleteProject: async ({ userId, params, tools }) => {
      const a = await authorize(tools, userId, params.projectId, 'project.delete')
      if (!a.ok) return a.res
      for (const collection of ['tasks', 'sprint_insights'] as const) {
        for (let i = 0; i < 20; i++) {
          const r = await tools.deleteWhere(collection, { projectId: a.projectId }, 500)
          if (!r.success) return r
          if (r.data.deleted < 500) break
        }
      }
      for (let i = 0; i < 20; i++) {
        const r = await tools.deleteWhere('team_members', { teamId: a.projectId }, 500)
        if (!r.success) return r
        if (r.data.deleted < 500) break
      }
      const res = await tools.remove('projects', a.projectId)
      return res.success ? ok({ projectId: a.projectId }) : res
    },

    createTask: async ({ userId, params, tools }) => {
      const a = await authorize(tools, userId, params.projectId, 'task.write')
      if (!a.ok) return a.res
      const members = new Set((await activeMembers(tools, a.projectId)).map((m) => String(m.data.userId)))
      const parsed = parseTaskPatch({ ...params, status: params.status ?? 'todo', priority: params.priority ?? 'medium' }, members, { partial: false })
      if (!parsed.ok) return fail(parsed.error, 'bad_request')
      const res = await tools.create('tasks', { blocked: 0, ...parsed.data, projectId: a.projectId })
      return res.success ? ok({ taskId: res.data.recordId }) : res
    },

    updateTask: async ({ userId, params, tools }) => {
      const taskId = sanitize(params.taskId, 200)
      const task = taskId ? await tools.get<Row>('tasks', taskId) : null
      if (!task || !task.success) return fail('Task not found', 'not_found')
      // The project comes from the stored task, not from the request.
      const a = await authorize(tools, userId, task.data.record.data.projectId, 'task.write')
      if (!a.ok) return a.res.error === 'Project not found' ? fail('Task not found', 'not_found') : a.res
      const members = new Set((await activeMembers(tools, a.projectId)).map((m) => String(m.data.userId)))
      const { taskId: _t, projectId: _p, ...patch } = params
      const parsed = parseTaskPatch(patch, members, { partial: true })
      if (!parsed.ok) return fail(parsed.error, 'bad_request')
      const res = await tools.update('tasks', taskId, parsed.data)
      return res.success ? ok({ taskId }) : res
    },

    deleteTask: async ({ userId, params, tools }) => {
      const taskId = sanitize(params.taskId, 200)
      const task = taskId ? await tools.get<Row>('tasks', taskId) : null
      if (!task || !task.success) return fail('Task not found', 'not_found')
      const a = await authorize(tools, userId, task.data.record.data.projectId, 'task.write')
      if (!a.ok) return a.res.error === 'Project not found' ? fail('Task not found', 'not_found') : a.res
      const res = await tools.remove('tasks', taskId)
      return res.success ? ok({ taskId }) : res
    },

    /**
     * AI Sprint Insights: deterministic metrics + an AI-written briefing
     * (Claude via the DeepSpace AI proxy, billed to the caller). If the AI call
     * fails the rule-based summary is stored instead so the feature degrades.
     */
    generateInsights: async ({ userId, params, tools, env, callerJwt }) => {
      const a = await authorize(tools, userId, params.projectId, 'insights.generate')
      if (!a.ok) return a.res
      const prev = await tools.get<Row>('sprint_insights', a.projectId)
      if (prev.success && !params.force) {
        const at = Date.parse(String(prev.data.record.data.generatedAt ?? ''))
        if (Number.isFinite(at) && now() - at < INSIGHT_COOLDOWN_MS) return ok({ cached: true })
      }
      const taskRes = await tools.query<Row>('tasks', { where: { projectId: a.projectId }, limit: 500 })
      if (!taskRes.success) return taskRes
      const tasks: (InsightTask & { id: string })[] = taskRes.data.records.map((r) => ({
        id: r.recordId,
        title: String(r.data.title ?? ''),
        status: String(r.data.status ?? 'todo'),
        due: (r.data.due as string | null) ?? null,
        blocked: Boolean(r.data.blocked),
      }))
      const insights: Insights = computeInsights(String(a.project.name ?? 'Project'), tasks, now())
      let summary = insights.summary
      let source: 'ai' | 'rules' = 'rules'
      let aiError: string | undefined
      try {
        const text = (await deps.generateNarrative(env, callerJwt, buildInsightPrompt(insights, tasks))).trim()
        if (text) {
          summary = text.slice(0, 3900)
          source = 'ai'
        }
      } catch (e) {
        aiError = e instanceof Error ? e.message.slice(0, 200) : 'AI unavailable'
      }
      const { project: _p, summary: _s, nextActions, ...metrics } = insights
      const saved = await tools.create(
        'sprint_insights',
        {
          projectId: a.projectId,
          summary,
          source,
          model: source === 'ai' ? INSIGHT_MODEL : '',
          generatedBy: userId,
          generatedAt: new Date(now()).toISOString(),
          metrics,
          nextActions,
        },
        a.projectId,
      )
      if (!saved.success) return saved
      return ok({ source, ...(aiError ? { aiError } : {}) })
    },
  }
}
