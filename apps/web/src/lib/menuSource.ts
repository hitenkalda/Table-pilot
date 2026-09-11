import { useEffect, useState } from "react";
import { createLocalStore } from "./localStore";
import { demoRestaurant } from "../data/demoRestaurant";
import { isSupabaseConfigured, getSupabase } from "./supabase";
import {
  registerMenuStore,
  type RemoteMenu,
  dbUpdateDish,
  dbUpdateDishFull,
  dbInsertDish,
  dbInsertCategory,
  dbDeleteCategory,
  dbInsertTable,
  dbUpdateTable,
  dbUpdateSettings,
  subscribeMenu as subscribeMenuRemote,
} from "./remoteData";
import type { Dish, MenuCategory, Restaurant, RestaurantTable } from "../types";

/**
 * Menu source of truth. Two backends behind one API:
 *  - Supabase (when configured): restaurant/categories/dishes/tables live in
 *    Postgres, updates arrive via realtime, and dashboard edits write through
 *    to the database under the signed-in owner's Row Level Security.
 *  - localStorage demo fallback (no Supabase env configured): the bundled
 *    demo restaurant with local overrides, exactly like the original pilot.
 */

type DishOverride = { is_available?: boolean; published?: boolean };
type MenuState = {
  dishOverrides: Record<string, DishOverride>;
  categories: MenuCategory[];
  customDishes: Dish[];
  removedDishIds: string[];
  tables: RestaurantTable[];
  settings: Pick<Restaurant, "upiId" | "upiName" | "isOpen">;
};

const store = createLocalStore<MenuState>("dishexplain-menu", {
  dishOverrides: {},
  categories: [],
  customDishes: [],
  removedDishIds: [],
  tables: [
    { id: "tbl-1", number: 1, isActive: true },
    { id: "tbl-2", number: 2, isActive: true },
    { id: "tbl-3", number: 3, isActive: true },
    { id: "tbl-4", number: 4, isActive: true },
    { id: "tbl-5", number: 5, isActive: true },
    { id: "tbl-6", number: 6, isActive: true },
    { id: "tbl-7", number: 7, isActive: true },
  ],
  settings: {
    upiId: "greentable@upi",
    upiName: "The Cedar Table",
    isOpen: true,
  },
});

export const menuStore = store;

/* --------------------------- Remote cache ---------------------------- */

let remoteBase: {
  restaurant: RemoteMenu["restaurant"];
  categories: MenuCategory[];
  dishes: Dish[];
  tables: RestaurantTable[];
} | null = null;
let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version++;
  listeners.forEach((l) => l());
}

registerMenuStore(
  (data) => {
    remoteBase = data;
    bump();
  },
  () => remoteBase
);

function isRemote(): boolean {
  return isSupabaseConfigured();
}

export function isMenuLoaded(): boolean {
  return !isRemote() || remoteBase !== null;
}

export function subscribeMenu(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Re-render hook: bump when remote menu data loads or changes. */
export function useMenuVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => {
    listeners.add(update);
    function update() {
      setV(version);
    }
    return () => {
      listeners.delete(update);
    };
  }, []);
  return v;
}

/** Starts the Supabase menu load + realtime subscription (once). */
export function initRemoteMenu(): void {
  const sb = getSupabase();
  if (!sb || menuInitStarted) return;
  menuInitStarted = true;
  void import("./remoteData").then((m) => void m.fetchMenu());
  subscribeMenuRemote();
}

let menuInitStarted = false;

/* ------------------------------ Reads -------------------------------- */

function applyOverrides(dish: Dish, overrides: Record<string, DishOverride>): Dish {
  const o = overrides[dish.id];
  return o ? { ...dish, ...o } : dish;
}

export function getRestaurant(): Restaurant {
  if (remoteBase) {
    return {
      id: remoteBase.restaurant.id,
      name: remoteBase.restaurant.name,
      slug: remoteBase.restaurant.slug,
      description: remoteBase.restaurant.description,
      default_language: remoteBase.restaurant.defaultLanguage,
      currency: remoteBase.restaurant.currency,
      upiId: remoteBase.restaurant.upiId,
      upiName: remoteBase.restaurant.upiName,
      isOpen: remoteBase.restaurant.isOpen,
      published: remoteBase.restaurant.published,
      categories: remoteBase.categories,
      dishes: remoteBase.dishes,
      tables: remoteBase.tables,
    };
  }
  const state = store.get();
  const dishes = [
    ...demoRestaurant.dishes
      .filter((d) => !state.removedDishIds.includes(d.id))
      .map((d) => applyOverrides(d, state.dishOverrides)),
    ...state.customDishes.map((d) => applyOverrides(d, state.dishOverrides)),
  ];
  const categories = [...demoRestaurant.categories, ...state.categories].sort(
    (a, b) => a.sort_order - b.sort_order
  );
  return {
    ...demoRestaurant,
    categories,
    dishes,
    tables: state.tables,
    upiId: state.settings.upiId,
    upiName: state.settings.upiName,
    isOpen: state.settings.isOpen,
  };
}

export function getRestaurantBySlug(slug: string): Restaurant | null {
  const restaurant = getRestaurant();
  return restaurant.slug === slug ? restaurant : null;
}

export function getDish(restaurant: Restaurant, dishId: string): Dish | null {
  return restaurant.dishes.find((d) => d.id === dishId) ?? null;
}

/* --------------------------- Write-throughs -------------------------- */

function patchRemoteDish(dishId: string, patch: Partial<Dish>): void {
  if (!remoteBase) return;
  remoteBase = {
    ...remoteBase,
    dishes: remoteBase.dishes.map((d) => (d.id === dishId ? { ...d, ...patch } : d)),
  };
  bump();
}

export function setDishAvailability(dishId: string, available: boolean): void {
  if (remoteBase) {
    patchRemoteDish(dishId, { is_available: available });
    void dbUpdateDish(dishId, { is_available: available });
    return;
  }
  store.update((s) => ({
    ...s,
    dishOverrides: {
      ...s.dishOverrides,
      [dishId]: { ...s.dishOverrides[dishId], is_available: available },
    },
  }));
}

export function setDishPublished(dishId: string, published: boolean): void {
  if (remoteBase) {
    patchRemoteDish(dishId, { published });
    void dbUpdateDish(dishId, { published });
    return;
  }
  store.update((s) => ({
    ...s,
    dishOverrides: {
      ...s.dishOverrides,
      [dishId]: { ...s.dishOverrides[dishId], published },
    },
  }));
}

export function saveDish(dish: Dish): void {
  if (remoteBase) {
    const existing = remoteBase.dishes.some((d) => d.id === dish.id);
    if (existing) {
      patchRemoteDish(dish.id, dish);
      void dbUpdateDishFull(dish);
    } else {
      remoteBase = { ...remoteBase, dishes: [...remoteBase.dishes, dish] };
      bump();
      void dbInsertDish(dish);
    }
    return;
  }
  store.update((s) => {
    const isCustom = s.customDishes.some((d) => d.id === dish.id);
    if (isCustom) {
      return { ...s, customDishes: s.customDishes.map((d) => (d.id === dish.id ? dish : d)) };
    }
    return {
      ...s,
      customDishes: [
        ...s.customDishes,
        { ...dish, updated_at: new Date().toISOString() },
      ],
    };
  });
}

export function newDish(categoryId: string): Dish {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dish-${Date.now().toString(36)}`,
    categoryId,
    name: "",
    price: 0,
    short_description: "",
    ingredients: [],
    taste_profile: [],
    texture_profile: [],
    spice_level: 0,
    dietary_tags: [],
    allergens: [],
    allergens_unknown: true,
    is_special: false,
    is_available: true,
    published: false,
    updated_at: new Date().toISOString(),
  };
}

export function addCategory(name: string): void {
  if (remoteBase) {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `cat-${Date.now().toString(36)}`;
    const maxOrder = Math.max(0, ...remoteBase.categories.map((c) => c.sort_order));
    remoteBase = {
      ...remoteBase,
      categories: [
        ...remoteBase.categories,
        { id, name, sort_order: maxOrder + 1, published: true },
      ],
    };
    bump();
    void dbInsertCategory(id, name, maxOrder + 1);
    return;
  }
  store.update((s) => {
    const maxOrder = Math.max(
      0,
      ...demoRestaurant.categories.map((c) => c.sort_order),
      ...s.categories.map((c) => c.sort_order)
    );
    return {
      ...s,
      categories: [
        ...s.categories,
        {
          id: `cat-${Date.now().toString(36)}`,
          name,
          sort_order: maxOrder + 1,
          published: true,
        },
      ],
    };
  });
}

export function removeCategory(categoryId: string): void {
  if (remoteBase) {
    remoteBase = {
      ...remoteBase,
      categories: remoteBase.categories.filter((c) => c.id !== categoryId),
      dishes: remoteBase.dishes.filter((d) => d.categoryId !== categoryId),
    };
    bump();
    void dbDeleteCategory(categoryId);
    return;
  }
  store.update((s) => ({
    ...s,
    categories: s.categories.filter((c) => c.id !== categoryId),
  }));
}

export function addTable(number: number): void {
  if (remoteBase) {
    if (remoteBase.tables.some((t) => t.number === number)) return;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tbl-${number}`;
    remoteBase = {
      ...remoteBase,
      tables: [...remoteBase.tables, { id, number, isActive: true }].sort(
        (a, b) => a.number - b.number
      ),
    };
    bump();
    void dbInsertTable(number);
    return;
  }
  store.update((s) => {
    if (s.tables.some((t) => t.number === number)) return s;
    return {
      ...s,
      tables: [...s.tables, { id: `tbl-${number}`, number, isActive: true }].sort(
        (a, b) => a.number - b.number
      ),
    };
  });
}

export function setTableActive(tableId: string, isActive: boolean): void {
  if (remoteBase) {
    remoteBase = {
      ...remoteBase,
      tables: remoteBase.tables.map((t) =>
        t.id === tableId ? { ...t, isActive } : t
      ),
    };
    bump();
    void dbUpdateTable(tableId, { is_active: isActive });
    return;
  }
  store.update((s) => ({
    ...s,
    tables: s.tables.map((t) => (t.id === tableId ? { ...t, isActive } : t)),
  }));
}

export function updateSettings(settings: Partial<MenuState["settings"]>): void {
  if (remoteBase) {
    remoteBase = {
      ...remoteBase,
      restaurant: { ...remoteBase.restaurant, ...settings },
    };
    bump();
    void dbUpdateSettings({
      upi_id: settings.upiId,
      upi_name: settings.upiName,
      is_open: settings.isOpen,
    });
    return;
  }
  store.update((s) => ({ ...s, settings: { ...s.settings, ...settings } }));
}

/** Menu completeness score (0–100) per the blueprint's §21 checklist. */
export function dishCompleteness(dish: Dish): {
  percent: number;
  missing: string[];
} {
  const checks: Array<[string, boolean]> = [
    ["Description", Boolean(dish.short_description)],
    ["Ingredients", dish.ingredients.length > 0],
    ["Taste", dish.taste_profile.length > 0],
    ["Texture", dish.texture_profile.length > 0],
    ["Spice", true],
    ["Dietary", dish.dietary_tags.length > 0],
    ["Price", dish.price > 0],
    ["Allergens", dish.allergens.length > 0 || !dish.allergens_unknown],
  ];
  const passed = checks.filter(([, ok]) => ok).length;
  return {
    percent: Math.round((passed / checks.length) * 100),
    missing: checks.filter(([, ok]) => !ok).map(([label]) => label),
  };
}