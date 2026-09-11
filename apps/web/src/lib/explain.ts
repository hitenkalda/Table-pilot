import { SPICE_LABELS, type Dish, type DishExplanation } from "../types";

export const SAFETY_NOTE =
  "Allergy note: always confirm with restaurant staff. Cross-contact is possible even when an allergen is not listed.";

const NOT_PROVIDED = "The restaurant has not provided this information.";

function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}

/**
 * Deterministic explanation generator. Uses only restaurant-approved
 * structured fields and never guesses. Missing fields are stated plainly.
 */
export function explainDish(dish: Dish): DishExplanation {
  const hasIngredients = dish.ingredients.length > 0;
  const hasTaste = dish.taste_profile.length > 0;
  const hasTexture = dish.texture_profile.length > 0;

  let whatItIs: string;
  if (dish.short_description.trim()) {
    whatItIs = dish.short_description;
    if (hasIngredients) {
      whatItIs += ` It is made with ${list(dish.ingredients)}.`;
    } else {
      whatItIs += ` ${NOT_PROVIDED.replace("this information", "a full ingredient list")}`;
    }
  } else if (hasIngredients) {
    whatItIs = `This dish is made with ${list(dish.ingredients)}.`;
  } else {
    whatItIs = NOT_PROVIDED;
  }

  const tasteAndTexture =
    hasTaste && hasTexture
      ? `Expect ${list(dish.taste_profile).toLowerCase()} flavors and a ${list(
          dish.texture_profile
        ).toLowerCase()} texture.`
      : hasTaste
        ? `Expect ${list(dish.taste_profile).toLowerCase()} flavors. Texture information has not been provided.`
        : hasTexture
          ? `Expect a ${list(dish.texture_profile).toLowerCase()} texture. Taste information has not been provided.`
          : NOT_PROVIDED;

  const spice = {
    level: dish.spice_level,
    label: SPICE_LABELS[dish.spice_level] ?? "Unknown",
  };

  const dietary = dish.dietary_tags;
  const allergens = {
    declared: dish.allergens,
    unknown: dish.allergens_unknown || dish.allergens.length === 0,
  };

  const providedCount = [
    hasIngredients,
    hasTaste,
    hasTexture,
    Boolean(dish.short_description),
    dietary.length > 0,
  ].filter(Boolean).length;

  const confidence: DishExplanation["confidence"] =
    providedCount >= 5
      ? "restaurant-provided"
      : providedCount >= 2
        ? "partially-provided"
        : "unknown";

  return {
    dishId: dish.id,
    title: dish.name,
    whatItIs,
    tasteAndTexture,
    spice,
    ingredients: dish.ingredients,
    dietary,
    allergens,
    portionNote: dish.portion_note,
    confidence,
    safetyNote: SAFETY_NOTE,
  };
}
