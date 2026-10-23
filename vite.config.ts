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
        // One 1.4 MB file meant the phone parsed the editor, the maths and
        // the highlighter before it could show a line of text, and any
        // change to any of them invalidated the whole download. They are
        // independent libraries that never change together: give each its
        // own file. The app's own code stays in the entry chunk.
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('katex')) return 'katex';
          if (id.includes('highlight.js')) return 'highlight';
          if (id.includes('@lezer')) return 'grammar';
          if (/[\\/](@codemirror|style-mod|w3c-keyname|crelt)[\\/]/.test(id)) return 'editor';
          if (id.includes('marked') || id.includes('dompurify')) return 'markdown';
          return undefined; // pagedjs is loaded on demand and keeps its own chunk
        },
      },
    },
  },
});
