import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Dish, Restaurant } from "../types";
import { explainDish } from "../lib/explain";
import { addToCart } from "../lib/cart";
import { formatPrice } from "../lib/localStore";
import { speak, speechSynthesisSupported } from "../lib/voice";
import { ExplanationSections } from "./ExplanationSections";
import { DishChat } from "./DishChat";

type Props = {
  restaurant: Restaurant;
  dish: Dish;
  tableNumber: number | null;
};

/** Full dish page per blueprint §6: details, Ask AI, quantity + notes. */
export function DishPage({ restaurant, dish, tableNumber }: Props) {
  const explanation = explainDish(dish);
  const [tab, setTab] = useState<"details" | "chat">("details");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const navigate = useNavigate();
  const canSpeak = speechSynthesisSupported();

  function handleAdd() {
    addToCart(restaurant.slug, tableNumber, dish.id, quantity, note.trim() || undefined);
    navigate(`/r/${restaurant.slug}/cart`);
  }

  return (
    <div className="container">
      <nav className="breadcrumbs" aria-label="Back">
        <a href={`/r/${restaurant.slug}${tableNumber ? `/t/${tableNumber}` : ""}`}>
          ← Back to menu
        </a>
      </nav>
      <header className="app-header">
        <h1>{dish.name}</h1>
        <p>{formatPrice("₹", dish.price)}</p>
        {!dish.is_available && <span className="chip unavailable">Currently unavailable</span>}
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")}>
          Dish details
        </button>
        <button role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
          Ask AI 💬🎤
        </button>
      </div>

      {tab === "details" && (
        <>
          {canSpeak && (
            <div className="sheet-actions voice-bar">
              <button
                onClick={() =>
                  speak(
                    [
                      `${dish.name}.`,
                      explanation.whatItIs,
                      explanation.tasteAndTexture,
                      `Spice level: ${explanation.spice.label}.`,
                      explanation.ingredients.length > 0
                        ? `Ingredients: ${explanation.ingredients.join(", ")}.`
                        : "",
                      explanation.safetyNote,
                    ]
                      .filter(Boolean)
                      .join(" ")
                  )
                }
              >
                🔊 Listen to this dish
              </button>
            </div>
          )}
          <ExplanationSections explanation={explanation} />

          {dish.is_available && (
            <section aria-label="Add to order">
              <div className="qty-row">
                <span>Quantity</span>
                <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
                <strong>{quantity}</strong>
                <button onClick={() => setQuantity((q) => Math.min(20, q + 1))} aria-label="Increase quantity">+</button>
              </div>
              <label className="field-label" htmlFor="dish-note">Special instructions</label>
              <input
                id="dish-note"
                type="text"
                className="text-input"
                placeholder="e.g. Less spicy please"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className="primary wide" onClick={handleAdd}>
                Add to Cart — {formatPrice("₹", dish.price * quantity)}
              </button>
            </section>
          )}
        </>
      )}

      {tab === "chat" && <DishChat restaurant={restaurant} dish={dish} />}
    </div>
  );
}
