import { describe, expect, test } from 'vitest';

import { findItemById, loadMenu } from '../src/state/menu-loader.js';
import {
  addItem,
  createEmptyOrder,
  removeItem,
  updateQuantity,
} from '../src/state/order-manager.js';

describe('immutable order state', () => {
  test('keeps totals correct through an add, update, and remove cycle', () => {
    const menu = loadMenu();
    const paneerTikka = findItemById('s1', menu)!;
    const butterChicken = findItemById('m1', menu)!;
    const original = createEmptyOrder();

    let state = addItem(original, paneerTikka, 2);
    state = addItem(state, butterChicken, 1);
    state = updateQuantity(state, 's1', 3);
    state = removeItem(state, 'm1');

    expect(original).toEqual({ items: [], itemCount: 0, totalAmount: 0 });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      menuItemId: 's1',
      quantity: 3,
      subtotal: 747,
    });
    expect(state.itemCount).toBe(3);
    expect(state.totalAmount).toBe(747);
  });
});
