import type { MenuItem } from '../types/menu.js';
import type { OrderItem, OrderState } from '../types/order.js';

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}

function rebuildOrder(items: OrderItem[]): OrderState {
  const normalizedItems = items.map((item) => ({
    ...item,
    subtotal: item.quantity * item.pricePerUnit,
  }));

  return {
    items: normalizedItems,
    totalAmount: calculateTotal({
      items: normalizedItems,
      totalAmount: 0,
      itemCount: 0,
    }),
    itemCount: normalizedItems.reduce((total, item) => total + item.quantity, 0),
  };
}

export function createEmptyOrder(): OrderState {
  return { items: [], totalAmount: 0, itemCount: 0 };
}

export function addItem(
  state: OrderState,
  item: MenuItem,
  quantity: number,
): OrderState {
  assertPositiveInteger(quantity, 'Quantity');

  const existing = state.items.find(
    (orderItem) => orderItem.menuItemId === item.id,
  );
  const items = existing
    ? state.items.map((orderItem) =>
        orderItem.menuItemId === item.id
          ? { ...orderItem, quantity: orderItem.quantity + quantity }
          : { ...orderItem },
      )
    : [
        ...state.items.map((orderItem) => ({ ...orderItem })),
        {
          menuItemId: item.id,
          name: item.name,
          quantity,
          pricePerUnit: item.price,
          subtotal: item.price * quantity,
        },
      ];

  return rebuildOrder(items);
}

export function removeItem(state: OrderState, menuItemId: string): OrderState {
  return rebuildOrder(
    state.items
      .filter((item) => item.menuItemId !== menuItemId)
      .map((item) => ({ ...item })),
  );
}

export function updateQuantity(
  state: OrderState,
  menuItemId: string,
  newQuantity: number,
): OrderState {
  assertPositiveInteger(newQuantity, 'New quantity');
  return rebuildOrder(
    state.items.map((item) =>
      item.menuItemId === menuItemId
        ? { ...item, quantity: newQuantity }
        : { ...item },
    ),
  );
}

export function getOrderSummary(state: OrderState): string {
  if (state.items.length === 0) {
    return 'Your order is empty.';
  }

  const itemSummary = state.items
    .map(
      (item) =>
        `${item.name} x${item.quantity} (₹${item.subtotal.toLocaleString('en-IN')})`,
    )
    .join(', ');

  return `${itemSummary}. Total: ₹${state.totalAmount.toLocaleString('en-IN')}.`;
}

export function calculateTotal(state: OrderState): number {
  return state.items.reduce(
    (total, item) => total + item.pricePerUnit * item.quantity,
    0,
  );
}
