import { test, expect } from '@playwright/test';
import { ChatbotHelper } from '../helpers/ChatbotHelper';

test.describe('Message Sending', () => {
  test('can load the chatbot page', async ({ page }) => {
    await page.goto('/lecc');

    // Check that the page loaded
    await expect(page).toHaveTitle(/LECC/);

    // Check that chatbot is present by looking for textarea
    const helper = new ChatbotHelper(page);
    await helper.waitForChatbotReady();
    const textarea = helper.getChatInput();
    await expect(textarea).toBeVisible();
  });

  test('can send a message and receive response', async ({ page }) => {
    const helper = new ChatbotHelper(page);

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Get initial message count
    const initialCount = await helper.getMessageCount();

    // Send a message
    await helper.sendMessage('What is LECC?');

    // Wait for user message to appear
    await helper.waitForMessageCount(initialCount + 1);

    // Wait for assistant response
    await helper.waitForMessageCount(initialCount + 2, 60000);

    // Wait for streaming to complete
    await helper.waitForStreamingComplete();

    // Verify we have messages
    const finalCount = await helper.getMessageCount();
    expect(finalCount).toBeGreaterThanOrEqual(initialCount + 2);

    // Verify last message has content
    const lastMessage = await helper.getLastMessageText();
    expect(lastMessage.length).toBeGreaterThan(0);
  });

  test('response streams in gradually', async ({ page }) => {
    const helper = new ChatbotHelper(page);

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    const initialCount = await helper.getMessageCount();

    // Type and send message
    await helper.typeMessage('Tell me about LECC');
    await helper.clickSend();

    // Wait for user message
    await helper.waitForMessageCount(initialCount + 1);

    // Wait a bit and check if streaming indicator appears
    await page.waitForTimeout(1000);

    // Eventually streaming should complete
    await helper.waitForStreamingComplete(60000);

    // Should have received a response
    const finalCount = await helper.getMessageCount();
    expect(finalCount).toBe(initialCount + 2);
  });

  test('can send multiple messages in sequence', async ({ page }) => {
    const helper = new ChatbotHelper(page);

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    const initialCount = await helper.getMessageCount();

    // Send first message
    await helper.sendMessage('What is LECC?');
    await helper.waitForMessageCount(initialCount + 2, 60000);
    await helper.waitForStreamingComplete();

    // Send second message
    await helper.sendMessage('Can you tell me more?');
    await helper.waitForMessageCount(initialCount + 4, 60000);
    await helper.waitForStreamingComplete();

    // Verify we have all messages
    const finalCount = await helper.getMessageCount();
    expect(finalCount).toBe(initialCount + 4);
  });
});
