// Spaces, like Obsidian vaults but lighter: a space is just a folder you
// picked, remembered in the app's own settings. Nothing is written into the
// folder. "All files" is the scope with no space: a folder walker over the
// whole storage.
import { basename, DEFAULT_FOLDER, backend } from './vault';

export interface Space { id: string; name: string; path: string }
export type Scope = { kind: 'space'; space: Space } | { kind: 'all' };

const SPACES_KEY = 'satr:spaces';
const SCOPE_KEY = 'satr:scope';
const WALK_KEY = 'satr:walk-dir';

export function loadSpaces(): Space[] {
  try {
    const value = JSON.parse(localStorage.getItem(SPACES_KEY) ?? 'null') as Space[] | null;
    if (Array.isArray(value)) return value.filter((s) => s && typeof s.id === 'string' && typeof s.path === 'string');
  } catch { /* default below */ }
  // First run on the web: the folder earlier notes were moved into.
  const spaces = backend.kind === 'web' ? [{ id: 'notes', name: DEFAULT_FOLDER, path: DEFAULT_FOLDER }] : [];
  saveSpaces(spaces);
  return spaces;
}
function saveSpaces(spaces: Space[]): void {
  localStorage.setItem(SPACES_KEY, JSON.stringify(spaces));
}

export function currentScope(): Scope {
  const spaces = loadSpaces();
  const id = localStorage.getItem(SCOPE_KEY);
  if (id === 'all') return { kind: 'all' };
  const space = spaces.find((s) => s.id === id) ?? spaces[0];
  return space ? { kind: 'space', space } : { kind: 'all' };
}
export function setScope(scope: Scope): void {
  localStorage.setItem(SCOPE_KEY, scope.kind === 'all' ? 'all' : scope.space.id);
}
/** The folder a scope covers ('' = all storage). */
export const scopeRoot = (scope: Scope): string => (scope.kind === 'space' ? scope.space.path : '');
export const scopeName = (scope: Scope): string => (scope.kind === 'space' ? scope.space.name : 'All files');

export function addSpace(path: string): Space {
  const spaces = loadSpaces();
  const existing = spaces.find((s) => s.path === path);
  if (existing) return existing;
  const space = { id: `s${Date.now().toString(36)}`, name: basename(path) || 'Storage', path };
  saveSpaces([...spaces, space]);
  return space;
}
export function removeSpace(id: string): void {
  saveSpaces(loadSpaces().filter((s) => s.id !== id));
}
/** A folder was renamed or moved: spaces inside it follow. */
export function moveSpaces(from: string, to: string): void {
  saveSpaces(loadSpaces().map((s) => {
    if (s.path !== from && !s.path.startsWith(`${from}/`)) return s;
    const path = to + s.path.slice(from.length);
    return { ...s, path, name: s.path === from ? basename(to) : s.name };
  }));
}

export const walkDir = (): string => localStorage.getItem(WALK_KEY) ?? '';
export const setWalkDir = (dir: string): void => localStorage.setItem(WALK_KEY, dir);
