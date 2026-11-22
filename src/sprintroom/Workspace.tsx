/**
 * SprintRoom workspace — the original prototype UI (same markup and class
 * names) rebuilt on DeepSpace:
 *  - data:     useQuery() live subscriptions (projects, team_members, tasks, sprint_insights)
 *  - writes:   server actions via callAction() (project-level RBAC enforced server-side)
 *  - presence: usePresenceRoom(`project:<id>`) shows teammates and the task they have open
 */

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AuthOverlay, getUserColor, signOut, useAuth, usePresenceRoom, useQuery, useUser } from 'deepspace'
import { callAction } from '../lib/actions'
import { can, computeInsights, type ProjectRole } from '../lib/sprint'
import './sprintroom.css'

interface ProjectRow { name: string; ownerId?: string }
interface MemberRow { teamId: string; userId: string; role: ProjectRole; name?: string; status?: string }
interface TaskRow {
  projectId: string
  title: string
  description?: string
  status: 'todo' | 'doing' | 'done'
  priority: 'low' | 'medium' | 'high'
  assigneeId?: string | null
  due?: string | null
  blocked?: boolean | number
}
interface InsightRow {
  projectId: string
  summary: string
  source: 'ai' | 'rules'
  model?: string
  generatedAt?: string
  generatedBy?: string
}

type Task = { id: string } & TaskRow
const COLUMNS: [TaskRow['status'], string][] = [['todo', 'To Do'], ['doing', 'In Progress'], ['done', 'Done']]
const ROLE_LABEL: Record<ProjectRole, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' }

type ModalState =
  | { kind: 'project' }
  | { kind: 'task'; task?: Task }
  | { kind: 'members' }
  | null

export default function Workspace() {
  const { isLoaded, isSignedIn, userId } = useAuth()
  const [showAuth, setShowAuth] = useState(false)

  if (!isLoaded) return <div className="sr" aria-busy="true" style={{ minHeight: '100vh' }} />
  if (!isSignedIn || !userId) {
    return (
      <div className="sr" data-testid="signed-out">
        <div className="login">
          <div className="login-card">
            <div className="brand">✦ Sprint<span>Room</span></div>
            <h1>Build better, together.</h1>
            <p className="subtitle">A collaborative sprint workspace with live task updates, project-level roles and AI sprint insights.</p>
            <button className="btn" data-testid="sign-in" onClick={() => setShowAuth(true)}>Sign in to your workspace →</button>
          </div>
        </div>
        {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
      </div>
    )
  }
  return <SignedInWorkspace userId={userId} />
}

function SignedInWorkspace({ userId }: { userId: string }) {
  const { user } = useUser()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const projectsQ = useQuery<ProjectRow>('projects', { orderBy: 'createdAt', orderDir: 'asc' })
  const projects = projectsQ.records
  const active = projects.find((p) => p.recordId === activeId) ?? projects[0] ?? null
  const projectId = active?.recordId ?? null

  const membersQ = useQuery<MemberRow>('team_members', { where: projectId ? { teamId: projectId } : { teamId: '__none__' } })
  const tasksQ = useQuery<TaskRow>('tasks', { where: projectId ? { projectId } : { projectId: '__none__' } })
  const insightQ = useQuery<InsightRow>('sprint_insights', { where: projectId ? { projectId } : { projectId: '__none__' } })

  const members = useMemo(
    () => membersQ.records.filter((m) => !m.data.status || m.data.status === 'active').map((m) => ({ id: m.data.userId, ...m.data })),
    [membersQ.records],
  )
  const tasks: Task[] = useMemo(() => tasksQ.records.map((r) => ({ id: r.recordId, ...r.data })), [tasksQ.records])
  const myRole = members.find((m) => m.userId === userId)?.role ?? null
  const canWrite = can(myRole, 'task.write')
  const isOwner = can(myRole, 'member.manage')

  // Presence: who else is in this project and which task they have open.
  const { peers, connected, updateState } = usePresenceRoom(`project:${projectId ?? 'lobby'}`)
  const openTaskId = modal?.kind === 'task' ? modal.task?.id ?? null : null
  useEffect(() => { updateState({ viewingTask: openTaskId }) }, [openTaskId, updateState])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3300); return () => clearTimeout(t) }, [toast])

  const live = useMemo(() => computeInsights(active?.data.name ?? '', tasks), [active?.data.name, tasks])
  const stored = insightQ.records[0]?.data
  const nameOf = (id?: string | null) => members.find((m) => m.userId === id)?.name || 'Unassigned'
  const loading = projectsQ.status === 'loading'

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true)
    try { return await fn() } catch (e) { setToast(e instanceof Error ? e.message : 'Something went wrong'); return undefined } finally { setBusy(false) }
  }

  const generate = () => run(async () => {
    const r = await callAction<{ source?: string; aiError?: string; cached?: boolean }>('generateInsights', { projectId, force: true })
    if (r.aiError) setToast('AI unavailable - showing rule-based insights')
  })

  const viewersOf = (taskId: string) => peers.filter((p) => p.state.viewingTask === taskId)

  return (
    <div className="sr" data-testid="workspace">
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">✦ Sprint<span>Room</span></div>
          <div>
            <div className="row between"><span className="navlabel">WORKSPACES</span><button className="btn small secondary" id="newproject" onClick={() => setModal({ kind: 'project' })} aria-label="New project">+</button></div>
            <div>
              {projects.map((p) => (
                <button key={p.recordId} className={`project-item ${p.recordId === projectId ? 'active' : ''}`} onClick={() => setActiveId(p.recordId)}>◈ &nbsp;{p.data.name}</button>
              ))}
            </div>
          </div>
          <div className="sidebar-footer">
            <div className="row">
              <div className="avatar">{(user?.name || user?.email || '?')[0].toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <strong data-testid="user-name">{user?.name || user?.email || 'You'}</strong>
                <div className="muted" style={{ fontSize: 11 }}>{myRole ? `${ROLE_LABEL[myRole]} · ` : ''}{connected ? 'Live' : 'Connecting…'}</div>
              </div>
            </div>
            <button className="btn ghost small" id="logout" style={{ marginTop: 15 }} onClick={() => void signOut()}>Sign out</button>
          </div>
        </aside>
        <main className="main">
          {active ? (
            <>
              <div className="top">
                <div>
                  <div className="navlabel">PROJECT OVERVIEW</div>
                  <h1 style={{ margin: '8px 0 0' }}>{active.data.name}</h1>
                  <p className="subtitle">Track progress. Clear blockers. Ship together.</p>
                </div>
                <div className="row">
                  <div className="members" data-testid="members">
                    {members.map((m) => {
                      const online = peers.some((p) => p.userId === m.userId)
                      return (
                        <div key={m.userId} className="avatar" title={`${m.name ?? ''} · ${ROLE_LABEL[m.role] ?? m.role}${online ? ' · online' : ''}`}
                          style={online ? { boxShadow: `0 0 0 2px ${getUserColor(m.userId)}` } : undefined}>
                          {(m.name?.[0] || '?').toUpperCase()}
                        </div>
                      )
                    })}
                  </div>
                  {peers.length > 0 && <span className="tag" data-testid="presence-count">{peers.length} online now</span>}
                  <button className="btn secondary" id="invite" onClick={() => setModal({ kind: 'members' })}>{isOwner ? '+ Member' : 'Team'}</button>
                  {canWrite && <button className="btn" id="newtask" onClick={() => setModal({ kind: 'task' })}>+ New Task</button>}
                </div>
              </div>
              <div className="stats">
                <div className="stat"><label>Total tasks</label><strong>{live.total}</strong></div>
                <div className="stat"><label>Completed</label><strong>{live.completed}</strong></div>
                <div className="stat"><label>In progress</label><strong>{tasks.filter((t) => t.status === 'doing').length}</strong></div>
                <div className="stat"><label>At risk</label><strong>{live.overdue + live.blocked}</strong></div>
              </div>
              <div className="board">
                {COLUMNS.map(([status, title]) => {
                  const col = tasks.filter((t) => t.status === status)
                  return (
                    <div className="column" key={status}>
                      <div className="column-title">{title}<span className="count">{col.length}</span></div>
                      {col.map((t) => {
                        const viewers = viewersOf(t.id)
                        return (
                          <article className="task" key={t.id} data-task={t.id} onClick={() => setModal({ kind: 'task', task: t })}
                            style={viewers[0] ? { borderColor: getUserColor(viewers[0].userId) } : undefined}>
                            <h3>{t.title}</h3>
                            <span className={`tag ${t.priority}`}>{t.priority} priority</span>
                            {t.blocked ? <span className="tag high" style={{ marginLeft: 6 }}>Blocked</span> : null}
                            {viewers.length > 0 && <span className="tag" style={{ marginLeft: 6 }}>{viewers.map((v) => v.userName).join(', ')} viewing</span>}
                            <div className="taskfoot">
                              <span>{nameOf(t.assigneeId)}</span>
                              <span className={t.due && new Date(`${t.due}T23:59:59`) < new Date() && t.status !== 'done' ? 'flag' : ''}>{t.due || 'No due date'}</span>
                            </div>
                          </article>
                        )
                      })}
                      {col.length === 0 && <div className="empty">No tasks yet</div>}
                    </div>
                  )
                })}
              </div>
              <div className="insight" data-testid="insights">
                <h2>
                  <span className="sparkle">✧</span> Sprint Health Insights
                  <span className="tag" style={{ marginLeft: 'auto' }}>{stored?.source === 'ai' ? 'AI' : 'Rule-based'}</span>
                </h2>
                <p>{stored?.summary || live.summary}</p>
                <div className="muted">{live.completion}% complete · {live.open} open · {live.overdue} overdue · {live.blocked} blocked</div>
                {live.nextActions.length > 0 && <p style={{ margin: '14px 0 0' }}><strong>Suggested next:</strong> {live.nextActions.map((x) => x.title).join(' · ')}</p>}
                <div className="row between" style={{ marginTop: 16 }}>
                  <small className="muted">{stored?.generatedAt ? `${stored.source === 'ai' ? `Generated by ${stored.model || 'AI'}` : 'Generated'} ${new Date(stored.generatedAt).toLocaleString()}` : 'Not generated yet - showing live rule-based summary'}</small>
                  {can(myRole, 'insights.generate') && <button className="btn secondary small" id="generate-insights" disabled={busy} onClick={() => void generate()}>{busy ? 'Working…' : '✧ Generate AI insights'}</button>}
                </div>
              </div>
            </>
          ) : (
            <div className="welcome">
              <div className="brand">✦ Sprint<span>Room</span></div>
              <h1>Every great sprint starts somewhere.</h1>
              <p className="subtitle">{loading ? 'Loading your workspaces…' : 'Create your first workspace to plan tasks, collaborate with teammates and spot blockers before they slow you down.'}</p>
              {!loading && <button className="btn" id="firstproject" onClick={() => setModal({ kind: 'project' })}>Create your first project →</button>}
            </div>
          )}
        </main>
      </div>

      {modal?.kind === 'project' && (
        <Modal title="Create project" onClose={() => setModal(null)} onSubmit={async (f) => {
          const r = await callAction<{ projectId: string }>('createProject', { name: f.get('name') })
          setActiveId(r.projectId)
        }}>
          <label className="field">Project name<input name="name" placeholder="e.g. Fall product launch" required maxLength={160} /></label>
        </Modal>
      )}

      {modal?.kind === 'task' && projectId && (
        <TaskModal
          task={modal.task} projectId={projectId} members={members} canWrite={canWrite}
          onClose={() => setModal(null)} onError={setToast}
        />
      )}

      {modal?.kind === 'members' && projectId && (
        <MembersModal projectId={projectId} members={members} isOwner={isOwner} me={userId} onClose={() => setModal(null)} onError={setToast} />
      )}

      {toast && <div className="sr-toast" role="status">{toast}</div>}
    </div>
  )
}

function Modal({ title, children, onClose, onSubmit, submitLabel = 'Save changes', extraActions, readOnly }: {
  title: string; children: ReactNode; onClose: () => void; onSubmit?: (f: FormData) => Promise<unknown>
  submitLabel?: string; extraActions?: ReactNode; readOnly?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!onSubmit) return
    setBusy(true); setErr(null)
    try { await onSubmit(new FormData(e.currentTarget)); onClose() } catch (x) { setErr(x instanceof Error ? x.message : 'Failed'); setBusy(false) }
  }
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <form onSubmit={submit}>
          {children}
          {err && <p className="flag" role="alert">{err}</p>}
          <div className="modal-actions">
            {extraActions}
            <button type="button" className="btn secondary" onClick={onClose}>{readOnly || !onSubmit ? 'Close' : 'Cancel'}</button>
            {onSubmit && !readOnly && <button className="btn" type="submit" disabled={busy}>{submitLabel}</button>}
          </div>
        </form>
      </div>
    </div>
  )
}

function TaskModal({ task: t, projectId, members, canWrite, onClose, onError }: {
  task?: Task; projectId: string; members: { userId: string; name?: string }[]; canWrite: boolean
  onClose: () => void; onError: (m: string) => void
}) {
  const ro = !!t && !canWrite
  return (
    <Modal
      title={t ? (ro ? 'Task details' : 'Edit task') : 'Create task'}
      onClose={onClose}
      readOnly={ro}
      onSubmit={async (f) => {
        const data = {
          title: f.get('title'), description: f.get('description'), status: f.get('status'), priority: f.get('priority'),
          assigneeId: f.get('assigneeId') || null, due: f.get('due') || null, blocked: f.has('blocked'),
        }
        await (t ? callAction('updateTask', { taskId: t.id, ...data }) : callAction('createTask', { projectId, ...data }))
      }}
      extraActions={t && canWrite ? (
        <button type="button" className="btn danger small" onClick={async () => {
          if (!window.confirm('Delete this task?')) return
          try { await callAction('deleteTask', { taskId: t.id }); onClose() } catch (e) { onError(e instanceof Error ? e.message : 'Delete failed') }
        }}>Delete task</button>
      ) : null}
    >
      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="field">Title<input name="title" required maxLength={160} defaultValue={t?.title ?? ''} /></label>
        <label className="field">Description<textarea name="description" maxLength={160} defaultValue={t?.description ?? ''} /></label>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>Status<select name="status" defaultValue={t?.status ?? 'todo'}>{COLUMNS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field" style={{ flex: 1 }}>Priority<select name="priority" defaultValue={t?.priority ?? 'medium'}>{['low', 'medium', 'high'].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        </div>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>Assignee<select name="assigneeId" defaultValue={t?.assigneeId ?? ''}><option value="">Unassigned</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></label>
          <label className="field" style={{ flex: 1 }}>Due date<input type="date" name="due" defaultValue={t?.due ?? ''} /></label>
        </div>
        <label className="row" style={{ marginTop: 14 }}><input type="checkbox" name="blocked" style={{ width: 'auto' }} defaultChecked={!!t?.blocked} /> Mark as blocked</label>
      </fieldset>
    </Modal>
  )
}

function MembersModal({ projectId, members, isOwner, me, onClose, onError }: {
  projectId: string; members: { userId: string; name?: string; role: ProjectRole }[]; isOwner: boolean; me: string
  onClose: () => void; onError: (m: string) => void
}) {
  const act = async (name: string, params: Record<string, unknown>) => {
    try { await callAction(name, { projectId, ...params }) } catch (e) { onError(e instanceof Error ? e.message : 'Failed') }
  }
  return (
    <Modal
      title={isOwner ? 'Manage team' : 'Project team'}
      onClose={onClose}
      submitLabel="Add member"
      onSubmit={isOwner ? async (f) => {
        await callAction('addMember', { projectId, identifier: f.get('identifier'), role: f.get('role') })
      } : undefined}
    >
      <div data-testid="member-list">
        {members.map((m) => (
          <div key={m.userId} className="row between" style={{ margin: '10px 0' }}>
            <span><strong>{m.name}</strong>{m.userId === me ? ' (you)' : ''}</span>
            {isOwner && m.role !== 'owner' ? (
              <span className="row">
                <select aria-label={`Role for ${m.name}`} value={m.role} style={{ width: 'auto' }} onChange={(e) => void act('setMemberRole', { userId: m.userId, role: e.target.value })}>
                  <option value="editor">Editor</option><option value="viewer">Viewer</option>
                </select>
                <button type="button" className="btn danger small" onClick={() => void act('removeMember', { userId: m.userId })}>Remove</button>
              </span>
            ) : <span className="tag">{ROLE_LABEL[m.role]}</span>}
          </div>
        ))}
      </div>
      {isOwner && (
        <>
          <p className="muted">Your teammate must have signed in to SprintRoom once. Owners manage members; editors change tasks; viewers are read-only.</p>
          <div className="row">
            <label className="field" style={{ flex: 2 }}>Email or exact display name<input name="identifier" required /></label>
            <label className="field" style={{ flex: 1 }}>Role<select name="role" defaultValue="editor"><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label>
          </div>
        </>
      )}
    </Modal>
  )
}
