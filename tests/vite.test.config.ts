// The build the specs run against: the app as it ships, plus tests/support/expose.ts
// so the specs can reach its modules. Written to test-dist/, which is git-ignored.
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import base from '../vite.config';

const exposeHook: Plugin = {
  name: 'satr-test-hook',
  // Exercise the real incoming-file flow with the two native URI calls
  // substituted in the browser. This hook is never in a production build.
  transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return null;
    if (!code.includes('await openIncomingFile(id)') || !code.includes('await readIncomingText(existing.id)')) {
      throw new Error('incoming test hook did not find its native calls');
    }
    const patched = code
      .replace('await openIncomingFile(id)', '(window.__satrIncomingMock ? window.__satrIncomingMock : await openIncomingFile(id))')
      .replace('await readIncomingText(existing.id)', '(window.__satrIncomingMock ? { text: window.__satrIncomingMock.text || "", modified: window.__satrIncomingMock.modified || 0, lossy: Boolean(window.__satrIncomingMock.lossy) } : await readIncomingText(existing.id))');
    return `${patched}\nwindow.__satrIncomingForTest = async (file) => { window.__satrIncomingMock = file; try { await handleIncomingId(file.id); } finally { window.__satrIncomingMock = null; } };`;
  },
  transformIndexHtml: {
    order: 'pre',
    handler: () => [{ tag: 'script', attrs: { type: 'module', src: '/tests/support/expose.ts' }, injectTo: 'body' }],
  },
};

export default mergeConfig(base, defineConfig({
  plugins: [exposeHook],
  build: { outDir: 'test-dist', emptyOutDir: true },
}));
