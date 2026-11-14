import { registerPlugin } from '@capacitor/core';

/** The native side stages bounded chunks privately, then exclusively creates
 * the destination. An interrupted final copy can leave a partial shared file;
 * cancellation before publication removes only the private staging file. */
export interface ImageWriteBridge {
  begin(options: { path: string; size: number; kind?: 'backup' }): Promise<{ token: string }>;
  append(options: { token: string; data: string }): Promise<void>;
  finish(options: { token: string }): Promise<void>;
  abort(options: { token: string }): Promise<void>;
}
const nativeWriter = registerPlugin<ImageWriteBridge>('SatrImageWrite');
export const IMAGE_WRITE_CHUNK = 192 * 1024;
export function validateImageDestination(path: string): void {
  const parts = path.split('/');
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0') || parts.length < 2 || parts[parts.length - 2] !== 'res' || parts.some((part) => !part || part === '.' || part === '..') || !/\.(?:jpg|jpeg|png|webp)$/i.test(parts[parts.length - 1])) throw new Error('Invalid image path');
}
export function validateNoteBackupDestination(path: string): void {
  const parts=path.split('/'),name=parts[parts.length-1];
  if(!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || parts.some(part=>!part||part==='.'||part==='..') || !/^Satr recovery [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/i.test(name)) throw new Error('Invalid recovery path');
}
function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** Exposed separately so the bounded bridge protocol can be tested without a
 * phone. Once finish succeeds, the file is committed even if cancellation
 * arrives while that final native call is already in progress. */
export async function writeNativeImage(path: string, blob: Blob, signal?: AbortSignal, bridge: ImageWriteBridge = nativeWriter): Promise<void> {
  validateImageDestination(path);
  await writeNativeBytes(path,blob,signal,bridge);
}
export async function writeNativeNoteBackup(path:string,text:string,signal?:AbortSignal,bridge:ImageWriteBridge=nativeWriter):Promise<void>{
  validateNoteBackupDestination(path);
  await writeNativeBytes(path,new Blob([text],{type:'text/plain;charset=utf-8'}),signal,bridge,'backup');
}
async function writeNativeBytes(path:string,blob:Blob,signal:AbortSignal|undefined,bridge:ImageWriteBridge,kind?:'backup'):Promise<void>{
  if (!Number.isSafeInteger(blob.size) || blob.size < 1) throw new Error('File has no bytes');
  check(signal);
  const { token } = await bridge.begin(kind ? { path, size: blob.size, kind } : { path, size: blob.size });
  let finished = false;
  try {
    check(signal);
    for (let offset = 0; offset < blob.size; offset += IMAGE_WRITE_CHUNK) {
      const bytes = new Uint8Array(await blob.slice(offset, Math.min(offset + IMAGE_WRITE_CHUNK, blob.size)).arrayBuffer());
      check(signal);
      await bridge.append({ token, data: base64(bytes) });
      check(signal);
    }
    await bridge.finish({ token });
    finished = true;
  } catch (error) {
    if (!finished) {
      try { await bridge.abort({ token }); }
      catch { throw new Error('Could not remove the incomplete image'); }
    }
    throw error;
  }
}
