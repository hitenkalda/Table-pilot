import { useEffect, useState } from "react";
import { createLocalStore } from "./localStore";
import type { CartItem, Dish } from "../types";

type CartState = {
  restaurantSlug: string;
  tableNumber: number | null;
  items: CartItem[];
};

const store = createLocalStore<CartState>("dishexplain-cart", {
  restaurantSlug: "",
  tableNumber: null,
  items: [],
});

export const cartStore = store;

export function useCart() {
  const [state, setState] = useState<CartState>(store.get());
  useEffect(() => store.subscribe(() => setState(store.get())), []);
  return state;
}

function sameItem(a: Pick<CartItem, "dishId" | "note">, b: Pick<CartItem, "dishId" | "note">): boolean {
  return a.dishId === b.dishId && (a.note ?? "") === (b.note ?? "");
}

export function addToCart(
  restaurantSlug: string,
  tableNumber: number | null,
  dishId: string,
  quantity = 1,
  note?: string
): void {
  store.update((s) => {
    const base =
      s.restaurantSlug === restaurantSlug ? s : { restaurantSlug, tableNumber, items: [] };
    const items = [...base.items];
    const existing = items.find((i) => sameItem(i, { dishId, note }));
    if (existing) {
      existing.quantity += quantity;
    } else {
      items.push({ dishId, quantity, note });
    }
    return { ...base, tableNumber: tableNumber ?? base.tableNumber, items };
  });
}

export function setQuantity(dishId: string, note: string | undefined, quantity: number): void {
  store.update((s) => ({
    ...s,
    items: quantity <= 0
      ? s.items.filter((i) => !sameItem(i, { dishId, note }))
      : s.items.map((i) => (sameItem(i, { dishId, note }) ? { ...i, quantity } : i)),
  }));
}

export function removeFromCart(dishId: string, note?: string): void {
  store.update((s) => ({
    ...s,
    items: s.items.filter((i) => !sameItem(i, { dishId, note })),
  }));
}

/** Remove ALL cart entries for a dishId regardless of note. */
export function removeAllByDishId(dishId: string): void {
  store.update((s) => ({
    ...s,
    items: s.items.filter((i) => i.dishId !== dishId),
  }));
}

/** Set the quantity for every cart entry matching a dishId (remove if ≤ 0). */
export function setQuantityAll(dishId: string, quantity: number): void {
  store.update((s) => {
    if (quantity <= 0) {
      return { ...s, items: s.items.filter((i) => i.dishId !== dishId) };
    }
    return {
      ...s,
      items: s.items.map((i) => (i.dishId === dishId ? { ...i, quantity } : i)),
    };
  });
}

export function setTableNumber(tableNumber: number | null): void {
  store.update((s) => ({ ...s, tableNumber }));
}

export function clearCart(): void {
  store.update((s) => ({ ...s, items: [] }));
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

export function cartSubtotal(items: CartItem[], dishes: Dish[]): number {
  return items.reduce((sum, item) => {
    const dish = dishes.find((d) => d.id === item.dishId);
    return dish ? sum + dish.price * item.quantity : sum;
  }, 0);
}
