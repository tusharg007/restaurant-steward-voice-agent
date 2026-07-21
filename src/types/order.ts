export interface OrderItem {
  menuItemId: string;
  name: string;
  quantity: number;
  pricePerUnit: number;
  subtotal: number;
}

export interface OrderState {
  items: OrderItem[];
  totalAmount: number;
  itemCount: number;
}
