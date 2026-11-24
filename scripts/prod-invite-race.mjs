#!/usr/bin/env node
/**
 * Targets the original intermittent invite failure on a deployed URL: a brand-new teammate is invited through the
 * UI the instant their workspace becomes visible (before their `users` row exists). Needs an owner account matching
 * SMOKE_OWNER (default "ada") and a never-used account matching SMOKE_FRESH (default "hana").
 * Prints the time to success and whether the dialog needed to retry. Deletes its project at the end.
 */
import { chromium } from '@playwright/test'
import { loadAllTestAccounts, newSignedInContext } from 'deepspace/testing'

const BASE = (process.env.SMOKE_URL || 'https://sprintroom-deepspace.app.space').replace(/\/$/, '')
const accounts = loadAllTestAccounts()
const owner = accounts.find((a) => a.email.includes(process.env.SMOKE_OWNER || 'ada'))
const fresh = accounts.find((a) => a.email.includes(process.env.SMOKE_FRESH || 'hana'))
if (!owner || !fresh) { console.error('Need owner and fresh test accounts'); process.exit(2) }

const browser = await chromium.launch()
let ok = false
try {
  const po = await (await newSignedInContext(browser, owner, BASE)).newPage()
  await po.goto(BASE + '/workspace')
  await po.getByTestId('workspace').waitFor({ timeout: 20000 })
  const name = `RACE ${Date.now()}`
  await po.locator('#newproject').click()
  await po.getByPlaceholder('e.g. Fall product launch').fill(name)
  await po.getByRole('button', { name: 'Save changes' }).click()
  await po.getByRole('heading', { name }).waitFor()

  const pf = await (await newSignedInContext(browser, fresh, BASE)).newPage()
  await pf.goto(BASE + '/workspace')
  await pf.getByTestId('workspace').waitFor({ timeout: 20000 }) // invite immediately from here: no extra wait

  const calls = []
  po.on('response', async (r) => { if (r.url().includes('/api/actions/addMember')) calls.push((await r.json().catch(() => ({}))).code || 'ok') })
  const t0 = Date.now()
  await po.locator('#invite').click()
  await po.getByLabel('Email or exact display name').fill(fresh.email)
  await po.locator('select[name=role]').selectOption('viewer')
  await po.getByRole('button', { name: 'Add member' }).click()
  await po.getByRole('status').filter({ hasText: /Added .* as Viewer/ }).waitFor({ timeout: 15000 })
  await pf.getByRole('button', { name: new RegExp(name) }).waitFor({ timeout: 15000 })
  console.log(`PASS invite right after the teammate opened the app: success after ${Date.now() - t0}ms; addMember responses: ${calls.join(' -> ')}`)
  ok = true
} catch (e) {
  console.log('FAIL', String(e.message).split('\n')[0])
} finally {
  // clean up through the owner UI
  try {
    const po = browser.contexts()[0].pages()[0]
    await po.locator('#delete-project').click()
    const heading = await po.getByRole('heading', { level: 1 }).first().innerText()
    await po.getByLabel('Type the project name to confirm').fill(heading)
    await po.getByRole('button', { name: 'Delete project', exact: true }).last().click()
    await po.getByRole('status').filter({ hasText: /Deleted project/ }).waitFor({ timeout: 15000 })
    console.log('cleanup: project deleted')
  } catch (e) { console.log('cleanup failed:', String(e.message).split('\n')[0]) }
  await browser.close()
  process.exit(ok ? 0 : 1)
}
