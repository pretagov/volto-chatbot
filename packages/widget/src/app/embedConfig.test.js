import { describe, it, expect } from 'vitest';
import { readEmbedConfig } from './embedConfig.js';
import { DEFAULTS } from './defaults.js';

const base = '?onyx=https://onyx.example&persona=12';

describe('readEmbedConfig', () => {
  it('reads the assistant and where it lives', () => {
    const config = readEmbedConfig(base);
    expect(config.onyxBaseUrl).toBe('https://onyx.example');
    expect(config.personaId).toBe('12');
  });

  it('fills the presentation defaults', () => {
    expect(readEmbedConfig(base).chatTitle).toBe(DEFAULTS.chatTitle);
  });

  it('lets the embed override a presentation default', () => {
    expect(readEmbedConfig(`${base}&chatTitle=Ask B%26NES`).chatTitle).toBe('Ask B&NES');
  });

  it('reads booleans as booleans, not as truthy strings', () => {
    // "false" is a non-empty string, so a naive read would turn every disabled
    // setting on.
    expect(readEmbedConfig(`${base}&enableFeedback=false`).enableFeedback).toBe(false);
    expect(readEmbedConfig(`${base}&qualityCheck=true`).qualityCheck).toBe(true);
  });

  it('reads numbers as numbers', () => {
    expect(readEmbedConfig(`${base}&rewakeDelay=30`).rewakeDelay).toBe(30);
  });

  it('collects a repeated parameter into a list', () => {
    const config = readEmbedConfig(`${base}&starterPrompts=One&starterPrompts=Two`);
    expect(config.starterPrompts).toEqual(['One', 'Two']);
  });

  it('carries the forced search tool through', () => {
    expect(readEmbedConfig(`${base}&tool=1`).forcedToolId).toBe('1');
  });

  it('refuses an embed with no persona', () => {
    // One chat, one persona: without it there is no assistant to be.
    expect(() => readEmbedConfig('?onyx=https://onyx.example')).toThrow(/persona/);
  });

  it('refuses an embed with no onyx url', () => {
    expect(() => readEmbedConfig('?persona=12')).toThrow(/onyx/);
  });

  it('keeps rewakeUrl a path, since the fetch wrapper matches on path', () => {
    expect(readEmbedConfig(base).rewakeUrl.startsWith('/')).toBe(true);
  });
});

describe('startOpen', () => {
  it('is off by default, so the bubble shows', () => {
    expect(readEmbedConfig(base).startOpen).toBe(false);
  });

  it('is on when the loader opened it from the host page', () => {
    // The host already has its own trigger, so a bubble inside the iframe would
    // be a second click.
    expect(readEmbedConfig(`${base}&open=1`).startOpen).toBe(true);
  });

  it('does not leak into the presentation config', () => {
    expect(readEmbedConfig(`${base}&open=1`).open).toBeUndefined();
  });
});
