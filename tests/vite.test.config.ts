// The build the specs run against: the app as it ships, plus tests/support/expose.ts
// so the specs can reach its modules. Written to test-dist/, which is git-ignored.
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import base from '../vite.config';

const exposeHook: Plugin = {
  name: 'satr-test-hook',
  transformIndexHtml: {
    order: 'pre',
    handler: () => [{ tag: 'script', attrs: { type: 'module', src: '/tests/support/expose.ts' }, injectTo: 'body' }],
  },
};

export default mergeConfig(base, defineConfig({
  plugins: [exposeHook],
  build: { outDir: 'test-dist', emptyOutDir: true },
}));
