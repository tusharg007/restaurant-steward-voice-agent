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

export class SessionManager {
  private orderState: OrderState = createEmptyOrder();
  private conversationHistory: ConversationMessage[] = [];
  private lastMentionedItemId?: string;

  addMessage(role: MessageRole, content: string): void {
    this.conversationHistory.push({ role, content, timestamp: new Date() });
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

  getLastMentionedItem(): string | undefined {
    return this.lastMentionedItemId;
  }

  getContext(): SessionContext {
    const context: SessionContext = {
      conversationHistory: this.getConversationHistory(),
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
}
