import { findItemById, loadMenu } from '../state/menu-loader.js';
import {
  removeItem,
  updateQuantity,
} from '../state/order-manager.js';
import type { SessionManager } from '../state/session.js';
import type { Menu } from '../types/menu.js';
import type { OrderState } from '../types/order.js';

export type ModifyAction = 'remove' | 'update_quantity';

export interface ModifyOrderResult {
  success: boolean;
  message: string;
  orderState: OrderState;
}

export function modifyOrder(
  session: SessionManager,
  itemId: string,
  action: ModifyAction,
  newQuantity?: number,
  menu: Menu = loadMenu(),
): ModifyOrderResult {
  const currentOrder = session.getOrderState();
  const orderItem = currentOrder.items.find(
    (item) => item.menuItemId === itemId,
  );

  if (!orderItem) {
    return {
      success: false,
      message: 'That item is not currently in the order.',
      orderState: currentOrder,
    };
  }

  if (action === 'remove') {
    const updatedOrder = removeItem(currentOrder, itemId);
    session.updateOrderState(updatedOrder);
    session.setLastMentionedItem(itemId);
    return {
      success: true,
      message: `Removed ${orderItem.name} from the order.`,
      orderState: session.getOrderState(),
    };
  }

  if (!Number.isInteger(newQuantity) || (newQuantity ?? 0) < 1) {
    return {
      success: false,
      message: 'A positive whole-number quantity is required.',
      orderState: currentOrder,
    };
  }

  const menuItem = findItemById(itemId, menu);
  if (
    menuItem?.limitedQuantity !== undefined &&
    newQuantity! > menuItem.limitedQuantity
  ) {
    return {
      success: false,
      message: `${menuItem.name} has limited availability: the maximum is ${menuItem.limitedQuantity}.`,
      orderState: currentOrder,
    };
  }

  const updatedOrder = updateQuantity(currentOrder, itemId, newQuantity!);
  session.updateOrderState(updatedOrder);
  session.setLastMentionedItem(itemId);
  return {
    success: true,
    message: `Updated ${orderItem.name} to quantity ${newQuantity}.`,
    orderState: session.getOrderState(),
  };
}
