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

// A grounded answer as Onyx actually streams one: the retrieved documents, the
// prose, and the citations tying them together. An earlier version of this stub
// sent an answer with no documents and no citations, which left the source cards
// and citation markers - the whole point of a grounded assistant - untested.
const DOCUMENTS = [
  {
    document_id: 'doc-paying',
    semantic_identifier: 'Paying your Council Tax',
    link: 'https://www.example.gov.uk/paying-your-council-tax',
    blurb: 'Ways to settle your bill, including automatic monthly collection.',
    source_type: 'web',
  },
  {
    document_id: 'doc-bands',
    semantic_identifier: 'Council Tax bands',
    link: 'https://www.example.gov.uk/council-tax-bands',
    blurb: 'How charges are banded for your area.',
    source_type: 'web',
  },
];

const ANSWER =
  packet({ type: 'search_tool_documents_delta', documents: DOCUMENTS }) +
  packet({ type: 'message_start', final_documents: DOCUMENTS }) +
  packet({ type: 'message_delta', content: '## Paying\n\nUse **Direct Debit** ' }) +
  packet({ type: 'message_delta', content: 'or pay online. [[1]]()' }) +
  packet({ type: 'citation_info', citation_number: 1, document_id: 'doc-paying' }) +
  packet({ type: 'citation_info', citation_number: 2, document_id: 'doc-bands' }) +
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
    // The favicon 404 is the static server, not the widget - and the URL lives
    // in location(), not in the message text, so matching on the text alone
    // never filtered it.
    const url = message.location()?.url ?? '';
    if (url.includes('favicon')) return;
    errors.push(`${message.text()} ${url}`.trim());
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

  await page.goto(WIDGET());
  const input = page.locator('textarea[placeholder="Ask me anything…"]');
  await input.fill('How do I pay?');
  await input.press('Enter');
  await expect(page.getByText('Direct Debit')).toBeVisible({ timeout: 20000 });

  const session = sent.find((r) => r.url.includes('create-chat-session'));
  expect(JSON.parse(session.body).persona_id).toBe(12);

  // Forced by default: the demo is about grounded answers, so retrieval is not
  // something an embed has to remember to switch on.
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


test('shows the sources it answered from', async ({ page }) => {
  // The retrieved documents have to reach the UI, not just the translator. This
  // is what makes the answer checkable by a reader, and it was previously
  // covered nowhere: the stub sent an answer with no documents at all.
  const errors = watchConsole(page);
  await stubOnyx(page);
  await page.goto(WIDGET());

  const input = page.locator('textarea[placeholder="Ask me anything…"]');
  await input.fill('How do I pay?');
  await input.press('Enter');

  await expect(page.getByText('Direct Debit')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('link', { name: /Paying your Council Tax/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Council Tax bands/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the sources scroll sideways instead of wrapping', async ({ page }) => {
  // At panel width the cards are wider than the frame. Wrapping turned them
  // into a block of stacked rows that pushed the answer down the panel; a
  // sideways scroller keeps them to one line and lets a reader swipe, which is
  // what the same cards do on a phone.
  await stubOnyx(page);
  await page.setViewportSize({ width: 400, height: 640 });
  await page.goto(WIDGET());

  const input = page.locator('textarea[placeholder="Ask me anything…"]');
  await input.fill('How do I pay?');
  await input.press('Enter');
  await expect(page.getByText('Direct Debit')).toBeVisible({ timeout: 20000 });

  const layout = await page.evaluate(() => {
    const row = document.querySelector('.document-cards-row');
    const cards = [...row.children];
    return {
      cardCount: cards.length,
      distinctRows: new Set(cards.map((c) => c.offsetTop)).size,
      scrolls: row.scrollWidth > row.clientWidth,
      overflowX: getComputedStyle(row).overflowX,
    };
  });

  expect(layout.cardCount).toBeGreaterThan(1);
  // One line: every card shares a top edge, however many there are.
  expect(layout.distinctRows).toBe(1);
  expect(layout.scrolls).toBe(true);
  expect(['auto', 'scroll']).toContain(layout.overflowX);
});

test('links each source to where it came from', async ({ page }) => {
  await stubOnyx(page);
  await page.goto(WIDGET());

  const input = page.locator('textarea[placeholder="Ask me anything…"]');
  await input.fill('How do I pay?');
  await input.press('Enter');

  const source = page.getByRole('link', { name: /Paying your Council Tax/ });
  await expect(source).toBeVisible({ timeout: 20000 });
  await expect(source).toHaveAttribute(
    'href',
    'https://www.example.gov.uk/paying-your-council-tax',
  );
});

// Against the real deployment, opt-in.
//
// The stubbed tests above prove the widget handles the protocol we believe Onyx
// speaks. This proves Onyx still speaks it - which is the failure mode that
// started all of this: a mock serving a dead contract stayed green for months
// while the deployed chat was broken.
//
// Opt-in because it needs the deployment awake, costs an inference call, and is
// as slow as a real answer:
//
//   LIVE_ONYX=https://pg-demo-onyx.fly.dev LIVE_PERSONA=12 npm run test:browser
const LIVE = process.env.LIVE_ONYX;

test.describe('against the real Onyx', () => {
  test.skip(!LIVE, 'set LIVE_ONYX to run');
  test.setTimeout(180_000);

  test('answers a real question with real sources', async ({ page }) => {
    const errors = watchConsole(page);
    const search = new URLSearchParams({
      onyx: LIVE,
      persona: process.env.LIVE_PERSONA || '12',
      tool: process.env.LIVE_TOOL || '1',
      open: '1',
      chatTitle: 'Live check',
    });
    await page.goto(`/widget.html?${search}`);

    const input = page.locator('textarea[placeholder="Ask me anything…"]');
    await input.fill(process.env.LIVE_QUESTION || 'How do I pay my council tax?');
    await input.press('Enter');

    // A cited source card, which only appears if retrieval actually ran and the
    // documents reached the UI. Asserting on the answer text would tie the test
    // to whatever the model happens to say.
    const sources = page.locator('a[href^="http"]');
    await expect(sources.first()).toBeVisible({ timeout: 150_000 });
    expect(await sources.count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

// Phone geometry, in a real browser.
//
// The panel was a fixed 400x640 with no media query anywhere, so on a 375px
// screen it rendered 45px off the left edge with the conversation clipped.
test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('fits the screen, with nothing off the edge', async ({ page }) => {
    await stubOnyx(page);
    await page.goto(WIDGET());

    const box = await page.locator('.chat-panel').boundingBox();
    expect(box.width).toBeLessThanOrEqual(375);
    expect(box.x).toBeGreaterThanOrEqual(0);
  });

  test('does not scroll the page sideways', async ({ page }) => {
    await stubOnyx(page);
    await page.goto(WIDGET());

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the input stays reachable with an answer on screen', async ({ page }) => {
    // The conversation scrolls inside the panel; if it pushed the composer off
    // the bottom instead, a phone user could read one answer and never ask again.
    await stubOnyx(page);
    await page.goto(WIDGET());

    const input = page.locator('textarea').first();
    await input.fill('How do I pay?');
    await input.press('Enter');
    await expect(page.getByText('Direct Debit')).toBeVisible({ timeout: 20000 });

    // The placeholder becomes "Ask follow-up..." once there are messages, so
    // this deliberately does not match on it.
    const box = await input.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(667);
  });
});


test('does not force a tool when the embed opts out', async ({ page }) => {
  await stubOnyx(page);
  const sent = [];
  page.on('request', (r) => {
    if (r.url().includes('send-chat-message')) sent.push(r.postData());
  });

  await page.goto(WIDGET({ tool: 'none' }));
  const input = page.locator('textarea').first();
  await input.fill('How do I pay?');
  await input.press('Enter');
  await expect(page.getByText('Direct Debit')).toBeVisible({ timeout: 20000 });

  expect(JSON.parse(sent[0]).forced_tool_id).toBeUndefined();
});
