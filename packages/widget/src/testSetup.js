// jsdom implements no layout, so the scroll APIs the chat uses to keep the
// conversation pinned to the newest message simply do not exist. Without these
// the components throw during commit, which looks like a product failure and is
// not one.
//
// Stubs rather than fakes: nothing asserts on scrolling, they only need to be
// callable.
for (const name of ['scrollBy', 'scrollTo', 'scrollIntoView']) {
  if (!Element.prototype[name]) {
    Element.prototype[name] = function noop() {};
  }
}

// react-textarea-autosize measures the textarea to size it.
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')?.get) {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return 20;
    },
  });
}
