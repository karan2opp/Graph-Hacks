import { expect, test } from '@playwright/test'

test('landing tells the story and leads into the app', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Your case file, with a memory.' })).toBeVisible()

  // Scrolling through the typewriter story moves it to the last step and the gavel strikes.
  await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('#pipeline')!
    window.scrollTo(0, s.offsetTop + s.offsetHeight - window.innerHeight)
  })
  await expect(page.locator('[data-step="3"]')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByTestId('flagged-stamp')).toHaveCSS('opacity', '1')

  await page.getByRole('link', { name: 'Sign in' }).first().click()
  await expect(page).toHaveURL(/\/login$/)
})

test('the footer leads to the privacy, cookie and terms pages', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy policy' }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible()

  const docs = page.getByRole('navigation', { name: 'Legal documents' })
  await docs.getByRole('link', { name: 'Cookie policy' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Cookie policy' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'cm_session' })).toBeVisible()

  await docs.getByRole('link', { name: 'Terms of use' }).click()
  await expect(page).toHaveURL(/\/terms$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible()
})

test('a stamp on the order sheet can be overruled and restored', async ({ page }) => {
  await page.goto('/')
  const orders = page.locator('#orders')
  const tally = orders.getByRole('complementary', { name: 'At a glance' }).getByRole('listitem').filter({ hasText: 'Overdue' })
  await orders.getByRole('button', { name: 'OVERDUE' }).click()
  await expect(orders.getByRole('button', { name: 'FILED BY HAND' })).toHaveAttribute('aria-pressed', 'true')
  await expect(orders.getByText('Your call: handed in at the counter on 05.10.2026.')).toBeVisible()
  await expect(tally).toContainText('0')

  await orders.getByRole('button', { name: 'FILED BY HAND' }).click()
  await expect(orders.getByRole('button', { name: 'OVERDUE' })).toHaveAttribute('aria-pressed', 'false')
  await expect(tally).toContainText('1')
})
