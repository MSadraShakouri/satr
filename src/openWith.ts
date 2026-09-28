// Android's ACTION_VIEW / ACTION_SEND bridge. The native side keeps a
// ContentResolver URI (or file URI) as the source of truth, so an incoming
// text document is never silently converted into a different vault file.
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface IncomingOpenFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'text' | 'binary' | 'shared-text' | 'too-large';
  readOnly: boolean;
  text?: string;
  dataUrl?: string;
  modified?: number;
}

interface PendingIncoming { available: boolean; id?: string }
interface OpenFilePlugin {
  pending(): Promise<PendingIncoming>;
  open(options: { id: string }): Promise<IncomingOpenFile>;
  readText(options: { id: string }): Promise<{ text: string; modified: number }>;
  writeText(options: { id: string; text: string }): Promise<void>;
  openInOtherApp(options: { id: string }): Promise<void>;
  addListener(event: 'incoming', listener: (event: { id: string }) => void): Promise<{ remove(): Promise<void> }>;
}

const SatrOpenFile = registerPlugin<OpenFilePlugin>('SatrOpenFile');

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

export function readIncomingText(id: string): Promise<{ text: string; modified: number }> {
  return SatrOpenFile.readText({ id });
}

export function writeIncomingText(id: string, text: string): Promise<void> {
  return SatrOpenFile.writeText({ id, text });
}

export function openIncomingInOtherApp(id: string): Promise<void> {
  return SatrOpenFile.openInOtherApp({ id });
}
