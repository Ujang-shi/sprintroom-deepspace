/**
 * Opt-in, credit-spending verification. Skipped unless RUN_REAL_AI=1, so the
 * normal suite never spends credits.
 *
 *  1. ONE real AI Sprint Insights request as the logged-in developer account
 *     (token read from the CLI session, never logged). No retries.
 *  2. Server-side RBAC: a project viewer calls the mutation actions directly
 *     (bypassing the UI) and must be refused; the task must be unchanged.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { request } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(process.env.RUN_REAL_AI !== '1', 'Opt-in: set RUN_REAL_AI=1 (spends account credits)')
test.skip(loadAllTestAccounts().length < 1, 'Needs a @deepspace.test account for the viewer')

type Res = { success: boolean; data?: Record<string, unknown>; error?: string; code?: string }

test('one real AI insight as the developer; viewer is refused server-side', async ({ users }, testInfo) => {
  test.setTimeout(120_000)
  const baseURL = String(testInfo.project.use.baseURL)
  const devToken = readFileSync(join(homedir(), '.deepspace', 'token'), 'utf8').trim()

  const dev = await request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${devToken}` } })
  const call = async (ctx: typeof dev, name: string, params: Record<string, unknown>): Promise<Res> => {
    const r = await ctx.post(`/api/actions/${name}`, { data: params })
    return (await r.json()) as Res
  }

  // Viewer account: needs a users row (opening the app creates it) and a JWT.
  const [viewer] = await users(['grace'])
  await viewer.page.goto('/workspace')
  await expect(viewer.page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 })
  const viewerToken = await viewer.page.evaluate(async () => {
    const r = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    return ((await r.json()) as { token: string }).token
  })
  const guest = await request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${viewerToken}` } })

  // Developer (owner) builds a project with the viewer on it.
  const created = await call(dev, 'createProject', { name: `RBAC ${Date.now()}` })
  console.log('SETUP createProject', created.success, created.error ?? '')
  expect(created.success).toBe(true)
  const projectId = String(created.data!.projectId)
  const added = await call(dev, 'addMember', { projectId, identifier: viewer.email, role: 'viewer' })
  expect(added.success, added.error).toBe(true)
  const task = await call(dev, 'createTask', { projectId, title: 'Original task', description: 'do not change' })
  expect(task.success, task.error).toBe(true)
  const taskId = String(task.data!.taskId)

  // ---- RBAC: viewer attempts every mutation directly ----
  const attempts: [string, Record<string, unknown>][] = [
    ['createTask', { projectId, title: 'Injected by viewer' }],
    ['updateTask', { taskId, projectId, title: 'Hijacked by viewer' }],
    ['deleteTask', { taskId, projectId }],
    ['generateInsights', { projectId }],
    ['addMember', { projectId, identifier: viewer.email, role: 'owner' }],
    ['setMemberRole', { projectId, userId: 'anyone', role: 'owner' }],
    ['deleteProject', { projectId }],
  ]
  for (const [name, params] of attempts) {
    const res = await call(guest, name, params)
    console.log(`RBAC viewer ${name}: success=${res.success} code=${res.code} error=${res.error}`)
    expect(res.success, `${name} must be refused for a viewer`).toBe(false)
    expect(res.code).toBe('forbidden')
  }

  // Task unchanged and still present, as seen live by the viewer.
  await viewer.page.getByRole('button', { name: /RBAC \d+/ }).first().waitFor({ timeout: 15_000 })
  await viewer.page.getByRole('button', { name: /RBAC d+/ }).last().click()
  await expect(viewer.page.getByText('Original task')).toBeVisible({ timeout: 15_000 })
  await expect(viewer.page.getByText('Injected by viewer')).toHaveCount(0)
  await expect(viewer.page.getByText('Hijacked by viewer')).toHaveCount(0)

  // ---- Exactly ONE real AI request, no retry ----
  const ai = await call(dev, 'generateInsights', { projectId, force: true })
  console.log('AI-RESULT', JSON.stringify(ai))
  expect(ai.success).toBe(true)

  await dev.dispose()
  await guest.dispose()
})
