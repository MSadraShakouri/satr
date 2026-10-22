// Android's ACTION_VIEW / ACTION_SEND bridge. The native side keeps a
// ContentResolver URI (or file URI) as the source of truth, so an incoming
// text document is never silently converted into a different vault file.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface IncomingOpenFile {
  id: string;
  /** Stable, opaque source identity for reading-position preferences only. */
  viewId?: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'text' | 'binary' | 'shared-text' | 'too-large';
  readOnly: boolean;
  /** Decoded, but not as clean UTF-8: shown read-only, rubbish and all. */
  lossy?: boolean;
  text?: string;
  dataUrl?: string;
  modified?: number;
  /** Where the file really is, when the device could say: a path relative to
   *  shared storage, the root the vault browses (android/.../OpenFilePlugin:
   *  a file:// URI, or a document of the device's own storage provider).
   *  Absent for anything reachable only through its provider. */
  vaultPath?: string;
}

interface PendingIncoming { available: boolean; id?: string }
interface OpenFilePlugin {
  pending(): Promise<PendingIncoming>;
  open(options: { id: string }): Promise<IncomingOpenFile>;
  readText(options: { id: string }): Promise<{ text: string; modified: number; lossy: boolean }>;
  writeText(options: { id: string; text: string }): Promise<void>;
  openInOtherApp(options: { id: string }): Promise<void>;
  addListener(event: 'incoming', listener: (event: { id: string }) => void): Promise<{ remove(): Promise<void> }>;
}

const SatrOpenFile = registerPlugin<OpenFilePlugin>('SatrOpenFile');

/** A stable digest of a piece of text, for the identity of shared text. FNV-1a
 *  32-bit: short, deterministic and enough to tell two shared notes apart — the
 *  only thing riding on it is which open tab a hand-over belongs to. */
function textDigest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/** What makes two hand-overs the same thing — the app's answer to "is this
 *  file already open?". `viewId` is the plugin's own identity (a hash of the
 *  source URI) and is the first answer. A file manager is free to vary the URI
 *  between hand-overs (a session parameter, another provider, a different
 *  route to the same file), so the file's own words are a second one: its
 *  name, its size and its modification time. Shared text has no URI at all —
 *  the text itself is its identity, so sharing the same words twice comes back
 *  to the tab that is already showing them. */
export function incomingIdentities(file: IncomingOpenFile): string[] {
  const identities: string[] = [];
  if (file.viewId) identities.push(`source:${file.viewId}`);
  if (file.kind === 'shared-text' && file.text) identities.push(`text:${textDigest(file.text)}`);
  else if (file.modified && file.size >= 0) identities.push(`file:${file.name.toLowerCase()}\u0000${file.size}\u0000${file.modified}`);
  return identities;
}

/** The open path a hand-over is already showing, if any. `known` is what the
 *  app has handed over before (identity → the path it was opened at). */
export function openPathForIdentities(
  identities: readonly string[],
  openPaths: readonly string[],
  known: ReadonlyMap<string, string>,
): string | null {
  for (const identity of identities) {
    const path = known.get(identity);
    if (path && openPaths.includes(path)) return path;
  }
  return null;
}

/** The open tab that is reading the very file just handed over: same name, and
 *  the same modification time to the second. Opening a note from the folders
 *  and being handed the same file by another app are two views of one
 *  document — the tab the app already has is where it should go. A copy
 *  elsewhere has its own time; the same file on the same disk has this one. */
export function openTabForSameFile(
  file: IncomingOpenFile,
  candidates: readonly { path: string; mtime: number }[],
): string | null {
  if (!file.modified || file.kind === 'shared-text') return null;
  const name = file.name.toLowerCase();
  const match = candidates.find((candidate) => candidate.mtime && Math.abs(candidate.mtime - file.modified!) < 1000
    && candidate.path.slice(candidate.path.lastIndexOf('/') + 1).toLowerCase() === name);
  return match ? match.path : null;
}

/** The note this hand-over is, where it is one of the vault's own files:
 *  a path the app can open as an ordinary note — tree row, "Show in files",
 *  the usual saving — instead of the satr-open:// copy. Null for a file only
 *  its provider can reach (Drive, Keep) and for shared text, which is no
 *  file at all. The path is checked for shape here; whether it is really
 *  there is the vault's question, asked before it is used. */
export function incomingVaultPath(file: IncomingOpenFile): string | null {
  if (file.kind === 'shared-text') return null;
  const path = (file.vaultPath ?? '').trim().replace(/\/+$/, '');
  if (!path || path.startsWith('/') || path.includes('://')) return null;
  if (path.split('/').some((part) => part === '..' || part === '.' || !part)) return null;
  return path;
}

export const supportsIncomingFiles = (): boolean => Capacitor.isNativePlatform();

export function onIncomingFile(listener: (id: string) => void): Promise<{ remove(): Promise<void> }> {
  return SatrOpenFile.addListener('incoming', ({ id }) => listener(id));
}

export async function pendingIncomingFile(): Promise<string | null> {
  if (!supportsIncomingFiles()) return null;
  const result = await SatrOpenFile.pending();
  return result.available && result.id ? result.id : null;
}

export function openIncomingFile(id: string): Promise<IncomingOpenFile> {
  return SatrOpenFile.open({ id });
}

export function readIncomingText(id: string): Promise<{ text: string; modified: number; lossy: boolean }> {
  return SatrOpenFile.readText({ id });
}

export function writeIncomingText(id: string, text: string): Promise<void> {
  return SatrOpenFile.writeText({ id, text });
}

export function openIncomingInOtherApp(id: string): Promise<void> {
  return SatrOpenFile.openInOtherApp({ id });
}
