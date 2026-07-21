import { createOpenAI } from '@ai-sdk/openai';
import type { ModelMessage } from '@ai-sdk/provider-utils';
import { generateText, stepCountIs, type LanguageModel } from 'ai';

import {
  findItemById,
  findItemByName,
  getAvailableItems,
  getItemsByTag,
} from '../state/menu-loader.js';
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
  responseMessages?: ModelMessage[];
  clearLastMentionedItem?: boolean;
}

export interface LLMRuntimeContext {
  lastMentionedItemId?: string;
}

export interface LLMClient {
  generateResponse(
    systemPrompt: string,
    messages: ModelMessage[],
    tools: AgentTools,
    context: LLMRuntimeContext,
  ): Promise<LLMResponse>;
}

export interface OpenAIClientOptions {
  apiKey: string;
  model?: string;
  generate?: OpenAIGenerate;
}

interface OpenAIGenerateOptions {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: AgentTools;
}

type OpenAIGenerate = (
  options: OpenAIGenerateOptions,
) => Promise<{ text: string; responseMessages: ModelMessage[] }>;

export class OpenAIClient implements LLMClient {
  private readonly provider: ReturnType<typeof createOpenAI>;
  private readonly model: string;
  private readonly generate: OpenAIGenerate;

  constructor({
    apiKey,
    model = 'gpt-4o-mini',
    generate,
  }: OpenAIClientOptions) {
    this.provider = createOpenAI({ apiKey });
    this.model = model;
    this.generate =
      generate ??
      (async (options) =>
        generateText({ ...options, stopWhen: stepCountIs(5) }));
  }

  async generateResponse(
    systemPrompt: string,
    messages: ModelMessage[],
    tools: AgentTools,
    _context: LLMRuntimeContext,
  ): Promise<LLMResponse> {
    const result = await this.generate({
      model: this.provider(this.model),
      system: systemPrompt,
      messages,
      tools,
    });

    return {
      text: result.text.trim(),
      // AI SDK v7 returns the accumulated assistant tool-call, tool-result,
      // and final assistant messages in provider-ready order.
      responseMessages: result.responseMessages,
    };
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
  const signedNumeric = input.match(/(?:^|\s)(-?\d+(?:\.\d+)?)\b/);
  if (signedNumeric?.[1]) {
    return Number(signedNumeric[1]);
  }

  const normalized = normalize(input);
  for (const [word, value] of Object.entries(quantityWords)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) {
      return value;
    }
  }
  return 1;
}

/**
 * Extract the quantity that immediately precedes a specific item name in the
 * input string. For example, given "2 Mango Lassi" and itemName "Mango Lassi",
 * this returns 2. Falls back to 1 when no per-item quantity is found.
 */
function parsePerItemQuantity(input: string, itemName: string): number {
  const normalizedInput = normalize(input);
  const normalizedName = normalize(itemName);
  const idx = normalizedInput.indexOf(normalizedName);
  if (idx <= 0) return 1;

  // Look at the token(s) immediately before the item name
  const preceding = normalizedInput.slice(0, idx).trim();
  const lastToken = preceding.split(' ').pop() ?? '';

  const numeric = Number(lastToken);
  if (Number.isInteger(numeric) && numeric >= 1) return numeric;
  if (quantityWords[lastToken]) return quantityWords[lastToken]!;
  return 1;
}

function isExplicitMultiItemListing(input: string, itemCount: number): boolean {
  return (
    itemCount >= 2 &&
    (/,/.test(input) || /\b(and|plus)\b/i.test(input))
  );
}

function menuItems(menu: Menu): MenuItem[] {
  return menu.categories.flatMap((category) => category.items);
}

function modelMessageText(message: ModelMessage): string {
  if (message.role === 'tool') {
    return '';
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part.type === 'text' && 'text' in part,
    )
    .map((part) => part.text)
    .join(' ');
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

  constructor(menu: Menu) {
    this.menu = structuredClone(menu);
  }

  async generateResponse(
    _systemPrompt: string,
    messages: ModelMessage[],
    tools: AgentTools,
    context: LLMRuntimeContext,
  ): Promise<LLMResponse> {
    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'user');
    const input = latestUserMessage ? modelMessageText(latestUserMessage) : '';
    const normalized = normalize(input);
    let mentionedItems = resolveMentionedItems(input, this.menu);
    if (
      mentionedItems.length === 0 &&
      /\b(it|that)\b/.test(normalized) &&
      context.lastMentionedItemId
    ) {
      const contextualItem = findItemById(
        context.lastMentionedItemId,
        this.menu,
      );
      if (contextualItem) {
        mentionedItems = [contextualItem];
      }
    }
    const referencedItemIds = mentionedItems.map((item) => item.id);

    if (/^(hi|hello|hey|good morning|good afternoon|good evening)$/.test(normalized)) {
      return {
        text: "Welcome to Namaste Kitchen! I'm here to help with your order. Would you like to see our menu?",
      };
    }

    if (/^(thanks|thank you|thank you very much)$/.test(normalized)) {
      return {
        text: "You're welcome! Is there anything else I can help you with?",
      };
    }

    if (/^(bye|goodbye|see you)$/.test(normalized)) {
      return { text: 'Goodbye! Thank you for visiting Namaste Kitchen.' };
    }

    // Handle "yes" / "sure" / "go ahead" confirmations.
    // If the previous assistant turn asked "Would you like to add X?", the
    // referenced items will be resolvable from the last assistant message.
    if (/^(yes|yeah|yep|sure|ok|okay|go ahead|please|do it|absolutely)$/.test(normalized)) {
      const previousAssistant = [...messages]
        .reverse()
        .find((message) => message.role === 'assistant');
      const previousText = previousAssistant
        ? modelMessageText(previousAssistant)
        : '';
      const previouslyMentioned = resolveMentionedItems(previousText, this.menu);
      if (previouslyMentioned.length > 0) {
        const confirmations: string[] = [];
        let changed = false;
        for (const item of previouslyMentioned) {
          const availability = await runTool<AvailabilityResult>(
            tools.checkAvailability,
            { itemName: item.name },
          );
          if (!availability.available || !availability.item) {
            confirmations.push(`${item.name} is unavailable.`);
            continue;
          }
          const result = await runTool<OrderToolResult>(tools.addToOrder, {
            itemId: item.id,
            quantity: 1,
          });
          confirmations.push(result.message);
          changed ||= result.success;
        }
        if (confirmations.length > 0) {
          const latestSummary = await runTool<OrderSummaryResult>(
            tools.getOrderSummary,
            {},
          );
          return {
            text: `${confirmations.join(' ')}${
              changed
                ? ` Your total is ${formatMoney(latestSummary.totalAmount)}.`
                : ''
            }`,
            referencedItemIds: previouslyMentioned.map((item) => item.id),
          };
        }
      }
      return {
        text: "Sure! What would you like to order?",
      };
    }

    if (/\bvegan\b/.test(normalized)) {
      const veganItems = getItemsByTag('vegan', this.menu).filter(
        (item) => item.available,
      );
      if (mentionedItems.length > 1) {
        return {
          text: `Which item do you mean: ${mentionedItems.map((item) => item.name).join(' or ')}?`,
          referencedItemIds,
        };
      }
      if (mentionedItems.length === 1) {
        const item = mentionedItems[0]!;
        const isVegan = item.tags.includes('vegan');
        const dietaryDescription = isVegan
          ? `${item.name} is vegan.`
          : item.tags.includes('vegetarian')
            ? `${item.name} is vegetarian, but it is not vegan.`
            : `${item.name} is not vegan.`;
        return {
          text: `${isVegan ? 'Yes' : 'No'}, ${dietaryDescription} ${item.description}. ${
            isVegan
              ? ''
              : `Our vegan options include ${veganItems.map((candidate) => candidate.name).join(', ')}.`
          }`.trim(),
          referencedItemIds: [item.id],
        };
      }
      return {
        text: `Our vegan options are ${veganItems.map((item) => `${item.name} (${formatMoney(item.price)})`).join(', ')}.`,
        referencedItemIds: veganItems.map((item) => item.id),
      };
    }

    const tagQuestion = [
      { pattern: /\bgluten free\b/, tag: 'gluten-free', label: 'gluten-free' },
      { pattern: /\bvegetarian\b/, tag: 'vegetarian', label: 'vegetarian' },
      { pattern: /\bnon veg\b/, tag: 'non-veg', label: 'non-vegetarian' },
      { pattern: /\bseafood\b/, tag: 'seafood', label: 'seafood' },
    ].find(({ pattern }) => pattern.test(normalized));
    if (tagQuestion) {
      if (mentionedItems.length > 1) {
        return {
          text: `Which item do you mean: ${mentionedItems.map((item) => item.name).join(' or ')}?`,
          referencedItemIds,
        };
      }
      if (mentionedItems.length === 1) {
        const item = mentionedItems[0]!;
        const matchesTag =
          item.tags.includes(tagQuestion.tag) ||
          (tagQuestion.tag === 'vegetarian' && item.tags.includes('vegan'));
        return {
          text: `${matchesTag ? 'Yes' : 'No'}, ${item.name} is${matchesTag ? '' : ' not'} ${tagQuestion.label}.`,
          referencedItemIds: [item.id],
        };
      }
      const taggedItems = getAvailableItems(this.menu).filter(
        (item) =>
          item.tags.includes(tagQuestion.tag) ||
          (tagQuestion.tag === 'vegetarian' && item.tags.includes('vegan')),
      );
      return {
        text: `Our ${tagQuestion.label} options are ${taggedItems
          .map((item) => `${item.name} (${formatMoney(item.price)})`)
          .join(', ')}.`,
        referencedItemIds: taggedItems.map((item) => item.id),
      };
    }

    const summary = await runTool<OrderSummaryResult>(tools.getOrderSummary, {});

    if (/\bspic(y|e|iness)\b/.test(normalized)) {
      // "Is there anything spicy in my order?" — check current order items
      if (
        mentionedItems.length === 0 &&
        /\b(my order|order|ordered)\b/.test(normalized)
      ) {
        const orderItems = summary.items;
        if (orderItems.length === 0) {
          return { text: 'Your order is empty, so there are no spicy items yet.' };
        }
        const spiceReport = orderItems
          .map((orderItem) => {
            const menuItem = findItemById(orderItem.menuItemId, this.menu);
            return menuItem
              ? { name: menuItem.name, spiceLevel: menuItem.spiceLevel ?? 'not specified' }
              : null;
          })
          .filter((item): item is { name: string; spiceLevel: string } => item !== null);
        const hotItems = spiceReport.filter((item) => item.spiceLevel === 'hot');
        const mediumItems = spiceReport.filter((item) => item.spiceLevel === 'medium');
        const parts: string[] = [];
        if (hotItems.length > 0) {
          parts.push(`${hotItems.map((item) => item.name).join(', ')} ${hotItems.length === 1 ? 'is' : 'are'} hot/spicy`);
        }
        if (mediumItems.length > 0) {
          parts.push(`${mediumItems.map((item) => item.name).join(', ')} ${mediumItems.length === 1 ? 'has' : 'have'} medium spice`);
        }
        const mildItems = spiceReport.filter((item) => item.spiceLevel === 'mild');
        if (mildItems.length > 0) {
          parts.push(`${mildItems.map((item) => item.name).join(', ')} ${mildItems.length === 1 ? 'is' : 'are'} mild`);
        }
        return {
          text: parts.length > 0
            ? `In your current order: ${parts.join('; ')}.`
            : 'None of the items in your order have a specified spice level.',
        };
      }
      if (
        mentionedItems.length === 0 &&
        /\b(not too spicy|mild|less spicy|low spice)\b/.test(normalized)
      ) {
        const mildItems = getAvailableItems(this.menu)
          .filter((item) => item.spiceLevel === 'mild')
          .slice(0, 3);
        return {
          text: `Here are some mild options: ${mildItems
            .map((item) => `${item.name} (${formatMoney(item.price)}, mild)`)
            .join(', ')}.`,
          referencedItemIds: mildItems.map((item) => item.id),
        };
      }
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
          return `${category.name}: ${available.map((item) => `${item.name} (${formatMoney(item.price)})`).join(', ')}`;
        })
        .join('\n');
      return { text: `Here is our menu:\n${categorySummary}` };
    }

    if (/\b(summary|current order|what.*ordered|that s all|done)\b/.test(normalized)) {
      return { text: summary.formattedSummary };
    }

    const asksPrice = /\b(how much|price|cost)\b/.test(normalized);
    const asksDescription =
      /\b(tell me about|what about|what s in|what is in|describe|description|details|ingredients)\b/.test(
        normalized,
      ) || /^what is\b/.test(normalized);
    const asksAvailability =
      /\b(is|are).+\bavailable\b/.test(normalized) ||
      (/\bdo you have\b/.test(normalized) && mentionedItems.length > 0);

    if (asksPrice || asksDescription || asksAvailability) {
      if (mentionedItems.length !== 1) {
        return {
          text:
            mentionedItems.length > 1
              ? `Which item do you mean: ${mentionedItems.map((item) => item.name).join(' or ')}?`
              : 'Which menu item would you like to know about?',
          referencedItemIds,
        };
      }

      const item = mentionedItems[0]!;
      const availability = await runTool<AvailabilityResult>(
        tools.checkAvailability,
        { itemName: item.name },
      );
      if (!availability.available) {
        const alternatives = availability.alternatives ?? [];
        return {
          text: `${item.name} is unavailable${availability.reason ? ` - ${availability.reason}` : ''}. ${
            alternatives.length > 0
              ? `May I suggest ${alternatives.map((alternative) => `${alternative.name} (${formatMoney(alternative.price)})`).join(' or ')}?`
              : ''
          }`.trim(),
          referencedItemIds: [item.id],
        };
      }
      if (asksPrice) {
        return {
          text: `${item.name} is ${formatMoney(item.price)}. Would you like to add it to your order?`,
          referencedItemIds: [item.id],
        };
      }
      if (asksAvailability) {
        return {
          text: `Yes, ${item.name} is available at ${formatMoney(item.price)}.`,
          referencedItemIds: [item.id],
        };
      }
      return {
        text: `${item.name}: ${item.description}. It costs ${formatMoney(item.price)}. Would you like to add it?`,
        referencedItemIds: [item.id],
      };
    }

    const wantsRemoval =
      /\b(cancel|remove|delete)\b/.test(normalized) ||
      /\b(change|changed) my mind\b/.test(normalized);
    const wantsQuantityChange = /\b(make it|change|update|quantity)\b/.test(
      normalized,
    );
    const wantsAddition = /\b(add|take|want|have|get|order|i ll|i will)\b/.test(
      normalized,
    );

    if (
      wantsRemoval &&
      /\b(everything|all|entire order|whole order)\b/.test(normalized)
    ) {
      if (summary.items.length === 0) {
        return {
          text: 'Your order is already empty.',
          clearLastMentionedItem: true,
        };
      }
      for (const item of summary.items) {
        await runTool<ModifyOrderResult>(tools.modifyOrder, {
          itemId: item.menuItemId,
          action: 'remove',
        });
      }
      const removedItemCount = summary.items.reduce(
        (total, item) => total + item.quantity,
        0,
      );
      return {
        text: `Removed all ${removedItemCount} item${removedItemCount === 1 ? '' : 's'}. Your order is now empty. Total: ${formatMoney(0)}.`,
        clearLastMentionedItem: true,
      };
    }

    if (mentionedItems.length > 1 && !wantsRemoval) {
      const explicitlyListsMultipleItems = isExplicitMultiItemListing(
        input,
        mentionedItems.length,
      );
      if (!explicitlyListsMultipleItems) {
        return {
          text: `Did you mean ${mentionedItems.map((item) => item.name).join(' or ')}?`,
          referencedItemIds,
        };
      }
    }

    // If the user lists multiple items separated by commas or "and" (e.g.
    // "1 Crispy Corn, 2 Mango Lassi, and 1 Kulfi Falooda"), treat the listing
    // as an implicit ordering intent even without an explicit verb.
    if (
      mentionedItems.length > 0 &&
      !wantsRemoval &&
      !wantsQuantityChange &&
      !wantsAddition
    ) {
      const isItemListing = isExplicitMultiItemListing(
        input,
        mentionedItems.length,
      );

      // If the previous assistant turn was asking about something (spice,
      // price, description, tag) and the user just names an item to answer
      // that question, provide the contextual info instead of adding.
      if (!isItemListing && mentionedItems.length === 1) {
        const previousAssistant = [...messages]
          .reverse()
          .find((message) => message.role === 'assistant');
        const prevText = previousAssistant
          ? normalize(modelMessageText(previousAssistant))
          : '';
        const prevAskedSpice = /spic(y|e|iness)|which.*item.*know|which.*mean/.test(prevText);
        const prevAskedInfo = /would you like to know|tell me about|which.*item/.test(prevText);
        if (prevAskedSpice || prevAskedInfo) {
          const item = mentionedItems[0]!;
          return {
            text: `${item.name} has a ${item.spiceLevel ?? 'not specified'} spice level. ${item.description}. It costs ${formatMoney(item.price)}.`,
            referencedItemIds: [item.id],
          };
        }
      }

      if (!isItemListing) {
        return {
          text: `Would you like to add ${mentionedItems.map((item) => item.name).join(' and ')} to your order?`,
          referencedItemIds,
        };
      }
      // Fall through to the ordering logic below by treating the listing as
      // an implicit addition.
    }

    if ((wantsRemoval || wantsQuantityChange) && mentionedItems.length === 0) {
      let targetId = context.lastMentionedItemId;
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
      const response: LLMResponse = {
        text: `${modification.message} ${
          modification.success
            ? `Your total is ${formatMoney(modification.orderState.totalAmount)}.`
            : ''
        }`.trim(),
      };
      response.referencedItemIds = [targetId];
      return response;
    }

    const directlyMentionedRemovalTargets = wantsRemoval
      ? mentionedItems.filter((item) =>
          summary.items.some((orderItem) => orderItem.menuItemId === item.id),
        )
      : [];
    const inputTokens = new Set(stemmed(input).split(' '));
    const contextualRemovalTargets = wantsRemoval
      ? summary.items
          .map((orderItem) => findItemById(orderItem.menuItemId, this.menu))
          .filter((item): item is MenuItem => item !== null)
          .filter(
            (item) =>
              !directlyMentionedRemovalTargets.some(
                (mentioned) => mentioned.id === item.id,
              ) &&
              normalize(item.name)
                .split(' ')
                .some(
                  (token) =>
                    token.length >= 4 && inputTokens.has(singularizeToken(token)),
                ),
          )
      : [];
    if (
      wantsRemoval &&
      directlyMentionedRemovalTargets.length === 0 &&
      contextualRemovalTargets.length > 1
    ) {
      return {
        text: `Which item should I remove: ${contextualRemovalTargets
          .map((item) => item.name)
          .join(' or ')}?`,
      };
    }
    const removalTargets = [
      ...directlyMentionedRemovalTargets,
      ...(contextualRemovalTargets.length === 1 ? contextualRemovalTargets : []),
    ];
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
    }

    const globalQuantity = parseQuantity(input);
    for (const item of additionTargets) {
      const existing = summary.items.find(
        (orderItem) => orderItem.menuItemId === item.id,
      );
      if (wantsQuantityChange && existing) {
        const result = await runTool<ModifyOrderResult>(tools.modifyOrder, {
          itemId: item.id,
          action: 'update_quantity',
          newQuantity: globalQuantity,
        });
        confirmations.push(result.message);
        changed ||= result.success;
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

      // Use per-item quantity when multiple items are listed ("1 X, 2 Y"),
      // otherwise fall back to the single global quantity.
      const itemQuantity =
        additionTargets.length > 1
          ? parsePerItemQuantity(input, item.name)
          : globalQuantity;
      const result = await runTool<OrderToolResult>(tools.addToOrder, {
        itemId: item.id,
        quantity: itemQuantity,
      });
      confirmations.push(result.message);
      changed ||= result.success;
    }

    if (confirmations.length > 0) {
      const latestSummary = await runTool<OrderSummaryResult>(
        tools.getOrderSummary,
        {},
      );

      // Proactive menu-grounded follow-up on first order addition:
      // ask about dietary or spice preferences so the customer doesn't
      // discover issues (e.g. too spicy, not vegan) after ordering.
      let proactivePrompt = '';
      if (summary.items.length === 0 && latestSummary.items.length > 0) {
        proactivePrompt =
          ' Any dietary preferences or spice concerns I should know about?';
      }

      const response: LLMResponse = {
        text: `${confirmations.join(' ')}${
          changed ? ` Your total is ${formatMoney(latestSummary.totalAmount)}.` : ''
        }${proactivePrompt}`,
      };
      response.referencedItemIds = referencedItemIds;
      return response;
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
