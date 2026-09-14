// Keeps localStorage access from throwing inside code we cannot edit.
//
// useBackendChat.js reads and writes its chat-last-awake key directly. Browsers
// partition storage in third-party iframes and can block it entirely, and in
// Safari a blocked localStorage throws on *property access*, not on the method
// call — so an unguarded read there takes the chat down rather than degrading.
//
// Storage being partitioned per top-level site is fine, and in fact desirable:
// it keeps one visitor's conversations on different tenants separate.

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

function storageWorks(host) {
  try {
    const probe = '__chat_storage_probe__';
    host.localStorage.setItem(probe, '1');
    host.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function installStorageGuard(host = globalThis) {
  if (storageWorks(host)) {
    const uninstall = () => {};
    uninstall.usedFallback = false;
    return uninstall;
  }

  // Replace the accessor itself: leaving the throwing getter in place would still
  // blow up on the first read from the reused code.
  const descriptor = Object.getOwnPropertyDescriptor(host, 'localStorage');
  const fallback = memoryStorage();
  Object.defineProperty(host, 'localStorage', {
    value: fallback,
    configurable: true,
    writable: true,
  });

  const uninstall = () => {
    if (descriptor) Object.defineProperty(host, 'localStorage', descriptor);
  };
  uninstall.usedFallback = true;
  return uninstall;
}
