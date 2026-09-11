import { describe, expect, it } from "vitest";
import { deterministicAnswer, MAX_ANSWER_CHARS } from "./deterministicChat";
import { demoRestaurant } from "../data/demoRestaurant";

const dish = demoRestaurant.dishes.find((d) => d.id === "dish-kabsa")!;
const nutDish = demoRestaurant.dishes.find((d) => d.id === "dish-kunafa")!;
const unknownAllergenDish = demoRestaurant.dishes.find((d) => d.id === "dish-mashawi")!;

describe("deterministicAnswer", () => {
  it("answers ingredient questions from the approved list", () => {
    const res = deterministicAnswer(dish, "What is in it?");
    expect(res.mode).toBe("deterministic");
    expect(res.answer).toContain("Chicken (on the bone)");
    expect(res.sources).toContain("ingredients");
  });

  it("answers spice questions with the restaurant rating", () => {
    const res = deterministicAnswer(dish, "How spicy is this?");
    expect(res.answer).toContain("2 out of 5");
  });

  it("warns on allergy questions even for declared nuts", () => {
    const res = deterministicAnswer(nutDish, "Does it contain nuts?");
    expect(res.answer).toMatch(/pistachio|nut/i);
    expect(res.answer).toMatch(/cross-contact|confirm with restaurant staff/i);
  });

  it("treats undeclared allergens as unknown, never safe", () => {
    const res = deterministicAnswer(unknownAllergenDish, "Is it safe for someone with a nut allergy?");
    expect(res.answer).toMatch(/unknown|not declared/i);
    expect(res.answer).not.toMatch(/yes, it is safe/i);
  });

  it("answers dietary questions only from confirmed tags", () => {
    const res = deterministicAnswer(dish, "Is it vegetarian?");
    expect(res.answer).toContain("Halal");
    expect(res.answer).toMatch(/not confirmed|unspecified/i);
  });

  it("returns the capability fallback for unmatched questions", () => {
    const res = deterministicAnswer(dish, "Can I customize the recipe?");
    expect(res.answer).toMatch(/has not provided enough information/i);
  });

  it("never exceeds the answer length cap", () => {
    const res = deterministicAnswer(dish, "tell me everything " + "x".repeat(1000));
    expect(res.answer.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
  });
});
