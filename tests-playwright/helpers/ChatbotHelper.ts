import { Page, Locator } from '@playwright/test';

export class ChatbotHelper {
  constructor(private page: Page) {}

  /**
   * Get the chat input textarea
   */
  getChatInput(): Locator {
    return this.page.locator('textarea[placeholder*="Ask"]').first();
  }

  /**
   * Get the send button
   */
  getSendButton(): Locator {
    // Look for button near the textarea
    return this.page.locator('button[type="submit"]').first();
  }

  /**
   * Type a message in the chat input
   */
  async typeMessage(text: string): Promise<void> {
    const input = this.getChatInput();
    await input.click();
    await input.fill(text);
  }

  /**
   * Click the send button
   */
  async clickSend(): Promise<void> {
    const sendButton = this.getSendButton();
    await sendButton.click();
  }

  /**
   * Send a message (type + click send)
   */
  async sendMessage(text: string): Promise<void> {
    await this.typeMessage(text);
    await this.clickSend();
  }

  /**
   * Get all message bubbles
   */
  getMessages(): Locator {
    return this.page.locator('.comment');
  }

  /**
   * Get the count of messages
   */
  async getMessageCount(): Promise<number> {
    return await this.getMessages().count();
  }

  /**
   * Get a specific message by index (0-based)
   */
  getMessage(index: number): Locator {
    return this.getMessages().nth(index);
  }

  /**
   * Get the last message
   */
  getLastMessage(): Locator {
    return this.getMessages().last();
  }

  /**
   * Get the text content of a message
   */
  async getMessageText(index: number): Promise<string> {
    const message = this.getMessage(index);
    // Get the text content directly from the message element
    return await message.textContent() || '';
  }

  /**
   * Get the last message text
   */
  async getLastMessageText(): Promise<string> {
    const count = await this.getMessageCount();
    if (count === 0) return '';
    return await this.getMessageText(count - 1);
  }

  /**
   * Get the agent thinking section
   */
  getAgentThinking(): Locator {
    return this.page.locator('.agent-thinking');
  }

  /**
   * Check if agent thinking section exists
   */
  async hasAgentThinking(): Promise<boolean> {
    const agentThinking = this.getAgentThinking();
    return await agentThinking.count() > 0;
  }

  /**
   * Check if agent thinking is expanded
   */
  async isAgentThinkingExpanded(): Promise<boolean> {
    const agentThinking = this.getAgentThinking();
    const stepsDiv = agentThinking.locator('.thinking-steps');
    return await stepsDiv.isVisible();
  }

  /**
   * Click the agent thinking header to toggle expand/collapse
   */
  async toggleAgentThinking(): Promise<void> {
    const header = this.getAgentThinking().locator('.thinking-header');
    await header.click();
  }

  /**
   * Get the agent thinking steps
   */
  async getThinkingSteps(): Promise<string[]> {
    const stepsDiv = this.getAgentThinking().locator('.thinking-steps');
    const steps = stepsDiv.locator('.thinking-step');
    const count = await steps.count();

    const stepTexts: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await steps.nth(i).textContent();
      if (text) stepTexts.push(text);
    }

    return stepTexts;
  }

  /**
   * Get the agent thinking step count from header
   */
  async getThinkingStepCount(): Promise<number> {
    const header = this.getAgentThinking().locator('.thinking-header');
    const text = await header.textContent();
    // Extract number from "Agent thinking (N steps)"
    const match = text?.match(/\((\d+) steps?\)/);
    return match ? parseInt(match[1]) : 0;
  }

  /**
   * Check if chatbot is currently streaming (has spinner or loading indicator)
   */
  async isStreaming(): Promise<boolean> {
    const loader = this.page.locator('.loader');
    return await loader.isVisible();
  }

  /**
   * Wait for streaming to complete
   */
  async waitForStreamingComplete(timeout: number = 30000): Promise<void> {
    const loader = this.page.locator('.loader');
    await loader.waitFor({ state: 'hidden', timeout });
  }

  /**
   * Wait for a specific number of messages
   */
  async waitForMessageCount(count: number, timeout: number = 30000): Promise<void> {
    await this.page.waitForFunction(
      (expectedCount) => {
        const messages = document.querySelectorAll('.comment');
        return messages.length >= expectedCount;
      },
      count,
      { timeout }
    );
  }

  /**
   * Wait for a new message to appear
   */
  async waitForNewMessage(previousCount: number, timeout: number = 30000): Promise<void> {
    await this.waitForMessageCount(previousCount + 1, timeout);
  }

  /**
   * Wait for agent thinking to appear
   */
  async waitForAgentThinkingToAppear(timeout: number = 10000): Promise<void> {
    const agentThinking = this.getAgentThinking();
    await agentThinking.waitFor({ state: 'visible', timeout });
  }

  /**
   * Wait for agent thinking to collapse
   */
  async waitForAgentThinkingToCollapse(timeout: number = 10000): Promise<void> {
    const stepsDiv = this.getAgentThinking().locator('.thinking-steps');
    await stepsDiv.waitFor({ state: 'hidden', timeout });
  }

  /**
   * Wait for chatbot to be ready (textarea visible)
   */
  async waitForChatbotReady(timeout: number = 30000): Promise<void> {
    await this.getChatInput().waitFor({ state: 'visible', timeout });
  }

  /**
   * Get the error message element
   */
  getErrorMessage(): Locator {
    return this.page.locator('#chat-wake-error-message');
  }

  /**
   * Check if an error is displayed
   */
  async hasError(): Promise<boolean> {
    const error = this.getErrorMessage();
    return await error.isVisible();
  }

  /**
   * Get the error message text
   */
  async getErrorText(): Promise<string> {
    const error = this.getErrorMessage();
    return await error.textContent() || '';
  }

  /**
   * Wait for an error to appear
   */
  async waitForError(timeout: number = 30000): Promise<void> {
    await this.getErrorMessage().waitFor({ state: 'visible', timeout });
  }

  /**
   * Get the current value of the chat input
   */
  async getInputValue(): Promise<string> {
    const input = this.getChatInput();
    return await input.inputValue();
  }
}
