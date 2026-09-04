import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConfigProvider, useChatConfig } from './ConfigProvider.jsx';
import registry from '../shims/registry.js';
import { DEFAULTS } from './defaults.js';

function Probe() {
  const config = useChatConfig();
  return <div data-testid="title">{config?.chatTitle ?? 'none'}</div>;
}

const config = { ...DEFAULTS, chatTitle: 'Ask LECC' };

// Vitest globals are off here, so testing-library's automatic cleanup does not
// run and renders would otherwise accumulate across tests.
afterEach(cleanup);

describe('ConfigProvider', () => {
  it('hands the embed config to the reused components', () => {
    render(
      <ConfigProvider config={config}>
        <Probe />
      </ConfigProvider>,
    );
    expect(screen.getByTestId('title').textContent).toBe('Ask LECC');
  });

  it('renders synchronously, with nothing to wait for', () => {
    // The whole config is in the iframe URL, so there is no loading state where
    // the launcher exists but its settings do not.
    render(
      <ConfigProvider config={config}>
        <Probe />
      </ConfigProvider>,
    );
    expect(screen.getByTestId('title')).toBeTruthy();
  });

  it('seeds the registry so the reused components can read their settings', () => {
    // lib.js reads rewakeUrl and useBackendChat.js reads rewakeDelay from the
    // settings singleton rather than from props.
    render(
      <ConfigProvider config={config}>
        <Probe />
      </ConfigProvider>,
    );
    expect(registry.settings['volto-chatbot'].rewakeUrl).toBe(DEFAULTS.rewakeUrl);
    expect(registry.settings['volto-chatbot'].rewakeDelay).toBe(DEFAULTS.rewakeDelay);
  });

  it('seeds rewakeUrl as a path, never an absolute URL', () => {
    // The fetch wrapper matches on path prefix, so an absolute URL would bypass
    // the rewrite and never reach Onyx.
    render(
      <ConfigProvider config={config}>
        <Probe />
      </ConfigProvider>,
    );
    expect(registry.settings['volto-chatbot'].rewakeUrl.startsWith('/')).toBe(true);
  });

  it('renders nothing without config rather than a broken panel', () => {
    const { container } = render(
      <ConfigProvider config={null}>
        <Probe />
      </ConfigProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
