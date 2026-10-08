// Test-only. Loaded by the test build (tests/vite.test.config.ts), never by the
// shipped app. The specs run in the page with page.evaluate and need the app's
// own modules, not copies: this bundle is the one the app runs from, so every
// module handed out here is the same instance the app uses.
//
// Use it as: const { SatrEditor } = await window.__satr.load('/src/editor.ts');
// The path is the source path the specs always used. A node_modules path
// reaches the CodeMirror view that the app bundles.
import * as cmView from '@codemirror/view';

// Every module in src/ except main.ts, which starts the app when it loads.
const sources = import.meta.glob(['../../src/*.ts', '!../../src/main.ts', '!../../src/*.d.ts'], { eager: true }) as Record<string, Record<string, unknown>>;

const byName = new Map<string, Record<string, unknown>>();
for (const [key, mod] of Object.entries(sources)) byName.set(key.split('/').pop() as string, mod);

function load(path: string): Record<string, unknown> {
  if (path.startsWith('/node_modules/@codemirror/view/')) return cmView as unknown as Record<string, unknown>;
  const name = path.split('/').pop() as string;
  const mod = byName.get(name);
  if (!mod) throw new Error(`satr test hook: no module for ${path}`);
  return mod;
}

(window as unknown as { __satr: { load: typeof load } }).__satr = { load };
