import { useEffect, useState } from "react";
import { createLocalStore } from "./localStore";
import { isSupabaseConfigured } from "./supabase";
import type {
  Dish,
  Order,
  OrderItem,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  Restaurant,
} from "../types";
import { getProvider } from "./payments";
import {
  placeOrderRemote,
  transitionOrderRemote,
  setPaymentStatusRemote,
  subscribeOrders,
  fetchOrderByNumber,
  subscribeOrderNumber,
} from "./remoteData";
import { subscribeMenu, isMenuLoaded } from "./menuSource";

/**
 * Order store with two backends behind one API:
 *  - Supabase (configured): orders live in Postgres, prices are re-validated
 *    by the place_order() database function, transitions/payment updates go
 *    through staff-only RPCs, and the dashboard gets Supabase Realtime +
 *    a periodic refresh fallback.
 *  - localStorage fallback (no Supabase env): immutable local snapshots with
 *    cross-tab storage events, exactly like the original prototype.
 *
 * Orders are immutable snapshots (blueprint §40): dish name and unit price
 * are captured at placement time. Prices sent by the browser are NEVER
 * trusted — the server revalidates against the current published menu.
 */

type OrderState = {
  orders: Order[];
  lastOrderNumber: number;
};

const store = createLocalStore<OrderState>("dishexplain-orders", {
  orders: [],
  lastOrderNumber: 1041,
});

export const orderStore = store;

function useLocalOrders(): Order[] {
  const [orders, setOrders] = useState<Order[]>(store.get().orders);
  useEffect(() => store.subscribe(() => setOrders([...store.get().orders])), []);
  return orders;
}

function useRemoteOrders(): Order[] | null {
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => {
    let stopped = false;
    let stopOrders: (() => void) | null = null;
    function start() {
      if (stopped || stopOrders) return;
      stopOrders = subscribeOrders((o) => {
        if (!stopped) setOrders(o);
      });
    }
    if (isMenuLoaded()) {
      start();
    } else {
      const stopMenu = subscribeMenu(() => {
        if (isMenuLoaded()) {
          start();
          stopMenu();
        }
      });
      return () => {
        stopped = true;
        stopMenu();
        stopOrders?.();
      };
    }
    return () => {
      stopped = true;
      stopOrders?.();
    };
  }, []);
  return orders;
}

export function useOrders(): Order[] {
  const local = useLocalOrders();
  const remote = useRemoteOrders();
  return isSupabaseConfigured() ? (remote ?? []) : local;
}

/** Legal transitions per blueprint §13. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY"],
  READY: ["SERVED"],
  SERVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class OrderError extends Error {}

export type PlaceOrderInput = {
  restaurant: Restaurant;
  tableNumber: number | null;
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  /** Guest-claimed selections; every dish id and quantity is revalidated. */
  items: Array<{ dishId: string; quantity: number; note?: string }>;
  customerNote?: string;
};

/**
 * Creates an order from guest input. Server-side rules from blueprint §28:
 * fetches current published prices, validates availability, computes totals,
 * snapshots everything, applies the payment method, and returns the order.
 * With Supabase configured this runs entirely in Postgres via place_order().
 */
export async function placeOrder(input: PlaceOrderInput): Promise<Order> {
  const { restaurant, orderType, paymentMethod, customerNote } = input;

  if (input.items.length === 0) {
    throw new OrderError("Your cart is empty.");
  }

  // Validate table for dine-in.
  const tableNumber = orderType === "DINE_IN" ? input.tableNumber : null;
  if (orderType === "DINE_IN") {
    const table =
      tableNumber != null
        ? restaurant.tables.find((t) => t.number === tableNumber && t.isActive)
        : null;
    if (!table) {
      throw new OrderError("Please scan a valid table QR code or choose takeaway.");
    }
  }

  // Payment method handling. Nothing is PAID here: cash stays UNPAID until
  // the manager confirms, UPI goes to PAYMENT_PENDING until verified.
  void getProvider(paymentMethod, restaurant.upiId, restaurant.upiName); // provider kept behind the adapter

  if (isSupabaseConfigured()) {
    try {
      return await placeOrderRemote({
        restaurantSlug: restaurant.slug,
        tableNumber,
        orderType,
        paymentMethod,
        items: input.items,
        customerNote,
      });
    } catch (e) {
      throw new OrderError(e instanceof Error ? e.message : "Could not place the order.");
    }
  }

  // Offline demo path: revalidate prices against the current menu.
  const items: OrderItem[] = [];
  for (const line of input.items) {
    const quantity = Math.floor(line.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 50) {
      throw new OrderError(`Invalid quantity for a dish in your order.`);
    }
    const dish: Dish | undefined = restaurant.dishes.find(
      (d) => d.id === line.dishId && d.published
    );
    if (!dish) throw new OrderError("A dish in your order is no longer on the menu.");
    if (!dish.is_available) {
      throw new OrderError(`"${dish.name}" is currently unavailable. Please remove it to continue.`);
    }
    items.push({
      dishId: dish.id,
      dishNameSnapshot: dish.name,
      unitPriceSnapshot: dish.price,
      quantity,
      specialInstruction: line.note,
      subtotal: Math.round(dish.price * quantity * 100) / 100,
    });
  }

  const subtotal = Math.round(items.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
  const tax = 0; // restaurant-level tax comes with Phase 7 hardening
  const discount = 0;
  const total = Math.round((subtotal + tax - discount) * 100) / 100;

  const paymentStatus: PaymentStatus =
    paymentMethod === "UPI" ? "PAYMENT_PENDING" : "UNPAID";

  const now = new Date().toISOString();
  const { orders, lastOrderNumber } = store.get();
  const order: Order = {
    id: `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    restaurantId: restaurant.id,
    restaurantSlug: restaurant.slug,
    tableNumber,
    orderNumber: lastOrderNumber + 1,
    orderType,
    status: "PENDING",
    paymentStatus,
    paymentMethod,
    items,
    subtotal,
    tax,
    discount,
    total,
    customerNote,
    createdAt: now,
    updatedAt: now,
  };

  store.set({ orders: [order, ...orders], lastOrderNumber: order.orderNumber });
  return order;
}

/**
 * Moves an order along the state machine. With Supabase the transition is
 * enforced by the update_order_status() RPC; the board refreshes via
 * realtime. Returns the updated order (legacy path) and rejects with
 * OrderError on illegal transitions or permission errors.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  rejectionReason?: string
): Promise<Order> {
  if (isSupabaseConfigured()) {
    try {
      await transitionOrderRemote(orderId, to, rejectionReason);
    } catch (e) {
      throw new OrderError(e instanceof Error ? e.message : "Update failed.");
    }
    const state = store.get();
    const cached = state.orders.find((o) => o.id === orderId);
    return {
      ...(cached ?? ({} as Order)),
      id: orderId,
      status: to,
      rejectionReason:
        to === "REJECTED"
          ? rejectionReason ?? "Kitchen is currently at capacity."
          : undefined,
      updatedAt: new Date().toISOString(),
    } as Order;
  }

  const state = store.get();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new OrderError("Order not found.");
  if (!canTransition(order.status, to)) {
    throw new OrderError(`Cannot move order from ${order.status} to ${to}.`);
  }
  const updated: Order = {
    ...order,
    status: to,
    rejectionReason: to === "REJECTED" ? (rejectionReason ?? "Kitchen is currently at capacity.") : undefined,
    updatedAt: new Date().toISOString(),
  };
  store.set({
    ...state,
    orders: state.orders.map((o) => (o.id === orderId ? updated : o)),
  });
  return updated;
}

export async function setOrderPaymentStatus(
  orderId: string,
  paymentStatus: PaymentStatus
): Promise<Order> {
  if (isSupabaseConfigured()) {
    try {
      await setPaymentStatusRemote(orderId, paymentStatus);
    } catch (e) {
      throw new OrderError(e instanceof Error ? e.message : "Payment update failed.");
    }
    const state = store.get();
    const order = state.orders.find((o) => o.id === orderId);
    return {
      ...(order ?? ({} as Order)),
      id: orderId,
      paymentStatus,
      updatedAt: new Date().toISOString(),
    } as Order;
  }

  const state = store.get();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new OrderError("Order not found.");
  const updated: Order = {
    ...order,
    paymentStatus,
    updatedAt: new Date().toISOString(),
  };
  store.set({
    ...state,
    orders: state.orders.map((o) => (o.id === orderId ? updated : o)),
  });
  return updated;
}

export function getOrder(orderNumber: number): Order | null {
  return store.get().orders.find((o) => o.orderNumber === orderNumber) ?? null;
}

/**
 * Live order lookup by number: Supabase (guest-safe public read + realtime)
 * when configured, the local store otherwise.
 */
export function useOrder(orderNumber: number): Order | null {
  const [local, setLocal] = useState<Order | null>(getOrder(orderNumber));
  const [remote, setRemote] = useState<Order | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return store.subscribe(() => setLocal(getOrder(orderNumber)));
    }
    let stopped = false;
    function load() {
      void fetchOrderByNumber(orderNumber).then((o) => {
        if (!stopped) setRemote(o);
      });
    }
    if (isMenuLoaded()) {
      load();
    } else {
      const stopMenu = subscribeMenu(() => {
        if (isMenuLoaded()) {
          load();
          stopMenu();
        }
      });
    }
    const stopChannel = subscribeOrderNumber(orderNumber, load);
    return () => {
      stopped = true;
      stopChannel();
    };
  }, [orderNumber]);

  return isSupabaseConfigured() ? remote : local;
}

/* -------- Analytics (blueprint §31): derived from real orders only -------- */

export function orderAnalytics(orders: Order[]) {
  const active = orders.filter((o) => !["REJECTED", "CANCELLED"].includes(o.status));
  const todayOrders = active;
  const revenue = todayOrders.reduce((s, o) => s + o.total, 0);
  const dishCounts = new Map<string, number>();
  for (const o of todayOrders) {
    for (const item of o.items) {
      dishCounts.set(
        item.dishNameSnapshot,
        (dishCounts.get(item.dishNameSnapshot) ?? 0) + item.quantity
      );
    }
  }
  const topDishes = [...dishCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
  return {
    orderCount: todayOrders.length,
    revenue,
    avgOrder: todayOrders.length > 0 ? revenue / todayOrders.length : 0,
    pending: orders.filter((o) => o.status === "PENDING").length,
    preparing: orders.filter((o) => o.status === "PREPARING").length,
    ready: orders.filter((o) => o.status === "READY").length,
    rejected: orders.filter((o) => o.status === "REJECTED").length,
    topDishes,
  };
}