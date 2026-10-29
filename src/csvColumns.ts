// The columns of a .csv told apart by colour while it is being edited.
//
// Markor's CsvSyntaxHighlighter (Apache-2.0) does this with nine colours of
// its own; here the colours are the ones the editor already paints code in
// (--code-function and the rest, src/style.css), so a file never introduces a
// palette of its own. Seven of them, cycled: the eighth column starts again
// at the first colour, which is what tells you it has come round rather than
// that two columns are the same.
//
// Line by line, like Markor's own: a field carrying a line break inside its
// quotes is coloured as the lines it is written across. Whole-document
// parsing would be the stricter reading, and on a file of any size it would
// have to be redone on every keystroke to be worth having.
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { csvFields, csvShape } from './csv';

/** One per colour in the code palette. */
const COLUMNS = 7;
const marks = Array.from({ length: COLUMNS }, (_, index) => Decoration.mark({ class: `cm-csv-col-${index}` }));

/** How much of the file the punctuation is read from: the first line with
 *  anything on it is all csvShape() looks at, and this is more than enough to
 *  reach it without slicing a large document on every rebuild. */
const SHAPE_SAMPLE = 4000;

function paint(view: EditorView, name: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const shape = csvShape(view.state.doc.sliceString(0, SHAPE_SAMPLE), name);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      for (const field of csvFields(line.text, shape)) {
        builder.add(line.from + field.from, line.from + field.to, marks[field.column % COLUMNS]);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/** The painter for one file, named so that a .tsv is read as tab-separated
 *  whatever its first line happens to contain. */
export const csvColumns = (name: string): Extension => ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = paint(view, name);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.decorations = paint(update.view, name);
  }
}, { decorations: (plugin) => plugin.decorations });
