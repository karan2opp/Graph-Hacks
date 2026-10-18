import { expect, test } from '@playwright/test'
import { PASSWORD, registerFirm, signIn } from './helpers'

test('a new firm signs up, lands on an empty case list, signs out and back in', async ({ page }) => {
  const email = await registerFirm(page)
  await expect(page.getByRole('heading', { name: 'Start your first case' })).toBeVisible()

  await page.getByRole('button', { name: /Account menu/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)

  await page.goto('/app')
  await expect(page).toHaveURL(/\/login\?next=/)

  await signIn(page, email, PASSWORD)
})

test('wrong password and invalid sign-up show clear errors', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@casememory.test')
  await page.getByLabel('Password').fill('not-the-password-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect')

  await page.goto('/register')
  await page.getByLabel('Password').fill('short')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Use at least 10 characters')).toBeVisible()
  await expect(page.getByText('Enter a valid email address')).toBeVisible()
})

test('an owner invites a colleague who joins the same firm', async ({ page, browser }) => {
  await registerFirm(page, 'Invite Test Chambers')
  await page.goto('/app/settings')
  await page.getByLabel('Invite a colleague by email').fill('junior.e2e@example.test')
  await page.getByRole('button', { name: 'Create invite' }).click()
  const link = (await page.locator('.banner-info .typed').textContent())!.trim()
  expect(link).toContain('/invite/')

  const other = await browser.newPage()
  await other.goto(new URL(link).pathname)
  await expect(other.getByRole('heading', { name: 'Join Invite Test Chambers' })).toBeVisible()
  await other.getByLabel('Your name').fill('Junior Associate')
  await other.getByLabel('Choose a password').fill(PASSWORD)
  await other.getByRole('button', { name: 'Join the firm' }).click()
  await expect(other).toHaveURL(/\/app$/)
  await other.goto('/app/settings')
  await expect(other.getByText('Only owners can invite or remove people.')).toBeVisible()
})
