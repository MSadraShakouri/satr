// A card belongs to an incarnation of a path, not to the spelling of that
// path forever. An old viewer or an unfinished JPEG must not file over the
// replacement after a delete or move. These guards coordinate this page;
// they do not claim to coordinate separate browser tabs.
import { asideKeys, dropAside } from './webStore';
import { forgetShotsWithin } from './tabCards';

const CARD = 'pdf-card/';
let sequence = 0;
const invalidated = new Map<string, number>();
let pending: Promise<void> = Promise.resolve();

export function cardEpoch(path: string): number {
  let current = invalidated.get('') ?? 0;
  for (let at = path.length; at >= 0;) {
    current = Math.max(current, invalidated.get(path.slice(0, at)) ?? 0);
    at = path.lastIndexOf('/', at - 1);
  }
  return current;
}

export function currentCard(path: string, epoch: number): boolean {
  return cardEpoch(path) === epoch;
}

/** Serialize a card write with subtree deletion, even when encoding yields. */
export function cardOperation<T>(work: () => Promise<T>): Promise<T> {
  const result = pending.then(work);
  pending = result.then(() => undefined, () => undefined);
  return result;
}

/** Queue invalidation immediately, before the caller can destroy its viewer. */
export function forgetPdfCardsWithin(path: string): Promise<void> {
  if (!path) return Promise.resolve();
  invalidated.set(path, ++sequence);
  forgetShotsWithin(path);
  return cardOperation(async () => {
    const keys = await asideKeys();
    const prefix = CARD + path;
    await Promise.all(keys.filter((key) => key === prefix || key.startsWith(prefix + '/')).map((key) => dropAside(key)));
  });
}

/** A recall must not race the queued deletion and see the former occupant. */
export function cardsSettled(): Promise<void> { return pending; }
