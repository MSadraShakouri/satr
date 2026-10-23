import { defineConfig } from 'vite';

export default defineConfig({
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
