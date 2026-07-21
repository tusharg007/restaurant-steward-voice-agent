import { describe, expect, test } from 'vitest';

import { loadMenu } from '../src/state/menu-loader.js';
import { SessionManager } from '../src/state/session.js';
import { addToOrder } from '../src/tools/add-to-order.js';
import { checkAvailability } from '../src/tools/check-availability.js';

describe('grounded tools', () => {
  test('does not invent items that are absent from the menu dataset', () => {
    const result = checkAvailability('pepperoni pizza', loadMenu());

    expect(result).toEqual({ found: false });
  });

  test('enforces limited quantity constraints without mutating the order', () => {
    const menu = loadMenu();
    const session = new SessionManager();

    const result = addToOrder(session, 'm4', 5, menu);

    expect(result.success).toBe(false);
    expect(result.message).toContain('limited availability');
    expect(session.getOrderState()).toEqual({
      items: [],
      itemCount: 0,
      totalAmount: 0,
    });
  });

  test('keeps unavailable-item alternatives compatible with dietary tags', () => {
    const menu = loadMenu();
    const fishResult = checkAvailability('Fish Amritsari', menu);

    expect(fishResult.alternatives).not.toHaveLength(0);
    expect(
      fishResult.alternatives?.every((item) => item.tags.includes('non-veg')),
    ).toBe(true);

    const vegBiryani = menu.categories
      .flatMap((category) => category.items)
      .find((item) => item.id === 'm4')!;
    vegBiryani.available = false;
    vegBiryani.unavailableReason = 'Sold out for this test';

    const veganResult = checkAvailability('Veg Biryani', menu);
    expect(veganResult.alternatives).not.toHaveLength(0);
    expect(
      veganResult.alternatives?.every((item) => item.tags.includes('vegan')),
    ).toBe(true);
  });
});
