// What Satr can do with a file, from its name alone — which is all the file
// list has to go on, and all the editor needs before it reads a byte.
//
// The distinction the reader cares about is not "is this Markdown" but "will
// this open as itself". A .json, a .py and a .patch are edited here as well
// as a note is; a PDF or a zip is not, and that is what the dim in the file
// list means now. Obsidian draws the same line in the same place (its file
// explorer marks a row `is-unsupported` when no view is registered for the
// extension) — it simply has far fewer extensions on the open side.
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { extension, mimeType } from './vault';

export type FileKind =
  | 'note' // Markdown: Satr's own format, the reading view, the PDF
  | 'page' // .html: shown as the page it is
  | 'code' // a language the editor can colour and indent
  | 'text' // plain text with no grammar behind it
  | 'picture' // shown, not edited
  | 'document' // a PDF: read here, page by page, not edited
  | 'none'; // nothing yet: an archive, bytes

/** Plain text that no grammar describes: a log, a CSV, a licence. A file with
 *  no extension at all is text too — a `LICENSE`, a `Makefile` — since the
 *  only thing it can be opened as here is its own characters. */
const PLAIN = new Set([
  'txt', 'text', 'log', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'env', 'properties',
  'patch', 'diff', 'srt', 'vtt', 'bib', 'tex', 'adoc', 'rst', 'org', 'me', 'nfo',
]);

/** The language the editor should use for this file, or null when markdown's
 *  parser is the right one (a note) and when there is no grammar to use. The
 *  grammar itself is loaded only if this file is opened: @codemirror/language-data
 *  holds descriptions, and Vite gives each parser its own chunk. */
export const codeLanguage = (name: string): LanguageDescription | null =>
  LanguageDescription.matchFilename(languages, name.toLowerCase());

export function fileKind(name: string): FileKind {
  const ext = extension(name);
  if (ext === 'md' || ext === 'markdown') return 'note';
  if (/^x?html?$/.test(ext)) return 'page';
  if (mimeType(name).startsWith('image/')) return 'picture';
  if (ext === 'pdf') return 'document';
  if (PLAIN.has(ext) || ext === '') return 'text';
  return codeLanguage(name) ? 'code' : 'none';
}

/** A file the editor opens as text of some kind — a note, a page, code, or
 *  plain characters. Everything else is shown rather than written. */
export const isEditableFile = (name: string): boolean => {
  const kind = fileKind(name);
  return kind !== 'picture' && kind !== 'document' && kind !== 'none';
};
