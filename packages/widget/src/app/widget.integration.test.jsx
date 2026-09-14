import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ConfigProvider } from './ConfigProvider.jsx';
import { App } from './App.jsx';
import { DEFAULTS } from './defaults.js';
import { installFetchWrapper } from './fetchWrapper.js';

// The test the suite was missing.
//
// Every previous test exercised one seam - a translator, a path map, a config
// parser - and the widget still shipped broken twice: once crashing on an icon
// before React mounted, once throwing on submit because the chat controller was
// never constructed. Both were found by loading the page, because nothing here
// ever rendered the widget and asked it a question.
//
// This does that, against a stubbed Onyx, so a widget that cannot answer fails
// the suite rather than the visitor.

const ONYX = 'https://onyx.example';

const config = {
  ...DEFAULTS,
  onyxBaseUrl: ONYX,
  personaId: '12',
  forcedToolId: '1',
  startOpen: true,
};

// Onyx streams NDJSON Packet envelopes; the widget translates them on the way in.
function packetStream(packets) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const packet of packets) {
        controller.enqueue(encoder.encode(`${JSON.stringify(packet)}\n`));
      }
      controller.close();
    },
  });
}

let requests;
let uninstall;
// What the stubbed Onyx streams for the next turn. A test that needs a
// different answer sets this rather than replacing globalThis.fetch, which the
// fetch wrapper has already wrapped by the time a test body runs - reassigning
// it there loses the /_da/ rewrite and every request falls through unmatched.
let streamPackets;

const PLAIN_ANSWER = [
  { placement: {}, obj: { type: 'message_start', final_documents: [] } },
  { placement: {}, obj: { type: 'message_delta', content: 'Pay online ' } },
  { placement: {}, obj: { type: 'message_delta', content: 'or by direct debit.' } },
  { placement: {}, obj: { type: 'stop' } },
];

beforeEach(() => {
  requests = [];
  streamPackets = PLAIN_ANSWER;
  globalThis.fetch = vi.fn(async (url, init) => {
    requests.push({ url: String(url), body: init?.body, method: init?.method ?? 'GET' });

    if (String(url).includes('create-chat-session')) {
      return new Response(JSON.stringify({ chat_session_id: 'session-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).includes('send-chat-message')) {
      return new Response(packetStream(streamPackets), { status: 200 });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  uninstall = installFetchWrapper({
    onyxBaseUrl: config.onyxBaseUrl,
    personaId: config.personaId,
    forcedToolId: config.forcedToolId,
  });
});

afterEach(() => {
  if (uninstall) uninstall();
  cleanup();
  vi.restoreAllMocks();
});

const renderWidget = () =>
  render(
    <ConfigProvider config={config}>
      <App />
    </ConfigProvider>,
  );

// The panel renders once its lazy libraries resolve, so this waits rather than
// grabbing synchronously.
async function findInput() {
  await waitFor(() => expect(document.querySelector('textarea')).not.toBeNull(), {
    timeout: 15000,
  });
  return document.querySelector('textarea');
}

async function ask(question) {
  const input = await findInput();
  fireEvent.change(input, { target: { value: question } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('starter prompts from the embed', () => {
  const withPrompts = {
    ...config,
    starterPrompts: [{ name: 'Pay council tax', message: 'How do I pay council tax?' }],
    persona: { id: '12', starter_messages: [] },
  };

  const renderWithPrompts = () =>
    render(
      <ConfigProvider config={withPrompts}>
        <App />
      </ConfigProvider>,
    );

  it('renders a button for each prompt', async () => {
    renderWithPrompts();
    await waitFor(() => expect(screen.getByText('Pay council tax')).toBeTruthy(), {
      timeout: 15000,
    });
  }, 20000);

  it('asks the question when one is clicked', async () => {
    // The prompts come from the embed rather than from a persona fetch, so this
    // is the check that they survive the trip and actually submit.
    renderWithPrompts();
    const button = await screen.findByText('Pay council tax', {}, { timeout: 15000 });
    fireEvent.click(button);

    await waitFor(
      () => {
        const turn = requests.find((r) => r.url.includes('send-chat-message'));
        expect(turn).toBeTruthy();
        expect(JSON.parse(turn.body).message).toBe('How do I pay council tax?');
      },
      { timeout: 15000 },
    );
  }, 20000);
});

describe('the widget, end to end', () => {
  it('mounts without throwing', () => {
    // The icon crash killed the render before anything appeared, leaving an
    // empty root and no request ever made.
    expect(() => renderWidget()).not.toThrow();
  });

  it('renders the panel when opened, not an empty root', async () => {
    const { container } = renderWidget();
    await waitFor(() => expect(container.querySelector('.chat-panel')).not.toBeNull(), {
      timeout: 15000,
    });
    expect(container.innerHTML.length).toBeGreaterThan(0);
  }, 20000);

  it('renders an input to ask a question with', async () => {
    renderWidget();
    expect(await findInput()).not.toBeNull();
  }, 20000);

  it('sends the question to Onyx', async () => {
    // The failure this exists for: submitting threw because the chat controller
    // was never constructed, so nothing but the health ping ever went out.
    renderWidget();
    await ask('How do I pay my council tax?');

    await waitFor(
      () => {
        expect(requests.some((r) => r.url.includes('send-chat-message'))).toBe(true);
      },
      { timeout: 15000 },
    );
  }, 20000);

  it('creates a session before sending, and pins the persona to it', async () => {
    renderWidget();
    await ask('hello');

    await waitFor(
      () => {
        const session = requests.find((r) => r.url.includes('create-chat-session'));
        expect(session).toBeTruthy();
        expect(JSON.parse(session.body).persona_id).toBe(12);
      },
      { timeout: 15000 },
    );
  }, 20000);

  it('forces the search tool on the turn, so the answer is grounded', async () => {
    renderWidget();
    await ask('hello');

    await waitFor(
      () => {
        const turn = requests.find((r) => r.url.includes('send-chat-message'));
        expect(turn).toBeTruthy();
        expect(JSON.parse(turn.body).forced_tool_id).toBe(1);
      },
      { timeout: 15000 },
    );
  }, 20000);

  it('shows the streamed answer', async () => {
    // Proves the translation layer lands in the UI, not just in a unit test.
    renderWidget();
    await ask('How do I pay?');

    await waitFor(
      () => {
        expect(screen.getByText(/direct debit/i)).toBeTruthy();
      },
      { timeout: 15000 },
    );
  }, 20000);
});

describe('reaching every document behind an answer', () => {
  // Checked against the live demo: the answer came back with three document
  // cards and no way to the rest, because the control was gated on citations
  // and that answer cited nothing. That is exactly when a reader wants to see
  // what was read.
  const DOCS = [1, 2, 3, 4, 5].map((n) => ({
    document_id: `doc-${n}`,
    semantic_identifier: `Report ${n}`,
    link: `https://example.test/report-${n}`,
    blurb: `Summary of report ${n}.`,
  }));

  const UNCITED_ANSWER = [
    { placement: {}, obj: { type: 'message_start', final_documents: DOCS } },
    // Deliberately uncited: retrieval found five documents and the answer
    // names none of them.
    { placement: {}, obj: { type: 'message_delta', content: 'I could not find that.' } },
    { placement: {}, obj: { type: 'stop' } },
  ];

  it('offers a way to all of them even when the answer cites none', async () => {
    streamPackets = UNCITED_ANSWER;
    renderWidget();
    await ask('anything');

    await waitFor(
      () => expect(document.querySelector('.show-all-card')).not.toBeNull(),
      { timeout: 15000 },
    );
  }, 20000);

  it('lists the sources under the answer, not above it', async () => {
    // The cards used to render before the answer, so the panel opened on a row
    // of sources with the answer pushed below them. A citation belongs under
    // what it supports.
    streamPackets = UNCITED_ANSWER;
    renderWidget();
    await ask('anything');

    // The documents arrive in the first packet and the answer streams after,
    // so wait for both before comparing their order.
    await waitFor(
      () => {
        expect(document.querySelector('.document-cards-row')).not.toBeNull();
        expect(screen.getByText(/I could not find that/i)).toBeTruthy();
      },
      { timeout: 15000 },
    );
    const row = document.querySelector('.document-cards-row');
    const answer = screen.getByText(/I could not find that/i);

    // PRECEDING means the answer comes before the row in document order.
    expect(
      row.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  }, 20000);

  it('opens the panel on every document, not just the three shown', async () => {
    streamPackets = UNCITED_ANSWER;
    renderWidget();
    await ask('anything');

    await waitFor(
      () => expect(document.querySelector('.show-all-card')).not.toBeNull(),
      { timeout: 15000 },
    );
    fireEvent.click(document.querySelector('.show-all-card'));

    await waitFor(() => {
      const panel = document.querySelector('.chat-sources--open');
      expect(panel).not.toBeNull();
      expect(panel.querySelectorAll('.chat-sources__item')).toHaveLength(DOCS.length);
    });
  }, 20000);
});
