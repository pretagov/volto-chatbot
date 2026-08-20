import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, WIDGET_ORIGIN_ATTR } from './loader.js';

const ORIGIN = 'https://chat.example';

function addScriptTag(attrs = {}) {
  const script = document.createElement('script');
  script.src = `${ORIGIN}/loader.js`;
  script.setAttribute('data-onyx', 'https://onyx.example');
  script.setAttribute('data-persona', '12');
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
  document.body.appendChild(script);
  return script;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('boot', () => {
  it('injects exactly one iframe carrying the demo config', () => {
    boot(addScriptTag());
    const frames = document.querySelectorAll('iframe');
    expect(frames.length).toBe(1);
    const url = new URL(frames[0].src);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/widget.html`);
    expect(url.searchParams.get('persona')).toBe('12');
    expect(url.searchParams.get('onyx')).toBe('https://onyx.example');
  });

  it('is idempotent when a site includes the script twice', () => {
    // Copy-pasted snippets happen; two launchers on one page is a visible bug.
    boot(addScriptTag());
    boot(addScriptTag());
    expect(document.querySelectorAll('iframe').length).toBe(1);
  });

  it('does nothing without a persona rather than guessing', () => {
    const script = addScriptTag();
    script.removeAttribute('data-persona');
    boot(script);
    expect(document.querySelectorAll('iframe').length).toBe(0);
  });

  it('positions on the right by default and honours data-position', () => {
    boot(addScriptTag());
    expect(document.querySelector('iframe').style.right).not.toBe('');

    document.body.innerHTML = '';
    boot(addScriptTag({ 'data-position': 'left' }));
    expect(document.querySelector('iframe').style.left).not.toBe('');
  });

  it('starts collapsed to launcher size', () => {
    boot(addScriptTag());
    const frame = document.querySelector('iframe');
    expect(parseInt(frame.style.width, 10)).toBeLessThan(200);
    expect(parseInt(frame.style.height, 10)).toBeLessThan(200);
  });
});

describe('postMessage handling', () => {
  function send(data, origin = ORIGIN) {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  }

  it('expands the iframe when the widget opens', () => {
    boot(addScriptTag());
    const frame = document.querySelector('iframe');
    send({ type: 'chat:open' });
    expect(parseInt(frame.style.width, 10)).toBeGreaterThan(200);
  });

  it('collapses again when the widget closes', () => {
    boot(addScriptTag());
    const frame = document.querySelector('iframe');
    send({ type: 'chat:open' });
    send({ type: 'chat:close' });
    expect(parseInt(frame.style.width, 10)).toBeLessThan(200);
  });

  it('ignores messages from any other origin', () => {
    // Any page on the internet can postMessage into this frame, so the origin
    // check is what stops a hostile embedder driving the widget.
    boot(addScriptTag());
    const frame = document.querySelector('iframe');
    const before = frame.style.width;
    send({ type: 'chat:open' }, 'https://evil.test');
    expect(frame.style.width).toBe(before);
  });

  it('ignores unrecognised message shapes', () => {
    boot(addScriptTag());
    const frame = document.querySelector('iframe');
    const before = frame.style.width;
    send('not-an-object');
    send({ type: 'something:else' });
    expect(frame.style.width).toBe(before);
  });
});

describe('WIDGET_ORIGIN_ATTR', () => {
  it('marks the iframe so a second boot can find it', () => {
    boot(addScriptTag());
    expect(document.querySelector(`iframe[${WIDGET_ORIGIN_ATTR}]`)).toBeTruthy();
  });
});

describe('buildWidgetUrl', () => {
  it('passes presentation attributes through as camelCase', () => {
    // The snippet reads like HTML; the widget still sees its contract's names.
    const script = addScriptTag({ 'data-chat-title': 'Ask B&NES' });
    boot(script);
    const url = new URL(document.querySelector('iframe').src);
    expect(url.searchParams.get('chatTitle')).toBe('Ask B&NES');
  });

  it('keeps loader-only attributes out of the widget url', () => {
    // position is the loader's business: it sizes and places the frame.
    boot(addScriptTag({ 'data-position': 'left' }));
    const url = new URL(document.querySelector('iframe').src);
    expect(url.searchParams.get('position')).toBeNull();
  });

  it('carries a forced search tool through', () => {
    boot(addScriptTag({ 'data-tool': '1' }));
    const url = new URL(document.querySelector('iframe').src);
    expect(url.searchParams.get('tool')).toBe('1');
  });
});

describe('serving from a subdirectory', () => {
  it('resolves the widget next to the loader, not at the origin root', () => {
    // It is mounted under an existing site's public directory rather than on a
    // host of its own, so the origin root is not ours to assume.
    const script = document.createElement('script');
    script.src = `${ORIGIN}/chat/loader.js`;
    script.setAttribute('data-onyx', 'https://onyx.example');
    script.setAttribute('data-persona', '12');
    document.body.appendChild(script);

    boot(script);
    const url = new URL(document.querySelector('iframe').src);
    expect(url.pathname).toBe('/chat/widget.html');
    expect(url.searchParams.get('persona')).toBe('12');
  });
});
