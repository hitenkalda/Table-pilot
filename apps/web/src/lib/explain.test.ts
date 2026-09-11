import { describe, expect, it } from "vitest";
import { explainDish } from "./explain";
import { demoRestaurant } from "../data/demoRestaurant";
import type { Dish } from "../types";

const baseDish: Dish = demoRestaurant.dishes[0];

const emptyDish: Dish = {
  ...baseDish,
  id: "dish-empty",
  name: "Empty Dish",
  short_description: "",
  ingredients: [],
  taste_profile: [],
  texture_profile: [],
  dietary_tags: [],
  allergens: [],
  allergens_unknown: true,
};

describe("explainDish", () => {
  it("explains a fully described dish without hedging", () => {
    const exp = explainDish(baseDish);
    expect(exp.confidence).toBe("restaurant-provided");
    expect(exp.whatItIs).toContain("Chickpeas");
    expect(exp.spice.label).toBe("Not spicy");
    expect(exp.allergens.declared).toContain("Sesame");
    expect(exp.safetyNote).toMatch(/cross-contact/i);
  });

  it("states plainly when fields are missing and never guesses", () => {
    const exp = explainDish(emptyDish);
    expect(exp.confidence).toBe("unknown");
    expect(exp.whatItIs).toMatch(/has not provided/i);
    expect(exp.tasteAndTexture).toMatch(/has not provided/i);
    expect(exp.ingredients).toHaveLength(0);
    expect(exp.allergens.unknown).toBe(true);
  });

  it("handles partial data with partially-provided confidence", () => {
    const exp = explainDish({
      ...emptyDish,
      ingredients: ["Rice"],
      taste_profile: ["Savory"],
    });
    expect(exp.confidence).toBe("partially-provided");
    expect(exp.whatItIs).toContain("Rice");
    expect(exp.tasteAndTexture).toMatch(/texture information has not been provided/i);
  });

  it("reports max spice with the correct label", () => {
    const exp = explainDish({ ...baseDish, spice_level: 5 });
    expect(exp.spice.label).toBe("Extremely hot");
  });
});
