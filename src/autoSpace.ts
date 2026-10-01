// A space after a sign: typing ",", "." or "؟" and then going on to the next
// word leaves the space in between — the "auto-space after punctuation" that
// Android's own keyboards do, and that Markor inherits from its EditText.
//
// The research, because the shape of this matters more than the feature:
//
//   * It is the *keyboard*, not the app, that does this on Android (Gboard:
//     Settings ▸ Text correction ▸ Auto-space after punctuation, added in
//     v7.1, and **off by default**). In an EditText the keyboard can read the
//     text around the cursor over the InputConnection; in a WebView it mostly
//     cannot, which is why Obsidian, Markor-in-a-WebView and Satr never show
//     it even with the setting on.
//   * Gboard's own rule is eager — the space lands the moment the sign is
//     typed — and its documented failure is exactly the one that has to be
//     designed around: "it does not recognize (and therefore breaks) URIs …
//     it should only fix the punctuation if it turns out there is actually a
//     space missing". `example.com` becomes `example. com`, `https://…` grows
//     a space after the colon.
//   * SwiftKey and the AOSP keyboards do it too (the AOSP one also *trims* a
//     space typed before a sign: "word ," → "word,". Satr does not do that
//     half — a space typed on purpose is the writer's); iOS's own keyboard
//     does neither.
//
// So this is the lazy variant of the same rule: nothing is inserted at the
// sign, only when the *next* letter is typed and the sign is the character
// before it and there is no space already. The full stop gets one more rule
// of its own, because it is the one sign that is also a hostname's: a
// lower-case Latin letter after it continues a word (`example.com`) and is
// left alone, while a capital begins a sentence and gets the space. Everything the eager rule gets
// wrong is then easy to see: no space when the next character is not a letter
// (`https://` — the "/" answers first, and a ":" is never followed by a space
// then), none after a digit's sign (`3.14`, `1,000`, `12:30` — the sign
// belongs to the number), and none in the middle of an existing word
// (`example.com` being edited). It also cannot double a space the keyboard
// already inserted (that space would be the character before the letter), and
// it never fights the writer — what is typed stays typed, with one space put
// in front of it.
//
// Code is left alone: in a code span or a fenced block a comma is a comma.
//
// And the keyboard's own words are left alone too. While an IME is holding a
// word — the suggestion strip's composition — the space is the keyboard's
// business and nobody else's: a space put into the document from underneath a
// live composition is what a WebView shows as spaces breaking, characters
// repeating and the strip losing the word (an app-side edit during
// `insertCompositionText` and the composition's own text fight over the same
// range). A composed character already carries the keyboard's own spacing in
// the committed text when the keyboard thinks one is owed (the "phantom"
// space of /home/user/phantom-space-research.md is inserted by the IME as part
// of the commit — the app sees two characters arrive, not one), so there is
// nothing left for this rule to add in that case; it steps aside and the
// keyboard is the one Obsidian leaves it to as well (Obsidian has no such code
// at all — its bundle contains no space state of any kind).
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { inCode, inMath } from './mathSource';

/** The signs that end something: sentence punctuation in both scripts. A
 *  digit's own signs (`٫` U+066B, `٬` U+066C, the decimal and thousands
 *  separators) are deliberately not here — those belong to the number. */
export const SIGNS = ',.!?:;،؛؟۔';

const LETTER = /^\p{L}$/u;
const WORD = /^[\p{L}\p{N}]$/u;
/** Digits in both scripts, so `۳٫۱۴` and `3.14` are treated the same. */
const DIGIT = /[0-9\u0660-\u0669\u06f0-\u06f9]/;
/** A colon after one of these is a URL's, not a sentence's. */
const SCHEME = /^(https?|ftp|ftps|file|mailto|tel|data|ssh|git)$/i;
/** A lower-case Latin letter after a full stop continues a word — `example`
 *  + `.` + `com`, `foo.md` — where a capital starts a sentence (or a name) and
 *  a letter of any other script is prose in a language without letter case.
 *  The full stop is the one sign that is also a hostname's, and this is what
 *  tells the two apart without a list of top-level domains to misfire on. */
const CONTINUES_WORD = /[a-z]/;

function wordBefore(state: EditorState, sign: number): string {
  const line = state.doc.lineAt(sign);
  let from = sign;
  while (from > line.from && /\p{L}/u.test(state.sliceDoc(from - 1, from))) from -= 1;
  return state.sliceDoc(from, sign);
}

/** Whether a letter typed at `at` (where `at` is where it is about to go, in
 *  the document as it is now) should get a space in front of it. */
export function spaceAfterSign(state: EditorState, at: number, typed: string): boolean {
  if (at < 2 || at > state.doc.length) return false;
  if (!LETTER.test(typed)) return false; // a digit, a sign or a space answers for itself
  const sign = state.sliceDoc(at - 1, at);
  if (!SIGNS.includes(sign)) return false;
  const prev = state.sliceDoc(at - 2, at - 1);
  if (prev === '' || /\s/.test(prev)) return false; // nothing before the sign, or a space is already there
  if (DIGIT.test(prev)) return false; // 3.14, 1,000, 12:30
  // The reader is typing inside a line: a letter or digit right at the caret
  // means the word continues (`example.com`, `foo.md`).
  if (at < state.doc.length && WORD.test(state.sliceDoc(at, at + 1))) return false;
  if (sign === ':' && SCHEME.test(wordBefore(state, at - 1))) return false;
  if (sign === '.' && CONTINUES_WORD.test(typed)) return false;
  const signAt = at - 1;
  if (inCode(state, signAt)) return false;
  if (inMath(state, signAt)) return false;
  return true;
}

/** Whether an IME is composing right now. `compositionstart` fires before the
 *  first composed character reaches the document and `compositionend` after
 *  the last one, so the window between them is exactly "the keyboard is holding
 *  a word". (CodeMirror's own `input.type.compose` marks the same characters,
 *  but the two disagree about the *final* commit of a composition, so both
 *  answers are read — see the rule below.) */
const setComposing = StateEffect.define<boolean>();
const composing = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setComposing)) return effect.value;
    return value;
  },
});

/** The rule as an editor extension. `on` reads the setting each time, so the
 *  same extension can be reconfigured rather than rebuilt. */
export function autoSpace(on: () => boolean): Extension {
  return [
    composing,
    EditorView.domEventHandlers({
      compositionstart: (_event, view) => { view.dispatch({ effects: setComposing.of(true) }); return false; },
      compositionend: (_event, view) => { view.dispatch({ effects: setComposing.of(false) }); return false; },
    }),
    EditorState.transactionFilter.of((tr) => {
    // NB: a filter that returns an empty array *cancels* the transaction — the
    // keystroke would be swallowed whole. Passing a transaction on is done by
    // returning it.
    if (!on() || !tr.isUserEvent('input.type') || tr.selection === null) return tr;
    // A character an IME is still holding — see the note at the top of the
    // file. Its space, if one is owed, is already in the committed text.
    if (tr.startState.field(composing, false)) return tr;
    if (tr.isUserEvent('input.type.compose')) return tr;
    if (tr.newDoc.length !== tr.startState.doc.length + 1) return tr;
    if (!tr.startState.selection.main.empty) return tr; // typing over a selection is a replacement
    let at = -1;
    let typed = '';
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, insert) => {
      if (fromA !== toA || insert.length !== 1) return;
      at = fromA;
      typed = insert.toString();
    });
    if (at < 0 || !spaceAfterSign(tr.startState, at, typed)) return tr;
    // The space goes in front of the letter that was just typed (the letter's
    // own transaction has already put it at `at`); the caret follows the
    // letter, so it ends up after the space without being moved by hand.
    // `sequential` is what makes the second spec's position refer to the
    // document the first one made — without it the space lands wherever `at`
    // means in the document before the letter, i.e. somewhere else entirely.
    return [tr, { changes: { from: at, insert: ' ' }, sequential: true, userEvent: 'input.type', scrollIntoView: false }];
    }),
  ];
}
