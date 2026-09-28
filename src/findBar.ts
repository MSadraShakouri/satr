// Find and replace in the note, as Obsidian's editor search
// (.document-search-container, read in its app.js):
// - One bar for find and replace: a chevron at the start drops down the
//   replace row ("Replace", replace, replace all); then the search field
//   ("Find", with "3 / 12" inside once there is a query), previous, next,
//   close.
// - Regular expressions, ignoring case (src/searchRegex.ts); `$1` etc. in the
//   replacement. Typing searches after 150ms from the caret; every match is
//   highlighted, the current one ringed; the caret doesn't move while you
//   search.
// - Enter: on a phone (no physical keyboard) it only closes the keyboard; on
//   a computer it goes to the next match (Shift+Enter: previous). F3 /
//   Shift+F3 next / previous, Mod+Alt+Enter replace all.
//   Enter in the replace field replaces and goes to the next match.
// - Closing with a field focused selects the current match in the note and
//   puts the caret there (keyboard stays up); otherwise the note is left as is.
import { RegExpCursor } from '@codemirror/search';
import { expandReplacement, searchRegExp } from './searchRegex';
import { EditorSelection, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, type Panel, showPanel, type ViewUpdate } from '@codemirror/view';

interface Match { from: number; to: number }
interface FindState {
  open: boolean;
  replaceMode: boolean;
  query: string;
  current: Match | null;
}
const CLOSED: FindState = { open: false, replaceMode: false, query: '', current: null };
/** Every match highlighted, not only the current one (Settings). */
let HIGHLIGHT_ALL = true;
export function setHighlightAll(on: boolean): void { HIGHLIGHT_ALL = on; }

const setFind = StateEffect.define<Partial<FindState>>();

// A regular expression ignoring case; an invalid one matches nothing.
function cursor(state: EditorState, query: string, from: number): RegExpCursor | null {
  if (!searchRegExp(query)) return null;
  try { return new RegExpCursor(state.doc, query, { ignoreCase: true }, from, state.doc.length); } catch { return null; }
}
/** Next non-empty match from the cursor's position. */
function step(c: RegExpCursor | null): Match | null {
  if (!c) return null;
  for (c.next(); !c.done; c.next()) if (c.value.to > c.value.from) return { from: c.value.from, to: c.value.to };
  return null;
}
/** The regex match at exactly `m` (for `$1` in replacements), or null. */
function execAt(state: EditorState, query: string, m: Match): RegExpExecArray | null {
  const c = cursor(state, query, m.from);
  for (c?.next(); c && !c.done; c.next()) {
    if (c.value.from > m.from) break;
    if (c.value.from === m.from && c.value.to === m.to) return c.value.match;
  }
  return null;
}
function matchesIn(state: EditorState, query: string, limit = 10000): Match[] {
  const out: Match[] = [];
  if (!query) return out;
  const c = cursor(state, query, 0);
  for (let m = step(c); m && out.length < limit; m = step(c)) out.push(m);
  return out;
}
/** First match starting at or after `pos` (wrapping). */
function matchFrom(state: EditorState, query: string, pos: number): Match | null {
  if (!query) return null;
  return step(cursor(state, query, pos)) ?? step(cursor(state, query, 0));
}
function isMatch(state: EditorState, query: string, m: Match): boolean {
  return m.to <= state.doc.length && m.to > m.from && execAt(state, query, m) !== null;
}

const findField = StateField.define<FindState>({
  create: () => CLOSED,
  update(value, tr) {
    let next = value;
    if (tr.docChanged && value.current) {
      // Follow the match through edits; if it is no longer one, the next
      // match from there takes its place.
      const mapped = { from: tr.changes.mapPos(value.current.from, 1), to: tr.changes.mapPos(value.current.to, -1) };
      next = { ...value, current: isMatch(tr.state, value.query, mapped) ? mapped : matchFrom(tr.state, value.query, mapped.from) };
    }
    for (const effect of tr.effects) if (effect.is(setFind)) next = { ...next, ...effect.value };
    return next;
  },
  provide: (field) => showPanel.from(field, (value) => (value.open ? createPanel : null)),
});
// Decorations are derived in a second field so they update with the doc.
const findDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_, tr) {
    const value = tr.state.field(findField);
    if (!value.open || !value.query) return Decoration.none;
    const marks: Range<Decoration>[] = [];
    if (HIGHLIGHT_ALL) for (const m of matchesIn(tr.state, value.query)) {
      if (!value.current || m.from !== value.current.from) marks.push(allMark.range(m.from, m.to));
    }
    if (value.current && value.current.to > value.current.from) marks.push(currentMark.range(value.current.from, value.current.to));
    return Decoration.set(marks, true);
  },
  provide: (field) => EditorView.decorations.from(field),
});
const currentMark = Decoration.mark({ class: 'obsidian-search-match-highlight' });
const allMark = Decoration.mark({ class: 'obsidian-search-match-highlight mod-all' });

const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
// Lucide icons, as Obsidian uses.
const ICONS = {
  up: icon('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'), // arrow-up
  down: icon('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'), // arrow-down
  chevron: icon('<path d="m9 18 6-6-6-6"/>'), // chevron-right, turns down when open
  close: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  replace: icon('<path d="M14 4a2 2 0 0 1 2-2M16 10a2 2 0 0 1-2-2M20 2a2 2 0 0 1 2 2M22 8a2 2 0 0 1-2 2M3 7l3 3 3-3M6 10V5a3 3 0 0 1 3-3h1"/><rect x="2" y="14" width="8" height="8" rx="2"/>'), // replace
  replaceAll: icon('<path d="M14 14a2 2 0 0 1 2-2M14 4a2 2 0 0 1 2-2M16 10a2 2 0 0 1-2-2M20 14a2 2 0 0 1 2 2M20 2a2 2 0 0 1 2 2M22 8a2 2 0 0 1-2 2M22 20a2 2 0 0 1-2 2M16 22a2 2 0 0 1-2-2M3 7l3 3 3-3M6 10V5a3 3 0 0 1 3-3h1"/><rect x="2" y="14" width="8" height="8" rx="2"/>'), // replace-all
};
const hasPhysicalKeyboard = (): boolean => !window.matchMedia('(pointer: coarse)').matches;

function scrollTo(view: EditorView, m: Match | null): StateEffect<unknown>[] {
  return m ? [EditorView.scrollIntoView(m.from, { y: 'center' })] : [];
}
function go(view: EditorView, step: 1 | -1): void {
  const s = view.state.field(findField);
  if (!s.query) return;
  const matches = matchesIn(view.state, s.query);
  if (!matches.length) return;
  const anchor = s.current?.from ?? view.state.selection.main.head;
  let index: number;
  if (step > 0) {
    index = matches.findIndex((m) => (s.current ? m.from > anchor : m.from >= anchor));
    if (index < 0) index = 0;
  } else {
    index = -1;
    for (let i = matches.length - 1; i >= 0; i -= 1) if (matches[i].from < anchor) { index = i; break; }
    if (index < 0) index = matches.length - 1;
  }
  view.dispatch({ effects: [setFind.of({ current: matches[index] }), ...scrollTo(view, matches[index])] });
}
function replaceCurrent(view: EditorView, replacement: string): void {
  if (view.state.readOnly) return;
  const s = view.state.field(findField);
  if (!s.current || !isMatch(view.state, s.query, s.current)) { go(view, 1); return; }
  const { from, to } = s.current;
  const insert = expandReplacement(execAt(view.state, s.query, s.current), replacement);
  view.dispatch({ changes: { from, to, insert }, userEvent: 'input.replace' });
  const next = matchFrom(view.state, s.query, from + insert.length);
  view.dispatch({ effects: [setFind.of({ current: next }), ...scrollTo(view, next)] });
}
function replaceEvery(view: EditorView, replacement: string): void {
  if (view.state.readOnly) return;
  const s = view.state.field(findField);
  const matches = matchesIn(view.state, s.query, Infinity);
  if (!matches.length) return;
  view.dispatch({ changes: matches.map((m) => ({ from: m.from, to: m.to, insert: expandReplacement(execAt(view.state, s.query, m), replacement) })), userEvent: 'input.replace.all' });
  view.dispatch({ effects: setFind.of({ current: null }) });
}

// First strong character is Hebrew/Arabic-script (Persian).
const RTL_QUERY = /^[^A-Za-z\u00C0-\u024F\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]*[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

function createPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'document-search-container';
  dom.dataset.ignoreSwipe = '';
  dom.innerHTML = `
    <div class="document-search">
      <button type="button" class="document-search-button clickable-icon document-replace-toggle" data-act="toggle-replace" aria-label="Replace" aria-expanded="false">${ICONS.chevron}</button>
      <div class="search-input-container document-search-input">
        <input type="search" dir="auto" placeholder="Find" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <div class="document-search-count"></div>
      </div>
      <div class="document-search-buttons">
        <button type="button" class="document-search-button clickable-icon" data-act="prev" aria-label="Previous">${ICONS.up}</button>
        <button type="button" class="document-search-button clickable-icon" data-act="next" aria-label="Next">${ICONS.down}</button>
      </div>
      <button type="button" class="document-search-close-button clickable-icon" data-act="close" aria-label="Close">${ICONS.close}</button>
    </div>
    <div class="document-replace">
      <div class="search-input-container document-replace-input">
        <input type="text" dir="auto" placeholder="Replace" enterkeyhint="done" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      </div>
      <div class="document-replace-buttons">
        <button type="button" class="document-search-button clickable-icon" data-act="replace" aria-label="Replace">${ICONS.replace}</button>
        <button type="button" class="document-search-button clickable-icon" data-act="replace-all" aria-label="Replace all">${ICONS.replaceAll}</button>
      </div>
    </div>`;
  const [find, replace] = dom.querySelectorAll<HTMLInputElement>('input');
  const count = dom.querySelector<HTMLElement>('.document-search-count')!;
  let timer: number | undefined;

  const render = (state: EditorState): void => {
    const s = state.field(findField);
    dom.classList.toggle('mod-replace-mode', s.replaceMode);
    const matches = s.query ? matchesIn(state, s.query) : [];
    const index = s.current ? matches.findIndex((m) => m.from === s.current!.from) : -1;
    const invalid = Boolean(s.query) && !searchRegExp(s.query);
    // A right-to-left query (Persian) puts the count on the left, where the
    // text ends, in Persian digits.
    const rtl = RTL_QUERY.test(s.query);
    const digits = (n: number): string => (rtl ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]) : String(n));
    dom.classList.toggle('mod-rtl-query', rtl);
    count.dir = rtl ? 'rtl' : 'ltr';
    count.textContent = invalid ? 'Invalid' : s.query ? `${digits(matches.length ? index + 1 : 0)} / ${digits(matches.length)}` : '';
    count.style.display = s.query ? '' : 'none';
    dom.classList.toggle('mod-no-match', Boolean(s.query) && !matches.length);
    dom.querySelector('[data-act="toggle-replace"]')!.setAttribute('aria-expanded', String(s.replaceMode));
  };
  const search = (): void => {
    window.clearTimeout(timer);
    timer = undefined;
    const query = find.value;
    if (query === view.state.field(findField).query) return;
    // From the caret (the note's selection start), not from the old match.
    const m = matchFrom(view.state, query, view.state.selection.main.from);
    view.dispatch({ effects: [setFind.of({ query, current: m }), ...scrollTo(view, m)] });
  };
  const flush = (): void => { if (timer !== undefined) search(); };
  find.addEventListener('input', () => {
    // The count's side follows the typed text at once, not after the search:
    // otherwise Persian text sat short of the right edge (where the count
    // had been) for a moment before jumping over.
    const rtl = RTL_QUERY.test(find.value);
    dom.classList.toggle('mod-rtl-query', rtl);
    count.dir = rtl ? 'rtl' : 'ltr';
    window.clearTimeout(timer);
    timer = window.setTimeout(search, 150);
  });
  find.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeFind(view); return; }
    if (event.key === 'F3') { event.preventDefault(); flush(); go(view, event.shiftKey ? -1 : 1); return; }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    flush();
    if (event.altKey && (event.ctrlKey || event.metaKey)) { replaceEvery(view, replace.value); return; }
    if (!hasPhysicalKeyboard()) { find.blur(); return; }
    go(view, event.shiftKey ? -1 : 1);
  });
  replace.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeFind(view); return; }
    if (event.key === 'F3') { event.preventDefault(); flush(); go(view, event.shiftKey ? -1 : 1); return; }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    flush();
    if (event.altKey && (event.ctrlKey || event.metaKey)) replaceEvery(view, replace.value);
    else replaceCurrent(view, replace.value);
  });
  // Buttons never take focus from a field, so the keyboard stays as it is.
  dom.addEventListener('mousedown', (event) => {
    if ((event.target as HTMLElement).closest('button')) event.preventDefault();
  });
  dom.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    flush();
    switch (button.dataset.act) {
      case 'prev': go(view, -1); break;
      case 'next': go(view, 1); break;
      case 'toggle-replace': {
        const replaceMode = !view.state.field(findField).replaceMode;
        view.dispatch({ effects: setFind.of({ replaceMode }) });
        if (!replaceMode && document.activeElement === replace) find.focus();
        break;
      }
      case 'replace': replaceCurrent(view, replace.value); break;
      case 'replace-all': replaceEvery(view, replace.value); break;
      case 'close': closeFind(view); break;
    }
  });
  return {
    dom,
    top: true,
    mount() {
      const s = view.state.field(findField);
      find.value = s.query;
      render(view.state);
      (s.replaceMode && s.query ? replace : find).focus();
      if (!(s.replaceMode && s.query)) find.select();
    },
    update(update: ViewUpdate) {
      if (update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setFind)))) {
        const s = update.state.field(findField);
        if (document.activeElement !== find && s.query !== find.value) find.value = s.query;
        render(update.state);
        if (update.transactions.some((tr) => tr.effects.some((e) => e.is(setFind) && e.value.replaceMode))) replace.focus();
      }
    },
    destroy() { window.clearTimeout(timer); },
  };
}

export const findBar: Extension = [findField, findDecorations];

/** Open the bar; with replace = true, with the replace row down. */
export function openFind(view: EditorView, replace = false): void {
  replace = replace && !view.state.readOnly;
  const s = view.state.field(findField);
  // Seed with the selected text (single line), as Obsidian does.
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const query = selected && !selected.includes('\n') ? selected : s.query;
  const current = query ? (selected === query ? { from, to } : matchFrom(view.state, query, from)) : null;
  if (s.open) {
    // Already open: keep the query (seeding is only on opening).
    view.dispatch({ effects: setFind.of({ replaceMode: replace || s.replaceMode }) });
    const input = view.dom.querySelector<HTMLInputElement>(replace ? '.document-replace-input input' : '.document-search-input input');
    input?.focus();
    if (!replace) input?.select();
    return;
  }
  view.dispatch({ effects: [setFind.of({ open: true, replaceMode: replace, query, current }), ...scrollTo(view, current)] });
}

export function closeFind(view: EditorView): void {
  const s = view.state.field(findField);
  if (!s.open) return;
  const panel = view.dom.querySelector('.document-search-container');
  const hadFocus = Boolean(panel && panel.contains(document.activeElement));
  view.dispatch({
    effects: setFind.of({ open: false }),
    ...(hadFocus && s.current ? { selection: EditorSelection.single(s.current.from, s.current.to) } : {}),
  });
  // The keyboard was up (a field had focus): hand it to the note.
  if (hadFocus) view.focus();
}

export const isFindOpen = (state: EditorState): boolean => state.field(findField, false)?.open ?? false;
export function findNext(view: EditorView): void { go(view, 1); }
export function findPrevious(view: EditorView): void { go(view, -1); }
