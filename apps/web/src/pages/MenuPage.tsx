import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Dish } from "../types";
import { getRestaurantBySlug, useMenuVersion } from "../lib/menuSource";
import { useCart, addToCart, cartCount } from "../lib/cart";
import { formatPrice } from "../lib/localStore";
import { SPICE_LABELS } from "../types";
import { DishSheet } from "../components/DishSheet";
import { ChatPanel } from "../components/DishChat";

export function AgentSheet({ restaurant, onClose }: { restaurant: NonNullable<ReturnType<typeof getRestaurantBySlug>>; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Ask the AI waiter">
        <div className="sheet-actions" style={{ justifyContent: "space-between" }}>
          <h2>🤵 AI Waiter — {restaurant.name}</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <ChatPanel restaurant={restaurant} />
      </div>
    </div>
  );
}

export function MenuPage() {
  const { slug, table } = useParams();
  const tableNumber = table ? Number(table) : null;
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const cart = useCart();

  const menuVersion = useMenuVersion();

  const restaurant = useMemo(() => getRestaurantBySlug(slug ?? ""), [slug, menuVersion]);

  const dishes = useMemo(() => {
    if (!restaurant) return [];
    const q = query.trim().toLowerCase();
    return restaurant.dishes.filter(
      (d) =>
        d.published &&
        (activeCategory === "all" || d.categoryId === activeCategory) &&
        (q === "" ||
          d.name.toLowerCase().includes(q) ||
          d.short_description.toLowerCase().includes(q) ||
          d.ingredients.some((i) => i.toLowerCase().includes(q)))
    );
  }, [restaurant, activeCategory, query]);

  const categories = useMemo(
    () => restaurant?.categories.filter((c) => c.published) ?? [],
    [restaurant]
  );

  if (!restaurant) {
    return (
      <div className="not-found">
        <h1>Restaurant not found</h1>
        <p>This menu link is not valid. Please ask restaurant staff for the correct QR code.</p>
      </div>
    );
  }

  const base = `/r/${restaurant.slug}${tableNumber ? `/t/${tableNumber}` : ""}`;
  const count = cartCount(cart.items);

  return (
    <div className="container">
      <header className="app-header">
        <h1>{restaurant.name}</h1>
        <p>{restaurant.description}</p>
        <div className="chips">
          {tableNumber != null && <span className="chip">Table {tableNumber}</span>}
          <span className={`chip ${restaurant.isOpen ? "open" : "closed"}`}>
            {restaurant.isOpen ? "● Open" : "○ Currently closed — you can still browse"}
          </span>
        </div>
      </header>

      <label className="visually-hidden" htmlFor="menu-search">Search dishes</label>
      <input
        id="menu-search"
        className="search-bar"
        type="search"
        placeholder="Search dishes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <nav className="category-tabs" role="tablist" aria-label="Menu categories">
        <button role="tab" aria-selected={activeCategory === "all"} onClick={() => setActiveCategory("all")}>
          All dishes
        </button>
        {categories.map((c) => (
          <button key={c.id} role="tab" aria-selected={activeCategory === c.id} onClick={() => setActiveCategory(c.id)}>
            {c.name}
          </button>
        ))}
      </nav>

      <main className="dish-list">
        {dishes.length === 0 && (
          <p>
            {query
              ? `No dishes match "${query}".`
              : "The menu is not published yet. Please ask our staff for today's dishes."}
          </p>
        )}
        {dishes.map((dish) => (
          <article key={dish.id} className="dish-card">
            <button
              className="dish-card-main"
              onClick={() => setSelectedDish(dish)}
              aria-label={`View details for ${dish.name}`}
            >
              <div className="title-row">
                <h3>{dish.name}</h3>
                <span className="price">{formatPrice("₹", dish.price)}</span>
              </div>
              <p>{dish.short_description}</p>
              <div className="chips" style={{ margin: 0 }}>
                {dish.is_special && <span className="chip special">★ Chef's special</span>}
                {dish.spice_level > 0 && (
                  <span className="chip spice" aria-label={`Spice level ${dish.spice_level} of 5`}>
                    🌶 {SPICE_LABELS[dish.spice_level]}
                  </span>
                )}
                {dish.dietary_tags.map((t) => (
                  <span key={t} className="chip">{t}</span>
                ))}
                {!dish.is_available && <span className="chip unavailable">Unavailable</span>}
              </div>
            </button>
            <div className="sheet-actions">
              <button onClick={() => setSelectedDish(dish)}>💬 Ask AI</button>
              <button
                className="primary"
                disabled={!dish.is_available}
                onClick={() => addToCart(restaurant.slug, tableNumber, dish.id, 1)}
              >
                Add {formatPrice("₹", dish.price)}
              </button>
            </div>
          </article>
        ))}
      </main>

      <footer className="footer-links">
        <a href="/manager">Manager dashboard</a>
      </footer>

      {count > 0 && (
        <Link to={`${base}/cart`} className="sticky-cart">
          🛒 {count} item{count > 1 ? "s" : ""} — view cart
        </Link>
      )}

      <button className="agent-fab" onClick={() => setAgentOpen(true)}>
        🤵 Ask the waiter
      </button>

      {agentOpen && <AgentSheet restaurant={restaurant} onClose={() => setAgentOpen(false)} />}

      {selectedDish && (
        <DishSheet
          restaurant={restaurant}
          dish={selectedDish}
          tableNumber={tableNumber}
          onClose={() => setSelectedDish(null)}
        />
      )}
    </div>
  );
}
