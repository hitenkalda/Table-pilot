/**
 * Vercel Serverless Function: POST /api/chat
 *
 * AI waiter with Groq function calling for cart actions.
 * Keeps API keys server-side.
 */

const SYSTEM_PROMPT = `You are a concise restaurant waiter. Answer ONLY what was asked. 1-2 sentences for simple questions, 2-3 max for recommendations.

RULES:
- Be natural, like a real waiter. Use contractions.
- Never dump full menus, tables, or every field.
- Match the user's tone. Casual? Be casual.
- One short follow-up is fine. Don't pepper with questions.
- Only use facts from the menu data below. Never invent anything.

You have cart tools. When the guest wants to order something, use the tool. Match dish names exactly from the menu. When they say "add" or "I'll take" or "give me", add_to_cart. When they say "remove" or "delete", remove_from_cart. When they say "change X to Y" or "make it Y", update_cart_item. When they ask "what's in my cart" or "my order", summarize cart contents without a tool call. When they say "pay", "checkout", "place order", "bill", "done", or "ready", use navigate_to_checkout.`;

const SAFETY_NOTE =
  "Allergy note: always confirm with restaurant staff. Cross-contact is possible even when an allergen is not listed.";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const history: Array<{ role: string; content: string }> = Array.isArray(body.messages)
      ? body.messages
          .filter(
            (m: { role?: string; content?: string }) =>
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string"
          )
          .slice(-8)
      : [];

    const lastUser = [...history].reverse().find((m: { role: string }) => m.role === "user");
    if (!lastUser) {
      return new Response(JSON.stringify({ error: "No question provided." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          answer: "The AI waiter is running in menu-information mode. Please ask restaurant staff for details.",
          mode: "deterministic",
          sources: [],
          safetyNote: SAFETY_NOTE,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    const context = typeof body.context === "string" ? body.context.slice(0, 6000) : "";

    const cartItems: Array<{ dishId: string; name: string; quantity: number; price: number }> =
      Array.isArray(body.cart) ? body.cart : [];
    const cartLines =
      cartItems.length > 0
        ? "\n\nCurrent cart:\n" +
          cartItems
            .map((c: { name: string; quantity: number; price: number }) =>
              `- ${c.name} x${c.quantity} (₹${c.price * c.quantity})`
            )
            .join("\n")
        : "\n\nCurrent cart: empty";

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "add_to_cart",
          description: "Add a dish to the guest's cart",
          parameters: {
            type: "object",
            properties: {
              dishId: { type: "string", description: "The exact dish ID from the menu" },
              quantity: { type: "number", description: "Number to add (default 1)" },
            },
            required: ["dishId"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "remove_from_cart",
          description: "Remove a dish from the guest's cart",
          parameters: {
            type: "object",
            properties: {
              dishId: { type: "string", description: "The exact dish ID to remove" },
            },
            required: ["dishId"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "update_cart_item",
          description: "Change the quantity of a dish already in the cart",
          parameters: {
            type: "object",
            properties: {
              dishId: { type: "string", description: "The exact dish ID to update" },
              quantity: { type: "number", description: "New quantity (0 to remove)" },
            },
            required: ["dishId", "quantity"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "navigate_to_checkout",
          description: "Navigate the guest to the checkout/payment page",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let providerRes: Response;
    try {
      providerRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          max_tokens: 500,
          temperature: 0.4,
          tools,
          tool_choice: "auto",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "system", content: `Restaurant menu data:\n${context}${cartLines}` },
            ...history,
          ],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (providerRes.ok) {
      const data: any = await providerRes.json();
      const msg = data.choices?.[0]?.message;
      const answer: string = msg?.content?.slice(0, 500) || "";
      const toolCalls: Array<{
        function: { name: string; arguments: string };
      }> = msg?.tool_calls ?? [];

      const actions: Array<
        | { type: "add_to_cart"; dishId: string; quantity: number }
        | { type: "remove_from_cart"; dishId: string }
        | { type: "update_cart_item"; dishId: string; quantity: number }
        | { type: "navigate_to_checkout" }
      > = [];

      for (const tc of toolCalls) {
        try {
          const args = JSON.parse(tc.function.arguments);
          if (tc.function.name === "add_to_cart" && args.dishId) {
            actions.push({ type: "add_to_cart", dishId: args.dishId, quantity: args.quantity ?? 1 });
          } else if (tc.function.name === "remove_from_cart" && args.dishId) {
            actions.push({ type: "remove_from_cart", dishId: args.dishId });
          } else if (tc.function.name === "update_cart_item" && args.dishId && typeof args.quantity === "number") {
            actions.push({ type: "update_cart_item", dishId: args.dishId, quantity: args.quantity });
          } else if (tc.function.name === "navigate_to_checkout") {
            actions.push({ type: "navigate_to_checkout" });
          }
        } catch {
          // skip malformed tool call
        }
      }

      if (answer || actions.length > 0) {
        return new Response(
          JSON.stringify({
            answer: answer || (actions.length > 0 ? "Done!" : ""),
            mode: "ai",
            sources: [body.scope === "dish" ? `dish ${body.dishId ?? ""}`.trim() : "restaurant menu"],
            safetyNote: SAFETY_NOTE,
            actions,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({
        answer: "I couldn't process that right now. You can still browse the menu or ask restaurant staff.",
        mode: "deterministic",
        sources: [],
        safetyNote: SAFETY_NOTE,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch {
    return new Response(JSON.stringify({ error: "Proxy failure." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
