import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { ConfigProvider, useChatConfig } from './ConfigProvider.jsx';
import registry from '../shims/registry.js';

function Probe() {
  const config = useChatConfig();
  return <div data-testid="probe">{config.chatTitle}</div>;
}

beforeEach(() => {
  registry.settings = {};
  globalThis.__CHAT_TENANT__ = 'lecc';
  globalThis.__CHAT_TOKEN__ = 'tok';
});

afterEach(() => {
  // Without this, screen queries see nodes left over from earlier renders and
  // assertions become order-dependent.
  cleanup();
  vi.restoreAllMocks();
});

function mockConfigFetch(body, ok = true) {
  globalThis.fetch = vi.fn(async () =>
    ok ? new Response(JSON.stringify(body), { status: 200 }) : new Response('', { status: 500 }),
  );
  return globalThis.fetch;
}

describe('ConfigProvider', () => {
  it('fetches config for the tenant handed over by the document', async () => {
    const fetchMock = mockConfigFetch({ chatTitle: 'Ask LECC' });
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Ask LECC'));
    expect(fetchMock.mock.calls[0][0]).toBe('/w/lecc/config');
  });

  it('renders nothing at all when config cannot be loaded', async () => {
    // Fail closed: a broken bubble on a customer's site is worse than no bubble.
    mockConfigFetch(null, false);
    const { container } = render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(screen.queryByTestId('probe')).toBeNull();
  });

  it('renders nothing while config is still loading', () => {
    mockConfigFetch({ chatTitle: 'Ask LECC' });
    const { container } = render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    expect(container.textContent).toBe('');
  });

  it('seeds the registry so the reused components can read their settings', async () => {
    // lib.js reads rewakeUrl and useBackendChat.js reads rewakeDelay from the
    // settings singleton rather than from props, so this is not optional.
    mockConfigFetch({ chatTitle: 'x', rewakeUrl: '/_da/health', rewakeDelay: 15 });
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await waitFor(() => {
      expect(registry.settings['volto-chatbot'].rewakeUrl).toBe('/_da/health');
      expect(registry.settings['volto-chatbot'].rewakeDelay).toBe(15);
    });
  });

  it('seeds rewakeUrl as a path, never an absolute URL', async () => {
    // The fetch wrapper matches on path prefix, so an absolute URL here would
    // send the health ping out untokenised.
    mockConfigFetch({ chatTitle: 'x', rewakeUrl: '/_da/health' });
    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await waitFor(() =>
      expect(registry.settings['volto-chatbot'].rewakeUrl.startsWith('/')).toBe(true),
    );
  });
});
