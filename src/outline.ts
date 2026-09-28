// Headings of a note, for the outline in the right sidebar (Obsidian's
// Outline view): level, plain text without the "#" marks, and the 0-based
// source line, from the same Lezer tree the editor uses.
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export interface Heading { level: number; text: string; line: number; from: number }

const HEADING = /^(?:ATX|Setext)Heading([1-6])$/;
const SKIP = /^(Paragraph|FencedCode|CodeBlock|Table|HTMLBlock|LinkReference)$/;

export function collectHeadings(state: EditorState): Heading[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 300) ?? syntaxTree(state);
  const out: Heading[] = [];
  tree.iterate({
    enter: (node) => {
      const match = HEADING.exec(node.name);
      if (!match) return !SKIP.test(node.name);
      const line = state.doc.lineAt(node.from);
      const text = node.name.startsWith('ATX')
        ? line.text.replace(/^\s{0,3}#{1,6}\s*/, '').replace(/\s+#+\s*$/, '')
        : line.text.trim();
      out.push({ level: Number(match[1]), text: text.trim() || '(untitled heading)', line: line.number - 1, from: line.from });
      return false;
    },
  });
  return out;
}
