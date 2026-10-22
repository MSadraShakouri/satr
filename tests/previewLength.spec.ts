import { expect, test, type Page } from '@playwright/test';

// The reading view has to be as long as the note is. Every section the
// reader has not reached yet stands on an estimate, and when those
// estimates are wrong by a factor the note changes length as it is read:
// the scroll range falls past the offset the reader is at, the browser
// clamps them to the end of the note, and the switch they just made looks
// like it landed at the bottom.

/** A homework note: a heading, a sentence, a short list, over and over. */
function note(sections: number): string {
  const out: string[] = ['# جلسه‌ی درس', ''];
  for (let i = 1; i <= sections; i += 1) {
    out.push(`## بخش ${i}`, '', `نشانه‌ی بخش ${i}. توضیح کوتاه این بخش. `, '', '- مورد یک', '- مورد دو', '- مورد سه', '');
  }
  return out.join('\n');
}

async function open(page: Page, text: string): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ text }) => {
    localStorage.setItem('satr:fs:index', JSON.stringify({ files: { 'Notes/A.md': 1 }, folders: ['Notes'] }));
    localStorage.setItem('satr:fs:file:Notes/A.md', text as string);
    localStorage.setItem('satr:tabs', JSON.stringify({ tabs: [{ path: 'Notes/A.md' }], active: 0 }));
    localStorage.setItem('satr:spaces', JSON.stringify([{ id: 'notes', name: 'Notes', path: 'Notes' }]));
  }, { text });
  await page.goto('/');
  await expect(page.locator('#app .cm-file-name')).toHaveText('A');
  await page.evaluate(() => document.getElementById('boot-snapshot')?.remove());
}

const toPreview = (page: Page) => page.evaluate(() => document.querySelector<HTMLButtonElement>('#app #preview-toggle')!.click());

/** Where the reader is: the first section at the typing band, and whether
 *  the pane has run out of note. */
const WHERE = `(() => {
  const pane = document.querySelector('#app .preview-pane');
  const top = pane.getBoundingClientRect().top + 120;
  let at = '';
  for (const el of pane.querySelectorAll('.md-section')) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > top) { at = (el.textContent || '').trim().slice(0, 24); break; }
  }
  const max = pane.scrollHeight - pane.clientHeight;
  return { top: Math.round(pane.scrollTop), max: Math.round(max), bottom: pane.scrollTop >= max - 4, at };
})()`;

test('a note the reader has not seen is as long as the note it is', async ({ page }) => {
  await open(page, note(80));
  await toPreview(page);
  await page.waitForTimeout(600);
  const cold = await page.evaluate(() => {
    const sections = [...document.querySelectorAll<HTMLElement>('#preview > .md-section')];
    return {
      height: document.querySelector<HTMLElement>('#app .preview-pane')!.scrollHeight,
      sections: sections.length,
      // Every section carries its own source span, lists included: it is
      // the span that buys the estimate.
      unestimated: sections.filter((s) => !s.style.containIntrinsicBlockSize).length,
    };
  });
  // The truth: every section laid out for real.
  const real = await page.evaluate(async () => {
    const style = document.createElement('style');
    style.textContent = '#preview > .md-section { content-visibility: visible !important; }';
    document.head.appendChild(style);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const height = document.querySelector<HTMLElement>('#app .preview-pane')!.scrollHeight;
    style.remove();
    return height;
  });
  expect(cold.unestimated).toBe(0);
  // It was three times the note's length when every list in it was held at
  // the stylesheet's 40em.
  expect(cold.height / real).toBeLessThan(1.3);
  expect(cold.height / real).toBeGreaterThan(0.7);
});

test('reading on from a switch does not end up at the bottom of the note', async ({ page }) => {
  await open(page, note(80));
  // Writing, well down the note.
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('#app .cm-scroller')!;
    scroller.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * 0.6;
  });
  await page.waitForTimeout(600);
  await toPreview(page);
  await page.waitForTimeout(500);
  const landed = await page.evaluate(WHERE) as { at: string; bottom: boolean; max: number };
  expect(landed.bottom).toBe(false);
  // Read on, a screen at a time, the way anyone does.
  for (let i = 0; i < 6; i += 1) {
    await page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>('#app .preview-pane')!;
      pane.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
      pane.scrollTop += pane.clientHeight * 0.85;
    });
    await page.waitForTimeout(150);
  }
  const after = await page.evaluate(WHERE) as { at: string; bottom: boolean; top: number; max: number };
  // The note does not get shorter as it is read. It used to lose a tenth of
  // its length over these six screens — 52136px of scroll range down to
  // 47120px — and the reader, who had been placed in a note that long, was
  // clamped to the end of the shorter one and left there.
  expect(Math.abs(after.max - landed.max) / landed.max).toBeLessThan(0.05);
  expect(after.bottom).toBe(false);
});

test('the tail of a note is the foot of the screen, not one line and a blank page', async ({ page }) => {
  // A note that ends the way notes end: a block, then nothing.
  await open(page, `${note(12)}\n\n`);
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('#app .cm-scroller')!;
    scroller.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
    scroller.scrollTop = scroller.scrollHeight; // the band sits past the last line
  });
  await page.waitForTimeout(500);
  await toPreview(page);
  await page.waitForTimeout(700);
  const filled = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('#app .preview-pane')!;
    const sections = [...pane.querySelectorAll<HTMLElement>('.md-section')];
    const last = sections[sections.length - 1]!.getBoundingClientRect();
    const box = pane.getBoundingClientRect();
    // How much of the screen below the note's last line is empty padding.
    return { blankBelow: Math.round(box.bottom - last.bottom), pane: Math.round(box.height) };
  });
  // The end of the last section used to be placed at the typing band, with
  // half a screen of the article's bottom padding under it.
  expect(filled.blankBelow).toBeLessThan(filled.pane / 3);
});
