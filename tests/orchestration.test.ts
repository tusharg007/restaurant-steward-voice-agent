import { describe, expect, test } from 'vitest';

import { MockLLMClient } from '../src/engine/llm-client.js';
import { Orchestrator } from '../src/engine/orchestrator.js';
import { loadMenu } from '../src/state/menu-loader.js';

describe('core orchestration', () => {
  test('handles a mid-conversation cancel-and-replace intent change', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    await orchestrator.processUserInput('Add the Paneer Tikka');
    const response = await orchestrator.processUserInput(
      'Actually cancel the Paneer Tikka and add Butter Chicken instead',
    );

    expect(orchestrator.getOrderState()).toMatchObject({
      items: [
        {
          menuItemId: 'm1',
          name: 'Butter Chicken',
          quantity: 1,
          subtotal: 399,
        },
      ],
      itemCount: 1,
      totalAmount: 399,
    });
    expect(response).toContain('Removed Paneer Tikka');
    expect(response).toContain('Added 1 x Butter Chicken');
  });

  test('rejects an unavailable order and suggests grounded alternatives', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    const response = await orchestrator.processUserInput(
      'I will have the Fish Amritsari',
    );

    expect(orchestrator.getOrderState().items).toHaveLength(0);
    expect(response).toContain('Fish Amritsari is unavailable');
    expect(response).toContain('Fresh fish not available today');
    expect(response).toMatch(/Paneer Tikka|Chicken Seekh Kebab|Crispy Corn/);
  });
});
