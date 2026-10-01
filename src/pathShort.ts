// Folder paths in the drawers, shortened the way powerlevel10k shortens a
// prompt's directory: `POWERLEVEL9K_SHORTEN_STRATEGY=truncate_to_unique`, the
// strategy p10k ships with. Every component but the last is cut back to the
// shortest prefix that no sibling of it shares — p10k's own test of the
// result is that you can paste it into a shell, hit TAB and get the original
// path back — so
//
//     Notes/Uni/Semester 3/Accounting/hw.md
//
// reads as
//
//     Notes/U/Se/Accounting/hw.md
//
// and still means only one folder. Two rules on top of p10k, both asked for:
//
//   - The last component is never shortened. p10k's default keeps one
//     component whole (POWERLEVEL9K_SHORTEN_DIR_LENGTH=1) and the reason is
//     the reader's: the folder a note lives in is the low-level one they are
//     looking for, and it keeps its whole name — "accounting" keeps its name
//     where "documents" above it can be cut.
//   - A component is shortened only when its siblings are actually known.
//     Uniqueness is a claim about the names *around* a folder; where the app
//     cannot list them (above a space's root on the phone, a folder it was
//     never allowed to read) the component stays whole rather than claiming
//     an unambiguity it cannot check.
//   - The row's own root can be kept whole (the `anchor` option): in a search
//     the path is relative to what is being searched, and its first component
//     is that root's own folder — the reader's context, not a folder competing
//     for length. `Notes/Uni/Semester 3/Accounting` reads
//     `Notes/U/Se/Accounting` in a search, and `N/U/Se/Accounting` in a list
//     of real folders (the new tab's recent notes), where every component but
//     the last is cut the same way — which is what p10k prints (`~/st/files/
//     documents/Uni/Semester 3/Accounting`: `storage` cut, the names inside it
//     that were already unique left alone).
//
// Case is folded when comparing (folders on a phone are usually
// case-insensitive), and a name that is already one character is left alone.
// Nothing is marked as shortened: p10k does not mark either, and the reading
// rule is the simple one — a component written in full is a component that
// needed no cutting.
export type Siblings = (dir: string) => readonly string[] | null;

/** The shortest prefix of `name` no other sibling shares; null when even the
 *  whole name would clash (a case-only difference, or a duplicate) — the
 *  caller then keeps the name as it is. */
export function shortestUnique(name: string, siblings: readonly string[] | null): string | null {
  if (!siblings || name.length <= 1) return null;
  const lower = name.toLowerCase();
  for (let n = 1; n <= name.length; n += 1) {
    const prefix = lower.slice(0, n);
    const clash = siblings.some((other) => {
      const otherLower = other.toLowerCase();
      return otherLower !== lower && otherLower.startsWith(prefix);
    });
    if (!clash) return n >= name.length ? null : name.slice(0, n);
  }
  return null;
}

export interface ShortenOptions {
  /** The directory `path` is relative to (empty when `path` is already a chain
   *  from the storage root). Sibling lookups are made with it. */
  base?: string;
  /** Keep the first component whole (see the note at the top). On for the
   *  drawers' rows, whose first component is the root being searched; off for
   *  a plain chain of folders. */
  anchor?: boolean;
}

/** `path` with its components shortened: the last keeps its name — it is the
 *  folder the reader is looking for — and every other one is cut to its
 *  shortest unique prefix, except the first when `anchor` is on. A component
 *  whose siblings the callback doesn't know stays whole. */
export function shortenPath(path: string, siblings: Siblings, options: ShortenOptions = {}): string {
  const base = options.base ?? '';
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return path;
  const out = parts.map((name, index) => {
    if (index === parts.length - 1 || (index === 0 && options.anchor)) return name;
    const parent = parts.slice(0, index).join('/');
    const dir = base ? (parent ? `${base}/${parent}` : base) : parent;
    return shortestUnique(name, siblings(dir)) ?? name;
  });
  return out.join('/');
}

/** A folder's own listing, read when it is needed (the device backend reads
 *  it from the filesystem, so this is not a callback the render can call
 *  synchronously). */
export type NameLookup = (dir: string) => Promise<readonly string[] | null>;

/** `shortenPath` with the sibling names read from the folders themselves, once
 *  per folder. A folder whose listing fails stays unknown, so its components
 *  are left whole rather than cut against names nobody saw. */
export async function shortenPathIn(path: string, names: NameLookup, options: ShortenOptions = {}): Promise<string> {
  const base = options.base ?? '';
  const known = new Map<string, readonly string[] | null>();
  const siblings: Siblings = (dir) => known.get(dir) ?? null;
  const parts = path.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const parent = parts.slice(0, i).join('/');
    const dir = base ? (parent ? `${base}/${parent}` : base) : parent;
    if (known.has(dir)) continue;
    try { known.set(dir, await names(dir)); } catch { known.set(dir, null); }
  }
  return shortenPath(path, siblings, options);
}

export interface SiblingList {
  /** Remember what a directory holds (a listing the caller already did). */
  record(dir: string, names: readonly string[]): void;
  of(dir: string): readonly string[] | null;
}

/** Keeps the sibling names a walk has already seen, so shortening a row costs
 *  nothing more than the walk the drawer is doing anyway. */
export function siblingList(): SiblingList {
  const known = new Map<string, readonly string[]>();
  return {
    record(dir, names) { known.set(dir, names); },
    of(dir) { return known.get(dir) ?? null; },
  };
}
