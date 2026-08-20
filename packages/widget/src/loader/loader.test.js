import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, WIDGET_ORIGIN_ATTR } from './loader.js';

const ORIGIN = 'https://chat.example';

function addScriptTag(attrs = {}) {
  const script = document.createElement('script');
  script.src = `${ORIGIN}/loader.js`;
  script.setAttribute('data-tenant', 'lecc');
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
  it('injects exactly one iframe pointing at the tenant widget', () => {
    boot(addScriptTag());
    const frames = document.querySelectorAll('iframe');
    expect(frames.length).toBe(1);
    expect(frames[0].src).toBe(`${ORIGIN}/w/lecc`);
  });

  it('is idempotent when a site includes the script twice', () => {
    // Copy-pasted snippets happen; two launchers on one page is a visible bug.
    boot(addScriptTag());
    boot(addScriptTag());
    expect(document.querySelectorAll('iframe').length).toBe(1);
  });

  it('does nothing without a tenant rather than guessing', () => {
    const script = addScriptTag();
    script.removeAttribute('data-tenant');
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
