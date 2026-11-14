import { markdownLanguage } from '@codemirror/lang-markdown';
import { dirname, joinPath } from './vault';

/** Normalize the same relative paths that the reading view resolves. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return parts.join('/');
}
function relative(from: string, target: string): string {
  const source = from ? from.split('/') : [], destination = target.split('/');
  let common = 0;
  while (common < source.length && common < destination.length && source[common] === destination[common]) common += 1;
  return [...source.slice(common).map(() => '..'), ...destination.slice(common)]
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}
export interface ImageLinkChange { from: number; to: number; insert: string }

/** Rewrite only inline Markdown image destinations whose original relative
 * file actually exists. Other links, code, remote URLs and root paths keep
 * their text. The caller must coordinate the resulting text with the move and
 * any open editor: this function itself never changes a file or an image. */
export async function movedImageLinkChanges(text: string, from: string, to: string, exists: (path: string) => Promise<boolean>): Promise<ImageLinkChange[]> {
  if (dirname(from) === dirname(to)) return [];
  const urls: { from: number; to: number }[] = [];
  markdownLanguage.parser.parse(text).iterate({ enter(node) {
    if (node.name === 'URL' && node.node.parent?.name === 'Image') urls.push({ from: node.from, to: node.to });
  } });
  const checks = new Map<string, Promise<boolean>>(), replacements: ImageLinkChange[] = [];
  for (const url of urls) {
    const raw = text.slice(url.from, url.to), bracketed = raw.startsWith('<') && raw.endsWith('>');
    const value = bracketed ? raw.slice(1, -1) : raw;
    const boundary = value.search(/[?#]/), pathPart = boundary < 0 ? value : value.slice(0, boundary);
    const suffix = boundary < 0 ? '' : value.slice(boundary);
    if (!pathPart || pathPart.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(pathPart)) continue;
    let decoded: string;
    try { decoded = decodeURIComponent(pathPart.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1')); }
    catch { continue; }
    if (decoded.startsWith('/')) continue;
    const target = normalize(joinPath(dirname(from), decoded));
    if (!checks.has(target)) checks.set(target, exists(target));
    if (!await checks.get(target)) continue;
    const updated = relative(dirname(to), target) + suffix;
    replacements.push({ ...url, insert: bracketed ? `<${updated}>` : updated });
  }
  return replacements;
}
function applyImageLinkChanges(text:string,changes:ImageLinkChange[]):string {
  let result=text;
  for(let i=changes.length-1;i>=0;i--){const c=changes[i];result=result.slice(0,c.from)+c.insert+result.slice(c.to);}
  return result;
}
export async function rewriteMovedImageLinks(text:string,from:string,to:string,exists:(path:string)=>Promise<boolean>):Promise<string>{
  return applyImageLinkChanges(text,await movedImageLinkChanges(text,from,to,exists));
}

export interface ImageNoteMoveStore {
  read(path:string):Promise<string|null>;
  stat(path:string):Promise<{kind:'file'|'folder'}|null>;
  rename(from:string,to:string):Promise<void>;
  write(path:string,text:string):Promise<void>;
  createNoteBackup(path:string,text:string):Promise<void>;
  remove(path:string):Promise<void>;
}
export interface ImageNoteMoveResult {original:string;rewritten:string;changes:ImageLinkChange[];warning?:string}

/** Move one Markdown note while leaving its images in place. A create-only
 * recovery copy is verified before any note is moved or rewritten. A failed
 * rewrite preserves both that copy and any changed destination bytes. */
export async function moveMarkdownWithImages(store:ImageNoteMoveStore,from:string,to:string):Promise<ImageNoteMoveResult>{
  const original=await store.read(from);if(original===null)throw new Error('The note could not be read');
  const changes=await movedImageLinkChanges(original,from,to,async path=>(await store.stat(path))?.kind==='file');
  const rewritten=applyImageLinkChanges(original,changes);
  if(await store.read(from)!==original)throw new Error('The note changed while it was being moved');
  if(rewritten===original){await store.rename(from,to);return {original,rewritten,changes};}
  const backup=joinPath(dirname(from),`Satr recovery ${crypto.randomUUID()}.md`);
  await store.createNoteBackup(backup,original);
  if(await store.read(backup)!==original)throw new Error(`Could not verify the recovery copy at ${backup}; the original note was not moved.`);
  if(await store.read(from)!==original)throw new Error(`The note changed while it was being moved. A recovery copy is at ${backup}.`);
  try{await store.rename(from,to);}catch(error){
    // A bridge error need not prove whether the rename happened. Remove the
    // backup only when the original bytes are still present at the source.
    if(await store.read(from).catch(()=>null)===original){
      try{await store.remove(backup);}catch{/* the recovery copy remains */}
      throw error;
    }
    throw new Error(`Could not confirm the move. A recovery copy is at ${backup}. ${error instanceof Error?error.message:String(error)}`);
  }
  let attemptedWrite=false;
  try{
    if(await store.read(to)!==original)throw new Error('The moved note changed before its links were updated');
    attemptedWrite=true;await store.write(to,rewritten);
    if(await store.read(to)!==rewritten)throw new Error('Could not verify the updated note');
  }catch(error){
    try{
      if(await store.stat(from))throw new Error('The original location is occupied');
      if(attemptedWrite){
        const extra=joinPath(dirname(to),`Satr recovery ${crypto.randomUUID()}.md`);
        await store.rename(to,extra); // preserve partial or independently changed bytes
        await store.rename(backup,from); // verified original, never overwrite
        throw new Error(`The original note was restored. Another copy remains at ${extra}. ${error instanceof Error?error.message:String(error)}`);
      }
      // Somebody changed the moved note before our write. Preserve that newer
      // version and leave the original backup as a separate recovery copy.
      await store.rename(to,from);
      throw new Error(`${error instanceof Error?error.message:String(error)}. A recovery copy is at ${backup}.`);
    }catch(recovery){
      if(recovery instanceof Error && (recovery.message.startsWith('The original note was restored.') || recovery.message.includes('A recovery copy is at')))throw recovery;
      throw new Error(`The note could not be restored automatically. Check ${to} and the recovery copy at ${backup}: ${recovery instanceof Error?recovery.message:String(recovery)}`);
    }
  }
  try{await store.remove(backup);}catch{return {original,rewritten,changes,warning:`A recovery copy remains at ${backup}.`};}
  return {original,rewritten,changes};
}
