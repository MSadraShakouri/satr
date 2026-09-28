// Storage: notes are files in folders, addressed by '/'-separated paths
// relative to a root ('' is the root itself; no leading or trailing slash).
//
// - Web (browser, dev server): a small virtual file system kept in
//   localStorage. Notes saved by earlier versions (satr:<name>.md) are moved
//   into a "Notes" folder once.
// - Device (the Capacitor app): the phone's shared storage through the
//   Capacitor Filesystem plugin, rooted at /storage/emulated/0, so "All
//   files" shows the real folder tree. Needs @capacitor/filesystem in the
//   native project and the all-files-access permission (APK phase).
//
// Satr never writes anything into a folder besides the notes and folders
// the user creates: no settings folder, no index file. Spaces and view
// state live in the app's own storage.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface Entry {
  path: string;
  name: string;
  kind: 'file' | 'folder';
  mtime: number;
}

export interface Backend {
  readonly kind: 'web' | 'device';
  /** Direct children of a folder. */
  list(dir: string): Promise<Entry[]>;
  read(path: string): Promise<string | null>;
  /** Creates missing parent folders. */
  write(path: string, text: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Files and folders (with everything inside). */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  stat(path: string): Promise<Entry | null>;
  /** A file as a data: URL (images), or null. */
  readDataUrl(path: string): Promise<string | null>;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
};
export const mimeType = (path: string): string => MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
export const dirname = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
export const extension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};
/** File name without the .md extension (the note's title). */
export const stem = (path: string): string => basename(path).replace(/\.(md|markdown)$/i, '');
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt']);
export const isNote = (name: string): boolean => TEXT_EXTENSIONS.has(extension(name));
/** Inside `dir` (or `dir` itself). */
export const within = (path: string, dir: string): boolean => !dir || path === dir || path.startsWith(`${dir}/`);

// ---- Web: virtual file system in localStorage ----
// satr:fs:index = { files: { [path]: mtime }, folders: [path] }
// satr:fs:file:<path> = content
const INDEX_KEY = 'satr:fs:index';
const fileKey = (path: string): string => `satr:fs:file:${path}`;
interface Index { files: Record<string, number>; folders: string[] }

class WebBackend implements Backend {
  readonly kind = 'web' as const;
  private index: Index;

  constructor() {
    this.index = this.load();
  }
  private load(): Index {
    try {
      const value = JSON.parse(localStorage.getItem(INDEX_KEY) ?? 'null') as Index | null;
      if (value && typeof value.files === 'object' && Array.isArray(value.folders)) return value;
    } catch { /* rebuilt below */ }
    return { files: {}, folders: [] };
  }
  private save(): void {
    localStorage.setItem(INDEX_KEY, JSON.stringify(this.index));
  }
  private addFolders(path: string): void {
    for (let dir = dirname(path); dir; dir = dirname(dir)) {
      if (!this.index.folders.includes(dir)) this.index.folders.push(dir);
    }
  }
  private isFolder(path: string): boolean {
    return this.index.folders.includes(path);
  }
  async list(dir: string): Promise<Entry[]> {
    const out = new Map<string, Entry>();
    for (const folder of this.index.folders) {
      if (dirname(folder) === dir && folder !== dir) out.set(folder, { path: folder, name: basename(folder), kind: 'folder', mtime: 0 });
    }
    for (const [path, mtime] of Object.entries(this.index.files)) {
      if (dirname(path) === dir) out.set(path, { path, name: basename(path), kind: 'file', mtime });
    }
    return [...out.values()];
  }
  readSync(path: string): string | null {
    return path in this.index.files ? localStorage.getItem(fileKey(path)) ?? '' : null;
  }
  async read(path: string): Promise<string | null> {
    return this.readSync(path);
  }
  /** The web version keeps text only; an image stored as a data: URL works. */
  async readDataUrl(path: string): Promise<string | null> {
    const value = this.readSync(path);
    return value && value.startsWith('data:') ? value : null;
  }
  writeSync(path: string, text: string): void {
    localStorage.setItem(fileKey(path), text);
    this.index.files[path] = Date.now();
    this.addFolders(path);
    this.save();
  }
  async write(path: string, text: string): Promise<void> {
    this.writeSync(path, text);
  }
  async mkdir(path: string): Promise<void> {
    if (!this.isFolder(path)) this.index.folders.push(path);
    this.addFolders(path);
    this.save();
  }
  async rename(from: string, to: string): Promise<void> {
    if (from === to) return;
    if (await this.stat(to)) throw new Error('Something with that name already exists');
    if (from in this.index.files) {
      const text = localStorage.getItem(fileKey(from)) ?? '';
      localStorage.setItem(fileKey(to), text);
      localStorage.removeItem(fileKey(from));
      this.index.files[to] = this.index.files[from];
      delete this.index.files[from];
      this.addFolders(to);
    } else if (this.isFolder(from)) {
      const move = (path: string): string => to + path.slice(from.length);
      for (const path of Object.keys(this.index.files)) {
        if (!within(path, from)) continue;
        localStorage.setItem(fileKey(move(path)), localStorage.getItem(fileKey(path)) ?? '');
        localStorage.removeItem(fileKey(path));
        this.index.files[move(path)] = this.index.files[path];
        delete this.index.files[path];
      }
      this.index.folders = this.index.folders.map((f) => (within(f, from) ? move(f) : f));
      this.addFolders(to);
    } else {
      throw new Error('Not found');
    }
    this.save();
  }
  async remove(path: string): Promise<void> {
    for (const file of Object.keys(this.index.files)) {
      if (!within(file, path)) continue;
      localStorage.removeItem(fileKey(file));
      delete this.index.files[file];
    }
    this.index.folders = this.index.folders.filter((f) => !within(f, path));
    this.save();
  }
  async stat(path: string): Promise<Entry | null> {
    if (path in this.index.files) return { path, name: basename(path), kind: 'file', mtime: this.index.files[path] };
    if (!path || this.isFolder(path)) return { path, name: basename(path), kind: 'folder', mtime: 0 };
    return null;
  }

  /**
   * Earlier versions kept notes flat as satr:<name>.md, the open one as
   * satr:file-name and view state as satr:view:<name>. Move them into the
   * "Notes" folder. Returns the path of the note that was open, if any.
   */
  migrate(folder: string): string | null {
    const old: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)!;
      if (key.startsWith('satr:') && key.endsWith('.md') && !key.startsWith('satr:view:') && !key.startsWith('satr:fs:')) old.push(key);
    }
    const openName = localStorage.getItem('satr:file-name');
    if (!old.length && openName === null) return null;
    for (const key of old) {
      const name = key.slice(5, -3);
      const path = joinPath(folder, `${name}.md`);
      if (!(path in this.index.files)) {
        localStorage.setItem(fileKey(path), localStorage.getItem(key) ?? '');
        this.index.files[path] = Date.now();
      }
      localStorage.removeItem(key);
      const view = localStorage.getItem(`satr:view:${name}`);
      if (view !== null) {
        localStorage.setItem(`satr:view:${path}`, view);
        localStorage.removeItem(`satr:view:${name}`);
      }
    }
    localStorage.removeItem('satr:file-name');
    if (!this.isFolder(folder)) this.index.folders.push(folder);
    this.save();
    return openName !== null ? joinPath(folder, `${openName}.md`) : null;
  }
}

// ---- Device: Capacitor Filesystem, shared storage ----
interface FsFileInfo { name: string; type: 'file' | 'directory'; mtime?: number; size?: number }
interface FilesystemPlugin {
  readdir(o: { path: string; directory: string }): Promise<{ files: FsFileInfo[] }>;
  readFile(o: { path: string; directory: string; encoding?: string }): Promise<{ data: string }>;
  writeFile(o: { path: string; directory: string; encoding: string; data: string; recursive: boolean }): Promise<unknown>;
  mkdir(o: { path: string; directory: string; recursive: boolean }): Promise<void>;
  rename(o: { from: string; to: string; directory: string; toDirectory: string }): Promise<void>;
  deleteFile(o: { path: string; directory: string }): Promise<void>;
  rmdir(o: { path: string; directory: string; recursive: boolean }): Promise<void>;
  stat(o: { path: string; directory: string }): Promise<{ type: 'file' | 'directory'; mtime?: number }>;
}
const EXTERNAL = 'EXTERNAL_STORAGE';

class DeviceBackend implements Backend {
  readonly kind = 'device' as const;
  private fs = registerPlugin<FilesystemPlugin>('Filesystem');

  async list(dir: string): Promise<Entry[]> {
    const { files } = await this.fs.readdir({ path: dir || '/', directory: EXTERNAL });
    return files.map((f) => ({
      path: joinPath(dir, f.name),
      name: f.name,
      kind: f.type === 'directory' ? 'folder' as const : 'file' as const,
      mtime: f.mtime ?? 0,
    }));
  }
  async read(path: string): Promise<string | null> {
    try {
      return (await this.fs.readFile({ path, directory: EXTERNAL, encoding: 'utf8' })).data;
    } catch {
      return null;
    }
  }
  async readDataUrl(path: string): Promise<string | null> {
    try {
      // Without an encoding the plugin returns the bytes as base64.
      const { data } = await this.fs.readFile({ path, directory: EXTERNAL });
      return `data:${mimeType(path)};base64,${data}`;
    } catch {
      return null;
    }
  }
  async write(path: string, text: string): Promise<void> {
    await this.fs.writeFile({ path, directory: EXTERNAL, encoding: 'utf8', data: text, recursive: true });
  }
  async mkdir(path: string): Promise<void> {
    await this.fs.mkdir({ path, directory: EXTERNAL, recursive: true });
  }
  async rename(from: string, to: string): Promise<void> {
    if (from === to) return;
    if (await this.stat(to)) throw new Error('Something with that name already exists');
    await this.fs.rename({ from, to, directory: EXTERNAL, toDirectory: EXTERNAL });
  }
  async remove(path: string): Promise<void> {
    const entry = await this.stat(path);
    if (!entry) return;
    if (entry.kind === 'folder') await this.fs.rmdir({ path, directory: EXTERNAL, recursive: true });
    else await this.fs.deleteFile({ path, directory: EXTERNAL });
  }
  async stat(path: string): Promise<Entry | null> {
    try {
      const s = await this.fs.stat({ path: path || '/', directory: EXTERNAL });
      return { path, name: basename(path), kind: s.type === 'directory' ? 'folder' : 'file', mtime: s.mtime ?? 0 };
    } catch {
      return null;
    }
  }
}

export const DEFAULT_FOLDER = 'Notes';
const web = Capacitor.isNativePlatform() ? null : new WebBackend();
export const backend: Backend = web ?? new DeviceBackend();
/** Web only: synchronous write, for saving while the page is being hidden. */
export function writeNow(path: string, text: string): void {
  if (web) web.writeSync(path, text);
  else void backend.write(path, text);
}
/** Web only: move notes from earlier versions into the default folder. */
export function migrateOldNotes(): string | null {
  return web ? web.migrate(DEFAULT_FOLDER) : null;
}

/** Every note (md/txt) under `dir`, depth-first, at most `limit`. */
export async function walkNotes(dir: string, limit = 2000): Promise<string[]> {
  const out: string[] = [];
  const queue = [dir];
  while (queue.length && out.length < limit) {
    let entries: Entry[];
    try { entries = await backend.list(queue.shift()!); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.path === 'Android') continue; // the phone's app data, never notes
      if (entry.kind === 'folder') queue.push(entry.path);
      else if (isNote(entry.name)) out.push(entry.path);
    }
  }
  return out.slice(0, limit);
}

/** The first file named `name` (any case) under `dir`, breadth-first, as
 *  Obsidian finds ![[embeds]] by name anywhere in the vault. */
export async function findFileByName(name: string, dir = '', limit = 5000): Promise<string | null> {
  const wanted = name.toLowerCase();
  const queue = [dir];
  let seen = 0;
  while (queue.length && seen < limit) {
    let entries: Entry[];
    try { entries = await backend.list(queue.shift()!); } catch { continue; }
    for (const entry of entries) {
      seen += 1;
      if (entry.name.startsWith('.') || entry.path === 'Android') continue;
      if (entry.kind === 'folder') queue.push(entry.path);
      else if (entry.name.toLowerCase() === wanted) return entry.path;
    }
  }
  return null;
}

/** A name not taken in `dir`: "Untitled.md", "Untitled 1.md", … */
export async function freeName(dir: string, base: string, ext = ''): Promise<string> {
  const taken = new Set((await backend.list(dir).catch(() => [] as Entry[])).map((e) => e.name.toLowerCase()));
  let name = `${base}${ext}`;
  for (let i = 1; taken.has(name.toLowerCase()); i += 1) name = `${base} ${i}${ext}`;
  return name;
}
