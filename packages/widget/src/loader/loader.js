// The only code that runs in the host page, so it stays dependency-free and
// small. It injects the iframe, owns its size and position, and does nothing else
// — everything about how the chat behaves comes from /w/<tenant>/config.

export const WIDGET_ORIGIN_ATTR = 'data-pretagov-chat';

const LAUNCHER = { width: 72, height: 72 };
const PANEL = { width: 400, height: 640 };
const EDGE = 20;

function applySize(frame, size) {
  frame.style.width = `${size.width}px`;
  frame.style.height = `${size.height}px`;
}

function applyPosition(frame, position) {
  frame.style.position = 'fixed';
  frame.style.bottom = `${EDGE}px`;
  if (position === 'left') {
    frame.style.left = `${EDGE}px`;
    frame.style.right = '';
  } else {
    frame.style.right = `${EDGE}px`;
    frame.style.left = '';
  }
}

export function boot(script = document.currentScript) {
  if (!script) return null;

  const tenant = script.getAttribute('data-tenant');
  // No guessing: without a tenant there is nothing sensible to load.
  if (!tenant) return null;

  // A site pasting the snippet twice should not get two launchers.
  const existing = document.querySelector(`iframe[${WIDGET_ORIGIN_ATTR}]`);
  if (existing) return existing;

  const widgetOrigin = new URL(script.src, window.location.href).origin;
  const position = script.getAttribute('data-position') === 'left' ? 'left' : 'right';

  const frame = document.createElement('iframe');
  frame.setAttribute(WIDGET_ORIGIN_ATTR, tenant);
  frame.setAttribute('title', 'Chat');
  frame.setAttribute('allow', 'clipboard-write');
  frame.src = `${widgetOrigin}/w/${tenant}`;
  frame.style.border = '0';
  frame.style.colorScheme = 'normal';
  frame.style.zIndex = '2147483647';
  frame.style.transition = 'width 120ms ease, height 120ms ease';
  applyPosition(frame, position);
  applySize(frame, LAUNCHER);

  window.addEventListener('message', (event) => {
    // Any page can postMessage into this window, so anything not from the widget
    // origin is ignored outright.
    if (event.origin !== widgetOrigin) return;
    const type = event.data && typeof event.data === 'object' ? event.data.type : null;
    if (type === 'chat:open') applySize(frame, PANEL);
    else if (type === 'chat:close') applySize(frame, LAUNCHER);
  });

  document.body.appendChild(frame);
  return frame;
}

// Auto-boot when loaded as a plain script tag, but stay importable for tests.
if (typeof document !== 'undefined' && document.currentScript) {
  boot(document.currentScript);
}
