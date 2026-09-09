import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';
import { readEmbedConfig } from './embedConfig.js';
import { DEFAULTS } from './defaults.js';

// The panel renders in an iframe, which inherits nothing from the page around
// it. The Volto sidebar sits in the page and picks up the site's typeface,
// which is why it looks like part of the site and the embed looked like a
// browser default. The host has to hand its font across the boundary.
describe('font family', () => {
  const base = 'onyx=https://onyx.example&persona=1';

  it('falls back to a stack that is available everywhere', () => {
    const config = readEmbedConfig(`?${base}`);
    expect(config.fontFamily).toBe(DEFAULTS.fontFamily);
  });

  it('takes the font the host site asks for', () => {
    const config = readEmbedConfig(`?${base}&fontFamily=${encodeURIComponent('Public Sans, sans-serif')}`);
    expect(config.fontFamily).toBe('Public Sans, sans-serif');
  });

  it('keeps a fallback in the default so text renders before any webfont does', () => {
    expect(DEFAULTS.fontFamily).toMatch(/sans-serif$/);
  });
});

// The add-on rings its own controls, but it strips the composer textarea's
// border and background, so the browser's focus style lands on nothing a
// reader can see, and the shell's own buttons were never styled at all. A
// keyboard user has to be able to see where they are.
describe('keyboard focus', () => {
  // Vitest stubs `?raw` for stylesheets, and under jsdom import.meta.url is an
  // http URL, so the file is read from the package root vitest runs in.
  const shellCss = readFileSync(resolve(process.cwd(), 'src/app/shell.css'), 'utf8');

  const focusBlocks = shellCss
    .split('}')
    .filter((block) => /:focus(-visible|-within)?\b/.test(block));

  const ringFor = (selector) =>
    focusBlocks.find((block) => block.includes(selector) && /outline:\s*\d/.test(block));

  it.each([
    ['the composer', '.textarea-wrapper:focus-within'],
    ['the launcher', '.chat-launcher:focus-visible'],
    ['the panel close button', '.chat-panel__header button:focus-visible'],
    ['the sources close button', '.chat-sources__header button:focus-visible'],
    ['a source link', '.chat-sources__body a:focus-visible'],
  ])('rings %s', (_name, selector) => {
    expect(ringFor(selector)).toBeTruthy();
  });

  it('rings the header buttons in a colour that shows against the header', () => {
    // The header is painted with --chat-accent, so an accent ring is invisible.
    expect(ringFor('.chat-panel__header button:focus-visible')).toContain(
      '--chat-focus-inverse',
    );
  });
});
