/**
 * Invite feedback/reliability and owner-only project deletion, with real test accounts.
 * Needs 2+ usable @deepspace.test accounts named "ada" and "grace" (see SPRINTROOM.md).
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 usable @deepspace.test accounts')

test('invite shows progress, success and a clear error; works right after the teammate opens the app', async ({ users }) => {
  const [owner, guest] = await users(['ada', 'grace'])
  const project = `Invite ${Date.now()}`
  await Promise.all([owner.page.goto('/workspace'), guest.page.goto('/workspace')])
  await expect(owner.page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 })
  await owner.page.locator('#newproject').click()
  await owner.page.getByPlaceholder('e.g. Fall product launch').fill(project)
  await owner.page.getByRole('button', { name: 'Save changes' }).click()
  await expect(owner.page.getByRole('heading', { name: project })).toBeVisible()

  // Unknown teammate: retries briefly, then a clear inline error; the dialog stays open and usable.
  await owner.page.locator('#invite').click()
  await owner.page.getByLabel('Email or exact display name').fill('nobody-here@deepspace.test')
  await owner.page.getByRole('button', { name: 'Add member' }).click()
  await expect(owner.page.getByTestId('modal-status')).toBeVisible()
  await expect(owner.page.getByTestId('modal-error')).toContainText('sign in once', { timeout: 15_000 })
  await expect(owner.page.getByRole('button', { name: 'Add member' })).toBeEnabled()

  // Valid teammate: success feedback and live membership.
  await owner.page.getByLabel('Email or exact display name').fill(guest.email)
  await owner.page.locator('select[name=role]').selectOption('viewer')
  await owner.page.getByRole('button', { name: 'Add member' }).click()
  await expect(owner.page.getByRole('status').filter({ hasText: /Added .* as Viewer/ })).toBeVisible({ timeout: 15_000 })
  await expect(guest.page.getByRole('button', { name: new RegExp(project) })).toBeVisible({ timeout: 15_000 })
})

test('only the owner can delete a project, behind a typed confirmation', async ({ users }) => {
  const [owner, guest] = await users(['ada', 'grace'])
  const project = `Delete ${Date.now()}`
  await Promise.all([owner.page.goto('/workspace'), guest.page.goto('/workspace')])
  await expect(owner.page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 })
  await expect(guest.page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 })
  await owner.page.locator('#newproject').click()
  await owner.page.getByPlaceholder('e.g. Fall product launch').fill(project)
  await owner.page.getByRole('button', { name: 'Save changes' }).click()
  await expect(owner.page.getByRole('heading', { name: project })).toBeVisible()
  await owner.page.locator('#newtask').click()
  await owner.page.locator('input[name=title]').fill('Doomed task')
  await owner.page.getByRole('button', { name: 'Save changes' }).click()
  await expect(owner.page.getByText('Doomed task')).toBeVisible()

  // Add the guest as an editor (still not an owner) and wait for the invite to land.
  await owner.page.locator('#invite').click()
  await owner.page.getByLabel('Email or exact display name').fill(guest.email)
  await owner.page.getByRole('button', { name: 'Add member' }).click()
  await expect(guest.page.getByRole('button', { name: new RegExp(project) })).toBeVisible({ timeout: 20_000 })
  await guest.page.getByRole('button', { name: new RegExp(project) }).click()
  await expect(guest.page.getByText('Doomed task')).toBeVisible({ timeout: 15_000 })
  await expect(guest.page.locator('#delete-project')).toHaveCount(0) // non-owner never sees it

  // Cancel keeps everything.
  await owner.page.locator('#delete-project').click()
  const confirm = owner.page.getByRole('button', { name: 'Delete project', exact: true }).last()
  await expect(confirm).toBeDisabled()
  await owner.page.getByRole('button', { name: 'Cancel' }).click()
  await expect(owner.page.getByRole('heading', { name: project })).toBeVisible()

  // Wrong name keeps the button disabled; the exact name enables it.
  await owner.page.locator('#delete-project').click()
  await owner.page.getByLabel('Type the project name to confirm').fill(project.slice(0, -1))
  await expect(confirm).toBeDisabled()
  await owner.page.getByLabel('Type the project name to confirm').fill(project)
  await expect(confirm).toBeEnabled()
  await confirm.click()

  // Gone for the owner and, live, for the member; a toast confirms.
  await expect(owner.page.getByRole('status').filter({ hasText: `Deleted project "${project}"` })).toBeVisible({ timeout: 15_000 })
  await expect(owner.page.getByRole('button', { name: new RegExp(project) })).toHaveCount(0, { timeout: 15_000 })
  await expect(guest.page.getByRole('button', { name: new RegExp(project) })).toHaveCount(0, { timeout: 15_000 })
  await owner.page.reload()
  await expect(owner.page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 })
  await expect(owner.page.getByText('Doomed task')).toHaveCount(0)
})
