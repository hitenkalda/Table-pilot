import { beforeEach, describe, expect, it } from "vitest";
import {
  placeOrder,
  transitionOrder,
  canTransition,
  orderAnalytics,
  OrderError,
  setOrderPaymentStatus,
  getOrder,
} from "./orders";
import { getRestaurantBySlug, setDishAvailability } from "./menuSource";
import { UpiPaymentProvider } from "./payments";
import type { Order } from "../types";

const restaurant = getRestaurantBySlug("cedar-table")!;
const kabsa = restaurant.dishes.find((d) => d.id === "dish-kabsa")!;
const unavailable = restaurant.dishes.find((d) => d.id === "dish-mashawi")!;

async function orderOf(items: Array<{ dishId: string; quantity: number; note?: string }>) {
  return placeOrder({
    restaurant,
    tableNumber: 3,
    orderType: "DINE_IN",
    paymentMethod: "CASH",
    items,
  });
}

describe("placeOrder", () => {
  beforeEach(() => {
    // reset between tests that mutate availability
    setDishAvailability("dish-mashawi", false);
  });

  it("creates an order with snapshot prices and sequential numbers", async () => {
    const o = await orderOf([{ dishId: kabsa.id, quantity: 2, note: "Less spicy" }]);
    expect(o.orderNumber).toBeGreaterThan(1000);
    expect(o.status).toBe("PENDING");
    expect(o.paymentStatus).toBe("UNPAID");
    expect(o.items[0].dishNameSnapshot).toBe(kabsa.name);
    expect(o.items[0].unitPriceSnapshot).toBe(kabsa.price);
    expect(o.total).toBe(Math.round(kabsa.price * 2 * 100) / 100);
    expect(o.tableNumber).toBe(3);
    const o2 = await orderOf([{ dishId: kabsa.id, quantity: 1 }]);
    expect(o2.orderNumber).toBe(o.orderNumber + 1);
  });

  it("rejects unavailable dishes", async () => {
    await expect(orderOf([{ dishId: unavailable.id, quantity: 1 }])).rejects.toThrow(
      /unavailable/i
    );
  });

  it("rejects unknown dishes", async () => {
    await expect(orderOf([{ dishId: "nope", quantity: 1 }])).rejects.toThrow(OrderError);
  });

  it("rejects invalid quantities", async () => {
    await expect(orderOf([{ dishId: kabsa.id, quantity: 0 }])).rejects.toThrow(/quantity/i);
    await expect(orderOf([{ dishId: kabsa.id, quantity: 51 }])).rejects.toThrow(/quantity/i);
  });

  it("requires a valid active table for dine-in", async () => {
    await expect(
      placeOrder({
        restaurant,
        tableNumber: 99,
        orderType: "DINE_IN",
        paymentMethod: "CASH",
        items: [{ dishId: kabsa.id, quantity: 1 }],
      })
    ).rejects.toThrow(/table/i);
  });

  it("UPI orders start as PAYMENT_PENDING, never PAID", async () => {
    const o = await placeOrder({
      restaurant,
      tableNumber: 2,
      orderType: "DINE_IN",
      paymentMethod: "UPI",
      items: [{ dishId: kabsa.id, quantity: 1 }],
    });
    expect(o.paymentStatus).toBe("PAYMENT_PENDING");
  });
});

describe("order state machine", () => {
  it("allows only legal transitions", () => {
    expect(canTransition("PENDING", "ACCEPTED")).toBe(true);
    expect(canTransition("PENDING", "READY")).toBe(false);
    expect(canTransition("PREPARING", "READY")).toBe(true);
    expect(canTransition("READY", "PREPARING")).toBe(false);
    expect(canTransition("SERVED", "PENDING")).toBe(false);
  });

  it("full lifecycle PENDING -> SERVED", async () => {
    const o = await orderOf([{ dishId: kabsa.id, quantity: 1 }]);
    await transitionOrder(o.id, "ACCEPTED");
    await transitionOrder(o.id, "PREPARING");
    await transitionOrder(o.id, "READY");
    await transitionOrder(o.id, "SERVED");
    expect(getOrder(o.orderNumber)!.status).toBe("SERVED");
  });

  it("reject records a reason", async () => {
    const o = await orderOf([{ dishId: kabsa.id, quantity: 1 }]);
    const updated = await transitionOrder(o.id, "REJECTED", "Closing soon");
    expect(updated.status).toBe("REJECTED");
    expect(updated.rejectionReason).toBe("Closing soon");
  });

  it("manager can mark payments paid", async () => {
    const o = await orderOf([{ dishId: kabsa.id, quantity: 1 }]);
    await setOrderPaymentStatus(o.id, "PAID");
    expect(getOrder(o.orderNumber)!.paymentStatus).toBe("PAID");
  });
});

describe("analytics", () => {
  it("derives real stats from orders", async () => {
    const o = await orderOf([
      { dishId: kabsa.id, quantity: 2 },
      { dishId: kabsa.id, quantity: 1 },
    ]);
    const a = orderAnalytics([o]);
    expect(a.orderCount).toBe(1);
    expect(a.revenue).toBe(o.total);
    expect(a.topDishes[0]).toEqual({ name: kabsa.name, count: 3 });
  });
});

describe("UpiPaymentProvider", () => {
  it("builds a standard UPI deep link with amount", async () => {
    const o = await orderOf([{ dishId: kabsa.id, quantity: 1 }]);
    const provider = new UpiPaymentProvider("test@upi", "Cedar Table");
    const link = provider.upiLink(o as Order);
    expect(link).toContain("upi://pay?");
    expect(link).toContain("pa=test%40upi");
    expect(link).toContain(`am=${o.total.toFixed(2)}`);
  });
});
