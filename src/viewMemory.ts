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
