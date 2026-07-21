import type { OrderState } from './order.js';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  timestamp: Date;
}

export interface SessionContext {
  conversationHistory: ConversationMessage[];
  orderState: OrderState;
  lastMentionedItemId?: string;
}
