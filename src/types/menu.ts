export interface MenuItem {
  id: string;
  name: string;
  price: number;
  description: string;
  tags: string[];
  spiceLevel?: 'mild' | 'medium' | 'hot';
  available: boolean;
  unavailableReason?: string;
  limitedQuantity?: number;
}

export interface MenuCategory {
  name: string;
  items: MenuItem[];
}

export interface Menu {
  restaurant: string;
  currency: string;
  categories: MenuCategory[];
}
