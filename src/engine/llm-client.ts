import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs } from 'ai';

import {
  findItemByName,
  getAvailableItems,
  getItemsByTag,
} from '../state/menu-loader.js';
import type { ConversationMessage } from '../types/conversation.js';
import type { Menu, MenuItem } from '../types/menu.js';
import type { OrderState } from '../types/order.js';
import type { AgentTools } from '../tools/registry.js';
import type { OrderToolResult } from '../tools/add-to-order.js';
import type { AvailabilityResult } from '../tools/check-availability.js';
import type { OrderSummaryResult } from '../tools/get-order-summary.js';
import type { ModifyOrderResult } from '../tools/modify-order.js';

export interface LLMResponse {
  text: string;
  referencedItemIds?: string[];
}

export interface LLMClient {
  generateResponse(
    systemPrompt: string,
    messages: ConversationMessage[],
    tools: AgentTools,
  ): Promise<LLMResponse>;
}

export interface OpenAIClientOptions {
  apiKey: string;
  model?: string;
}

export class OpenAIClient implements LLMClient {
  private readonly provider: ReturnType<typeof createOpenAI>;
  private readonly model: string;

  constructor({ apiKey, model = 'gpt-4o-mini' }: OpenAIClientOptions) {
    this.provider = createOpenAI({ apiKey });
    this.model = model;
  }

  async generateResponse(
    systemPrompt: string,
    messages: ConversationMessage[],
    tools: AgentTools,
  ): Promise<LLMResponse> {
    const modelMessages = messages
      .filter(
        (message): message is ConversationMessage & {
          role: 'user' | 'assistant';
        } => message.role === 'user' || message.role === 'assistant',
      )
      .map(({ role, content }) => ({ role, content }));

    const result = await generateText({
      model: this.provider(this.model),
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(5),
    });

    return { text: result.text.trim() };
  }
}

type ToolExecutor = (
  input: unknown,
  options: unknown,
) => unknown | PromiseLike<unknown>;

const quantityWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('en-IN')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularizeToken(token: string): string {
  return token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token;
}

function stemmed(value: string): string {
  return normalize(value).split(' ').map(singularizeToken).join(' ');
}

function parseQuantity(input: string): number {
  const normalized = normalize(input);
  const numeric = normalized.match(/\b(\d+)\b/);
  if (numeric?.[1]) {
    return Number.parseInt(numeric[1], 10);
  }

  for (const [word, value] of Object.entries(quantityWords)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) {
      return value;
    }
  }
  return 1;
}

function menuItems(menu: Menu): MenuItem[] {
  return menu.categories.flatMap((category) => category.items);
}

function resolveMentionedItems(input: string, menu: Menu): MenuItem[] {
  const normalizedInput = normalize(input);
  const stemmedInput = stemmed(input);
  const items = menuItems(menu);
  const directMatches = items.filter((item) => {
    const itemName = normalize(item.name);
    const words = itemName.split(' ');
    const aliases = [itemName];
    if (words.length >= 3) {
      aliases.push(words.slice(1).join(' '));
    }
    return aliases.some(
      (alias) =>
        normalizedInput.includes(alias) || stemmedInput.includes(stemmed(alias)),
    );
  });

  if (directMatches.length > 0) {
    return directMatches;
  }

  const stopWords = new Set([
    'actually',
    'available',
    'cancel',
    'change',
    'have',
    'make',
    'menu',
    'order',
    'remove',
    'spicy',
    'that',
    'this',
    'vegan',
    'what',
  ]);
  const candidates = new Map<string, MenuItem>();
  for (const token of stemmedInput.split(' ')) {
    if (token.length < 4 || stopWords.has(token) || quantityWords[token]) {
      continue;
    }
    const result = findItemByName(token, menu);
    if (Array.isArray(result)) {
      result.forEach((item) => candidates.set(item.id, item));
    } else if (result) {
      candidates.set(result.id, result);
    }
  }
  return [...candidates.values()];
}

function formatMoney(value: number): string {
  return `₹${value.toLocaleString('en-IN')}`;
}

async function runTool<T>(toolDefinition: unknown, input: unknown): Promise<T> {
  const execute = (toolDefinition as { execute?: ToolExecutor }).execute;
  if (!execute) {
    throw new Error('A required tool has no execute function.');
  }
  return (await execute(input, {})) as T;
}

export class MockLLMClient implements LLMClient {
  private readonly menu: Menu;
  private lastMentionedItemId?: string;

  constructor(menu: Menu) {
    this.menu = structuredClone(menu);
  }

  async generateResponse(
    _systemPrompt: string,
    messages: ConversationMessage[],
    tools: AgentTools,
  ): Promise<LLMResponse> {
    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'user');
    const input = latestUserMessage?.content ?? '';
    const normalized = normalize(input);
    const mentionedItems = resolveMentionedItems(input, this.menu);
    const referencedItemIds = mentionedItems.map((item) => item.id);

    if (/\bvegan\b/.test(normalized)) {
      const veganItems = getItemsByTag('vegan', this.menu).filter(
        (item) => item.available,
      );
      return {
        text: `Our vegan options are ${veganItems.map((item) => `${item.name} (${formatMoney(item.price)})`).join(', ')}.`,
        referencedItemIds: veganItems.map((item) => item.id),
      };
    }

    if (/\bspic(y|e|iness)\b/.test(normalized)) {
      if (mentionedItems.length !== 1) {
        return {
          text:
            mentionedItems.length > 1
              ? `Did you mean ${mentionedItems.map((item) => item.name).join(' or ')}?`
              : 'Which menu item would you like to know about?',
          referencedItemIds,
        };
      }
      const item = mentionedItems[0]!;
      this.lastMentionedItemId = item.id;
      return {
        text: `${item.name} has a ${item.spiceLevel ?? 'not specified'} spice level. ${item.description}.`,
        referencedItemIds: [item.id],
      };
    }

    if (
      /\b(what.*available|what.*have|show.*menu|recommend|menu)\b/.test(
        normalized,
      ) && mentionedItems.length === 0
    ) {
      const categorySummary = this.menu.categories
        .map((category) => {
          const available = category.items.filter((item) => item.available);
          return `${category.name}: ${available.map((item) => item.name).join(', ')}`;
        })
        .join('; ');
      return { text: `Here are today's available choices - ${categorySummary}.` };
    }

    const summary = await runTool<OrderSummaryResult>(tools.getOrderSummary, {});

    if (/\b(summary|current order|what.*ordered|that s all|done)\b/.test(normalized)) {
      return { text: summary.formattedSummary };
    }

    const wantsRemoval = /\b(cancel|remove|delete)\b/.test(normalized);
    const wantsQuantityChange = /\b(make it|change|update|quantity)\b/.test(
      normalized,
    );

    if (mentionedItems.length > 1 && !wantsRemoval) {
      const explicitlyListsMultipleItems = /\b(and|plus)\b|,/.test(normalized);
      if (!explicitlyListsMultipleItems) {
        return {
          text: `Did you mean ${mentionedItems.map((item) => item.name).join(' or ')}?`,
          referencedItemIds,
        };
      }
    }

    if ((wantsRemoval || wantsQuantityChange) && mentionedItems.length === 0) {
      let targetId = this.lastMentionedItemId;
      if (!targetId && summary.items.length === 1) {
        targetId = summary.items[0]!.menuItemId;
      }
      if (!targetId || !summary.items.some((item) => item.menuItemId === targetId)) {
        return {
          text:
            summary.items.length > 1
              ? `${wantsRemoval ? 'Remove' : 'Update'} which item?`
              : 'There is no matching item in your order to update.',
        };
      }

      const action = wantsRemoval ? 'remove' : 'update_quantity';
      const modification = await runTool<ModifyOrderResult>(tools.modifyOrder, {
        itemId: targetId,
        action,
        ...(action === 'update_quantity'
          ? { newQuantity: parseQuantity(input) }
          : {}),
      });
      if (modification.success) {
        this.lastMentionedItemId = targetId;
      }
      return {
        text: `${modification.message} ${
          modification.success
            ? `Your total is ${formatMoney(modification.orderState.totalAmount)}.`
            : ''
        }`.trim(),
        referencedItemIds: [targetId],
      };
    }

    const removalTargets = wantsRemoval
      ? mentionedItems.filter((item) =>
          summary.items.some((orderItem) => orderItem.menuItemId === item.id),
        )
      : [];
    const additionTargets = wantsRemoval
      ? mentionedItems.filter(
          (item) => !removalTargets.some((target) => target.id === item.id),
        )
      : mentionedItems;

    const confirmations: string[] = [];
    let changed = false;
    for (const item of removalTargets) {
      const result = await runTool<ModifyOrderResult>(tools.modifyOrder, {
        itemId: item.id,
        action: 'remove',
      });
      confirmations.push(result.message);
      changed ||= result.success;
      if (result.success) {
        this.lastMentionedItemId = item.id;
      }
    }

    const requestedQuantity = parseQuantity(input);
    for (const item of additionTargets) {
      const existing = summary.items.find(
        (orderItem) => orderItem.menuItemId === item.id,
      );
      if (wantsQuantityChange && existing) {
        const result = await runTool<ModifyOrderResult>(tools.modifyOrder, {
          itemId: item.id,
          action: 'update_quantity',
          newQuantity: requestedQuantity,
        });
        confirmations.push(result.message);
        changed ||= result.success;
        if (result.success) {
          this.lastMentionedItemId = item.id;
        }
        continue;
      }

      const availability = await runTool<AvailabilityResult>(
        tools.checkAvailability,
        { itemName: item.name },
      );
      if (!availability.available || !availability.item) {
        const alternatives = availability.alternatives ?? [];
        confirmations.push(
          `${item.name} is unavailable${availability.reason ? ` - ${availability.reason}` : ''}. ${
            alternatives.length > 0
              ? `May I suggest ${alternatives.map((alternative) => `${alternative.name} (${formatMoney(alternative.price)})`).join(' or ')}?`
              : ''
          }`.trim(),
        );
        continue;
      }

      const result = await runTool<OrderToolResult>(tools.addToOrder, {
        itemId: item.id,
        quantity: requestedQuantity,
      });
      confirmations.push(result.message);
      changed ||= result.success;
      if (result.success) {
        this.lastMentionedItemId = item.id;
      }
    }

    if (confirmations.length > 0) {
      const latestSummary = await runTool<OrderSummaryResult>(
        tools.getOrderSummary,
        {},
      );
      return {
        text: `${confirmations.join(' ')}${
          changed ? ` Your total is ${formatMoney(latestSummary.totalAmount)}.` : ''
        }`,
        referencedItemIds,
      };
    }

    if (/\b(add|take|want|have|get|order)\b/.test(normalized)) {
      const available = getAvailableItems(this.menu).slice(0, 3);
      return {
        text: `I'm sorry, we don't have that on our menu. You could try ${available.map((item) => item.name).join(', ')}.`,
      };
    }

    return {
      text: 'I can help with menu recommendations, availability, and your order. What would you like?',
    };
  }
}
