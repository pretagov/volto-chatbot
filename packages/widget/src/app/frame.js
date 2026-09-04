// The loader owns the iframe's geometry in the host page; the widget only says
// which state it is in. Shared so the sources panel can ask for the room it
// needs without importing the component that owns "open".
export function notifyParent(type) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type }, '*');
  }
}

export default notifyParent;
