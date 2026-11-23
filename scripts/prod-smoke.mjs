#!/usr/bin/env node
/**
 * Production smoke test for SprintRoom: two real @deepspace.test accounts drive two separate browser
 * contexts against a deployed URL.
 *
 *   node scripts/prod-smoke.mjs                       # https://sprintroom-deepspace.app.space
 *   SMOKE_URL=https://staging.example node scripts/prod-smoke.mjs
 *   SMOKE_OWNER=ada SMOKE_VIEWER=grace node scripts/prod-smoke.mjs   # account selectors (substring of the email)
 *
 * Needs two test accounts (their credentials live in ~/.deepspace/test-accounts.json):
 *   printf '%s' "<password>" | npx deepspace test accounts create --email sprintroom-ada@deepspace.test   --name ada   --label sprintroom-e2e --password-stdin
 *   printf '%s' "<password>" | npx deepspace test accounts create --email sprintroom-grace@deepspace.test --name grace --label sprintroom-e2e --password-stdin
 *
 * Checks: 1 auth, 2 create project+tasks, 3 live sync + presence, 4 viewer cannot mutate (UI and API),
 * 5 persistence after reload, 6 AI insights (real model if the account has credits, else rule-based fallback).
 * It never buys credits. The test project is always deleted at the end (owner-only deleteProject).
 * Exit code 0 only if every step passed.
 */
import { chromium } from '@playwright/test'
import { loadAllTestAccounts, newSignedInContext } from 'deepspace/testing'

const BASE = (process.env.SMOKE_URL || 'https://sprintroom-deepspace.app.space').replace(/\/$/, '')
const OWNER = process.env.SMOKE_OWNER || 'ada'
const VIEWER = process.env.SMOKE_VIEWER || 'grace'
const REGISTER_WAIT_MS = 4000 // a user's `users` row appears ~1-2s after they first open the app

const results = []
const rec = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`)
}
const step = async (name, fn) => {
  try {
    rec(name, true, (await fn()) ?? '')
  } catch (e) {
    rec(name, false, String(e.message).split('\n')[0])
    throw e
  }
}
const visible = (loc, timeout = 20000) => loc.waitFor({ state: 'visible', timeout })

const accounts = loadAllTestAccounts()
const owner = accounts.find((a) => a.email.includes(OWNER))
const viewer = accounts.find((a) => a.email.includes(VIEWER))
if (!owner || !viewer || owner.email === viewer.email) {
  console.error(`Need two distinct test accounts matching "${OWNER}" and "${VIEWER}". See the header of this file.`)
  process.exit(2)
}

const getToken = (page) =>
  page.evaluate(async () => {
    const r = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    return (await r.json()).token
  })
const action = async (token, name, params) =>
  (await fetch(`${BASE}/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })).json()

const project = `PROD-SMOKE ${Date.now()}`
const browser = await chromium.launch()
let po, pv, projectId, ownerToken

try {
  await step('1. both users authenticate', async () => {
    const [co, cv] = await Promise.all([newSignedInContext(browser, owner, BASE), newSignedInContext(browser, viewer, BASE)])
    po = await co.newPage()
    pv = await cv.newPage()
    await Promise.all([po.goto(BASE + '/workspace'), pv.goto(BASE + '/workspace')])
    await Promise.all([visible(po.getByTestId('workspace')), visible(pv.getByTestId('workspace'))])
    await pv.waitForTimeout(REGISTER_WAIT_MS)
    ownerToken = await getToken(po)
    return `owner=${owner.email} viewer=${viewer.email}`
  })

  await step('2a. owner creates a project (non-member sees nothing)', async () => {
    const created = po.waitForResponse((r) => r.url().includes('/api/actions/createProject'))
    await po.locator('#newproject').click()
    await po.getByPlaceholder('e.g. Fall product launch').fill(project)
    await po.getByRole('button', { name: 'Save changes' }).click()
    projectId = (await (await created).json()).data.projectId
    await visible(po.getByRole('heading', { name: project }))
    if (await pv.getByText(project).count()) throw new Error('non-member can see the project')
  })

  await step('3a. invite viewer; project appears live in the other session (no reload)', async () => {
    const added = po.waitForResponse((r) => r.url().includes('/api/actions/addMember'))
    await po.locator('#invite').click()
    await po.getByLabel('Email or exact display name').fill(viewer.email)
    await po.locator('select[name=role]').selectOption('viewer')
    await po.getByRole('button', { name: 'Add member' }).click()
    const body = await (await added).json()
    if (!body.success) throw new Error(`addMember failed: ${body.code} ${body.error}`)
    await visible(pv.getByRole('button', { name: new RegExp(project) }))
    await pv.getByRole('button', { name: new RegExp(project) }).click()
    await visible(pv.getByRole('heading', { name: project }))
  })

  await step('2b+3b. owner creates tasks; they sync live to the viewer', async () => {
    for (const title of ['Smoke task one', 'Smoke task two']) {
      await po.locator('#newtask').click()
      await po.locator('input[name=title]').fill(title)
      await po.getByRole('button', { name: 'Save changes' }).click()
      await visible(pv.getByText(title))
    }
  })

  await step('3c. presence: both sessions see each other online', async () => {
    await visible(po.getByTestId('presence-count'))
    await visible(pv.getByTestId('presence-count'))
    return `${await po.getByTestId('presence-count').innerText()} / ${await pv.getByTestId('presence-count').innerText()}`
  })

  await step('4a. viewer UI has no write controls', async () => {
    for (const sel of ['#newtask', '#generate-insights', '#delete-project']) {
      if (await pv.locator(sel).count()) throw new Error(`${sel} is visible to the viewer`)
    }
  })

  await step('4b. viewer cannot modify/delete via direct API (server-side)', async () => {
    const viewerToken = await getToken(pv)
    const probe = await action(ownerToken, 'createTask', { projectId, title: 'Probe task' })
    if (!probe.success) throw new Error('owner probe task failed: ' + probe.error)
    const taskId = probe.data.taskId
    const out = []
    for (const [name, params] of [
      ['createTask', { projectId, title: 'Injected' }],
      ['updateTask', { taskId, projectId, title: 'Hijacked' }],
      ['deleteTask', { taskId, projectId }],
      ['generateInsights', { projectId }],
      ['deleteProject', { projectId }],
    ]) {
      const r = await action(viewerToken, name, params)
      if (r.success || r.code !== 'forbidden') throw new Error(`${name} not refused: ${JSON.stringify(r)}`)
      out.push(`${name}=forbidden`)
    }
    return out.join(', ')
  })

  await step('5. data persists after refresh (both users, nothing injected)', async () => {
    await Promise.all([po.reload(), pv.reload()])
    for (const p of [po, pv]) {
      await visible(p.getByTestId('workspace'))
      await visible(p.getByRole('button', { name: new RegExp(project) }))
      await p.getByRole('button', { name: new RegExp(project) }).click()
      await visible(p.getByText('Smoke task one'))
      await visible(p.getByText('Smoke task two'))
      if ((await p.getByText('Injected').count()) || (await p.getByText('Hijacked').count())) throw new Error('a viewer mutation persisted')
    }
  })

  await step('6. AI insights: real model with credits, rule-based fallback without', async () => {
    const resp = po.waitForResponse((r) => r.url().includes('/api/actions/generateInsights'), { timeout: 60000 })
    await po.locator('#generate-insights').click()
    const body = await (await resp).json()
    if (!body.success) throw new Error('action failed: ' + JSON.stringify(body))
    const tag = body.data.source === 'ai' ? 'AI' : 'Rule-based'
    await visible(po.getByTestId('insights').getByText(tag, { exact: true }), 15000)
    return `source=${body.data.source}${body.data.aiError ? ' aiError=' + body.data.aiError : ''}; UI tag "${tag}"`
  })
} catch (e) {
  console.log('STOPPED:', String(e.message).split('\n')[0])
} finally {
  if (projectId && ownerToken) {
    try {
      const r = await action(ownerToken, 'deleteProject', { projectId })
      console.log('CLEANUP deleteProject:', r.success ? 'ok' : JSON.stringify(r))
      if (!r.success) results.push({ name: 'cleanup', ok: false })
    } catch (e) {
      console.log('CLEANUP failed:', e.message)
      results.push({ name: 'cleanup', ok: false })
    }
  }
  await browser.close()
  console.log(`\nSUMMARY ${results.filter((r) => r.ok).length}/${results.length} passed against ${BASE}`)
  process.exit(results.length > 0 && results.every((r) => r.ok) ? 0 : 1)
}
