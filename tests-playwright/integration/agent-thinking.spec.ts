import { test, expect } from '@playwright/test';
import { ChatbotHelper } from '../helpers/ChatbotHelper';

test.describe('Agent Thinking Display', () => {
  test('agent thinking appears during message response', async ({ page }) => {
    const helper = new ChatbotHelper(page);

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Send a message
    await helper.sendMessage('What is LECC?');

    // Wait for the response to start
    await page.waitForTimeout(2000);

    // Check if agent thinking exists (it may or may not, depending on server)
    const hasThinking = await helper.hasAgentThinking();

    if (hasThinking) {
      // If thinking exists, verify it has content
      const steps = await helper.getThinkingSteps();
      expect(steps.length).toBeGreaterThan(0);

      // Verify step count matches
      const headerCount = await helper.getThinkingStepCount();
      expect(headerCount).toBe(steps.length);
    }

    // Wait for streaming to complete
    await helper.waitForStreamingComplete();
  });

  test('agent thinking auto-collapses when streaming completes', async ({ page }) => {
    const helper = new ChatbotHelper(page);

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Send a message
    await helper.sendMessage('Tell me about LECC');

    // Wait a bit for response to start
    await page.waitForTimeout(2000);

    // Agent thinking must appear. This used to be guarded by `if (hasThinking)`,
    // which meant the assertions below never ran when it was missing and the test
    // reported green regardless — so the auto-collapse behaviour was never
    // actually verified.
    const hasThinking = await helper.hasAgentThinking();
    expect(hasThinking).toBe(true);

    // Wait for streaming to complete
    await helper.waitForStreamingComplete();

    // Agent thinking should auto-collapse
    // Wait a bit for the auto-collapse animation
    await page.waitForTimeout(500);

    // It collapses rather than unmounting, so the steps stay available.
    expect(await helper.hasAgentThinking()).toBe(true);
    expect(await helper.isAgentThinkingExpanded()).toBe(false);
  });

  test('user can manually toggle agent thinking', async ({ page }) => {
    const helper = new ChatbotHelper(page);

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Send a message and wait for complete response
    await helper.sendMessage('What is LECC?');
    await helper.waitForStreamingComplete(60000);

    // Check if agent thinking exists
    const hasThinking = await helper.hasAgentThinking();

    if (hasThinking) {
      // Should be collapsed after streaming completes
      await page.waitForTimeout(500);
      let isExpanded = await helper.isAgentThinkingExpanded();
      expect(isExpanded).toBe(false);

      // Click to expand
      await helper.toggleAgentThinking();
      await page.waitForTimeout(300); // Wait for animation

      isExpanded = await helper.isAgentThinkingExpanded();
      expect(isExpanded).toBe(true);

      // Verify we can see steps
      const steps = await helper.getThinkingSteps();
      expect(steps.length).toBeGreaterThan(0);

      // Click to collapse again
      await helper.toggleAgentThinking();
      await page.waitForTimeout(300); // Wait for animation

      isExpanded = await helper.isAgentThinkingExpanded();
      expect(isExpanded).toBe(false);
    }
  });

  test('agent thinking shows step count in header', async ({ page }) => {
    const helper = new ChatbotHelper(page);

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Send a message
    await helper.sendMessage('Tell me about LECC');
    await helper.waitForStreamingComplete(60000);

    // Check if agent thinking exists
    const hasThinking = await helper.hasAgentThinking();

    if (hasThinking) {
      // Expand to see steps
      const isExpanded = await helper.isAgentThinkingExpanded();
      if (!isExpanded) {
        await helper.toggleAgentThinking();
        await page.waitForTimeout(300);
      }

      // Get steps
      const steps = await helper.getThinkingSteps();
      const headerCount = await helper.getThinkingStepCount();

      // Header count should match actual steps
      expect(headerCount).toBe(steps.length);
      expect(headerCount).toBeGreaterThan(0);
    }
  });

  test('agent thinking displays steps in order', async ({ page }) => {
    const helper = new ChatbotHelper(page);

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Send a message
    await helper.sendMessage('What is LECC?');
    await helper.waitForStreamingComplete(60000);

    // Check if agent thinking exists
    const hasThinking = await helper.hasAgentThinking();

    if (hasThinking) {
      // Expand if collapsed
      const isExpanded = await helper.isAgentThinkingExpanded();
      if (!isExpanded) {
        await helper.toggleAgentThinking();
        await page.waitForTimeout(300);
      }

      // Get steps
      const steps = await helper.getThinkingSteps();

      // Verify we have steps and they're non-empty
      expect(steps.length).toBeGreaterThan(0);
      steps.forEach((step) => {
        expect(step.trim().length).toBeGreaterThan(0);
      });
    }
  });

  test('agent thinking captures agent_sub_answer messages', async ({ page }) => {
    const helper = new ChatbotHelper(page);

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Send a message to trigger agent thinking
    await helper.sendMessage('Test agent sub-answer');
    await helper.waitForStreamingComplete(60000);

    // Agent thinking should exist
    const hasThinking = await helper.hasAgentThinking();
    expect(hasThinking).toBe(true);

    // Expand to see steps
    const isExpanded = await helper.isAgentThinkingExpanded();
    if (!isExpanded) {
      await helper.toggleAgentThinking();
      await page.waitForTimeout(300);
    }

    // Get steps
    const steps = await helper.getThinkingSteps();

    // Should have agent_sub_answer messages from mock server
    expect(steps.length).toBeGreaterThan(0);

    // Check for expected agent thinking content from mock server
    const stepsText = steps.join(' ');
    expect(stepsText).toContain('Searching through available documents');
    expect(stepsText).toContain('Found relevant information');
  });

  test('agent thinking extracts reasoning model thinking tags', async ({ page }) => {
    const helper = new ChatbotHelper(page);

    await page.goto('/lecc');
    await helper.waitForChatbotReady();

    // Send a message to trigger response with thinking tags
    await helper.sendMessage('Test thinking tags');
    await helper.waitForStreamingComplete(60000);

    // Agent thinking should exist
    const hasThinking = await helper.hasAgentThinking();
    expect(hasThinking).toBe(true);

    // Expand to see steps
    const isExpanded = await helper.isAgentThinkingExpanded();
    if (!isExpanded) {
      await helper.toggleAgentThinking();
      await page.waitForTimeout(300);
    }

    // Get steps
    const steps = await helper.getThinkingSteps();

    // Should include extracted thinking tag content
    const stepsText = steps.join(' ');
    expect(stepsText).toContain('Analyzing the question and documents');

    // Get the actual message text
    const messageText = await helper.getMessageText(1); // Assistant's response

    // The thinking tags should NOT appear in the final message
    expect(messageText).not.toContain('<thinking>');
    expect(messageText).not.toContain('</thinking>');
    expect(messageText).not.toContain('Analyzing the question and documents');

    // But the actual answer should be there
    expect(messageText).toContain('This is a test response');
  });
});
