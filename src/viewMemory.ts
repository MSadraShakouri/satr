// Reading bookmarks persist; CodeMirror undo histories deliberately do not.
// They are kept in src/viewStore.ts (IndexedDB, read into memory at start)
// rather than localStorage: one record per file is unbounded by nature, and
// localStorage is 5 MiB for the whole origin and synchronous on the main
// thread. The reading and writing here is unchanged -- same keys, same
// shapes, same validation of anything read back.
import { dropRecord, readRecord, writeRecord } from './viewStore';

export interface SavedView {
  /** Pixels between the anchor and the top of the line, measured when the
   *  line was read. Without it the line lands a little high every time. */
  gap?: number;
  mode: 'edit' | 'preview';
  line: number;
  cursor?: [number, number];
  folds?: number[];
}
export interface ViewIdentity {
  path: string;
  /** Opaque identity of an Android source URI, not its ephemeral grant id. */
  sourceId?: string;
  temporary?: boolean;
}
const temporaryViews = new Map<string, SavedView>();
export const viewMemoryKey = ({ path, sourceId }: ViewIdentity): string => `satr:view:${sourceId ? `satr-source:${sourceId}` : path}`;

export function readViewMemory(file: ViewIdentity): SavedView | null {
  if (file.temporary) return temporaryViews.get(file.path) ?? null;
  try {
    const value = JSON.parse(readRecord(viewMemoryKey(file)) ?? 'null') as Partial<SavedView> | null;
    if (!value || (value.mode !== 'edit' && value.mode !== 'preview') || !Number.isFinite(value.line)) return null;
    const cursor = Array.isArray(value.cursor) && value.cursor.length === 2 && value.cursor.every((n) => Number.isInteger(n) && n >= 0)
      ? value.cursor as [number, number] : undefined;
    const folds = Array.isArray(value.folds) ? value.folds.filter((n) => Number.isInteger(n) && n >= 0) : undefined;
    // The gap travels with the line or the line is not a place: without it
    // every restore puts the line flush against the anchor, the next read
    // sees the line above, and the note walks backwards a line at a time.
    const gap = typeof value.gap === 'number' && value.gap >= 0 ? Math.min(value.gap, 400) : 0;
    return { mode: value.mode, line: Math.max(0, value.line as number), cursor, folds, ...(gap ? { gap } : {}) };
  } catch { return null; }
}

export function writeViewMemory(file: ViewIdentity, view: SavedView): void {
  if (file.temporary) temporaryViews.set(file.path, view);
  else writeRecord(viewMemoryKey(file), JSON.stringify(view));
}

/** Where a PDF was left: the page, how far into it, and the zoom — kept
 *  against what the document holds (src/pdfView.ts: pdfKey) rather than
 *  where the file sits, which is Gander's rule and for its reasons. A place
 *  written here belongs to the document down every route it is opened by,
 *  and survives it being moved or renamed. */
export interface SavedPlace {
  page: number;
  into: number;
  zoom: number;
  /** How far across the sheet the middle of the screen is, 0 to 1. Absent
   *  on a place written down before a zoomed reader's sideways position
   *  was kept, and absent while a document sits unzoomed at its own width. */
  across?: number;
}
const placeKey = (key: string): string => `satr:place:${key}`;

export function readPlace(key: string): SavedPlace | null {
  try {
    const value = JSON.parse(readRecord(placeKey(key)) ?? 'null') as Partial<SavedPlace> | null;
    if (!value || !Number.isFinite(value.page) || !Number.isFinite(value.zoom)) return null;
    return {
      page: Math.max(1, Math.round(value.page as number)),
      into: Math.min(1, Math.max(0, Number(value.into) || 0)),
      zoom: Math.min(8, Math.max(0.25, value.zoom as number)),
      ...(Number.isFinite(value.across) ? { across: Math.min(1, Math.max(0, value.across as number)) } : {}),
    };
  } catch { return null; }
}

export function writePlace(key: string, place: SavedPlace): void {
  // The first page at the width it opens at is where a document opens
  // anyway: storing that is a line of storage for nothing.
  const middling = place.across == null || Math.abs(place.across - 0.5) < 0.01;
  if (place.page === 1 && place.into < 0.01 && Math.abs(place.zoom - 1) < 0.01 && middling) {
    dropRecord(placeKey(key));
    return;
  }
  writeRecord(placeKey(key), JSON.stringify(place));
}
