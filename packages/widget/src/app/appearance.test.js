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
