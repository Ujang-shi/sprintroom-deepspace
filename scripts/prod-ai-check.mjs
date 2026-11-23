#!/usr/bin/env node
/**
 * Opt-in: ONE real AI Sprint Insights request against production, billed to the logged-in DeepSpace
 * developer account's existing credits (token read from the CLI session at ~/.deepspace/token, never
 * printed). It makes exactly one generateInsights call - no retry - and deletes its temporary project.
 * It never buys credits. If the account has none, the app returns the rule-based fallback and this
 * script reports that instead of success.
 *
 *   RUN_REAL_AI=1 node scripts/prod-ai-check.mjs            # SMOKE_URL overrides the target
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

if (process.env.RUN_REAL_AI !== '1') {
  console.error('Refusing to run: this spends account credits. Set RUN_REAL_AI=1 to proceed.')
  process.exit(2)
}
const BASE = (process.env.SMOKE_URL || 'https://sprintroom-deepspace.app.space').replace(/\/$/, '')
const token = readFileSync(join(homedir(), '.deepspace', 'token'), 'utf8').trim()
const call = async (name, params) =>
  (await fetch(`${BASE}/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })).json()

let projectId
let exitCode = 1
try {
  const created = await call('createProject', { name: `AI-CHECK ${Date.now()}` })
  if (!created.success) throw new Error(`createProject: ${created.error}`)
  projectId = created.data.projectId
  const task = await call('createTask', { projectId, title: 'Fix login bug', priority: 'high', due: '2020-01-01' })
  if (!task.success) throw new Error(`createTask: ${task.error}`)

  const ai = await call('generateInsights', { projectId, force: true }) // the single AI request
  console.log('generateInsights ->', JSON.stringify(ai))
  if (!ai.success) throw new Error('action failed')
  if (ai.data.source === 'ai') {
    console.log('RESULT: AI success path verified (real model responded).')
    exitCode = 0
  } else {
    console.log(`RESULT: fell back to rule-based insights (${ai.data.aiError}). AI success NOT verified.`)
  }
} catch (e) {
  console.log('ERROR:', e.message)
} finally {
  if (projectId) {
    const r = await call('deleteProject', { projectId })
    console.log('cleanup deleteProject ->', r.success ? 'ok' : JSON.stringify(r))
  }
  process.exit(exitCode)
}
