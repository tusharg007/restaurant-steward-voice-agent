import type { ModelMessage } from '@ai-sdk/provider-utils';
import { describe, expect, test } from 'vitest';

import { OpenAIClient } from '../src/engine/llm-client.js';
import { Orchestrator } from '../src/engine/orchestrator.js';
import { loadMenu } from '../src/state/menu-loader.js';

describe('structured model history', () => {
  test('preserves assistant tool calls and tool results across turns', async () => {
    const menu = loadMenu();
    const calls: ModelMessage[][] = [];
    const firstResponseMessages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'availability-1',
            toolName: 'checkAvailability',
            input: { itemName: 'Paneer Tikka' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'availability-1',
            toolName: 'checkAvailability',
            output: {
              type: 'json',
              value: { found: true, available: true, itemId: 's1' },
            },
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Paneer Tikka is available.' }],
      },
    ];
    const client = new OpenAIClient({
      apiKey: 'test-key',
      generate: async ({ messages }) => {
        calls.push(structuredClone(messages));
        return calls.length === 1
          ? {
              text: 'Paneer Tikka is available.',
              responseMessages: firstResponseMessages,
            }
          : {
              text: 'The previous availability check is still in context.',
              responseMessages: [
                {
                  role: 'assistant',
                  content: 'The previous availability check is still in context.',
                },
              ],
            };
      },
    });
    const orchestrator = new Orchestrator(menu, client);

    await orchestrator.processUserInput('Is Paneer Tikka available?');
    await orchestrator.processUserInput('What did that check return?');

    expect(calls[1]?.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);
    expect(calls[1]?.[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'availability-1' }],
    });
    expect(calls[1]?.[2]).toMatchObject({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'availability-1' }],
    });
  });
});
