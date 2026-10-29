// Reading bookmarks persist; CodeMirror undo histories deliberately do not.
export interface SavedView {
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
    const value = JSON.parse(localStorage.getItem(viewMemoryKey(file)) ?? 'null') as Partial<SavedView> | null;
    if (!value || (value.mode !== 'edit' && value.mode !== 'preview') || !Number.isFinite(value.line)) return null;
    const cursor = Array.isArray(value.cursor) && value.cursor.length === 2 && value.cursor.every((n) => Number.isInteger(n) && n >= 0)
      ? value.cursor as [number, number] : undefined;
    const folds = Array.isArray(value.folds) ? value.folds.filter((n) => Number.isInteger(n) && n >= 0) : undefined;
    return { mode: value.mode, line: Math.max(0, value.line as number), cursor, folds };
  } catch { return null; }
}

export function writeViewMemory(file: ViewIdentity, view: SavedView): void {
  if (file.temporary) temporaryViews.set(file.path, view);
  else localStorage.setItem(viewMemoryKey(file), JSON.stringify(view));
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
}
const placeKey = (key: string): string => `satr:place:${key}`;

export function readPlace(key: string): SavedPlace | null {
  try {
    const value = JSON.parse(localStorage.getItem(placeKey(key)) ?? 'null') as Partial<SavedPlace> | null;
    if (!value || !Number.isFinite(value.page) || !Number.isFinite(value.zoom)) return null;
    return {
      page: Math.max(1, Math.round(value.page as number)),
      into: Math.min(1, Math.max(0, Number(value.into) || 0)),
      zoom: Math.min(8, Math.max(0.25, value.zoom as number)),
    };
  } catch { return null; }
}

export function writePlace(key: string, place: SavedPlace): void {
  // The first page at the width it opens at is where a document opens
  // anyway: storing that is a line of storage for nothing.
  if (place.page === 1 && place.into < 0.01 && Math.abs(place.zoom - 1) < 0.01) {
    localStorage.removeItem(placeKey(key));
    return;
  }
  localStorage.setItem(placeKey(key), JSON.stringify(place));
}
