import { tool } from 'ai';
import { z } from 'zod';

import type { SessionManager } from '../state/session.js';
import type { Menu } from '../types/menu.js';
import { addToOrder } from './add-to-order.js';
import { checkAvailability } from './check-availability.js';
import { getOrderSummary } from './get-order-summary.js';
import { modifyOrder } from './modify-order.js';

export function createBoundTools(session: SessionManager, menu: Menu) {
  return {
    checkAvailability: tool({
      description:
        'Check whether a menu item exists and is available. Use this before adding any item.',
      inputSchema: z.object({
        itemName: z
          .string()
          .min(1)
          .describe('Name or partial name of the menu item to check'),
      }),
      execute: async ({ itemName }) => checkAvailability(itemName, menu),
    }),
    addToOrder: tool({
      description:
        'Add an available menu item to the customer order after availability has been checked.',
      inputSchema: z.object({
        itemId: z
          .string()
          .min(1)
          .describe('Unique menu item ID, for example m1'),
        quantity: z
          .number()
          .int()
          .min(1)
          .describe('Number of this item to add'),
      }),
      execute: async ({ itemId, quantity }) =>
        addToOrder(session, itemId, quantity, menu),
    }),
    modifyOrder: tool({
      description:
        'Remove an existing order item or change its current quantity.',
      inputSchema: z
        .object({
          itemId: z.string().min(1).describe('Unique ID of the item to modify'),
          action: z
            .enum(['remove', 'update_quantity'])
            .describe('Whether to remove or update quantity'),
          newQuantity: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Required when action is update_quantity'),
        })
        .refine(
          ({ action, newQuantity }) =>
            action !== 'update_quantity' || newQuantity !== undefined,
          {
            message: 'newQuantity is required for update_quantity',
            path: ['newQuantity'],
          },
        ),
      execute: async ({ itemId, action, newQuantity }) =>
        modifyOrder(session, itemId, action, newQuantity, menu),
    }),
    getOrderSummary: tool({
      description:
        'Get the current order summary with item quantities and total amount.',
      inputSchema: z.object({}),
      execute: async () => getOrderSummary(session),
    }),
  };
}

export type AgentTools = ReturnType<typeof createBoundTools>;
