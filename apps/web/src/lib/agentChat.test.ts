import { describe, expect, it } from "vitest";
import { deterministicAgentAnswer } from "./agentChat";
import { getRestaurantBySlug } from "./menuSource";

const r = getRestaurantBySlug("cedar-table")!;

describe("deterministicAgentAnswer (AI waiter fallback)", () => {
  it("answers specials questions from the is_special flag", () => {
    const res = deterministicAgentAnswer(r, "What are today's specials?");
    expect(res.answer).toContain("Beef Nihari");
    expect(res.answer).toContain("Kunafa");
    expect(res.mode).toBe("deterministic");
  });

  it("recommends the specials when asked for suggestions", () => {
    const res = deterministicAgentAnswer(r, "What do you recommend?");
    expect(res.answer).toMatch(/Nihari|Kunafa/);
  });

  it("lists vegetarian options when asked", () => {
    const res = deterministicAgentAnswer(r, "What is vegetarian here?");
    expect(res.answer).toMatch(/Hummus|Labneh/);
  });

  it("answers price questions for a named dish", () => {
    const res = deterministicAgentAnswer(r, "How much is the Kunafa?");
    expect(res.answer).toContain("₹9");
  });

  it("never invents answers outside menu data", () => {
    const res = deterministicAgentAnswer(r, "Can I book a table for tomorrow 8pm with live music?");
    expect(res.answer).toMatch(/ask the restaurant staff/i);
    expect(res.answer).not.toMatch(/yes, (we|i)/i);
  });

  it("mentions open/closed state truthfully", () => {
    const res = deterministicAgentAnswer(r, "Are you open?");
    expect(res.answer).toMatch(/open right now|currently closed/);
  });
});
