import { SPICE_LABELS, type ChatResponse, type Dish } from "../types";
import { SAFETY_NOTE } from "./explain";

export const MAX_QUESTION_CHARS = 500;
export const MAX_HISTORY_TURNS = 5;
export const MAX_ANSWER_CHARS = 800;

const NOT_PROVIDED =
  "The restaurant has not provided enough information to answer that question.";

const CAPABILITY_ANSWER =
  "I can explain the ingredients, taste, texture, spice level, dietary labels, declared allergens, and portion information. " +
  NOT_PROVIDED;

function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}

type Intent =
  | "ingredients"
  | "taste"
  | "texture"
  | "diet"
  | "allergens"
  | "portion"
  | "similarity"
  | "availability"
  | "unknown";

const INTENT_KEYWORDS: Array<[Intent, RegExp]> = [
  // Allergen safety takes priority over generic ingredient phrasing
  // ("does it contain nuts?" must never be answered as a plain ingredient list).
  ["allergens", /\b(allerg\w*|nuts?|peanuts?|sesame|gluten|dairy|milk|shellfish|eggs?|soy|safe for)/i],
  ["ingredients", /\b(ingredient|what'?s in|what is in|contain|made of|made with|inside)\b/i],
  ["taste", /\b(taste|flavor|flavour|sweet|sour|salty|bitter|savory|spicy|hot is it|spice)\b/i],
  ["texture", /\b(texture|crunch|crispy|creamy|soft|chewy|tender|juicy|dry)\b/i],
  ["diet", /\b(vegetarian|vegan|halal|kosher|gluten[- ]free|dairy[- ]free|dietary)\b/i],
  ["portion", /\b(portion|share|enough for|big|small|how much|serving|filling)\b/i],
  ["similarity", /\b(similar|like what|what does it (compare|resemble)|remind)\b/i],
  ["availability", /\b(available|sold out|order|get it)\b/i],
];

function detectIntent(question: string): Intent {
  for (const [intent, re] of INTENT_KEYWORDS) {
    if (re.test(question)) return intent;
  }
  return "unknown";
}

function allergenAnswer(dish: Dish, question: string): string {
  const nutMatch = question.match(/\b(nuts?|peanuts?|almonds?|cashews?|pistachios?|walnuts?)\b/i);
  const declared = dish.allergens.map((a) => a.toLowerCase());
  if (nutMatch) {
    const nut = nutMatch[1].toLowerCase();
    const hit = declared.find((a) => a.includes(nut));
    if (hit) {
      return `Yes — the restaurant has declared ${hit} as an allergen in this dish. ${SAFETY_NOTE}`;
    }
    if (!dish.allergens_unknown) {
      return `The restaurant's declared allergen list for this dish (${list(
        dish.allergens
      )} or "none declared") does not include ${nutMatch[1]}. However, ${SAFETY_NOTE.toLowerCase()}`;
    }
  }
  if (dish.allergens.length > 0 && !dish.allergens_unknown) {
    return `The restaurant has declared these allergens: ${list(dish.allergens)}. ${SAFETY_NOTE}`;
  }
  return `The restaurant has not declared allergen information for this dish, so it must be treated as unknown. ${SAFETY_NOTE}`;
}

/**
 * Deterministic chat fallback. Answers only from restaurant-approved
 * dish fields; never guesses. Matches the ChatResponse contract used by
 * the optional AI proxy in functions/api/chat.ts.
 */
export function deterministicAnswer(dish: Dish, question: string): ChatResponse {
  const intent = detectIntent(question);
  let answer: string;
  const sources: string[] = [];

  switch (intent) {
    case "ingredients":
      if (dish.ingredients.length > 0) {
        answer = `The restaurant lists these ingredients: ${list(dish.ingredients)}.`;
        sources.push("ingredients");
      } else {
        answer = "The restaurant has not provided an ingredient list for this dish.";
      }
      break;

    case "allergens":
      answer = allergenAnswer(dish, question);
      sources.push("allergens");
      break;

    case "taste": {
      const parts: string[] = [];
      if (/\bspic|hot\b/i.test(question)) {
        parts.push(
          dish.spice_level === 0
            ? "The restaurant rates this dish as not spicy."
            : `The restaurant rates the spice level ${dish.spice_level} out of 5 (${SPICE_LABELS[dish.spice_level]}).`
        );
        sources.push("spice_level");
      }
      if (dish.taste_profile.length > 0) {
        parts.push(`The taste profile is ${list(dish.taste_profile).toLowerCase()}.`);
        sources.push("taste_profile");
      }
      answer = parts.length > 0 ? parts.join(" ") : NOT_PROVIDED;
      break;
    }

    case "texture":
      if (dish.texture_profile.length > 0) {
        answer = `The texture is ${list(dish.texture_profile).toLowerCase()}.`;
        sources.push("texture_profile");
      } else {
        answer = NOT_PROVIDED;
      }
      break;

    case "diet": {
      if (dish.dietary_tags.length > 0) {
        answer = `The restaurant has confirmed these dietary labels: ${list(dish.dietary_tags)}. Any label not listed is not confirmed.`;
        sources.push("dietary_tags");
      } else {
        answer =
          "The restaurant has not confirmed any dietary labels (such as vegetarian or vegan) for this dish, so it should be treated as unspecified.";
      }
      break;
    }

    case "portion":
      if (dish.portion_note) {
        answer = dish.portion_note;
        sources.push("portion_note");
      } else {
        answer = NOT_PROVIDED;
      }
      break;

    case "similarity":
      if (dish.taste_profile.length > 0 || dish.texture_profile.length > 0) {
        const parts: string[] = [];
        if (dish.taste_profile.length > 0)
          parts.push(`${list(dish.taste_profile).toLowerCase()} flavors`);
        if (dish.texture_profile.length > 0)
          parts.push(`a ${list(dish.texture_profile).toLowerCase()} texture`);
        answer = `Based on the restaurant's description, expect ${parts.join(" and ")}. The restaurant has not provided comparison dishes.`;
        sources.push("taste_profile", "texture_profile");
      } else {
        answer = NOT_PROVIDED;
      }
      break;

    case "availability":
      answer = dish.is_available
        ? "Yes, the restaurant currently lists this dish as available."
        : "This dish is currently marked unavailable by the restaurant. Please ask the staff when it will return.";
      sources.push("is_available");
      break;

    default:
      answer = CAPABILITY_ANSWER;
  }

  if (answer.length > MAX_ANSWER_CHARS) {
    answer = answer.slice(0, MAX_ANSWER_CHARS - 1) + "…";
  }

  return { answer, mode: "deterministic", sources, safetyNote: SAFETY_NOTE };
}
