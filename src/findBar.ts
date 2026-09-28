// Find and replace in the note, after Obsidian's mobile document search
// (.document-search-container): a bar across the top of the note, below the
// floating buttons, with the match count inside the search field ("3 / 12"),
// previous / next, a toggle that opens the replace row (Replace, Replace
// all), and options for match case and regular expressions. Built as a
// CodeMirror search panel, so CodeMirror highlights every match and does the
// replacing (one undo step for Replace all).
import {
  closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext,
  search, SearchQuery, setSearchQuery,
} from '@codemirror/search';
import type { EditorState } from '@codemirror/state';
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view';

const icon = (paths: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  up: icon('<path d="m18 15-6-6-6 6"/>'),
  down: icon('<path d="m6 9 6 6 6-6"/>'),
  replace: icon('<path d="M14 4h6v6"/><path d="M20 4 13 11"/><path d="M4 14v6h6"/><path d="m4 20 7-7"/>'),
  close: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
};

/** Matches of the current query, and which one the selection is on (1-based, 0 = none). */
function countMatches(state: EditorState, query: SearchQuery): { total: number; current: number } {
  if (!query.valid || !query.search) return { total: 0, current: 0 };
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state) as Iterator<{ from: number; to: number }>;
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total += 1;
    if (next.value.from === from && next.value.to === to) current = total;
    if (total >= 9999) break;
  }
  return { total, current };
}

function createPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'document-search-container';
  dom.dataset.ignoreSwipe = '';
  dom.innerHTML = `
    <div class="document-search">
      <div class="search-input-wrap">
        <input class="document-search-input" type="search" dir="auto" placeholder="Find…" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <span class="document-search-count"></span>
      </div>
      <div class="document-search-buttons">
        <button type="button" class="document-search-icon" data-act="prev" aria-label="Previous match">${ICONS.up}</button>
        <button type="button" class="document-search-icon" data-act="next" aria-label="Next match">${ICONS.down}</button>
        <button type="button" class="document-search-icon" data-act="replace-mode" aria-label="Replace">${ICONS.replace}</button>
        <button type="button" class="document-search-icon" data-act="close" aria-label="Close">${ICONS.close}</button>
      </div>
    </div>
    <div class="document-replace">
      <input class="document-replace-input" type="text" dir="auto" placeholder="Replace…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      <div class="document-replace-buttons">
        <button type="button" class="document-search-button" data-act="replace">Replace</button>
        <button type="button" class="document-search-button" data-act="replace-all">All</button>
      </div>
    </div>
    <div class="document-search-options">
      <button type="button" class="search-option" data-opt="caseSensitive" aria-pressed="false" title="Match case">Aa</button>
      <button type="button" class="search-option" data-opt="wholeWord" aria-pressed="false" title="Whole word">“ab”</button>
      <button type="button" class="search-option" data-opt="regexp" aria-pressed="false" title="Regular expression">.*</button>
    </div>`;
  const find = dom.querySelector<HTMLInputElement>('.document-search-input')!;
  const replace = dom.querySelector<HTMLInputElement>('.document-replace-input')!;
  const count = dom.querySelector<HTMLElement>('.document-search-count')!;
  const options = { caseSensitive: false, wholeWord: false, regexp: false };

  const initial = getSearchQuery(view.state);
  find.value = initial.search;
  replace.value = initial.replace;
  Object.assign(options, { caseSensitive: initial.caseSensitive, wholeWord: initial.wholeWord, regexp: initial.regexp });

  const commit = (): void => {
    const query = new SearchQuery({ search: find.value, replace: replace.value, ...options });
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) });
  };
  const render = (state: EditorState): void => {
    const query = getSearchQuery(state);
    const { total, current } = countMatches(state, query);
    count.textContent = query.search ? (total ? `${current || '–'} / ${total}` : '0') : '';
    const noMatch = Boolean(query.search) && (!query.valid || total === 0);
    find.classList.toggle('mod-no-match', noMatch);
    for (const button of dom.querySelectorAll<HTMLButtonElement>('.search-option')) {
      button.setAttribute('aria-pressed', String(options[button.dataset.opt as keyof typeof options]));
    }
  };
  find.addEventListener('input', () => {
    commit();
    // Jump to the first match at or after the caret while typing, as Obsidian
    // does: search again from where the current match starts, so each extra
    // letter refines the same hit instead of skipping to the next one.
    if (find.value) {
      const { from } = view.state.selection.main;
      view.dispatch({ selection: { anchor: from } });
      findNext(view);
    }
  });
  replace.addEventListener('input', commit);
  find.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); (event.shiftKey ? findPrevious : findNext)(view); }
    if (event.key === 'Escape') { event.preventDefault(); closeSearchPanel(view); }
  });
  replace.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); replaceNext(view); }
    if (event.key === 'Escape') { event.preventDefault(); closeSearchPanel(view); }
  });
  // Buttons never take focus from the field, so the keyboard stays up.
  dom.addEventListener('mousedown', (event) => {
    if ((event.target as HTMLElement).closest('button')) event.preventDefault();
  });
  dom.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const opt = button.dataset.opt as keyof typeof options | undefined;
    if (opt) { options[opt] = !options[opt]; commit(); render(view.state); return; }
    switch (button.dataset.act) {
      case 'prev': findPrevious(view); break;
      case 'next': findNext(view); break;
      case 'replace-mode':
        dom.classList.toggle('mod-replace-mode');
        button.classList.toggle('is-active', dom.classList.contains('mod-replace-mode'));
        if (dom.classList.contains('mod-replace-mode')) replace.focus();
        else find.focus();
        break;
      case 'replace': replaceNext(view); break;
      case 'replace-all': replaceAll(view); break;
      case 'close': closeSearchPanel(view); break;
    }
  });
  return {
    dom,
    top: true,
    mount() {
      find.focus();
      find.select();
      render(view.state);
    },
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))) {
        const query = getSearchQuery(update.state);
        if (document.activeElement !== find && query.search !== find.value) find.value = query.search;
        render(update.state);
      }
    },
  };
}

export const findBar = search({ top: true, createPanel, scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: 'center' }) });

/** Open the bar; with replace = true the replace row is open too. */
export function openFind(view: EditorView, replace = false): void {
  // Seed with the selected text (single line), as Obsidian does.
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (selected && !selected.includes('\n')) {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...getSearchQuery(view.state), search: selected })) });
  }
  openSearchPanel(view);
  const dom = view.dom.querySelector<HTMLElement>('.document-search-container');
  if (dom && replace && !dom.classList.contains('mod-replace-mode')) {
    dom.querySelector<HTMLButtonElement>('[data-act="replace-mode"]')?.click();
  }
}

export function closeFind(view: EditorView): void { closeSearchPanel(view); }
