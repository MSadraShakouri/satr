import { test, expect } from '@playwright/test';

// The file list says what every file is, and dims only what Satr has nothing
// to open with yet. Satr edits text of any extension, so a .json or a .py
// reads at full strength, and a PDF is read page by page — what is left
// faint is an archive, bytes, the things with no view at all.

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAQklEQVR42u3OMQEAAAgDoC251a3gLWQgnbvKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4GlxsAAGnJP8tAAAAAElFTkSuQmCC';

test('every file says which kind it is, and only the ones with no view are faint', async ({ page }) => {
  const files: Record<string, string> = {
    'Notes/note.md': '# a', 'Notes/page.html': '<h1>a</h1>', 'Notes/data.json': '{}',
    'Notes/script.py': 'x = 1', 'Notes/paper.pdf': 'x', 'Notes/photo.png': PNG,
    'Notes/notes.txt': 'x', 'Notes/archive.zip': 'x',
  };
  await page.addInitScript((seed: Record<string, string>) => {
    const paths = Object.keys(seed);
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: Object.fromEntries(paths.map((p) => [p, 1])), folders: ['Notes'] }));
    for (const p of paths) localStorage.setItem(`satr:fs:file:${p}`, seed[p]);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/note.md' }], active: 0 }));
  }, files);
  await page.goto('/');
  await page.waitForSelector('#boot-snapshot', { state: 'detached' });
  await page.locator('#files').click();
  await expect(page.locator('.nav-file-title').first()).toBeVisible();
  const rows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.nav-file-title')].map((r) => [
    r.querySelector('.tree-item-inner')?.textContent?.trim() ?? '',
    { dim: r.classList.contains('is-unsupported'), badge: r.querySelector('.nav-file-tag')?.textContent ?? '' },
  ])));
  // the badge: every file but a Markdown note, which is what a note is here
  expect(rows['note']).toEqual({ dim: false, badge: '' });
  expect(rows['data.json']).toEqual({ dim: false, badge: 'json' });
  expect(rows['script.py']).toEqual({ dim: false, badge: 'py' });
  expect(rows['notes.txt']).toEqual({ dim: false, badge: 'txt' });
  expect(rows['page.html']).toEqual({ dim: false, badge: 'html' });
  expect(rows['photo.png']).toEqual({ dim: false, badge: 'png' });
  // nothing opens these two yet, and the list says so
  expect(rows['paper.pdf']).toEqual({ dim: false, badge: 'pdf' });
  expect(rows['archive.zip']).toEqual({ dim: true, badge: 'zip' });
});
