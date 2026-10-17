import { expect, test } from '@playwright/test'

test('landing tells the story and leads into the app', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Your case file, with a memory.' })).toBeVisible()

  // Scrolling through the typewriter story moves it to the last step and the gavel strikes.
  await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('#pipeline')!
    window.scrollTo(0, s.offsetTop + s.offsetHeight - window.innerHeight)
  })
  await expect(page.locator('[data-step="3"]')).toHaveAttribute('aria-current', '')
  await expect(page.locator('[data-anim="stamp"]')).toHaveAttribute('opacity', '1')

  await page.getByRole('link', { name: 'Sign in' }).first().click()
  await expect(page).toHaveURL(/\/login$/)
})
