/**
 * Supabase data layer. When env vars are configured this module is the
 * source of truth for menus, tables and orders; the localStorage stores in
 * menuSource/orders stay as the offline/demo fallback.
 *
 * All guest writes go through the place_order() Postgres function: prices,
 * availability, tables and quantities are validated in the database, never
 * in the browser. Staff mutations (order transitions, payment verification)
 * go through RPCs that check staff membership via auth.uid() and RLS.
 */

import { getSupabase } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Dish,
  MenuCategory,
  Order,
  OrderStatus,
  PaymentStatus,
  RestaurantTable,
} from "../types";

export type RemoteMenu = {
  restaurant: {
    id: string;
    name: string;
    slug: string;
    description: string;
    defaultLanguage: string;
    currency: string;
    upiId: string;
    upiName: string;
    isOpen: boolean;
    published: boolean;
  };
  categories: MenuCategory[];
  dishes: Dish[];
  tables: RestaurantTable[];
};

/* ---------------------------- Row mapping ---------------------------- */

export function mapDishRow(r: any): Dish {
  return {
    id: r.id,
    categoryId: r.category_id,
    name: r.name,
    price: Number(r.price),
    short_description: r.short_description ?? "",
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    taste_profile: Array.isArray(r.taste_profile) ? r.taste_profile : [],
    texture_profile: Array.isArray(r.texture_profile) ? r.texture_profile : [],
    spice_level: r.spice_level ?? 0,
    dietary_tags: r.dietary_tags ?? [],
    allergens: r.allergens ?? [],
    allergens_unknown: r.allergens_unknown ?? true,
    portion_note: r.portion_note ?? undefined,
    is_special: r.is_special ?? false,
    image_url: r.image_url ?? undefined,
    is_available: r.is_available,
    published: r.published,
    updated_at: r.updated_at,
  };
}

function mapCategoryRow(r: any): MenuCategory {
  return { id: r.id, name: r.name, sort_order: r.sort_order, published: r.published };
}

function mapTableRow(r: any): RestaurantTable {
  return { id: r.id, number: r.table_number, isActive: r.is_active };
}

function mapOrderRow(
  r: any,
  items: any[],
  tables: RestaurantTable[],
  slug: string
): Order {
  const table = r.table_id ? tables.find((t) => t.id === r.table_id) : null;
  return {
    id: r.id,
    restaurantId: r.restaurant_id,
    restaurantSlug: slug,
    tableNumber: table?.number ?? null,
    orderNumber: Number(r.order_number),
    orderType: r.order_type,
    status: r.status as OrderStatus,
    paymentStatus: r.payment_status as PaymentStatus,
    paymentMethod: r.payment_method,
    items: items.map((i) => ({
      dishId: i.dish_id,
      dishNameSnapshot: i.dish_name_snapshot,
      unitPriceSnapshot: Number(i.unit_price_snapshot),
      quantity: i.quantity,
      specialInstruction: i.special_instruction ?? undefined,
      subtotal: Number(i.subtotal),
    })),
    subtotal: Number(r.subtotal),
    tax: Number(r.tax),
    discount: Number(r.discount),
    total: Number(r.total),
    customerNote: r.customer_note ?? undefined,
    rejectionReason: r.rejection_reason ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ------------------------------ Menu --------------------------------- */

export async function fetchMenu(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data: rest } = await sb.from("restaurants").select("*").limit(1).maybeSingle();
  if (!rest) return false;

  const [cats, dis, tbls] = await Promise.all([
    sb.from("menu_categories").select("*").order("sort_order"),
    sb.from("dishes").select("*").order("name"),
    sb.from("tables").select("*").order("table_number"),
  ]);

  menuSink({
    restaurant: {
      id: rest.id,
      name: rest.name,
      slug: rest.slug,
      description: rest.description ?? "",
      defaultLanguage: rest.default_language ?? "en",
      currency: rest.currency ?? "₹",
      upiId: rest.upi_id ?? "",
      upiName: rest.upi_name ?? "",
      isOpen: rest.is_open ?? true,
      published: rest.published,
    },
    categories: (cats.data ?? []).map(mapCategoryRow),
    dishes: (dis.data ?? []).map(mapDishRow),
    tables: (tbls.data ?? []).map(mapTableRow),
  });
  return true;
}

// menuSource registers its cache at module load (it imports this module, so
// registration happens before any fetch runs).
let menuSink: (data: RemoteMenu) => void = () => {};
let remoteBaseRef: () => RemoteMenu | null = () => null;
export function registerMenuStore(
  sink: (data: RemoteMenu) => void,
  getBase: () => RemoteMenu | null
): void {
  menuSink = sink;
  remoteBaseRef = getBase;
}

function getRemoteBase(): RemoteMenu | null {
  return remoteBaseRef();
}

let menuChannelSubscribed = false;

/** Loads the menu once and keeps it live via Supabase Realtime. */
export function subscribeMenu(): void {
  const sb = getSupabase();
  if (!sb || menuChannelSubscribed) return;
  menuChannelSubscribed = true;
  sb
    .channel("tablepilot-menu")
    .on("postgres_changes", { event: "*", schema: "public", table: "restaurants" }, () => void fetchMenu())
    .on("postgres_changes", { event: "*", schema: "public", table: "menu_categories" }, () => void fetchMenu())
    .on("postgres_changes", { event: "*", schema: "public", table: "dishes" }, () => void fetchMenu())
    .on("postgres_changes", { event: "*", schema: "public", table: "tables" }, () => void fetchMenu())
    .subscribe();
}

/* ------------------------- Menu write-through ------------------------ */

function sbOrThrow(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured.");
  return sb;
}

function restaurantId(): string {
  return getRemoteBase()?.restaurant.id ?? "";
}

async function onErrorRefetch(r: { error: { message: string } | null }): Promise<void> {
  if (r.error) await fetchMenu();
}

export async function dbUpdateDish(dishId: string, patch: Record<string, unknown>): Promise<void> {
  await onErrorRefetch(await sbOrThrow().from("dishes").update(patch).eq("id", dishId));
}

export async function dbInsertDish(dish: Dish): Promise<void> {
  await onErrorRefetch(
    await sbOrThrow()
      .from("dishes")
      .insert({
        id: dish.id,
        restaurant_id: restaurantId(),
        category_id: dish.categoryId,
        name: dish.name,
        price: dish.price,
        short_description: dish.short_description,
        ingredients: dish.ingredients,
        taste_profile: dish.taste_profile,
        texture_profile: dish.texture_profile,
        spice_level: dish.spice_level,
        dietary_tags: dish.dietary_tags,
        allergens: dish.allergens,
        allergens_unknown: dish.allergens_unknown,
        portion_note: dish.portion_note ?? null,
        is_special: Boolean(dish.is_special),
        is_available: dish.is_available,
        published: dish.published,
      })
  );
}

export async function dbUpdateDishFull(dish: Dish): Promise<void> {
  await dbUpdateDish(dish.id, {
    category_id: dish.categoryId,
    name: dish.name,
    price: dish.price,
    short_description: dish.short_description,
    ingredients: dish.ingredients,
    taste_profile: dish.taste_profile,
    texture_profile: dish.texture_profile,
    spice_level: dish.spice_level,
    dietary_tags: dish.dietary_tags,
    allergens: dish.allergens,
    allergens_unknown: dish.allergens_unknown,
    portion_note: dish.portion_note ?? null,
    is_special: Boolean(dish.is_special),
  });
}

export async function dbInsertCategory(id: string, name: string, sortOrder: number): Promise<void> {
  await onErrorRefetch(
    await sbOrThrow()
      .from("menu_categories")
      .insert({ id, restaurant_id: restaurantId(), name, sort_order: sortOrder, published: true })
  );
}

export async function dbDeleteCategory(categoryId: string): Promise<void> {
  await onErrorRefetch(await sbOrThrow().from("menu_categories").delete().eq("id", categoryId));
}

export async function dbInsertTable(number: number): Promise<void> {
  await onErrorRefetch(
    await sbOrThrow()
      .from("tables")
      .insert({ restaurant_id: restaurantId(), table_number: number, is_active: true })
  );
}

export async function dbUpdateTable(tableId: string, patch: Record<string, unknown>): Promise<void> {
  await onErrorRefetch(await sbOrThrow().from("tables").update(patch).eq("id", tableId));
}

export async function dbUpdateSettings(patch: {
  upi_id?: string;
  upi_name?: string;
  is_open?: boolean;
}): Promise<void> {
  await onErrorRefetch(await sbOrThrow().from("restaurants").update(patch).eq("id", restaurantId()));
}

/* ------------------------------ Orders ------------------------------- */

async function hydrateOrders(rows: any[]): Promise<Order[]> {
  if (rows.length === 0) return [];
  const base = getRemoteBase();
  if (!base) return [];
  const sb = sbOrThrow();
  const ids = rows.map((r) => r.id);
  const { data: itemRows } = await sb.from("order_items").select("*").in("order_id", ids);
  const byOrder = new Map<string, any[]>();
  for (const it of itemRows ?? []) {
    const list = byOrder.get(it.order_id) ?? [];
    list.push(it);
    byOrder.set(it.order_id, list);
  }
  return rows.map((r) =>
    mapOrderRow(r, byOrder.get(r.id) ?? [], base.tables, base.restaurant.slug)
  );
}

async function fetchOrdersList(): Promise<Order[]> {
  const base = getRemoteBase();
  if (!base) return [];
  const { data: rows } = await sbOrThrow()
    .from("orders")
    .select("*")
    .eq("restaurant_id", base.restaurant.id)
    .order("created_at", { ascending: false })
    .limit(200);
  return hydrateOrders(rows ?? []);
}

export async function fetchOrderByNumber(orderNumber: number): Promise<Order | null> {
  const base = getRemoteBase();
  if (!base) return null;
  const { data: row } = await sbOrThrow()
    .from("orders")
    .select("*")
    .eq("restaurant_id", base.restaurant.id)
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (!row) return null;
  const [order] = await hydrateOrders([row]);
  return order ?? null;
}

/** Live order feed for the dashboard: realtime events + a safety poll. */
export function subscribeOrders(onChange: (orders: Order[]) => void): () => void {
  const sb = sbOrThrow();
  const base = getRemoteBase();
  let stopped = false;
  const push = () => {
    void fetchOrdersList().then((orders) => {
      if (!stopped) onChange(orders);
    });
  };
  push();
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;
  if (base) {
    channel = sb
      .channel("tablepilot-orders")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${base.restaurant.id}`,
        },
        push
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, push)
      .subscribe();
  }
  const interval = window.setInterval(push, 30000);
  return () => {
    stopped = true;
    window.clearInterval(interval);
    if (channel) sb.removeChannel(channel);
  };
}

export function subscribeOrderNumber(orderNumber: number, onChange: () => void): () => void {
  const sb = sbOrThrow();
  const channel = sb
    .channel(`order-${orderNumber}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: `order_number=eq.${orderNumber}` },
      onChange
    )
    .subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}

/* --------------------------- Order mutations -------------------------- */

export type RemotePlaceOrderInput = {
  restaurantSlug: string;
  tableNumber: number | null;
  orderType: "DINE_IN" | "TAKEAWAY";
  paymentMethod: "CASH" | "UPI" | "GATEWAY";
  items: Array<{ dishId: string; quantity: number; note?: string }>;
  customerNote?: string;
};

export async function placeOrderRemote(input: RemotePlaceOrderInput): Promise<Order> {
  const sb = sbOrThrow();
  const { data, error } = await sb.rpc("place_order", {
    p_restaurant_slug: input.restaurantSlug,
    p_table_number: input.tableNumber,
    p_order_type: input.orderType,
    p_payment_method: input.paymentMethod,
    p_items: input.items.map((i) => ({
      dishId: i.dishId,
      quantity: Math.floor(i.quantity),
      note: i.note ?? null,
    })),
    p_customer_note: input.customerNote ?? null,
  });
  if (error) throw new Error(error.message);
  const { data: row } = await sbOrThrow()
    .from("orders")
    .select("*")
    .eq("id", data as string)
    .maybeSingle();
  if (!row) throw new Error("Order was created but could not be read back.");
  const [order] = await hydrateOrders([row]);
  return order!;
}

export async function transitionOrderRemote(
  orderId: string,
  to: OrderStatus,
  rejectionReason?: string
): Promise<void> {
  const { error } = await sbOrThrow().rpc("update_order_status", {
    p_order_id: orderId,
    p_new_status: to,
    p_rejection_reason: rejectionReason ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function setPaymentStatusRemote(
  orderId: string,
  status: PaymentStatus
): Promise<void> {
  const { error } = await sbOrThrow().rpc("set_order_payment_status", {
    p_order_id: orderId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}