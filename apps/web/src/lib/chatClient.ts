import type { ChatMessage, ChatResponse, Dish, Restaurant } from "../types";
import { deterministicAnswer, MAX_HISTORY_TURNS, MAX_QUESTION_CHARS } from "./deterministicChat";
import { deterministicAgentAnswer } from "./agentChat";

/**
 * Restaurant-wide AI waiter. Tries the /api/chat proxy (which talks to the
 * optional AI provider with the full approved menu context); falls back to
 * the deterministic agent that answers specials, recommendations, prices,
 * and dietary queries from the menu alone.
 */
export type CartContextItem = {
  dishId: string;
  name: string;
  quantity: number;
  price: number;
};

export async function askAgent(
  restaurant: Restaurant,
  messages: ChatMessage[],
  cart: CartContextItem[] = []
): Promise<ChatResponse> {
  const history = messages.slice(-MAX_HISTORY_TURNS - 1);
  const lastUser = [...history].reverse().find((m) => m.role === "user");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantSlug: restaurant.slug,
        scope: "restaurant",
        context: menuContext(restaurant),
        messages: history,
        cart,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as ChatResponse;
      if (data && typeof data.answer === "string" && data.answer.length > 0) {
        return data;
      }
    }
  } catch {
    // Endpoint unavailable; deterministic agent below.
  }

  const question = (lastUser?.content ?? "").slice(0, MAX_QUESTION_CHARS);
  return deterministicAgentAnswer(restaurant, question, cart);
}

/**
 * Sends the chat request to the optional server-side proxy (/api/chat,
 * a Cloudflare Pages Function). When the proxy is unavailable — or no AI
 * provider is configured — falls back to the deterministic engine that
 * runs entirely in the browser. The public menu never depends on the
 * chat endpoint.
 */
/** Compact restaurant-approved summary sent to the provider as context. */
function dishContext(dish: Dish): string {
  return JSON.stringify({
    name: dish.name,
    price: dish.price,
    description: dish.short_description,
    ingredients: dish.ingredients,
    taste: dish.taste_profile,
    texture: dish.texture_profile,
    spice_level: dish.spice_level,
    dietary_tags: dish.dietary_tags,
    declared_allergens: dish.allergens,
    allergens_unknown: dish.allergens_unknown,
    portion: dish.portion_note ?? null,
    is_available: dish.is_available,
    is_special: Boolean(dish.is_special),
  });
}

export function menuContext(restaurant: Restaurant): string {
  const dishes = restaurant.dishes
    .filter((d) => d.published)
    .map((d) => ({
      id: d.id,
      name: d.name,
      price: d.price,
      description: d.short_description,
      ingredients: d.ingredients,
      taste: d.taste_profile,
      texture: d.texture_profile,
      spice_level: d.spice_level,
      dietary_tags: d.dietary_tags,
      declared_allergens: d.allergens,
      allergens_unknown: d.allergens_unknown,
      portion: d.portion_note ?? null,
      is_available: d.is_available,
      is_special: Boolean(d.is_special),
    }));
  return JSON.stringify({
    restaurant: restaurant.name,
    is_open: restaurant.isOpen,
    dishes,
  });
}

export async function askQuestion(
  restaurantSlug: string,
  dish: Dish,
  messages: ChatMessage[]
): Promise<ChatResponse> {
  const history = messages.slice(-MAX_HISTORY_TURNS - 1);
  const lastUser = [...history].reverse().find((m) => m.role === "user");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantSlug,
        scope: "dish",
        dishId: dish.id,
        context: dishContext(dish),
        messages: history,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as ChatResponse;
      if (data && typeof data.answer === "string" && data.answer.length > 0) {
        return data;
      }
    }
  } catch {
    // Endpoint unavailable; deterministic fallback below.
  }

  const question = (lastUser?.content ?? "").slice(0, MAX_QUESTION_CHARS);
  return deterministicAnswer(dish, question);
}
