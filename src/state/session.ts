import type { ModelMessage } from '@ai-sdk/provider-utils';

import type {
  ConversationMessage,
  MessageRole,
  SessionContext,
} from '../types/conversation.js';
import type { OrderState } from '../types/order.js';
import { createEmptyOrder } from './order-manager.js';

function cloneOrder(state: OrderState): OrderState {
  return {
    ...state,
    items: state.items.map((item) => ({ ...item })),
  };
}

function cloneMessage(message: ConversationMessage): ConversationMessage {
  return { ...message, timestamp: new Date(message.timestamp) };
}

function cloneModelMessage(message: ModelMessage): ModelMessage {
  return structuredClone(message);
}

export class SessionManager {
  private orderState: OrderState = createEmptyOrder();
  private conversationHistory: ConversationMessage[] = [];
  private modelHistory: ModelMessage[] = [];
  private lastMentionedItemId?: string;

  addMessage(role: MessageRole, content: string): void {
    this.conversationHistory.push({ role, content, timestamp: new Date() });
  }

  addModelMessage(message: ModelMessage): void {
    this.modelHistory.push(cloneModelMessage(message));
  }

  addModelMessages(messages: ModelMessage[]): void {
    this.modelHistory.push(...messages.map(cloneModelMessage));
  }

  getOrderState(): OrderState {
    return cloneOrder(this.orderState);
  }

  updateOrderState(newState: OrderState): void {
    this.orderState = cloneOrder(newState);
  }

  setLastMentionedItem(itemId: string): void {
    this.lastMentionedItemId = itemId;
  }

  clearLastMentionedItem(): void {
    delete this.lastMentionedItemId;
  }

  getLastMentionedItem(): string | undefined {
    return this.lastMentionedItemId;
  }

  getContext(): SessionContext {
    const context: SessionContext = {
      conversationHistory: this.getConversationHistory(),
      modelHistory: this.getModelHistory(),
      orderState: this.getOrderState(),
    };
    if (this.lastMentionedItemId !== undefined) {
      context.lastMentionedItemId = this.lastMentionedItemId;
    }
    return context;
  }

  getConversationHistory(): ConversationMessage[] {
    return this.conversationHistory.map(cloneMessage);
  }

  getModelHistory(): ModelMessage[] {
    return this.modelHistory.map(cloneModelMessage);
  }
}
