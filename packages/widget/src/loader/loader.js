// The only code that runs in the host page, so it stays dependency-free and
// small. It owns the iframe and its geometry; everything about how the chat
// behaves travels in the iframe URL.
//
// Two ways to use it:
//
//   Host-driven (data-auto="false") - nothing appears until the page asks:
//     <script src=".../embed/loader.js" data-auto="false"
//             data-onyx="https://onyx.example" data-persona="12"
//             data-assistant-name="B&NES"
//             data-starter-prompts="Pay council tax"
//             data-starter-prompts="Report a problem"></script>
//
//   Retrieval is forced by default, so answers come from the persona's
//   documents rather than the model. data-tool names a different tool id;
//   data-tool="none" hands the choice back to the assistant.
//     <button onclick="PretagovChat.open()">Ask a question</button>
//
//   Self-contained - the loader supplies its own floating bubble:
//     <script src=".../embed/loader.js"
//             data-onyx="https://onyx.example" data-persona="12"></script>

export const WIDGET_ORIGIN_ATTR = 'data-pretagov-chat';

const LAUNCHER = { width: 72, height: 72 };
const PANEL = { width: 400, height: 640 };
const EDGE = 20;
// Below this the panel takes the whole screen. A floating card inset by 20px a
// side wastes scarce width on a phone and reads as a mistake rather than a
// choice.
const FULL_SCREEN_BELOW = 480;

function applySize(frame, size) {
  frame.style.width = `${size.width}px`;
  frame.style.height = `${size.height}px`;
}

// The panel was a fixed 400x640, which is wider than a phone: on a 375px screen
// it hung 45px off the left edge and clipped the conversation.
function fitPanel(frame, position) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (vw <= FULL_SCREEN_BELOW) {
    frame.style.position = 'fixed';
    frame.style.inset = '0';
    frame.style.left = '0px';
    frame.style.right = '0px';
    frame.style.top = '0px';
    frame.style.bottom = '0px';
    applySize(frame, { width: vw, height: vh });
    return;
  }

  // Never larger than the space available, so a short or narrow window still
  // gets a whole panel rather than a cropped one.
  frame.style.inset = '';
  applyPosition(frame, position);
  applySize(frame, {
    width: Math.min(PANEL.width, vw - EDGE * 2),
    height: Math.min(PANEL.height, vh - EDGE * 2),
  });
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

// Sidebar: full height against one edge, rather than a floating card.
function applySidebar(frame, position) {
  frame.style.position = 'fixed';
  frame.style.top = '0';
  frame.style.bottom = '0';
  frame.style.height = '100%';
  frame.style.width = `${PANEL.width}px`;
  if (position === 'left') {
    frame.style.left = '0';
    frame.style.right = '';
  } else {
    frame.style.right = '0';
    frame.style.left = '';
  }
}

// Attributes the loader consumes itself rather than passing on to the widget.
const LOADER_ONLY = new Set(['position', 'auto', 'layout']);

// data-chat-title becomes chatTitle, so the snippet reads like HTML and the
// widget still sees its contract's names.
function camelCase(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function paramsFrom(script) {
  const params = new URLSearchParams();
  for (const { name, value } of script.attributes) {
    if (!name.startsWith('data-')) continue;
    const key = name.slice('data-'.length);
    if (LOADER_ONLY.has(key)) continue;
    params.append(camelCase(key), value);
  }
  return params;
}

// Everything the demo needs travels in the iframe URL: which Onyx, which
// persona, and how the panel should look. No lookup, no registry, no server.
//
// Resolved against the loader's own directory rather than the origin root,
// because it is served from a subdirectory of an existing site rather than from
// a host of its own.
export function buildWidgetUrl(script, overrides = {}) {
  const params = paramsFrom(script);
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) continue;
    params.set(key, String(value));
  }
  const here = new URL('.', new URL(script.src, window.location.href));
  return new URL(`widget.html?${params.toString()}`, here).href;
}

function frameFor(script, url, position, layout) {
  const frame = document.createElement('iframe');
  frame.setAttribute(WIDGET_ORIGIN_ATTR, script.getAttribute('data-persona') || '');
  frame.setAttribute('title', 'Chat');
  frame.setAttribute('allow', 'clipboard-write');
  frame.src = url;
  frame.style.border = '0';
  frame.style.colorScheme = 'normal';
  frame.style.zIndex = '2147483647';
  frame.style.transition = 'width 120ms ease, height 120ms ease';
  if (layout === 'sidebar') applySidebar(frame, position);
  else applyPosition(frame, position);
  return frame;
}

/**
 * Builds the control surface a host page drives from its own buttons or links.
 *
 * The iframe is created on the first open rather than at page load, so a page
 * that nobody clicks never loads the chat at all.
 */
export function createChatApi(script) {
  const widgetOrigin = new URL(script.src, window.location.href).origin;
  const position = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  const layout = script.getAttribute('data-layout') === 'sidebar' ? 'sidebar' : 'panel';

  let frame = null;
  let currentPersona = null;
  let open = false;

  function show(persona) {
    // A different assistant is a different conversation, so the frame is rebuilt
    // rather than reused - otherwise the previous one keeps answering.
    if (frame && persona !== currentPersona) {
      frame.remove();
      frame = null;
    }

    if (!frame) {
      currentPersona = persona;
      // open=1 so the widget renders the panel directly. The host already has a
      // trigger; a bubble inside the iframe would be a second click.
      const url = buildWidgetUrl(script, { persona, open: '1' });
      frame = frameFor(script, url, position, layout);
      if (layout !== 'sidebar') fitPanel(frame, position);
      document.body.appendChild(frame);
    }

    frame.style.display = '';
    open = true;
  }

  function hide() {
    // Hidden rather than removed: destroying it would throw away the
    // conversation, which is what a visitor would notice most.
    if (frame) frame.style.display = 'none';
    open = false;
  }

  window.addEventListener('message', (event) => {
    // Any page can postMessage into this window, so anything not from the widget
    // origin is ignored outright.
    if (event.origin !== widgetOrigin) return;
    const type = event.data && typeof event.data === 'object' ? event.data.type : null;
    if (type === 'chat:close') hide();
    else if (type === 'chat:open' && frame && layout !== 'sidebar') fitPanel(frame, position);
  });

  // Rotation and window resizes change what fits, and a panel sized for the old
  // viewport is exactly the overflow this avoids.
  window.addEventListener('resize', () => {
    if (frame && open && layout !== 'sidebar') fitPanel(frame, position);
  });

  return {
    open: (options = {}) => show(options.persona ?? script.getAttribute('data-persona')),
    close: hide,
    toggle: (options = {}) =>
      open ? hide() : show(options.persona ?? script.getAttribute('data-persona')),
    isOpen: () => open,
  };
}

/**
 * The self-contained mode: the loader supplies its own floating bubble, which is
 * the widget rendered at launcher size and expanded on its own request.
 */
export function boot(script = document.currentScript) {
  if (!script) return null;

  const persona = script.getAttribute('data-persona');
  // No guessing: one chat is one persona, and without it there is nothing to
  // load.
  if (!persona) return null;

  // A site pasting the snippet twice should not get two launchers.
  const existing = document.querySelector(`iframe[${WIDGET_ORIGIN_ATTR}]`);
  if (existing) return existing;

  const widgetOrigin = new URL(script.src, window.location.href).origin;
  const position = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  const layout = script.getAttribute('data-layout') === 'sidebar' ? 'sidebar' : 'panel';

  const frame = frameFor(script, buildWidgetUrl(script), position, layout);
  applySize(frame, LAUNCHER);

  window.addEventListener('message', (event) => {
    if (event.origin !== widgetOrigin) return;
    const type = event.data && typeof event.data === 'object' ? event.data.type : null;
    if (type === 'chat:open') {
      if (layout === 'sidebar') applySidebar(frame, position);
      else fitPanel(frame, position);
    } else if (type === 'chat:close') {
      frame.style.inset = '';
      applyPosition(frame, position);
      applySize(frame, LAUNCHER);
    }
  });

  document.body.appendChild(frame);
  return frame;
}

/**
 * Publishes the control surface as window.PretagovChat, which is how a host page
 * reaches it from its own click handlers.
 *
 * Separate from createChatApi so the global is an explicit step rather than a
 * side effect of building the API.
 */
export function install(script) {
  window.PretagovChat = createChatApi(script);
  return window.PretagovChat;
}

// Published either way, so a page can drive the chat from its own handlers even
// when the floating bubble is in use.
if (typeof document !== 'undefined' && document.currentScript) {
  const script = document.currentScript;
  install(script);
  // Opt out with data-auto="false" when the page supplies its own trigger.
  if (script.getAttribute('data-auto') !== 'false') boot(script);
}
