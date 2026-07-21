import { transcribe } from '../mocks/stt.js';
import { synthesize } from '../mocks/tts.js';
import { findItemByName } from '../state/menu-loader.js';
import { SessionManager } from '../state/session.js';
import { createBoundTools } from '../tools/registry.js';
import type { ConversationMessage } from '../types/conversation.js';
import type { Menu } from '../types/menu.js';
import type { OrderState } from '../types/order.js';
import type { LLMClient, LLMResponse } from './llm-client.js';
import { buildSystemPrompt } from './prompt-builder.js';

export class Orchestrator {
  private readonly session: SessionManager;
  private readonly llmClient: LLMClient;
  private readonly menu: Menu;

  constructor(menu: Menu, llmClient: LLMClient) {
    this.menu = structuredClone(menu);
    this.session = new SessionManager();
    this.llmClient = llmClient;
  }

  async processUserInput(rawInput: string): Promise<string> {
    const transcribedText = transcribe(rawInput);
    if (!transcribedText) {
      return 'I did not catch that. What would you like to order?';
    }

    const orderBeforeTurn = this.session.getOrderState();
    this.session.addMessage('user', transcribedText);
    this.session.addModelMessage({ role: 'user', content: transcribedText });

    const systemPrompt = buildSystemPrompt(
      this.menu,
      this.session.getOrderState(),
      this.session.getLastMentionedItem(),
    );
    const tools = createBoundTools(this.session, this.menu);
    const response = await this.llmClient.generateResponse(
      systemPrompt,
      this.session.getModelHistory(),
      tools,
    );
    const agentReply =
      response.text.trim() || 'I am sorry, I could not complete that request.';

    this.session.addMessage('assistant', agentReply);
    if (response.responseMessages?.length) {
      this.session.addModelMessages(response.responseMessages);
    } else {
      this.session.addModelMessage({ role: 'assistant', content: agentReply });
    }
    this.updateLastMentionedItem(response, transcribedText, orderBeforeTurn);
    synthesize(agentReply);
    return agentReply;
  }

  getOrderState(): OrderState {
    return this.session.getOrderState();
  }

  getConversationLog(): ConversationMessage[] {
    return this.session.getConversationHistory();
  }

  private updateLastMentionedItem(
    response: LLMResponse,
    userInput: string,
    orderBeforeTurn: OrderState,
  ): void {
    const explicitId = response.referencedItemIds?.at(-1);
    if (explicitId) {
      this.session.setLastMentionedItem(explicitId);
      return;
    }

    const currentOrder = this.session.getOrderState();
    const changedItem = currentOrder.items.find((item) => {
      const previous = orderBeforeTurn.items.find(
        (candidate) => candidate.menuItemId === item.menuItemId,
      );
      return previous?.quantity !== item.quantity;
    });
    if (changedItem) {
      this.session.setLastMentionedItem(changedItem.menuItemId);
      return;
    }

    const nameMatch = findItemByName(userInput, this.menu);
    if (nameMatch && !Array.isArray(nameMatch)) {
      this.session.setLastMentionedItem(nameMatch.id);
    }
  }
}
