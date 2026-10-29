// Code in the reading view, painted by the editor's own highlighter.
//
// There used to be two of them: Lezer in the editor, highlight.js in the
// page, and a --code-* palette each was mapped onto by hand. Two highlighters
// cannot agree, and did not. highlight.js's common bundle knows 36 languages
// against @codemirror/language-data's 150-odd, so a fence written in toml,
// dart, scala, powershell or latex was fully coloured while writing and flat
// grey when read; and inside the 36 they still disagreed token by token —
// hljs painted a parameter that Lezer left alone, Lezer painted a `*` that
// hljs left alone.
//
// So the page runs the editor's highlighter instead. The same grammar, the
// same tags, the same table of colours below — the two views now agree by
// construction rather than by maintenance. The grammars load on demand, as
// they do in the editor (and as Obsidian's do), so a block appears in plain
// text for the moment its language takes to arrive.
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightCode, tagHighlighter, tags, type Tag } from '@lezer/highlight';
import type { Parser } from '@lezer/common';

/** The one table of code colours. The editor builds a CodeMirror
 *  HighlightStyle out of it (src/editor.ts), the reading view and the PDF
 *  build class names out of it, and both end at the same --code-* variable:
 *  `keyword` here is `var(--code-keyword)` there and `.tok-keyword` in the
 *  page's stylesheet.
 *
 *  Only kinds a code grammar emits are listed. Punctuation, brackets,
 *  operators and bare identifiers are deliberately left in the text colour,
 *  so `const greeting = "hello";` is three colours rather than six. */
export const CODE_COLOURS: Array<{ name: string; tags: Tag[] }> = [
  { name: 'comment', tags: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment] },
  { name: 'keyword', tags: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.modifier, tags.self, tags.null, tags.typeName, tags.namespace] },
  { name: 'string', tags: [tags.string, tags.special(tags.string), tags.regexp, tags.character, tags.inserted] },
  { name: 'value', tags: [tags.number, tags.bool, tags.atom, tags.literal, tags.unit] },
  { name: 'function', tags: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.function(tags.definition(tags.variableName)), tags.className, tags.macroName] },
  { name: 'property', tags: [tags.propertyName, tags.attributeName, tags.labelName, tags.self] },
  { name: 'tag', tags: [tags.tagName, tags.deleted] },
  { name: 'important', tags: [tags.meta, tags.annotation, tags.standard(tags.variableName)] },
];

/** The page's painter: the same tags, written as class names. */
const painter = tagHighlighter(CODE_COLOURS.map(({ name, tags: kinds }) => ({ tag: kinds, class: `tok-${name}` })));

// One load per language for the life of the page, shared by every block that
// asks for it — and by the PDF, which is rendered from the same module.
const grammars = new Map<string, Promise<Parser | null>>();
function grammarFor(name: string): Promise<Parser | null> {
  const key = name.toLowerCase();
  let found = grammars.get(key);
  if (!found) {
    const description = LanguageDescription.matchLanguageName(languages, key, true);
    found = description
      ? description.load().then((support) => support.language.parser).catch(() => null)
      : Promise.resolve(null);
    grammars.set(key, found);
  }
  return found;
}

/** Paint one block: its tokens, in the palette. */
function paint(code: HTMLElement, text: string, parser: Parser): void {
  const out = document.createDocumentFragment();
  highlightCode(text, parser.parse(text), painter, (piece, kind) => {
    if (!kind) { out.append(document.createTextNode(piece)); return; }
    const span = document.createElement('span');
    span.className = kind;
    span.textContent = piece;
    out.append(span);
  }, () => out.append(document.createTextNode('\n')));
  code.replaceChildren(out);
}

/** Every fenced block under `root`, painted. Awaited by the PDF export, left
 *  to settle on its own in the reading view. Blocks whose text has changed
 *  while a grammar loaded are left to the render that replaced them. */
export async function highlightCodeBlocks(root: ParentNode): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre > code')];
  await Promise.all(blocks.map(async (code) => {
    const text = code.textContent ?? '';
    const language = code.dataset.lang;
    const parser = language ? await grammarFor(language) : null;
    if (!parser || (code.textContent ?? '') !== text) return;
    paint(code, text, parser);
  }));
}
