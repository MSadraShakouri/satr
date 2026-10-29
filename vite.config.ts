import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize } from 'node:path';
import { createReadStream } from 'node:fs';

/**
 * pdf.js keeps three things outside its own bundle, and every one of them
 * fails silently when it cannot be fetched: the CMap tables (CJK text draws
 * nothing), the standard font data (a document that embeds no font draws
 * with the wrong metrics), and the wasm image decoders (JPEG 2000 and JBIG2
 * images are left out — which is most of what a scanned page is made of).
 * Obsidian serves all three from /lib/pdfjs/; Satr serves them from /pdfjs/,
 * out of the installed package, in dev and in every build.
 */
function pdfjsAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const parts = ['cmaps', 'standard_fonts', 'wasm'];
  return {
    name: 'satr-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0];
        if (!path.startsWith('/pdfjs/')) return next();
        // normalize first: a request may not climb out of the package
        const inside = normalize(path.slice('/pdfjs/'.length));
        if (inside.startsWith('..') || !parts.some((part) => inside.startsWith(part))) return next();
        const file = join(root, inside);
        if (!existsSync(file)) return next();
        createReadStream(file).pipe(response);
        return undefined;
      });
    },
    closeBundle() {
      const out = this.environment?.config?.build?.outDir ?? 'dist';
      for (const part of parts) cpSync(join(root, part), join(out, 'pdfjs', part), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [pdfjsAssets()],
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  build: {
    // Everything we author is under 500 kB now. The one file above it is
    // pagedjs's vendored polyfill (505 kB), which is read as text and only
    // when a PDF is exported — so the tripwire sits just over it and still
    // fires the moment OUR code grows.
    chunkSizeWarningLimit: 520,
    rollupOptions: {
      output: {
        // Those on-demand grammars are each a package's own dist/index.js, so
        // Rollup would call every one of them index-<hash>.js. Named after
        // the package instead, a build says which language costs what.
        chunkFileNames(chunk): string {
          if (chunk.name === 'index' && !chunk.isEntry) {
            const inside = chunk.moduleIds.find((id) => id.includes('node_modules'));
            const pkg = inside ? /node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/.exec(inside)?.[1] : undefined;
            if (pkg) return `assets/${pkg.replace(/^@(codemirror|lezer)[\\/]/, '').replace(/[@\\/]/g, '-')}-[hash].js`;
          }
          return 'assets/[name]-[hash].js';
        },
        // One 1.4 MB file meant the phone parsed the editor, the maths and
        // the highlighter before it could show a line of text, and any
        // change to any of them invalidated the whole download. They are
        // independent libraries that never change together: give each its
        // own file. The app's own code stays in the entry chunk.
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('katex')) return 'katex';
          if (id.includes('highlight.js')) return 'highlight';
          // A code fence's language is fetched the first time a fence asks
          // for it. Those packages are left unnamed on purpose: Rollup then
          // chunks them at the dynamic import @codemirror/language-data
          // makes, each grammar in its own file. Naming them here instead
          // put 143 grammars (640 kB) in front of the first line of text
          // when they were swept into the editor's chunk, and split the
          // libraries into chunks that initialise each other when they were
          // named one by one. Markdown itself and the `stex` mode the math
          // source is coloured with are not on demand: they are what the
          // editor opens with, and they stay in the chunks below.
          if (/[\\/]@codemirror[\\/]lang-(?!markdown)/.test(id)) return undefined;
          if (/[\\/]@codemirror[\\/]legacy-modes[\\/]mode[\\/](?!stex\\.)/.test(id)) return undefined;
          if (/[\\/]@lezer[\\/](?!common|highlight|lr|markdown)/.test(id)) return undefined;
          if (id.includes('@lezer')) return 'grammar';
          if (/[\\/](@codemirror|style-mod|w3c-keyname|crelt)[\\/]/.test(id)) return 'editor';
          if (id.includes('marked') || id.includes('dompurify')) return 'markdown';
          return undefined; // pagedjs is loaded on demand and keeps its own chunk
        },
      },
    },
  },
});
