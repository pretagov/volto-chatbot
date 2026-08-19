import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// The add-on's components are imported IN PLACE from ../../src and never edited,
// so upstream changes keep merging cleanly. Everything Volto used to provide is
// resolved here instead.
//
// Order matters: Vite matches these in sequence, so the longer Loadable path must
// come before the shorter one, and both before the bare helpers path.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@plone/volto/helpers/Loadable/Loadable', replacement: here('src/shims/loadable.jsx') },
      { find: '@plone/volto/helpers/Loadable', replacement: here('src/shims/loadable.jsx') },
      { find: '@plone/volto/helpers', replacement: here('src/shims/helpers.js') },
      { find: '@plone/volto/icons/zoom.svg', replacement: here('src/shims/icons/zoom.svg') },
      { find: '@plone/volto/icons/code.svg', replacement: here('src/shims/icons/code.svg') },
      { find: '@plone/volto-slate/editor/render', replacement: here('src/shims/slate.jsx') },
      { find: '@plone/registry', replacement: here('src/shims/registry.js') },
      // Matomo is out of scope for the embedded widget, but four reused
      // components import trackEvent, so it has to resolve to something.
      { find: '@eeacms/volto-matomo/utils', replacement: here('src/shims/matomo.js') },
      // ChatWindow imports #stores/sidebarStore, a package imports subpath.
      { find: /^#stores\/(.*)/, replacement: here('../../src/sidebar/stores/$1') },
      { find: '@eeacms/volto-chatbot', replacement: here('../../src') },
    ],
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        widget: here('index.html'),
        loader: here('src/loader/loader.js'),
      },
      output: {
        // loader.js is referenced by name in host pages, so it must not be hashed.
        entryFileNames: (chunk) => (chunk.name === 'loader' ? 'loader.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
  },
});
