import { expect, test } from '@playwright/test'
import { registerFirm, signIn } from './helpers'

test('a lawyer creates a case, adds people, the first hearing and a document', async ({ page }) => {
  await registerFirm(page)
  await page.getByRole('link', { name: 'Create a case' }).click()

  await page.getByLabel('Case number').fill('CS 77/2026')
  await page.getByLabel('Court').fill('Civil Judge (Junior Division)')
  await page.getByLabel('Title').fill('Asha Rao v. Vikram Shah')
  await page.getByRole('button', { name: 'Next: people' }).click()

  await expect(page.getByRole('heading', { name: 'Who is in this case?' })).toBeVisible()
  const sides = page.locator('fieldset')
  await expect(sides.nth(0).getByLabel('Party')).toHaveValue('Asha Rao')
  await sides.nth(0).getByLabel('Lawyer (optional)').fill('Adv. Nikhil Jain')
  await sides.nth(0).getByLabel('Witnesses (optional)').fill('PW1 Asha Rao')
  await page.getByLabel('Presiding judge (optional)').fill('Mr. K. Iyer')
  await page.getByRole('button', { name: 'Next: first hearing' }).click()

  await expect(page.getByRole('heading', { name: 'Add the first hearing' })).toBeVisible()
  await page.getByLabel('Date', { exact: true }).fill('2026-01-15')
  await page.getByLabel('Listed for').first().fill('Appearance')
  await page.getByRole('button', { name: 'Save and add the order or transcript' }).click()

  await expect(page.getByRole('heading', { name: 'Add to the case memory' })).toBeVisible()
  await page.getByRole('tab', { name: 'Paste text' }).click()
  await page.getByLabel('Paste the text').fill('1. Defendant appears.\n\n2. Defendant to file written statement within 30 days.')
  await page.getByLabel('Title').fill('Order dated 15.01.2026')
  await page.getByRole('button', { name: 'Add & read' }).click()

  await expect(page.getByRole('heading', { name: /Reading “Order dated 15.01.2026”/ })).toBeVisible()
  await expect(page.getByText('2 paragraphs, each citable by page and number.')).toBeVisible()
  await expect(page.getByText('Waiting for the AI agents.').first()).toBeVisible()

  await page.getByRole('link', { name: /^Documents/ }).click()
  await expect(page.getByRole('link', { name: /Order dated 15.01.2026/ })).toBeVisible()
  await page.getByRole('link', { name: 'Brief', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Asha Rao v. Vikram Shah' })).toBeVisible()
})

test('another firm cannot open a case by URL', async ({ page, browser }) => {
  await signIn(page)
  await page.getByRole('link', { name: /Ramesh Kumar v\. Suresh Gupta/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Walk in prepared' })).toBeVisible()
  const caseUrl = new URL(page.url()).pathname

  const outsider = await browser.newPage()
  await registerFirm(outsider, 'Outsider LLP')
  await outsider.goto(caseUrl)
  await expect(outsider.getByRole('heading', { name: 'Case not found' })).toBeVisible()
})
