import { expect, type BrowserContext, type Page } from '@playwright/test'

export const DEMO = { email: 'demo@casememory.test', password: 'casememory-demo-2026' }
export const PASSWORD = 'correct-horse-42'

/** The API allows 10 sign-ins per account per 15 minutes, so tests share one demo session. */
let demoSession: Awaited<ReturnType<BrowserContext['cookies']>> | null = null

export async function signIn(page: Page, email = DEMO.email, password = DEMO.password) {
  const demo = email === DEMO.email
  if (demo && demoSession) {
    await page.context().addCookies(demoSession)
    if ((await page.context().request.get('/api/v1/auth/me')).ok()) {
      await page.goto('/app')
      await expect(page).toHaveURL(/\/app$/)
      return
    }
  }
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app$/)
  if (demo) demoSession = await page.context().cookies()
}

let n = 0
export async function registerFirm(page: Page, firmName = 'Mehta Chambers') {
  const email = `e2e${Date.now()}${++n}@example.test`
  await page.goto('/register')
  await page.getByLabel('Firm or chambers name').fill(firmName)
  await page.getByLabel('Your name').fill('Riya Mehta')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  return email
}

export async function openDemoCase(page: Page) {
  await signIn(page)
  await page.getByRole('link', { name: /Ramesh Kumar v\. Suresh Gupta/ }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: /Ramesh Kumar v\. Suresh Gupta/ })).toBeVisible()
}
