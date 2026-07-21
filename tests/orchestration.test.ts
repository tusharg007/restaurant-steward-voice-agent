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

  test('answers price and description questions without changing the order', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    const price = await orchestrator.processUserInput(
      'How much is the Paneer Tikka?',
    );
    const description = await orchestrator.processUserInput(
      'Tell me about the Dal Makhani',
    );
    const ingredients = await orchestrator.processUserInput(
      "What's in the Mango Lassi?",
    );

    expect(price).toContain('Paneer Tikka is ₹249');
    expect(description).toContain('Slow-cooked black lentils');
    expect(ingredients).toContain('Chilled yogurt smoothie');
    expect(orchestrator.getOrderState().items).toHaveLength(0);
  });

  test('answers whether a specific item is vegan', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    const dal = await orchestrator.processUserInput('Is the Dal Makhani vegan?');
    const corn = await orchestrator.processUserInput('Is Crispy Corn vegan?');

    expect(dal).toMatch(/No, Dal Makhani is vegetarian.+not vegan/i);
    expect(corn).toContain('Yes, Crispy Corn is vegan');
    expect(orchestrator.getOrderState().items).toHaveLength(0);
  });

  test('removes every item when the customer clears the order', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    await orchestrator.processUserInput('Add Butter Chicken');
    await orchestrator.processUserInput('Add Mango Lassi');
    await orchestrator.processUserInput('Add Crispy Corn');
    const response = await orchestrator.processUserInput('Remove everything');

    expect(response).toContain('Your order is now empty');
    expect(orchestrator.getOrderState()).toEqual({
      items: [],
      itemCount: 0,
      totalAmount: 0,
    });
  });

  test('recommends grounded mild options for a low-spice request', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    const response = await orchestrator.processUserInput(
      'I want something not too spicy',
    );

    expect(response).toContain('mild options');
    expect(response).toMatch(/Butter Chicken|Dal Makhani|Crispy Corn/);
    expect(orchestrator.getOrderState().items).toHaveLength(0);
  });

  test('responds naturally to greetings, thanks, and goodbyes', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    await expect(orchestrator.processUserInput('hello')).resolves.toContain(
      'Welcome to Namaste Kitchen',
    );
    await expect(orchestrator.processUserInput('thanks')).resolves.toContain(
      "You're welcome",
    );
    await expect(orchestrator.processUserInput('goodbye')).resolves.toContain(
      'Goodbye',
    );
  });

  test('resolves references from session context without client-owned state', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    await orchestrator.processUserInput('Add Paneer Tikka');
    const response = await orchestrator.processUserInput('Remove that');

    expect(response).toContain('Removed Paneer Tikka');
    expect(orchestrator.getOrderState().items).toHaveLength(0);
  });

  test('rejects unavailable items in what-about information queries', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    const response = await orchestrator.processUserInput(
      'What about the Mutton Rogan Josh?',
    );

    expect(response).toContain('Mutton Rogan Josh is unavailable');
    expect(response).toContain('Sold out for the day');
    expect(orchestrator.getOrderState().items).toHaveLength(0);
  });

  test('treats changed-my-mind as a remove-and-replace correction', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    await orchestrator.processUserInput('Add Mango Lassi');
    const response = await orchestrator.processUserInput(
      'I changed my mind, remove the lassi and add Fresh Lime Soda',
    );

    expect(response).toContain('Removed Mango Lassi');
    expect(response).toContain('Added 1 x Fresh Lime Soda');
    expect(orchestrator.getOrderState().items.map((item) => item.menuItemId)).toEqual([
      'd3',
    ]);
  });

  test('adds a previously removed item back through a pronoun reference', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    await orchestrator.processUserInput('Add Dal Makhani');
    await orchestrator.processUserInput('Remove Dal Makhani');
    const response = await orchestrator.processUserInput('Actually add it back');

    expect(response).toContain('Added 1 x Dal Makhani');
    expect(orchestrator.getOrderState().items).toMatchObject([
      { menuItemId: 'm3', quantity: 1 },
    ]);
  });

  test('answers item-specific gluten-free tag questions without ordering', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    const response = await orchestrator.processUserInput(
      'Is the Crispy Corn gluten free?',
    );

    expect(response).toContain('Yes, Crispy Corn is gluten-free');
    expect(orchestrator.getOrderState().items).toHaveLength(0);
  });

  test('rejects signed negative quantities instead of converting them to positive', async () => {
    const menu = loadMenu();
    const orchestrator = new Orchestrator(menu, new MockLLMClient(menu));

    const response = await orchestrator.processUserInput('Add -1 Mango Lassi');

    expect(response).toContain('Quantity must be a positive whole number');
    expect(orchestrator.getOrderState().items).toHaveLength(0);
  });
});
