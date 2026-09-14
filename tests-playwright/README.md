# Playwright Tests for volto-chatbot

End-to-end tests for the volto-chatbot component using Playwright.

## Quick Start

```bash
# From admin project root (/admin):

# 1. Install dependencies (one-time)
pnpm install

# 2. Build dependencies (one-time)
pnpm build:deps

# 3. Install Playwright browsers (one-time)
npx playwright install chromium

# 4. Run tests (Volto and mock API start automatically!)
pnpm --filter @eeacms/volto-chatbot test:playwright

# Or use these convenience commands:
pnpm --filter @eeacms/volto-chatbot test:playwright:headed  # See browser
pnpm --filter @eeacms/volto-chatbot test:playwright:ui      # Interactive UI
pnpm --filter @eeacms/volto-chatbot test:playwright:debug   # Step-by-step
```

**Notes**:
- **One-time setup**: `pnpm build:deps` builds @plone/registry and @plone/components (required before first run)
- **First test run**: Takes ~5 minutes for Volto's webpack compilation
- **Subsequent runs**: Much faster - reuses the running server

## Architecture

### Current Setup
- **Automatic Server Management**: Playwright automatically starts both servers before tests
  - **Mock Plone API** (port 8090): Started via `globalSetup`, serves:
    - Plone REST API endpoints (login, site info, content, schemas)
    - Proxies `/_da/*` requests to production Onyx API at https://pg-demo-admin.fly.dev
    - Test content from `fixtures/api/lecc-page.json`
  - **Local Volto** (port 3010): Started via `webServer` config with:
    - `RAZZLE_API_PATH=http://localhost:8090`
    - Initial compilation ~5 minutes, subsequent runs reuse existing server
- **Test Page**: `/lecc` page with chatbot block
- **No iframe complexity**: Tests navigate directly to Volto page

### Test Structure
```
tests-playwright/
├── fixtures/
│   ├── api/
│   │   ├── lecc-page.json        # Test page content with chatbot block
│   │   └── schema-document.json  # Document type schema
│   └── mock-plone-server.js      # Mock Plone API + Danswer proxy
├── helpers/
│   └── ChatbotHelper.ts          # Test helper methods for chatbot interactions
├── integration/
│   ├── message-sending.spec.ts   # Tests for sending messages and receiving responses
│   └── agent-thinking.spec.ts    # Tests for agent thinking display and behavior
├── global-setup.ts               # Starts mock-plone-server before tests
├── global-teardown.ts            # Stops server after tests
├── playwright.config.ts          # Playwright configuration
└── tsconfig.json                 # TypeScript configuration
```

## Test Helper: ChatbotHelper

The `ChatbotHelper` class provides methods to interact with the chatbot directly on the page (no iframe):

```typescript
const helper = new ChatbotHelper(page);

// Send messages
await helper.sendMessage('What is LECC?');
await helper.typeMessage('Hello');
await helper.clickSend();

// Get messages
const count = await helper.getMessageCount();
const lastMessage = await helper.getLastMessageText();

// Agent thinking
const hasThinking = await helper.hasAgentThinking();
const isExpanded = await helper.isAgentThinkingExpanded();
await helper.toggleAgentThinking();
const steps = await helper.getThinkingSteps();

// Waiting utilities
await helper.waitForChatbotReady();
await helper.waitForStreamingComplete();
await helper.waitForMessageCount(5);
await helper.waitForAgentThinkingToCollapse();
```

## Writing Tests

Tests are written using Playwright Test framework with TypeScript:

```typescript
import { test, expect } from '@playwright/test';
import { ChatbotHelper } from '../helpers/ChatbotHelper';

test('can send a message', async ({ page }) => {
  const helper = new ChatbotHelper(page);

  await page.goto('/lecc');
  await helper.waitForChatbotReady();

  await helper.sendMessage('What is LECC?');
  await helper.waitForStreamingComplete();

  const response = await helper.getLastMessageText();
  expect(response.length).toBeGreaterThan(0);
});
```

## Current Tests

### Message Sending Tests (`integration/message-sending.spec.ts`)
- ✅ Page loads with chatbot
- ✅ Can send a message and receive response
- ✅ Response streams in gradually
- ✅ Can send multiple messages in sequence

### Agent Thinking Tests (`integration/agent-thinking.spec.ts`)
- ✅ Agent thinking appears during message response (if server sends agent_piece packets)
- ✅ Agent thinking auto-collapses when streaming completes
- ✅ User can manually toggle agent thinking expand/collapse
- ✅ Agent thinking shows step count in header
- ✅ Agent thinking displays steps in order

## Configuration

### Playwright Config (`playwright.config.ts`)
- Base URL: `http://localhost:3010` (Volto)
- Timeout: 30 seconds per test
- Browsers: Chromium only (can add Firefox/WebKit if needed)
- Screenshots/video: Only on failure
- Global setup: Starts mock-plone-server.js on port 8090
- Global teardown: Stops mock server

### TypeScript Config (`tsconfig.json`)
- Target: ES2020
- Module: CommonJS
- Types: Node + Playwright

## Mock Plone API Server

The mock server (`fixtures/mock-plone-server.js`) provides:

1. **Plone REST API Endpoints**:
   - `POST /@login` - Authentication (accepts any credentials)
   - `POST /@login-renew` - Token renewal
   - `GET /@site` - Site information
   - `GET /@types/:typeName` - Content type schemas
   - `GET /:path` - Content retrieval
   - `PATCH /:path` - Content updates
   - `POST /:path/@lock` - Content locking

2. **Danswer API Proxy**:
   - `/_da/*` → `https://pg-demo-admin.fly.dev/_da/*`
   - Allows testing with production AI backend
   - Future: Can be mocked for faster, deterministic tests

3. **Test Content**:
   - `/` - Site root
   - `/lecc` - Test page with chatbot block (from `fixtures/api/lecc-page.json`)

## Known Limitations

### Current Implementation
1. **Uses Production Onyx API**: Tests interact with live production AI service via proxy
   - Pros: Tests real AI behavior, no mocking needed
   - Cons: Slower, depends on external service, responses vary

2. **Requires Running Volto**: Tests need local Volto instance running
   - Slower startup than pure mock approach
   - But tests real component in real Volto environment

### Future Enhancements

#### Phase 1: Mock Danswer API (Planned)
- Create mock streaming responses with controlled `agent_piece` packets
- Faster, more reliable tests
- Test error scenarios and edge cases
- Make tests deterministic

#### Phase 2: Standalone Test Mode (Optional)
- Investigate if tests can run against compiled Volto bundle
- Potentially faster setup
- Trade-off: Less accurate to production environment

#### Phase 3: Additional Tests
- Citations and sources display
- Feedback mechanism (thumbs up/down)
- Error states and edge cases
- Accessibility testing
- Visual regression testing

## Debugging

### See Browser While Testing
```bash
pnpm test:playwright:headed
```

### Interactive UI Mode
```bash
pnpm test:playwright:ui
```

### Step-by-step Debugging
```bash
pnpm test:playwright:debug
```

### Check Servers Manually

Start servers independently for debugging:

```bash
# Terminal 1: Start mock Plone API manually
cd tests-playwright
node fixtures/mock-plone-server.js

# Terminal 2: Start Volto manually
RAZZLE_API_PATH=http://localhost:8090 pnpm start

# Test endpoints
curl http://localhost:8090/++api++/@site
curl http://localhost:8090/++api++/lecc

# Visit in browser
open http://localhost:3010/lecc
```

### Debug Mode
```bash
# Run mock server with debug output
DEBUG=* node tests-playwright/fixtures/mock-plone-server.js
```

## CI/CD Integration

Tests can be run in CI pipelines. Playwright handles server startup automatically:

```yaml
# Example GitHub Actions workflow
- name: Install dependencies
  run: pnpm install

- name: Build dependencies
  run: pnpm build:deps

- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium

- name: Run Playwright tests
  run: pnpm --filter @eeacms/volto-chatbot test:playwright
  env:
    CI: true
```

**Note**: The `CI=true` environment variable ensures Playwright doesn't reuse existing servers and properly manages server lifecycle.

## Troubleshooting

### Build errors or missing dependencies
- **Run `pnpm build:deps` first**: This is required once before running tests
- Builds @plone/registry and @plone/components
- If you see errors about missing modules, try this step

### Tests timeout on first run
- **Normal**: First run takes ~5 minutes for Volto webpack compilation
- Check Playwright output for "Waiting for http://localhost:3010" message
- Volto compilation progress is logged to console
- Subsequent runs are much faster (reuses existing server)

### Port already in use errors
- **Port 8090 (Mock API)**: `lsof -ti:8080 | xargs kill -9`
- **Port 3010 (Volto)**: `lsof -ti:3000 | xargs kill -9`
- Or change ports in `mock-plone-server.js`, `global-setup.ts`, and `playwright.config.ts`

### Tests timeout waiting for chatbot
- Verify Volto started successfully (check Playwright output)
- Manually visit http://localhost:3010/lecc to debug
- Check browser console for errors
- Verify volto-chatbot addon is loaded in Volto
- Try increasing timeout in test

### TypeScript errors
- Run `npx tsc --noEmit` to check for type errors
- Check that `@playwright/test` and `@types/node` are installed

### Tests fail with "Cannot find chatbot"
- Verify the chatbot block is configured correctly in `fixtures/api/lecc-page.json`
- Check that volto-chatbot addon is loaded in Volto
- Inspect page HTML to verify chatbot components are rendered

## Contributing

When adding new tests:
1. Follow existing test patterns
2. Use ChatbotHelper methods for consistency
3. Add appropriate waits (don't use arbitrary timeouts)
4. Test both success and edge cases
5. Update this README if adding new features

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Test API](https://playwright.dev/docs/api/class-test)
- [volto-hydra Test Setup](../../../hydraadmin/volto-hydra/tests-playwright/) - Reference implementation
