import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Dish, Restaurant } from "../types";
import { explainDish } from "../lib/explain";
import { addToCart } from "../lib/cart";
import { formatPrice } from "../lib/localStore";
import { speak, speechSynthesisSupported, stopSpeaking } from "../lib/voice";
import { ExplanationSections } from "./ExplanationSections";
import { DishChat } from "./DishChat";

type Props = {
  restaurant: Restaurant;
  dish: Dish;
  tableNumber: number | null;
  onClose: () => void;
};

/** Bottom sheet from the menu: explanation + voice + add-to-cart. */
export function DishSheet({ restaurant, dish, tableNumber, onClose }: Props) {
  const explanation = explainDish(dish);
  const [tab, setTab] = useState<"explain" | "chat" | "order">("explain");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const navigate = useNavigate();

  const canSpeak = speechSynthesisSupported();

  function speakFull(text: string) {
    setSpeaking(true);
    const started = speak(text, () => setSpeaking(false));
    if (!started) setSpeaking(false);
  }

  function handleAdd() {
    addToCart(restaurant.slug, tableNumber, dish.id, quantity, note.trim() || undefined);
    onClose();
    navigate(`/r/${restaurant.slug}/cart`);
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`About ${dish.name}`}>
        <div className="sheet-actions" style={{ justifyContent: "space-between" }}>
          <h2>{dish.name}</h2>
          <button onClick={() => { stopSpeaking(); onClose(); }} aria-label="Close">✕</button>
        </div>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "explain"} onClick={() => setTab("explain")}>Explain</button>
          <button role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>Ask AI 💬🎤</button>
          <button role="tab" aria-selected={tab === "order"} onClick={() => setTab("order")}>Order</button>
        </div>

        {tab === "explain" && (
          <>
            {canSpeak && (
              <div className="sheet-actions voice-bar">
                <button
                  onClick={() =>
                    speaking
                      ? (stopSpeaking(), setSpeaking(false))
                      : speakFull(
                          [
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
                  {speaking ? "⏹ Stop voice" : "🔊 Listen to this dish"}
                </button>
              </div>
            )}
            <ExplanationSections explanation={explanation} />
          </>
        )}

        {tab === "chat" && <DishChat restaurant={restaurant} dish={dish} />}

        {tab === "order" && (
          <section aria-label="Order this dish">
            {dish.is_available ? (
              <>
                <div className="qty-row">
                  <span>Quantity</span>
                  <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
                  <strong>{quantity}</strong>
                  <button onClick={() => setQuantity((q) => Math.min(20, q + 1))} aria-label="Increase quantity">+</button>
                </div>
                <label className="field-label" htmlFor="sheet-note">
                  Special instructions
                </label>
                <input
                  id="sheet-note"
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
              </>
            ) : (
              <p className="not-provided">
                Currently unavailable — this dish cannot be added to an order.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
