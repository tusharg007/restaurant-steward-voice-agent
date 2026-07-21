import {
  findCategoryForItem,
  findItemByName,
  getAvailableItems,
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

function matchesDietaryPreference(
  unavailableItem: MenuItem,
  candidate: MenuItem,
): boolean {
  if (unavailableItem.tags.includes('vegan')) {
    return candidate.tags.includes('vegan');
  }
  if (unavailableItem.tags.includes('vegetarian')) {
    return (
      candidate.tags.includes('vegetarian') || candidate.tags.includes('vegan')
    );
  }
  if (unavailableItem.tags.includes('non-veg')) {
    return candidate.tags.includes('non-veg');
  }
  return true;
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
  const sameCategoryItems = category ? getItemsByCategory(category, menu) : [];
  const candidates = [...sameCategoryItems, ...getAvailableItems(menu)];
  const alternatives = candidates
    .filter(
      (item, index, items) =>
        item.id !== match.id &&
        item.available &&
        matchesDietaryPreference(match, item) &&
        items.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .slice(0, 3);

  return {
    found: true,
    item: match,
    available: false,
    reason: match.unavailableReason ?? 'This item is currently unavailable.',
    alternatives,
  };
}
