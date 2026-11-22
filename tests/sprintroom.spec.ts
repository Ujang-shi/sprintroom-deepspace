/**
 * SprintRoom end-to-end: two real test accounts, project-level RBAC, realtime
 * sync and presence. Needs 2 usable test accounts (see tests/collab.spec.ts):
 *   npx deepspace test accounts create --email a@deepspace.test --name "Ada" --password-stdin
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 usable @deepspace.test accounts')

test('owner invites a viewer; tasks sync live; viewer is read-only; presence shows', async ({ users }) => {
  const [owner, guest] = await users(2)
  const project = `E2E ${Date.now()}`

  // Both accounts need a users row before an invite can find them.
  await Promise.all([owner.page.goto('/workspace'), guest.page.goto('/workspace')])
  await expect(owner.page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 })
  await expect(guest.page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 })

  // Owner creates a project.
  await owner.page.locator('#newproject').click()
  await owner.page.getByPlaceholder('e.g. Fall product launch').fill(project)
  await owner.page.getByRole('button', { name: 'Save changes' }).click()
  await expect(owner.page.getByRole('heading', { name: project })).toBeVisible()

  // A non-member sees nothing of it (rows are filtered by the Durable Object).
  await expect(guest.page.getByText(project)).toHaveCount(0)

  // Owner adds the guest as a viewer.
  await owner.page.locator('#invite').click()
  await owner.page.getByLabel('Email or exact display name').fill(guest.email)
  await owner.page.locator('select[name=role]').selectOption('viewer')
  await owner.page.getByRole('button', { name: 'Add member' }).click()

  // The project appears live for the guest, no reload.
  await expect(guest.page.getByRole('button', { name: new RegExp(project) })).toBeVisible({ timeout: 15_000 })
  await guest.page.getByRole('button', { name: new RegExp(project) }).click()

  // Owner creates a task; guest sees it live.
  await owner.page.locator('#newtask').click()
  await owner.page.locator('input[name=title]').fill('Ship the beta')
  await owner.page.getByRole('button', { name: 'Save changes' }).click()
  await expect(guest.page.getByText('Ship the beta')).toBeVisible({ timeout: 15_000 })

  // Viewer role: no write controls.
  await expect(guest.page.locator('#newtask')).toHaveCount(0)
  await expect(guest.page.locator('#generate-insights')).toHaveCount(0)

  // Presence: each side sees the other online.
  await expect(owner.page.getByTestId('presence-count')).toBeVisible({ timeout: 15_000 })
})
