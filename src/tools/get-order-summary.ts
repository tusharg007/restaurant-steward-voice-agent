import { getOrderSummary as formatOrderSummary } from '../state/order-manager.js';
import type { SessionManager } from '../state/session.js';
import type { OrderItem } from '../types/order.js';

export interface OrderSummaryResult {
  items: OrderItem[];
  totalAmount: number;
  formattedSummary: string;
}

export function getOrderSummary(session: SessionManager): OrderSummaryResult {
  const orderState = session.getOrderState();
  return {
    items: orderState.items,
    totalAmount: orderState.totalAmount,
    formattedSummary: formatOrderSummary(orderState),
  };
}
