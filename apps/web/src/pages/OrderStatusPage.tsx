import { useParams, useLocation, Link } from "react-router-dom";
import type { OrderStatus } from "../types";
import { useOrder } from "../lib/orders";
import { formatPrice, timeAgo } from "../lib/localStore";

const STEPS: OrderStatus[] = ["PENDING", "ACCEPTED", "PREPARING", "READY", "SERVED"];

const STEP_LABELS: Record<OrderStatus, string> = {
  PENDING: "Order received",
  ACCEPTED: "Restaurant accepted",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export function OrderStatusPage() {
  const { orderNumber } = useParams();
  const location = useLocation();
  const upiLink = (location.state as { upiLink?: string } | null)?.upiLink;
  const order = useOrder(Number(orderNumber));

  if (!order) {
    return (
      <div className="not-found">
        <h1>Order not found</h1>
        <p>
          We couldn&apos;t find order #{orderNumber}. Check the order number or{" "}
          <Link to="/r/cedar-table">return to the menu</Link>.
        </p>
      </div>
    );
  }

  if (order.status === "REJECTED") {
    return (
      <div className="container">
        <div className="not-found">
          <h1>Order #{order.orderNumber}</h1>
          <p>
            Unfortunately, the restaurant couldn&apos;t accept this order.
          </p>
          <p>
            Reason: <strong>{order.rejectionReason ?? "Not specified"}</strong>
          </p>
          <p>
            <Link to={`/r/${order.restaurantSlug}`}>Back to menu</Link>
          </p>
        </div>
      </div>
    );
  }

  const currentStep = STEPS.indexOf(order.status);

  return (
    <div className="container">
      <header className="app-header">
        <h1>
          {order.status === "READY" ? "🎉 Your order is ready!" : `Order #${order.orderNumber}`}
        </h1>
        <p>
          {order.tableNumber ? `Table ${order.tableNumber}` : "Takeaway"} · placed{" "}
          {timeAgo(order.createdAt)} · {formatPrice("₹", order.total)}
        </p>
        <Link
          to={
            order.tableNumber
              ? `/r/${order.restaurantSlug}/t/${order.tableNumber}`
              : `/r/${order.restaurantSlug}`
          }
        >
          ← Back to menu
        </Link>
      </header>

      {order.status === "READY" && (
        <p className="order-ready-note">
          Please show this screen when collecting your food.
        </p>
      )}

      <ol className="tracker" aria-label="Order progress">
        {STEPS.map((step, i) => (
          <li
            key={step}
            className={i < currentStep ? "done" : i === currentStep ? "current" : "todo"}
          >
            {STEP_LABELS[step]}
          </li>
        ))}
      </ol>

      <p className="voice-hint">
        {order.status === "PENDING" && "Waiting for the restaurant to accept your order…"}
        {order.status === "ACCEPTED" && "Your order has been accepted and will start soon."}
        {order.status === "PREPARING" && "Your food is being prepared."}
        {order.status === "READY" && "Your food is ready!"}
        {order.status === "SERVED" && "Enjoy your meal — thank you!"}
        {order.status === "CANCELLED" && "This order was cancelled."}
      </p>

      {order.status === "CANCELLED" && (
        <p>
          <Link to={`/r/${order.restaurantSlug}`}>Back to menu</Link>
        </p>
      )}

      <section aria-labelledby="h-summary">
        <h4 className="section-title" id="h-summary">Items</h4>
        <div className="totals">
          {order.items.map((item, i) => (
            <div key={i} className="totals-row">
              <span>
                {item.dishNameSnapshot} × {item.quantity}
                {item.specialInstruction ? ` — ${item.specialInstruction}` : ""}
              </span>
              <span>{formatPrice("₹", item.subtotal)}</span>
            </div>
          ))}
          <div className="totals-row total">
            <span>Total</span>
            <span>{formatPrice("₹", order.total)}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="h-pay">
        <h4 className="section-title" id="h-pay">Payment</h4>
        <p>
          {order.paymentMethod === "CASH" && "Pay at the restaurant."}{" "}
          {order.paymentMethod === "UPI" && "UPI — "}
          <strong>{order.paymentStatus.replace("_", " ")}</strong>
        </p>
        {upiLink && order.paymentStatus !== "PAID" && (
          <a className="button-link primary" href={upiLink}>
            Pay {formatPrice("₹", order.total)} via UPI
          </a>
        )}
        {order.paymentMethod === "UPI" && order.paymentStatus !== "PAID" && (
          <p className="voice-hint">
            After paying, show the confirmation to the restaurant — they verify and mark
            the order paid.
          </p>
        )}
      </section>
    </div>
  );
}
