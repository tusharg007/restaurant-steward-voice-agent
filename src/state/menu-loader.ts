import menuData from '../data/menu.json' with { type: 'json' };

import type { Menu, MenuItem } from '../types/menu.js';

export type MenuSearchResult = MenuItem | MenuItem[] | null;

const menu = menuData as Menu;

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ');
}

function allItems(source: Menu = menu): MenuItem[] {
  return source.categories.flatMap((category) => category.items);
}

export function loadMenu(): Menu {
  return structuredClone(menu);
}

/**
 * Returns one item for an unambiguous match, every candidate for an ambiguous
 * partial match, and null when the query is not grounded in the menu.
 */
export function findItemByName(
  query: string,
  source: Menu = menu,
): MenuSearchResult {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return null;
  }

  const items = allItems(source);
  const exactMatch = items.find(
    (item) => normalize(item.name) === normalizedQuery,
  );
  if (exactMatch) {
    return structuredClone(exactMatch);
  }

  const partialMatches = items.filter((item) => {
    const normalizedName = normalize(item.name);
    return (
      normalizedName.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedName)
    );
  });

  if (partialMatches.length === 0) {
    return null;
  }

  if (partialMatches.length === 1) {
    return structuredClone(partialMatches[0]!);
  }

  return structuredClone(partialMatches);
}

export function findItemById(
  id: string,
  source: Menu = menu,
): MenuItem | null {
  const item = allItems(source).find(
    (candidate) => normalize(candidate.id) === normalize(id),
  );
  return item ? structuredClone(item) : null;
}

export function getItemsByCategory(
  category: string,
  source: Menu = menu,
): MenuItem[] {
  const normalizedCategory = normalize(category);
  const matchingCategory = source.categories.find(
    (candidate) => normalize(candidate.name) === normalizedCategory,
  );
  return structuredClone(matchingCategory?.items ?? []);
}

export function getItemsByTag(tag: string, source: Menu = menu): MenuItem[] {
  const normalizedTag = normalize(tag);
  return structuredClone(
    allItems(source).filter((item) =>
      item.tags.some((candidate) => normalize(candidate) === normalizedTag),
    ),
  );
}

export function getAvailableItems(source: Menu = menu): MenuItem[] {
  return structuredClone(allItems(source).filter((item) => item.available));
}

export function getUnavailableItems(source: Menu = menu): MenuItem[] {
  return structuredClone(allItems(source).filter((item) => !item.available));
}

export function findCategoryForItem(
  itemId: string,
  source: Menu = menu,
): string | null {
  const category = source.categories.find((candidate) =>
    candidate.items.some((item) => item.id === itemId),
  );
  return category?.name ?? null;
}
