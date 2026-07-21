import { findItemById, loadMenu } from '../state/menu-loader.js';
import { addItem } from '../state/order-manager.js';
import type { SessionManager } from '../state/session.js';
import type { Menu } from '../types/menu.js';
import type { OrderState } from '../types/order.js';

export interface OrderToolResult {
  success: boolean;
  message: string;
  orderState: OrderState;
}

export function addToOrder(
  session: SessionManager,
  itemId: string,
  quantity: number,
  menu: Menu = loadMenu(),
): OrderToolResult {
  const currentOrder = session.getOrderState();
  const item = findItemById(itemId, menu);

  if (!item) {
    return {
      success: false,
      message: `Item ${itemId} does not exist on the menu.`,
      orderState: currentOrder,
    };
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return {
      success: false,
      message: 'Quantity must be a positive whole number.',
      orderState: currentOrder,
    };
  }

  if (!item.available) {
    return {
      success: false,
      message: `${item.name} is unavailable: ${item.unavailableReason ?? 'currently out of stock'}.`,
      orderState: currentOrder,
    };
  }

  const existingQuantity =
    currentOrder.items.find((orderItem) => orderItem.menuItemId === item.id)
      ?.quantity ?? 0;
  if (
    item.limitedQuantity !== undefined &&
    existingQuantity + quantity > item.limitedQuantity
  ) {
    return {
      success: false,
      message: `${item.name} has limited availability: only ${item.limitedQuantity} can be ordered.`,
      orderState: currentOrder,
    };
  }

  const updatedOrder = addItem(currentOrder, item, quantity);
  session.updateOrderState(updatedOrder);
  session.setLastMentionedItem(item.id);

  return {
    success: true,
    message: `Added ${quantity} x ${item.name}.${
      item.limitedQuantity !== undefined
        ? ` Note: ${item.name} has limited availability today.`
        : ''
    }`,
    orderState: session.getOrderState(),
  };
}
