import { describe, it, expect, afterEach } from 'vitest';
import { installStorageGuard } from './storageGuard.js';

let uninstall;

afterEach(() => {
  if (uninstall) uninstall();
  uninstall = undefined;
});

// Safari with storage blocked throws on property access, not on the method call,
// so the guard has to survive the access itself.
function blockedStorage() {
  return {
    get localStorage() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  };
}

function workingStorage() {
  const data = new Map();
  return {
    localStorage: {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: (k) => data.delete(k),
    },
  };
}

describe('installStorageGuard', () => {
  it('leaves working storage alone', () => {
    const host = workingStorage();
    uninstall = installStorageGuard(host);
    host.localStorage.setItem('chat-last-awake', '123');
    expect(host.localStorage.getItem('chat-last-awake')).toBe('123');
  });

  it('does not throw when storage access itself throws', () => {
    // useBackendChat.js reads and writes chat-last-awake directly, inside a file
    // we cannot edit, so an unguarded throw there takes the chat down.
    const host = blockedStorage();
    uninstall = installStorageGuard(host);
    expect(() => host.localStorage.getItem('chat-last-awake')).not.toThrow();
    expect(() => host.localStorage.setItem('chat-last-awake', '1')).not.toThrow();
  });

  it('falls back to memory, so reads still round-trip within a session', () => {
    const host = blockedStorage();
    uninstall = installStorageGuard(host);
    host.localStorage.setItem('k', 'v');
    expect(host.localStorage.getItem('k')).toBe('v');
  });

  it('returns null for a missing key rather than undefined', () => {
    const host = blockedStorage();
    uninstall = installStorageGuard(host);
    expect(host.localStorage.getItem('never-set')).toBeNull();
  });

  it('reports whether real storage was available', () => {
    expect(installStorageGuard(workingStorage()).usedFallback).toBe(false);
    expect(installStorageGuard(blockedStorage()).usedFallback).toBe(true);
  });
});
