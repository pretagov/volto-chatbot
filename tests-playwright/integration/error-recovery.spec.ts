import { test, expect } from '@playwright/test';
import { ChatbotHelper } from '../helpers/ChatbotHelper';

test.describe('Health Check Before Submit', () => {
  test('waits for health check before creating session', async ({ page }) => {
    const helper = new ChatbotHelper(page);
    const testMessage = 'Test message after health check';
    let healthCheckCalled = false;
    let healthCheckResolve: () => void;

    // Create a promise we control for the health check
    const healthCheckPromise = new Promise<void>((resolve) => {
      healthCheckResolve = resolve;
    });

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Intercept health check - delay it to verify session waits
    await page.route('**/_da/health*', async (route) => {
      healthCheckCalled = true;
      // Wait a bit before responding to simulate slow wake
      await new Promise((r) => setTimeout(r, 500));
      healthCheckResolve();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      });
    });

    // Intercept session creation to verify health check was called first
    await page.route('**/_da/chat/create-chat-session', async (route) => {
      // Verify health check was called first
      expect(healthCheckCalled).toBe(true);
      await route.continue();
    });

    // Send message
    await helper.sendMessage(testMessage);

    // Wait for health check to complete
    await healthCheckPromise;

    // Give time for session creation to be called
    await page.waitForTimeout(1000);

    // Both should have been called, health check first
    expect(healthCheckCalled).toBe(true);
  });

  test('shows error when health check fails before submit', async ({ page }) => {
    const helper = new ChatbotHelper(page);
    const testMessage = 'Test message with failed health';

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Make health check fail
    await page.route('**/_da/health*', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service unavailable' }),
      });
    });

    // Send message
    await helper.sendMessage(testMessage);

    // Should show error
    await helper.waitForError(10000);
    const hasError = await helper.hasError();
    expect(hasError).toBe(true);

    // Message should be restored for retry
    const inputValue = await helper.getInputValue();
    expect(inputValue).toBe(testMessage);
  });
});

test.describe('Error Recovery', () => {
  test('restores message to input when API request fails', async ({ page }) => {
    const helper = new ChatbotHelper(page);
    const testMessage = 'This is my test question that should be restored';

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Intercept the send-message API call and make it fail
    await page.route('**/_da/chat/send-message', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    // Type the message
    await helper.typeMessage(testMessage);

    // Verify input has the message before sending
    const inputBefore = await helper.getInputValue();
    expect(inputBefore).toBe(testMessage);

    // Click send
    await helper.clickSend();

    // Wait for error to appear
    await helper.waitForError(10000);

    // Verify error is displayed
    const hasError = await helper.hasError();
    expect(hasError).toBe(true);

    // The message should be restored to the input
    const inputAfter = await helper.getInputValue();
    expect(inputAfter).toBe(testMessage);
  });

  test('clears restored message after successful retry', async ({ page }) => {
    const helper = new ChatbotHelper(page);
    const testMessage = 'Test message for retry';
    let callCount = 0;

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // First call fails, second succeeds
    await page.route('**/_da/chat/send-message', async (route) => {
      callCount++;
      if (callCount === 1) {
        // First call - fail
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporary error' }),
        });
      } else {
        // Subsequent calls - let them through
        await route.continue();
      }
    });

    // Send message - should fail
    await helper.sendMessage(testMessage);
    await helper.waitForError(10000);

    // Message should be restored
    const inputAfterError = await helper.getInputValue();
    expect(inputAfterError).toBe(testMessage);

    // Now retry - should succeed
    await helper.clickSend();

    // Wait for response
    await helper.waitForStreamingComplete(60000);

    // Error should be gone
    const hasError = await helper.hasError();
    expect(hasError).toBe(false);

    // Input should be cleared after successful send
    const inputAfterSuccess = await helper.getInputValue();
    expect(inputAfterSuccess).toBe('');
  });
});
