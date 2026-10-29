// Indentation markers inside code, in the editor — the small touch, and
// nothing more than it. A faint vertical line at each level of indentation
// tells you which block a line belongs to without reading it.
//
// Obsidian's rule, copied: it walks the leading run of a line, counts a tab
// or a full group of spaces as one level, steps over a quote's `>` and leaves
// a partial group unmarked. What it does not do is ask whose indentation it
// is, which is why its markers show inside a fenced block as well as in a
// list — and a code file here is a code block, so it gets exactly the same
// treatment. Two differences, both on purpose: Satr marks code only (a list
// already shows its own structure through its markers), and there is no
// brighter "active" guide for the block the caret is in — one line, one
// colour, nothing that moves while you type.
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

const guide = Decoration.mark({ class: 'cm-indent' });

/** The step this code indents by: the smallest indent anyone actually used,
 *  held between 2 and 8. A file written in fours gets a marker per four, one
 *  written in twos a marker per two — rather than a fixed guess that suits
 *  one of them and halves or doubles the other. Enter asks the same question
 *  when it gives a level back (src/enterKey.ts), so a block is walked out of
 *  in the steps its own markers are drawn in. */
export function indentStep(lines: Iterable<string>): number {
  let step = 0;
  for (const text of lines) {
    const spaces = /^ +/.exec(text);
    if (!spaces || spaces[0].length === text.length) continue;
    if (!step || spaces[0].length < step) step = spaces[0].length;
  }
  return Math.min(8, Math.max(2, step || 4));
}

/** Where the markers may be drawn: the whole document when the file itself is
 *  code, otherwise the inside of every fenced block the viewport can see. An
 *  indented code block is left alone — its four spaces are what make it a
 *  block, not an indent of the writer's. */
function codeRanges(view: EditorView, whole: boolean): Array<[number, number]> {
  if (whole) return [[1, view.state.doc.lines]];
  const out: Array<[number, number]> = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'FencedCode') return;
        const first = view.state.doc.lineAt(node.from).number;
        const last = view.state.doc.lineAt(node.to).number;
        if (last > first + 1) out.push([first + 1, last - 1]); // the content, not the fences
      },
    });
  }
  return out;
}

function build(view: EditorView, whole: boolean): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  for (const [first, last] of codeRanges(view, whole)) {
    const texts: string[] = [];
    for (let n = first; n <= last; n += 1) texts.push(doc.line(n).text);
    const step = indentStep(texts);
    for (const block of view.viewportLineBlocks) {
      const line = doc.lineAt(block.from);
      if (line.number < first || line.number > last) continue;
      const lead = /^[\s>]+/.exec(line.text)?.[0] ?? '';
      let at = 0;
      while (at < lead.length) {
        const char = lead.charAt(at);
        if (char === '>') { // a quoted fence: the quote is not an indent
          at += lead.charAt(at + 1) === ' ' ? 2 : 1;
          continue;
        }
        if (char === '\t') {
          builder.add(line.from + at, line.from + at + 1, guide);
          at += 1;
          continue;
        }
        if (char !== ' ') break;
        let run = 0;
        while (run < step && lead.charAt(at + run) === ' ') run += 1;
        if (run === step) builder.add(line.from + at, line.from + at + run, guide);
        at += run; // a partial group is space, not a level
      }
    }
  }
  return builder.finish();
}

/** `isCode` is asked on every rebuild rather than captured, so the same
 *  editor can hold a note now and a code file after the next open. */
export const indentGuides = (isCode: () => boolean): ViewPlugin<{ decorations: DecorationSet }> =>
  ViewPlugin.define((view) => {
    let code = isCode();
    return {
      decorations: build(view, code),
      update(update: ViewUpdate) {
        const now = isCode();
        if (update.docChanged || update.viewportChanged || now !== code) {
          code = now;
          this.decorations = build(update.view, now);
        }
      },
    };
  }, { decorations: (plugin) => plugin.decorations });
