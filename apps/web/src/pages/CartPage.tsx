import { Link, useParams } from "react-router-dom";
import { cartStore, useCart, cartSubtotal, setQuantity, removeFromCart } from "../lib/cart";
import { getRestaurantBySlug } from "../lib/menuSource";
import { formatPrice } from "../lib/localStore";

export function CartPage() {
  const { slug } = useParams();
  const cart = useCart();
  const restaurant = getRestaurantBySlug(slug ?? "");

  if (!restaurant) {
    return (
      <div className="not-found">
        <h1>Restaurant not found</h1>
      </div>
    );
  }

  const base = `/r/${restaurant.slug}${cart.tableNumber ? `/t/${cart.tableNumber}` : ""}`;
  const lines = cart.items
    .map((item) => ({ item, dish: restaurant.dishes.find((d) => d.id === item.dishId) }))
    .filter((l) => l.dish && l.dish.published);
  const subtotal = cartSubtotal(cart.items, restaurant.dishes);
  const unavailable = lines.filter((l) => !l.dish!.is_available);

  return (
    <div className="container">
      <header className="app-header">
        <h1>Your order</h1>
        <p>
          {cart.tableNumber ? `Table ${cart.tableNumber} · ` : ""}
          {restaurant.name}
        </p>
      </header>

      {lines.length === 0 ? (
        <p>
          Your cart is empty. <Link to={base}>Browse the menu</Link>.
        </p>
      ) : (
        <>
          {unavailable.length > 0 && (
            <div className="safety-note">
              {unavailable
                .map((l) => `"${l.dish!.name}" is currently unavailable`)
                .join(", ")}
              . Please remove it to place your order.
            </div>
          )}
          <main className="cart-list">
            {lines.map(({ item, dish }) => (
              <article key={`${item.dishId}-${item.note ?? ""}`} className="dish-card">
                <div className="title-row">
                  <h3>{dish!.name}</h3>
                  <span className="price">{formatPrice("₹", dish!.price * item.quantity)}</span>
                </div>
                {item.note && <p className="not-provided">Note: {item.note}</p>}
                <div className="qty-row">
                  <button
                    onClick={() => setQuantity(item.dishId, item.note, item.quantity - 1)}
                    aria-label={`Decrease ${dish!.name}`}
                  >
                    −
                  </button>
                  <strong>{item.quantity}</strong>
                  <button
                    onClick={() => setQuantity(item.dishId, item.note, item.quantity + 1)}
                    aria-label={`Increase ${dish!.name}`}
                  >
                    +
                  </button>
                  <button className="link-danger" onClick={() => removeFromCart(item.dishId, item.note)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </main>
          <div className="totals">
            <div className="totals-row">
              <span>Subtotal</span>
              <span>{formatPrice("₹", subtotal)}</span>
            </div>
            <div className="totals-row total">
              <span>Total</span>
              <span>{formatPrice("₹", subtotal)}</span>
            </div>
          </div>
          <Link to={`${base}/checkout`} className="sticky-cart">
            Continue to checkout →
          </Link>
        </>
      )}
      <button
        className="link-danger"
        onClick={() => cartStore.update((s) => ({ ...s, items: [] }))}
      >
        Clear cart
      </button>
    </div>
  );
}
