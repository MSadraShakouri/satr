import { expect, test, type Page } from '@playwright/test';

type Incoming = { id: string; name: string; mimeType: string; size: number; kind: string; readOnly: boolean; text: string; lossy?: boolean };
async function open(page: Page, file: Incoming): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __satrBooted: boolean }).__satrBooted);
  await page.evaluate(async (incoming) => {
    await (window as unknown as { __satrIncomingForTest: (value: Incoming) => Promise<void> }).__satrIncomingForTest(incoming);
  }, file);
}
const note = (over: Partial<Incoming> = {}): Incoming => ({ id: 'read-only', name: 'Outside note.md', mimeType: 'text/markdown', size: 30, kind: 'text', readOnly: true, text: '# External heading\n\n**Bold words**\n\n- [ ] Unchanged task\n\n<t:1700000000:f>', ...over });

test('a read-only incoming Markdown has source and preview, without granting writes', async ({ page }) => {
  await open(page, note());
  await expect(page.locator('body')).toHaveClass(/is-view-only/);
  await expect(page.locator('#topbar-title')).toHaveText('Outside note');
  await expect(page.locator('#file-actions')).toBeVisible();
  await expect(page.locator('#preview-toggle')).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await page.locator('.cm-content').click();
  await page.keyboard.type('WRONG');
  await expect(page.locator('.cm-content')).not.toContainText('WRONG');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'preview');
  await expect(page.locator('#preview h1')).toHaveText('External heading');
  await expect(page.locator('#preview strong')).toHaveText('Bold words');
  await expect(page.locator('#preview input[type=checkbox]')).toBeDisabled();
  await page.locator('#preview time.discord-timestamp').click();
  await expect(page.locator('.timestamp-picker')).toHaveCount(0);
  await page.locator('#preview-toggle').click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await expect(page.locator('.cm-content')).toContainText('External heading');
});

test('writable incoming Markdown still offers the usual editing control', async ({ page }) => {
  await open(page, note({ id:'writable', readOnly: false }));
  await expect(page.locator('body')).not.toHaveClass(/is-view-only/);
  await expect(page.locator('#preview-toggle')).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
});

test('shared Markdown is also readable both ways but remains read-only', async ({ page }) => {
  await open(page, note({ id:'shared', name:'Shared text.md', kind:'shared-text', readOnly:true }));
  await expect(page.locator('#preview-toggle')).toBeVisible();
  await page.locator('#preview-toggle').click();
  await expect(page.locator('#preview h1')).toHaveText('External heading');
  await page.locator('#preview-toggle').click();
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
});
