import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const SYSTEM_PROMPT = `You are a concise restaurant waiter. Answer ONLY what was asked. 1-2 sentences for simple questions, 2-3 max for recommendations.

RULES:
- Be natural, like a real waiter. Use contractions.
- Never dump full menus, tables, or every field.
- Match the user's tone. Casual? Be casual.
- One short follow-up is fine. Don't pepper with questions.
- Only use facts from the menu data below. Never invent anything.

You have cart tools. When the guest wants to order something, use the tool. Match dish names exactly from the menu. When they say "add" or "I'll take" or "give me", add_to_cart. When they say "remove" or "delete", remove_from_cart. When they say "change X to Y" or "make it Y", update_cart_item. When they ask "what's in my cart" or "my order", summarize cart contents without a tool call. When they say "pay", "checkout", "place order", "bill", "done", or "ready", use navigate_to_checkout. When the guest mentions a preference like "less spicy", "no onions", "extra sauce", "birthday", "allergic to X", or any special instruction, use set_instruction to save it. Combine multiple instructions into one note.`;

const SAFETY_NOTE =
  "Allergy note: always confirm with restaurant staff. Cross-contact is possible even when an allergen is not listed.";

/** Dev-only stand-in for the deployed Cloudflare Pages Function
 *  (functions/api/chat.ts): same contract, calls Groq server-side. */
function chatProxy(env: Record<string, string>): Plugin {
  return {
    name: "dev-chat-proxy",
    configureServer(server) {
      server.middlewares.use("/api/chat", (req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", async () => {
          try {
            const body = JSON.parse(raw || "{}");
            const history = Array.isArray(body.messages)
              ? body.messages
                  .filter(
                    (m: { role?: string; content?: string }) =>
                      (m.role === "user" || m.role === "assistant") &&
                      typeof m.content === "string"
                  )
                  .slice(-8)
              : [];
            const lastUser = [...history].reverse().find(
              (m: { role: string }) => m.role === "user"
            );
            if (!lastUser) {
              res.writeHead(400, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "No question provided." }));
              return;
            }
            if (!env.GROQ_API_KEY) {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(
                JSON.stringify({
                  answer:
                    "The AI waiter is running in menu-information mode. Please ask restaurant staff for details.",
                  mode: "deterministic",
                  sources: [],
                  safetyNote: SAFETY_NOTE,
                })
              );
              return;
            }
            const context =
              typeof body.context === "string"
                ? body.context.slice(0, 6000)
                : "";

            // Build cart summary for the prompt
            const cartItems: Array<{ dishId: string; name: string; quantity: number; price: number }> =
              Array.isArray(body.cart) ? body.cart : [];
            const cartLines = cartItems.length > 0
              ? "\n\nCurrent cart:\n" + cartItems.map(
                  (c: { name: string; quantity: number; price: number }) =>
                    `- ${c.name} x${c.quantity} (₹${c.price * c.quantity})`
                ).join("\n")
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
              {
                type: "function" as const,
                function: {
                  name: "set_instruction",
                  description: "Save a special instruction or preference from the guest (e.g. less spicy, no onions, birthday)",
                  parameters: {
                    type: "object",
                    properties: {
                      note: { type: "string", description: "The instruction text" },
                    },
                    required: ["note"],
                  },
                },
              },
            ];

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            let providerRes: Response;
            try {
              providerRes = await fetch(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${env.GROQ_API_KEY}`,
                  },
                  signal: controller.signal,
                  body: JSON.stringify({
                    model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
                    max_tokens: 500,
                    temperature: 0.4,
                    tools,
                    tool_choice: "auto",
                    messages: [
                      { role: "system", content: SYSTEM_PROMPT },
                      {
                        role: "system",
                        content: `Restaurant menu data:\n${context}${cartLines}`,
                      },
                      ...history,
                    ],
                  }),
                }
              );
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

              // Parse tool calls into CartAction[]
              const actions: Array<
                | { type: "add_to_cart"; dishId: string; quantity: number }
                | { type: "remove_from_cart"; dishId: string }
                | { type: "update_cart_item"; dishId: string; quantity: number }
                | { type: "navigate_to_checkout" }
                | { type: "set_instruction"; note: string }
              > = [];
              for (const tc of toolCalls) {
                try {
                  const args = JSON.parse(tc.function.arguments);
                  if (tc.function.name === "add_to_cart" && args.dishId) {
                    actions.push({
                      type: "add_to_cart",
                      dishId: args.dishId,
                      quantity: args.quantity ?? 1,
                    });
                  } else if (tc.function.name === "remove_from_cart" && args.dishId) {
                    actions.push({ type: "remove_from_cart", dishId: args.dishId });
                  } else if (
                    tc.function.name === "update_cart_item" &&
                    args.dishId &&
                    typeof args.quantity === "number"
                  ) {
                    actions.push({
                      type: "update_cart_item",
                      dishId: args.dishId,
                      quantity: args.quantity,
                    });
                  } else if (tc.function.name === "navigate_to_checkout") {
                    actions.push({ type: "navigate_to_checkout" });
                  } else if (tc.function.name === "set_instruction" && args.note) {
                    actions.push({ type: "set_instruction", note: args.note });
                  }
                } catch {
                  // skip malformed tool call
                }
              }

              if (answer || actions.length > 0) {
                res.writeHead(200, { "content-type": "application/json" });
                res.end(
                  JSON.stringify({
                    answer: answer || (actions.length > 0 ? "Done!" : ""),
                    mode: "ai",
                    sources: [
                      body.scope === "dish"
                        ? `dish ${body.dishId ?? ""}`.trim()
                        : "restaurant menu",
                    ],
                    safetyNote: SAFETY_NOTE,
                    actions,
                  })
                );
                return;
              }
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                answer:
                  "I couldn't process that right now. You can still browse the menu or ask restaurant staff.",
                mode: "deterministic",
                sources: [],
                safetyNote: SAFETY_NOTE,
              })
            );
          } catch {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "Proxy failure." }));
          }
        });
      });
    },
  };
}

/** Server-side TTS proxy: keeps the ElevenLabs key secret. */
function ttsProxy(env: Record<string, string>): Plugin {
  return {
    name: "dev-tts-proxy",
    configureServer(server) {
      server.middlewares.use("/api/tts", (req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", async () => {
          try {
            const body = JSON.parse(raw || "{}");
            const text = typeof body.text === "string" ? body.text.trim() : "";
            if (!text) {
              res.writeHead(400, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "No text provided." }));
              return;
            }
            if (!env.ELEVENLABS_API_KEY) {
              res.writeHead(503, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "TTS not configured." }));
              return;
            }
            const voiceId = env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
            const modelId = env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            let providerRes: Response;
            try {
              providerRes = await fetch(
                `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "xi-api-key": env.ELEVENLABS_API_KEY,
                  },
                  signal: controller.signal,
                  body: JSON.stringify({
                    text,
                    model_id: modelId,
                    voice_settings: {
                      stability: 0.5,
                      similarity_boost: 0.75,
                    },
                  }),
                }
              );
            } finally {
              clearTimeout(timeout);
            }
            if (providerRes.ok) {
              const audio = Buffer.from(await providerRes.arrayBuffer());
              res.writeHead(200, {
                "content-type": "audio/mpeg",
                "content-length": audio.length,
              });
              res.end(audio);
            } else {
              const errText = await providerRes.text().catch(() => "Unknown error");
              console.error("ElevenLabs error:", providerRes.status, errText);
              // 402 = free plan can't use premade voices; fall back gracefully
              res.writeHead(502, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "TTS provider error.", status: providerRes.status }));
            }
          } catch (e) {
            console.error("TTS proxy failure:", e);
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "TTS proxy failure." }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), chatProxy(env), ttsProxy(env)],
  };
});