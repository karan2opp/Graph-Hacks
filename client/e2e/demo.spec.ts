import { expect, test } from '@playwright/test'
import { openDemoCase, signIn } from './helpers'

test('home shows the firm cases and what needs attention', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('heading', { name: /Here is what your cases remember/ })).toBeVisible()
  await expect(page.getByText('Overdue directions')).toBeVisible()
  await expect(page.locator('li .case-row')).toHaveCount(4)
  await page.getByPlaceholder('Search by party, case no., court').fill('Patel')
  await expect(page.locator('li .case-row')).toHaveCount(1)
})

test('the brief prepares the lawyer for the next hearing', async ({ page }) => {
  await openDemoCase(page)
  await expect(page.getByRole('heading', { name: 'Walk in prepared' })).toBeVisible()
  await expect(page.getByText(/Ramesh Kumar: Plaintiff to file rejoinder/)).toBeVisible()
  await expect(page.getByText('3 contradictions to raise')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The case so far' })).toBeVisible()
  await expect(page.locator('.spine > li')).toHaveCount(10)
})

test('a transcript turn opens its contradiction', async ({ page }) => {
  await openDemoCase(page)
  await page.getByRole('link', { name: /Hearings & transcripts/ }).click()
  await page.getByRole('link', { name: /Cross-examination of PW1/ }).click()
  await expect(page.getByRole('heading', { name: /Transcript/ })).toBeVisible()
  await page.getByRole('button', { name: /He returned Rs\. 2,00,000/ }).click()
  await expect(page.getByText('Contradicts · Same person')).toBeVisible()
  await expect(page.getByText(/no part of the said amount has been repaid/i)).toBeVisible()
})

test('story drift lets the lawyer flag findings and see disputes', async ({ page }) => {
  await openDemoCase(page)
  await page.getByRole('link', { name: /Story drift/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: /Suresh Gupta/ })).toBeVisible()
  const first = page.locator('article').filter({ hasText: 'I received the said amount' }).first()
  await first.getByRole('button', { name: 'Add to cross prep' }).click()
  await expect(page.getByText('Added to cross prep')).toBeVisible()
  await expect(first.getByText('In cross prep')).toBeVisible()

  await page.getByRole('button', { name: /Disputes/ }).click()
  await expect(page.getByText('Disputed by the other side').first()).toBeVisible()
})

test('directions show stamps and accept a lawyer override', async ({ page }) => {
  await openDemoCase(page)
  await page.getByRole('link', { name: /^Directions/ }).click()
  await expect(page.locator('.stamp-red', { hasText: 'Overdue' })).toBeVisible()
  await expect(page.locator('.stamp-grey', { hasText: 'Vacated' })).toBeVisible()
  const row = page.locator('.drow').filter({ hasText: 'Plaintiff to file rejoinder' })
  await row.getByLabel('Your call').selectOption('complied')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Your call is saved')).toBeVisible()
  await expect(row.locator('.stamp-green')).toBeVisible()
  await row.getByLabel('Your call').selectOption('auto')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect(row.locator('.stamp-red')).toBeVisible()
})

test('documents show problem states and open at the cited paragraph', async ({ page }) => {
  await openDemoCase(page)
  await page.getByRole('link', { name: /^Documents/ }).click()
  await expect(page.getByText(/need your attention/)).toBeVisible()
  await expect(page.getByText('No readable text').first()).toBeVisible()
  await expect(page.getByText('Waiting for analysis').first()).toBeVisible()
  // The list is paged, newest first; find the 2021 written statement by searching, as a lawyer would.
  await page.getByPlaceholder('Search titles').fill('Written statement')
  await page.getByRole('link', { name: /^Written statement Written statement/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Written statement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Paragraph 1' })).toBeVisible()
  await expect(page.getByText(/I received the said amount in March 2019/)).toBeVisible()
})

test('ask stays usable and explains that answers need the AI agents', async ({ page }) => {
  await openDemoCase(page)
  await page.getByRole('link', { name: 'Ask the case', exact: true }).click()
  await expect(page.getByText(/Answers need the AI agents/)).toBeVisible()
  const box = page.getByLabel('Ask a question')
  await box.fill('Has Suresh Gupta contradicted himself?')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(/The Q&A agent needs the AI service/)).toBeVisible()
  await expect(box).toHaveValue('Has Suresh Gupta contradicted himself?')
})
