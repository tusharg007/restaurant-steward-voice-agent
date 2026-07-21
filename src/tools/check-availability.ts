import {
  findCategoryForItem,
  findItemByName,
  getItemsByCategory,
  loadMenu,
} from '../state/menu-loader.js';
import type { Menu, MenuItem } from '../types/menu.js';

export interface AvailabilityResult {
  found: boolean;
  item?: MenuItem;
  matches?: MenuItem[];
  available?: boolean;
  reason?: string;
  alternatives?: MenuItem[];
}

export function checkAvailability(
  itemQuery: string,
  menu: Menu = loadMenu(),
): AvailabilityResult {
  const match = findItemByName(itemQuery, menu);
  if (!match) {
    return { found: false };
  }

  if (Array.isArray(match)) {
    return {
      found: true,
      matches: match,
      reason: 'The item name is ambiguous. Ask the customer to clarify.',
    };
  }

  if (match.available) {
    return { found: true, item: match, available: true };
  }

  const category = findCategoryForItem(match.id, menu);
  const alternatives = category
    ? getItemsByCategory(category, menu)
        .filter((item) => item.available && item.id !== match.id)
        .slice(0, 3)
    : [];

  return {
    found: true,
    item: match,
    available: false,
    reason: match.unavailableReason ?? 'This item is currently unavailable.',
    alternatives,
  };
}
