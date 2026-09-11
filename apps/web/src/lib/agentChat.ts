import { SPICE_LABELS, type CartAction, type ChatResponse, type Dish, type Restaurant } from "../types";
import { SAFETY_NOTE } from "./explain";

export const MAX_QUESTION_CHARS = 500;
export const MAX_AGENT_ANSWER_CHARS = 800;

function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function availableDishes(r: Restaurant): Dish[] {
  return r.dishes.filter((d) => d.published && d.is_available);
}

function findDish(r: Restaurant, question: string): Dish | undefined {
  const q = question.toLowerCase();
  for (const d of availableDishes(r)) {
    if (q.includes(d.name.toLowerCase())) return d;
  }
  return availableDishes(r).find((d) =>
    q.includes(d.name.toLowerCase().split(" ")[0])
  );
}

/** Simple fuzzy match: returns dish if name appears in question. */
function matchDish(r: Restaurant, text: string): Dish | undefined {
  const q = text.toLowerCase();
  const dishes = availableDishes(r);
  // Exact full-name match first
  for (const d of dishes) {
    if (q === d.name.toLowerCase()) return d;
  }
  // Partial match
  for (const d of dishes) {
    if (q.includes(d.name.toLowerCase())) return d;
  }
  // First-word match
  return dishes.find((d) => q.includes(d.name.toLowerCase().split(" ")[0]));
}

type CartEntry = { dishId: string; name: string; quantity: number; price: number };

/**
 * Deterministic fallback that sounds like a real waiter, not a database.
 * Used when the AI provider is unavailable.
 */
export function deterministicAgentAnswer(
  restaurant: Restaurant,
  question: string,
  cart: CartEntry[] = []
): ChatResponse {
  const q = question.toLowerCase();
  const dishes = availableDishes(restaurant);
  const sources = ["menu (restaurant-approved)"];
  let answer: string;
  let actions: CartAction[] | undefined;

  // ---- Add to cart ----
  if (/\b(add|order|i'?ll take|give me|bring me|want)\b/.test(q) && !/\b(remove|cancel|delete)\b/.test(q)) {
    const dish = matchDish(restaurant, q);
    if (dish) {
      const qtyMatch = q.match(/(\d+)/);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      actions = [{ type: "add_to_cart", dishId: dish.id, quantity: qty }];
      answer = qty > 1
        ? `Added ${qty}x ${dish.name} to your order. Anything else?`
        : `Added ${dish.name} to your order. Anything else?`;
    } else {
      answer = "Which dish would you like to add? I can see what's on the menu.";
    }
  }

  // ---- Remove from cart ----
  else if (/\b(remove|cancel|delete|drop)\b/.test(q)) {
    const dish = matchDish(restaurant, q);
    if (dish) {
      actions = [{ type: "remove_from_cart", dishId: dish.id }];
      answer = `Removed ${dish.name} from your order.`;
    } else {
      // Check if they want to clear everything
      if (/\b(all|everything|whole|clear)\b/.test(q)) {
        answer = "Your cart is now empty.";
      } else {
        answer = "Which dish do you want to remove?";
      }
    }
  }

  // ---- View cart / what's my order ----
  else if (/\b(cart|order|my order|what did i|what have i|what's in)\b/.test(q)) {
    if (cart.length === 0) {
      answer = "Your cart is empty. Ready to order something?";
    } else {
      const lines = cart.map((c) => `${c.name} x${c.quantity}`).join(", ");
      const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);
      answer = `You have: ${lines}. Total: ₹${total}. Ready to place the order?`;
    }
  }

  // ---- Clear cart ----
  else if (/\b(clear|empty|reset|start over)\b/.test(q) && /\b(cart|order|everything)\b/.test(q)) {
    answer = "Cart cleared. Want to start fresh?";
  }

  // ---- Pay / checkout ----
  else if (/\b(pay|checkout|check out|place order|place the order|done|ready|proceed|bill|payment)\b/.test(q)) {
    if (cart.length === 0) {
      answer = "Your cart is empty. Add some items first, then I'll take you to checkout.";
    } else {
      actions = [{ type: "navigate_to_checkout" }];
      const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);
      answer = `Taking you to checkout — your total is ₹${total}.`;
    }
  }

  // ---- Allergen / nut / ingredient questions ----
  else if (/\b(allerg|allergen|nut|peanut|gluten|dairy|egg|milk|soy|sesame|fish|shellfish|tree.?nut|contain|contains|safe|cross.?contact)\b/.test(q)) {
    const dish = findDish(restaurant, q);
    if (dish) {
      const allergens = dish.allergens ?? [];
      const unknown = dish.allergens_unknown;
      if (allergens.length === 0 && !unknown) {
        answer = `${dish.name} doesn't have any declared allergens. But if it's a serious allergy, I'd still check with the staff — cross-contact can happen.`;
      } else if (allergens.length === 0 && unknown) {
        answer = `The restaurant hasn't confirmed the full allergen list for ${dish.name}. I'd ask the staff before ordering if you have any allergies.`;
      } else {
        answer = `${dish.name} lists ${list(allergens)} as allergens. If you have a serious allergy, I'd double-check with the staff before ordering — the menu info might not cover everything.`;
      }
    } else {
      const withAllergens = dishes.filter((d) => (d.allergens ?? []).length > 0);
      if (withAllergens.length > 0) {
        answer = `I can check any dish for you — just name it. For example, ${withAllergens[0].name} lists ${list(withAllergens[0].allergens)} as allergens.`;
      } else {
        answer = "Allergen info hasn't been fully listed yet. Ask me about a specific dish and I'll tell you what I know, or check with the staff to be safe.";
      }
    }
  }

  // ---- Ingredient questions ----
  else if (/\b(ingredient|made of|what'?s in|recipe|how is it made)\b/.test(q)) {
    const dish = findDish(restaurant, q);
    if (dish && dish.ingredients.length > 0) {
      answer = `${dish.name} is made with ${list(dish.ingredients)}.`;
    } else if (dish) {
      answer = `The restaurant hasn't listed the full ingredients for ${dish.name}. I'd ask the staff if you need to know.`;
    } else {
      answer = "Which dish are you curious about? I can tell you what's in it.";
    }
  }

  // ---- Specials ----
  else if (/\b(special|today'?s|signature|chef)\b/.test(q)) {
    const specials = dishes.filter((d) => d.is_special);
    if (specials.length === 0) {
      answer = "No specials listed today — but everything on the menu is available. Anything catch your eye?";
    } else if (specials.length === 1) {
      const s = specials[0];
      answer = `The chef's special today is ${s.name} — ${s.short_description || "really good"} (₹${s.price}). Want to know more about it?`;
    } else {
      answer = `The chef's specials today are ${specials.map((d) => d.name).join(" and ")}. ${specials[0].name} is ${specials[0].short_description || "a great pick"}, and ${specials[1].name} is ${specials[1].short_description || "another solid option"}. Want to hear about either one?`;
    }
  }

  // ---- Recommendations / "what should I eat" ----
  else if (/\b(recommend|popular|best|suggest|what'?s good|what should|what can|what do|light|healthy|spicy|mild|heavy|filling|cheap|budget|quick|fast|don'?t know|can'?t decide|confused|help me)\b/.test(q)) {
    const specials = dishes.filter((d) => d.is_special);
    const light = dishes.filter((d) => d.spice_level <= 1 && d.price <= 10);

    if (/\b(light|healthy|small|snack|starter|appetizer)\b/.test(q)) {
      if (light.length > 0) {
        answer = `If you want to keep it light, I'd go with the ${light[0].name} — ${light[0].short_description || "a nice small bite"}. ${light.length > 1 ? `The ${light[1].name} is another good option if you want something a bit more.` : ""} Want me to pick you something?`;
      } else {
        answer = "Hmm, most of the mains are pretty hearty. The starters are your best bet for something lighter. Want me to narrow it down?";
      }
    } else if (/\b(spicy|hot|heat|chili)\b/.test(q)) {
      const spicy = dishes.filter((d) => d.spice_level >= 3);
      if (spicy.length > 0) {
        answer = `If you want heat, the ${spicy[0].name} is rated ${SPICE_LABELS[spicy[0].spice_level]}. ${spicy.length > 1 ? `The ${spicy[1].name} is another spicy one.` : ""} Want to go for it?`;
      } else {
        answer = "Nothing on the menu is super spicy right now. Most things are pretty mild to medium.";
      }
    } else if (/\b(cheap|budget|affordable)\b/.test(q)) {
      const cheap = [...dishes].sort((a, b) => a.price - b.price).slice(0, 3);
      answer = `The most affordable picks are ${cheap.map((d) => `${d.name} at ₹${d.price}`).join(", ")}. Any of those sound good?`;
    } else {
      // General recommendation
      if (specials.length > 0) {
        answer = `If I were picking for you, I'd go with the ${specials[0].name} — it's the chef's special for a reason. ${specials[0].short_description || ""} ₹${specials[0].price}. Want me to tell you more?`;
      } else {
        const top = dishes.slice(0, 3);
        answer = `I'd start with the ${top[0].name} — it's a solid choice. ${top.length > 1 ? `If you want something different, the ${top[1].name} is good too.` : ""} What are you in the mood for?`;
      }
    }
  }

  // ---- Spice level ----
  else if (/\b(spice|spicy|hot|heat)\b/.test(q)) {
    const dish = findDish(restaurant, q);
    if (dish) {
      answer = `${dish.name} is ${SPICE_LABELS[dish.spice_level].toLowerCase()}.`;
    } else {
      answer = "Which dish do you want to know about? I can tell you the spice level.";
    }
  }

  // ---- Price ----
  else if (/\b(price|cost|how much)\b/.test(q)) {
    const dish = findDish(restaurant, q);
    if (dish) {
      answer = `${dish.name} is ₹${dish.price}. ${dish.is_available ? "It's on the menu right now." : "It's currently unavailable though."}`;
    } else {
      answer = "Which dish are you asking about? I can tell you the price.";
    }
  }

  // ---- Open / closed ----
  else if (/\b(open|closed|hours|timing)\b/.test(q)) {
    answer = restaurant.isOpen
      ? "We're open right now — you can order from the menu."
      : "We're currently closed, but you can still browse the menu.";
  }

  // ---- "why do I need you" / meta questions ----
  else if (/\b(why|purpose|what are you|who are you|what can you do|help|useless|point)\b/.test(q)) {
    answer = "I'm here for the quick stuff — what's spicy, what's light, what's in a dish, allergens, prices. If it's something the menu doesn't cover, like custom orders or special requests, I'll point you to the staff.";
  }

  // ---- Dietary / vegetarian / vegan ----
  else if (/\b(vegetarian|vegan|halal|dietary)\b/.test(q)) {
    const tags = /\bvegan\b/.test(q) ? ["Vegan"] : ["Vegetarian", "Vegan"];
    const matches = dishes.filter((d) =>
      d.dietary_tags.some((t) => tags.includes(t))
    );
    if (matches.length > 0) {
      answer = `For something ${/\bvegan\b/.test(q) ? "vegan" : "vegetarian"}, I'd go with the ${matches[0].name} — ${matches[0].short_description || "a great option"}. ${matches.length > 1 ? `The ${matches[1].name} is another good pick.` : ""} Want to hear more about either?`;
    } else {
      answer = "The restaurant hasn't confirmed any vegetarian or vegan labels on the menu yet. I'd check with the staff to be sure.";
    }
  }

  // ---- Pairing ----
  else if (/\b(pair|goes with|combine|drink|wine|water|beverage)\b/.test(q)) {
    const dish = findDish(restaurant, q);
    if (dish) {
      answer = `The ${dish.name} goes well with something light on the side. I'd ask the staff about drinks — they'll know what's available right now.`;
    } else {
      answer = "Which dish are you thinking about? I can suggest what might go with it.";
    }
  }

  // ---- Default ----
  else {
    answer = "That's not something I can help with — I'm better with menu stuff like what's spicy, what's light, allergens, or just recommending something. For anything else, ask the restaurant staff.";
  }

  if (answer.length > MAX_AGENT_ANSWER_CHARS) {
    answer = answer.slice(0, MAX_AGENT_ANSWER_CHARS - 1) + "…";
  }
  return { answer, mode: "deterministic", sources, safetyNote: SAFETY_NOTE, ...(actions ? { actions } : {}) };
}