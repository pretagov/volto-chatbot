import { test, expect } from '@playwright/test';

// The check that jsdom cannot make.
//
// Four separate crashes shipped past a green unit suite, every one of them
// found by opening the page: an icon that threw before React mounted, a submit
// path that threw because the chat controller was never built, a markdown
// plugin resolved to the wrong major so `visit` came out undefined, and a
// tokenizer mismatch between react-markdown and remark-gfm.
//
// None were reachable from jsdom, because each lived in the BUILT bundle -
// module resolution, chunk ordering, interop. This loads the real build in a
// real browser and asks it a question, with Onyx stubbed so it stays fast and
// deterministic.

const ONYX = 'https://onyx.test';

const WIDGET = (params = {}) => {
  const search = new URLSearchParams({
    onyx: ONYX,
    persona: '12',
    open: '1',
    chatTitle: 'Ask us',
    ...params,
  });
  return `/widget.html?${search}`;
};

function packet(obj) {
  return `${JSON.stringify({ placement: {}, obj })}\n`;
}

// Onyx's streaming protocol, which the widget translates on the way in.
const ANSWER =
  packet({ type: 'message_start', final_documents: [] }) +
  packet({ type: 'message_delta', content: '## Paying\n\nUse **Direct Debit** ' }) +
  packet({ type: 'message_delta', content: 'or pay online.' }) +
  packet({ type: 'stop' });

async function stubOnyx(page) {
  await page.route(`${ONYX}/**`, async (route) => {
    const url = route.request().url();
    if (url.includes('create-chat-session')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ chat_session_id: 'session-1' }),
      });
    }
    if (url.includes('send-chat-message')) {
      return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ANSWER });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

// Any console error at all is a failure here. Every one of the four crashes
// showed up as exactly this and nothing else.
function watchConsole(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // The favicon 404 is the static server, not the widget.
    if (message.text().includes('favicon')) return;
    errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

test('renders the panel without throwing', async ({ page }) => {
  const errors = watchConsole(page);
  await stubOnyx(page);
  await page.goto(WIDGET());

  await expect(page.locator('.chat-panel')).toBeVisible();
  await expect(page.getByText('Ask us')).toBeVisible();
  expect(errors).toEqual([]);
});

test('is styled, not raw markup', async ({ page }) => {
  await stubOnyx(page);
  await page.goto(WIDGET());

  // The shell had no CSS at all and rendered as default serif with no chrome.
  const panel = page.locator('.chat-panel');
  await expect(panel).toBeVisible();
  const font = await panel.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).not.toMatch(/^(serif|Times)/i);
});

test('answers a question, and renders the answer', async ({ page }) => {
  const errors = watchConsole(page);
  await stubOnyx(page);
  await page.goto(WIDGET());

  const input = page.locator('textarea[placeholder="Ask me anything…"]');
  await input.fill('How do I pay?');
  await input.press('Enter');

  // Markdown has to render, which is where the plugin major mismatch died.
  await expect(page.getByRole('heading', { name: 'Paying' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Direct Debit')).toBeVisible();
  expect(errors).toEqual([]);
});

test('sends the question to Onyx with the persona and tool pinned', async ({ page }) => {
  await stubOnyx(page);
  const sent = [];
  page.on('request', (request) => {
    if (request.url().includes(ONYX)) sent.push({ url: request.url(), body: request.postData() });
  });

  await page.goto(WIDGET({ tool: '1' }));
  const input = page.locator('textarea[placeholder="Ask me anything…"]');
  await input.fill('How do I pay?');
  await input.press('Enter');
  await expect(page.getByText('Direct Debit')).toBeVisible({ timeout: 20000 });

  const session = sent.find((r) => r.url.includes('create-chat-session'));
  expect(JSON.parse(session.body).persona_id).toBe(12);

  const turn = sent.find((r) => r.url.includes('send-chat-message'));
  expect(JSON.parse(turn.body).forced_tool_id).toBe(1);
});

test('a starter prompt from the embed asks its question', async ({ page }) => {
  const errors = watchConsole(page);
  await stubOnyx(page);
  await page.goto(WIDGET({ starterPrompts: 'Pay council tax' }));

  await page.getByRole('button', { name: 'Pay council tax' }).click();
  await expect(page.getByText('Direct Debit')).toBeVisible({ timeout: 20000 });
  expect(errors).toEqual([]);
});
