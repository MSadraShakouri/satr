import { backend, dirname, ImageNameTakenError, joinPath, type Backend } from './vault';

const extension: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/** A safe, readable name for a picked file. Clipboard images have no reliable
 * original name; they use Image and the same collision suffixes. */
export function imageBaseName(originalName: string): string {
  const leaf = originalName.split(/[\\/]/).pop() ?? '';
  const withoutExtension = leaf.replace(/\.[^.]+$/, '');
  const cleaned = withoutExtension.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, ' ').replace(/^\.+/, '').trim().replace(/[. ]+$/, '');
  const limited = Array.from(cleaned).slice(0, 60).map((character) => {
    const code = character.charCodeAt(0);
    return character.length === 1 && code >= 0xd800 && code <= 0xdfff ? '�' : character;
  }).join('').replace(/[. ]+$/, '');
  if (!limited) return 'Image';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(limited) ? `_${limited}` : limited;
}

function checkNotePath(path: string): void {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid note path');
}
function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}
export interface SavedImage { path: string; markdown: string }

/** Write a new image beside the note, then return its portable Markdown. The
 * caller inserts the returned text only after saving succeeds. The original
 * source file is not involved and can never be overwritten. */
export async function saveImageResource(notePath: string, originalName: string, blob: Blob, signal?: AbortSignal, store: Backend = backend): Promise<SavedImage> {
  checkNotePath(notePath); check(signal);
  const ext = extension[blob.type];
  if (!ext || !blob.size) throw new Error('Unsupported or empty image');
  const dir = joinPath(dirname(notePath), 'res'), base = imageBaseName(originalName);
  const entries = await store.list(dir).catch(() => []);
  const taken = new Set(entries.map((entry) => entry.name.toLocaleLowerCase()));
  for (let index = 0; index < 10_000; index += 1) {
    check(signal);
    const name = `${base}${index ? ` ${index}` : ''}${ext}`;
    if (taken.has(name.toLocaleLowerCase())) continue;
    const path = joinPath(dir, name);
    // RFC 3986 also escapes parentheses, which otherwise close Markdown links.
    // Build the link before writing, so encoding failure cannot orphan a file.
    const encodedName = encodeURIComponent(name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    try {
      await store.createImageBytes(path, blob, signal);
      // The returned link is relative to the note, even for a root-level note.
      return { path, markdown: `![](res/${encodedName})` };
    } catch (error) {
      if (error instanceof ImageNameTakenError) { taken.add(name.toLocaleLowerCase()); continue; }
      throw error;
    }
  }
  throw new Error('Could not find an available image name');
}
