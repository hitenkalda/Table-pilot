import type { Order, Payment, PaymentProvider, PaymentStatus } from "../types";

/**
 * Provider-neutral payment adapters (blueprint §12). None of them trusts a
 * client-side "payment success" claim:
 *  - Cash: paid only when the manager verifies at the counter.
 *  - UPI: order goes to PAYMENT_PENDING; the guest gets a deep link, the
 *    restaurant verifies receipt manually (pilot workflow) before PAID.
 *  - Gateway: stub showing where a webhook-verified provider slots in.
 */

function makeId(): string {
  return `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class CashPaymentProvider implements PaymentProvider {
  readonly method = "CASH" as const;

  async createPayment(order: Order): Promise<Payment> {
    return {
      id: makeId(),
      orderId: order.id,
      method: this.method,
      amount: order.total,
      currency: "INR",
      status: "UNPAID",
      createdAt: new Date().toISOString(),
    };
  }

  async verifyPayment(): Promise<PaymentStatus> {
    // The manager marks cash as received; guests cannot self-confirm.
    return "UNPAID";
  }

  async refundPayment(): Promise<PaymentStatus> {
    return "REFUNDED";
  }
}

export class UpiPaymentProvider implements PaymentProvider {
  readonly method = "UPI" as const;

  private upiId: string;
  private payeeName: string;

  constructor(upiId: string, payeeName: string) {
    this.upiId = upiId;
    this.payeeName = payeeName;
  }

  /** Builds a standard UPI deep link; platform pays no fees. */
  upiLink(order: Order): string {
    const params = new URLSearchParams({
      pa: this.upiId,
      pn: this.payeeName,
      am: order.total.toFixed(2),
      cu: "INR",
      tn: `Order #${order.orderNumber} - ${this.payeeName}`,
    });
    return `upi://pay?${params.toString()}`;
  }

  async createPayment(order: Order): Promise<Payment> {
    return {
      id: makeId(),
      orderId: order.id,
      method: this.method,
      amount: order.total,
      currency: "INR",
      // Pending until the restaurant verifies the received amount —
      // never PAID merely because the guest tapped the link.
      status: "PAYMENT_PENDING",
      createdAt: new Date().toISOString(),
    };
  }

  async verifyPayment(): Promise<PaymentStatus> {
    return "PAYMENT_PENDING";
  }

  async refundPayment(): Promise<PaymentStatus> {
    return "REFUNDED";
  }
}

export class GatewayPaymentProvider implements PaymentProvider {
  readonly method = "GATEWAY" as const;

  async createPayment(order: Order): Promise<Payment> {
    // Placeholder: a real provider (Razorpay, Stripe, ...) plugs in here and
    // confirms via server-side webhook. The pilot ships without it.
    return {
      id: makeId(),
      orderId: order.id,
      method: this.method,
      amount: order.total,
      currency: "INR",
      status: "PAYMENT_FAILED",
      createdAt: new Date().toISOString(),
    };
  }

  async verifyPayment(): Promise<PaymentStatus> {
    return "PAYMENT_FAILED";
  }

  async refundPayment(): Promise<PaymentStatus> {
    return "REFUNDED";
  }
}

export function getProvider(method: "CASH" | "UPI" | "GATEWAY", upiId: string, upiName: string): PaymentProvider {
  switch (method) {
    case "UPI":
      return new UpiPaymentProvider(upiId, upiName);
    case "GATEWAY":
      return new GatewayPaymentProvider();
    default:
      return new CashPaymentProvider();
  }
}
