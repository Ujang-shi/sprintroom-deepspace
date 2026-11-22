/**
 * AI Sprint Insights against the live DeepSpace Anthropic integration
 * (user-billed). With credits the insight is tagged "AI". A test account with no
 * credits gets 402 from the proxy, and the app must degrade to rule-based
 * insights instead of failing. Either outcome is valid; the test logs which one
 * happened so a green run is never mistaken for a verified AI response.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 1, 'Needs 1 usable @deepspace.test account')

test('generate insights: real model with credits, rule-based fallback without', async ({ users }) => {
  const [owner] = await users(1)
  await owner.page.goto('/workspace')
  await expect(owner.page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 })

  await owner.page.locator('#newproject').click()
  await owner.page.getByPlaceholder('e.g. Fall product launch').fill(`AI ${Date.now()}`)
  await owner.page.getByRole('button', { name: 'Save changes' }).click()
  await owner.page.locator('#newtask').click()
  await owner.page.locator('input[name=title]').fill('Fix login bug')
  await owner.page.getByRole('button', { name: 'Save changes' }).click()
  await expect(owner.page.getByText('Fix login bug')).toBeVisible({ timeout: 15_000 })

  const resp = owner.page.waitForResponse((r) => r.url().includes('/api/actions/generateInsights'))
  await owner.page.locator('#generate-insights').click()
  const body = await (await resp).json()
  expect(body.success).toBe(true)

  const insights = owner.page.getByTestId('insights')
  if (body.data.source === 'ai') {
    await expect(insights.getByText('AI', { exact: true })).toBeVisible({ timeout: 15_000 })
    console.log('AI-RESULT: real model responded')
  } else {
    expect(body.data.source).toBe('rules')
    await expect(insights.getByText('Rule-based')).toBeVisible()
    console.log(`AI-RESULT: fallback to rules (${body.data.aiError})`)
  }
})
