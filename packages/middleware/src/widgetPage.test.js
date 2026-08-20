import { describe, it, expect } from 'vitest';
import { injectBootstrap } from './widgetPage.js';

// A stand-in for the built dist/index.html, in the shape Vite emits.
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Chat</title>
    <script type="module" crossorigin src="/assets/widget-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/widget-abc123.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

const tenant = { tenantId: 'pretagov' };

describe('injectBootstrap', () => {
  it('hands the token and tenant to the page', () => {
    const html = injectBootstrap(TEMPLATE, tenant, 'tok-123');
    expect(html).toContain('window.__CHAT_TOKEN__="tok-123"');
    expect(html).toContain('window.__CHAT_TENANT__="pretagov"');
  });

  it('keeps the built bundle and stylesheet', () => {
    // Rendering our own HTML instead of the build output was the placeholder's
    // flaw: the page loaded with no widget in it at all.
    const html = injectBootstrap(TEMPLATE, tenant, 'tok');
    expect(html).toContain('/assets/widget-abc123.js');
    expect(html).toContain('/assets/widget-abc123.css');
  });

  it('runs the bootstrap before the bundle', () => {
    // The reused components issue bare fetch() calls, so the token has to be on
    // window before any of them run. A classic inline script executes during
    // parsing while type=module is deferred, so being inside head is enough.
    const html = injectBootstrap(TEMPLATE, tenant, 'tok');
    const bootstrap = html.indexOf('__CHAT_TOKEN__');
    const bundle = html.indexOf('type="module"');
    expect(bootstrap).toBeGreaterThan(-1);
    expect(bundle).toBeGreaterThan(-1);
    expect(html.slice(0, bootstrap)).not.toContain('type="module"');
  });

  it('cannot be broken out of by a value containing a closing script tag', () => {
    // JSON.stringify does not escape "</script>", so without extra escaping a
    // crafted tenant id or token would close the inline script and inject markup.
    const html = injectBootstrap(TEMPLATE, { tenantId: 'a</script><img src=x>' }, 'tok');
    expect(html).not.toContain('</script><img src=x>');
  });

  it('escapes a closing script tag in the token too', () => {
    const html = injectBootstrap(TEMPLATE, tenant, 'a</script><img src=x>');
    expect(html).not.toContain('</script><img src=x>');
  });
});
