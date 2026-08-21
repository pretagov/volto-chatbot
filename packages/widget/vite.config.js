import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { readFile } from 'node:fs/promises';
import { svgAsIconData } from './src/buildPlugins/svgIcon.js';

// The add-on writes JSX inside .js files (utils.js and others). Volto's Babel
// build allows that; Vite's esbuild pass rejects it before any plugin sees the
// file, so re-transform those specific files with the jsx loader first.
const jsxInJs = {
  name: 'chatbot-jsx-in-js',
  enforce: 'pre',
  async transform(code, id) {
    if (!/volto-chatbot\/src\/.*\.js$/.test(id)) return null;
    return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
  },
};

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Runtime packages the reused components import by bare specifier.
//
// unist-util-visit is deliberately NOT here. The alias below matches on the
// bare specifier regardless of who is importing, and several markdown packages
// need different majors of it: mdast-util-definitions@4 requires the v2
// CommonJS build, whose module.exports IS the function, while the add-on itself
// uses v5, which is pure ESM with named exports only. Forcing one copy handed
// v5 to the v4 consumer, so `visit` came out undefined and every rendered
// answer died on "is not a function". pnpm already resolves these correctly per
// importer; the alias was overriding that.
const SHARED_DEPS = [
  'semantic-ui-react',
  'react-dom',
  'react',
  '@nanostores/react',
  'nanostores',
  '@loadable/component',
  'prop-types',
  'react-textarea-autosize',
  'highlight.js',
  'marked',
  'dequal',
];

// The add-on's components are imported IN PLACE from ../../src and never edited,
// so upstream changes keep merging cleanly. Everything Volto used to provide is
// resolved here instead.
//
// Order matters: Vite matches these in sequence, so the longer Loadable path must
// come before the shorter one, and both before the bare helpers path.
export default defineConfig({
  // The add-on writes JSX inside .js files (utils.js and others), which Volto's
  // Babel build allows and esbuild does not. Let the react plugin handle both.
  plugins: [svgAsIconData({ readFile }), jsxInJs, react({ include: /\.(js|jsx)$/ })],
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
      // The reused components live in ../../src, so Node resolves their bare
      // imports from volto-chatbot's node_modules — where these are not
      // installed. Point them at the widget's copies rather than adding deps to
      // upstream's package.json, which would be a merge-conflict risk.
      ...SHARED_DEPS.map((dep) => ({
        find: new RegExp(`^${dep.replace('/', '\\/')}$`),
        replacement: here(`node_modules/${dep}`),
      })),
    ],
  },
  // Relative asset URLs so the built page works wherever it is mounted. It is
  // served from a subdirectory of the Onyx web server's public/ rather than a
  // host root, and absolute /assets/ paths would resolve against that root.
  base: './',
  build: {
    // react-markdown 6 pulls in mdast-util-definitions@4 and unist-util-visit@2,
    // both CommonJS. Rollup's default interop hoisted the consumer above the
    // provider, so `visit` was read before its module had run and every rendered
    // answer died on "Ep is not a function".
    //
    // strictRequires wraps CJS modules and runs them on first require, which is
    // the semantics they were written against, rather than guessing an order.
    commonjsOptions: {
      strictRequires: true,
      transformMixedEsModules: true,
    },
    outDir: 'dist',
    rollupOptions: {
      input: {
        widget: here('widget.html'),
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
    // jsdom has no layout, so the scroll APIs the chat uses do not exist.
    setupFiles: ['./src/testSetup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
});
