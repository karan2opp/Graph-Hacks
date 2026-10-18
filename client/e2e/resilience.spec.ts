import { expect, test } from '@playwright/test'
import { pageNumbers } from '../src/lib/paging'
import { openDemoCase, signIn } from './helpers'

test('page numbers keep both ends and the current page with its neighbours', () => {
  expect(pageNumbers(1, 1)).toEqual([1])
  expect(pageNumbers(1, 3)).toEqual([1, 2, 3])
  expect(pageNumbers(2, 10)).toEqual([1, 2, 3, null, 10])
  expect(pageNumbers(5, 10)).toEqual([1, null, 4, 5, 6, null, 10])
  expect(pageNumbers(10, 10)).toEqual([1, null, 9, 10])
})

test('long lists are paged, and the page lives in the URL', async ({ page }) => {
  await openDemoCase(page)
  await page.getByRole('link', { name: 'Documents' }).first().click()
  const rows = page.locator('a.docrow')
  await expect(rows).toHaveCount(8)
  await expect(page.getByText('1–8 of 12 documents')).toBeVisible()

  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page).toHaveURL(/[?&]page=2/)
  await expect(rows).toHaveCount(5)
  await expect(page.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')

  await page.goBack()
  await expect(rows).toHaveCount(8)
})

test('going offline shows a banner, waits, and catches up on reconnect', async ({ page, context }) => {
  await openDemoCase(page)
  await context.setOffline(true)
  await expect(page.getByText(/You're offline\. What's loaded stays readable/)).toBeVisible()

  // A page not loaded yet waits for the connection instead of failing.
  await page.getByRole('link', { name: /Directions/ }).first().click()
  await expect(page.getByText('Waiting for your connection.', { exact: false })).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByText(/You're back online/)).toBeVisible()
  await expect(page.getByText(/You're offline\. What's loaded/)).toBeHidden()
  await expect(page.locator('.drow:not(.drow-head)').first()).toBeVisible()
})

test('a failed load explains itself and can be retried', async ({ page }) => {
  await openDemoCase(page)
  const fail = (route: import('@playwright/test').Route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, statusCode: 500, message: 'The graph is busy.' }) })
  await page.route('**/api/v1/cases/*/directions', fail)
  await page.getByRole('link', { name: /Directions/ }).first().click()
  await expect(page.getByRole('heading', { name: 'This could not be loaded' })).toBeVisible()
  await expect(page.getByText('The graph is busy.')).toBeVisible()

  await page.unroute('**/api/v1/cases/*/directions', fail)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.drow:not(.drow-head)').first()).toBeVisible()
})

test('a server error while opening the app does not sign you out', async ({ page }) => {
  await signIn(page)
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, statusCode: 503, message: 'FalkorDB is unavailable' }) }),
  )
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: "Couldn't open your account" })).toBeVisible()
  await expect(page).toHaveURL(/\/app$/)
})
