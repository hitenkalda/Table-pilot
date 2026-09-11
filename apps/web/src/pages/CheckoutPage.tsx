import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { OrderType, PaymentMethod } from "../types";
import { getRestaurantBySlug } from "../lib/menuSource";
import { useCart, cartSubtotal, clearCart } from "../lib/cart";
import { placeOrder, OrderError } from "../lib/orders";
import { UpiPaymentProvider } from "../lib/payments";
import { formatPrice } from "../lib/localStore";

export function CheckoutPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const cart = useCart();
  const restaurant = getRestaurantBySlug(slug ?? "");

  const [orderType, setOrderType] = useState<OrderType>(
    cart.tableNumber ? "DINE_IN" : "TAKEAWAY"
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [tableChoice, setTableChoice] = useState<number | null>(cart.tableNumber);
  const [customerNote, setCustomerNote] = useState(cart.customerNote || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!restaurant) {
    return <div className="not-found"><h1>Restaurant not found</h1></div>;
  }

  const base = `/r/${restaurant.slug}`;
  const lines = cart.items
    .map((item) => ({ item, dish: restaurant.dishes.find((d) => d.id === item.dishId) }))
    .filter((l) => l.dish && l.dish.published && l.dish.is_available);
  const subtotal = cartSubtotal(cart.items, restaurant.dishes);

  async function handlePlaceOrder() {
    if (!restaurant) return;
    setError("");
    setBusy(true);
    try {
      const order = await placeOrder({
        restaurant,
        tableNumber: orderType === "DINE_IN" ? tableChoice : null,
        orderType,
        paymentMethod,
        items: cart.items,
        customerNote: customerNote.trim() || undefined,
      });
      const upiLink =
        paymentMethod === "UPI"
          ? new UpiPaymentProvider(restaurant.upiId, restaurant.upiName).upiLink(order)
          : null;
      clearCart();
      navigate(`/r/${restaurant.slug}/order/${order.orderNumber}`, {
        state: { upiLink },
      });
    } catch (e) {
      setError(e instanceof OrderError ? e.message : "Could not place the order. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <header className="app-header">
        <h1>Checkout</h1>
        <p>{restaurant.name}</p>
      </header>

      {lines.length === 0 ? (
        <p>
          Nothing to check out. <Link to={base}>Browse the menu</Link>.
        </p>
      ) : (
        <>
          <section aria-labelledby="h-table">
            <h4 className="section-title" id="h-table">Table</h4>
            {orderType === "DINE_IN" ? (
              cart.tableNumber ? (
                <p>Table {cart.tableNumber} ✓</p>
              ) : (
                <label className="field-label">
                  Select your table
                  <select
                    className="text-input"
                    value={tableChoice ?? ""}
                    onChange={(e) => setTableChoice(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">— choose table —</option>
                    {restaurant.tables.filter((t) => t.isActive).map((t) => (
                      <option key={t.id} value={t.number}>Table {t.number}</option>
                    ))}
                  </select>
                </label>
              )
            ) : (
              <p>Takeaway — no table needed.</p>
            )}
          </section>

          <section aria-labelledby="h-type">
            <h4 className="section-title" id="h-type">Order type</h4>
            <div className="radio-row">
              <label>
                <input
                  type="radio"
                  name="ordertype"
                  checked={orderType === "DINE_IN"}
                  onChange={() => setOrderType("DINE_IN")}
                />{" "}
                Dine-in
              </label>
              <label>
                <input
                  type="radio"
                  name="ordertype"
                  checked={orderType === "TAKEAWAY"}
                  onChange={() => setOrderType("TAKEAWAY")}
                />{" "}
                Takeaway
              </label>
            </div>
          </section>

          <section aria-labelledby="h-items">
            <h4 className="section-title" id="h-items">Items</h4>
            <div className="totals">
              {lines.map(({ item, dish }) => (
                <div key={`${item.dishId}-${item.note ?? ""}`} className="totals-row">
                  <span>
                    {dish!.name}
                    {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                  </span>
                  <span>{formatPrice("₹", dish!.price * item.quantity)}</span>
                </div>
              ))}
              <div className="totals-row total">
                <span>Total</span>
                <span>{formatPrice("₹", subtotal)}</span>
              </div>
            </div>
          </section>

          <section aria-labelledby="h-note">
            <h4 className="section-title" id="h-note">Note for the restaurant (optional)</h4>
            <input
              className="text-input"
              type="text"
              placeholder="e.g. Birthday, less oil…"
              value={customerNote}
              maxLength={300}
              onChange={(e) => setCustomerNote(e.target.value)}
            />
          </section>

          <section aria-labelledby="h-payment">
            <h4 className="section-title" id="h-payment">Payment</h4>
            <div className="radio-col">
              <label>
                <input
                  type="radio"
                  name="payment"
                  checked={paymentMethod === "CASH"}
                  onChange={() => setPaymentMethod("CASH")}
                />{" "}
                Pay at restaurant (cash / card at counter)
              </label>
              <label>
                <input
                  type="radio"
                  name="payment"
                  checked={paymentMethod === "UPI"}
                  onChange={() => setPaymentMethod("UPI")}
                />{" "}
                Pay with UPI ({restaurant.upiId})
              </label>
              <label className="not-provided">
                <input type="radio" name="payment" disabled /> Online payment — coming with the
                restaurant&apos;s gateway
              </label>
            </div>
          </section>

          {error && <div className="safety-note" role="alert">{error}</div>}

          <button
            className="primary wide"
            disabled={busy || lines.length === 0 || (orderType === "DINE_IN" && !tableChoice)}
            onClick={handlePlaceOrder}
          >
            {busy ? "Placing order…" : `Place Order — ${formatPrice("₹", subtotal)}`}
          </button>
          <p className="voice-hint">
            {paymentMethod === "CASH"
              ? "Pay at the counter when your food arrives."
              : "You'll get a UPI link after placing the order. The restaurant confirms your payment before it's marked paid."}
          </p>
        </>
      )}
    </div>
  );
}
