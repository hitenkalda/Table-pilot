import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ChatMessage, Dish, Restaurant } from "../types";
import { askQuestion, askAgent } from "../lib/chatClient";
import { speak, speechRecognitionSupported, speechSynthesisSupported, startDictation, stopSpeaking } from "../lib/voice";
import { MAX_QUESTION_CHARS } from "../lib/deterministicChat";
import { MAX_QUESTION_CHARS as MAX_AGENT_QUESTION_CHARS } from "../lib/agentChat";
import { useCart, addToCart, removeAllByDishId, setQuantityAll, setCustomerNote } from "../lib/cart";
import { useChatMessages } from "../lib/chatStore";

type Props = {
  restaurant: Restaurant;
  /** When set, the chat is scoped to this dish; otherwise it's the
   *  restaurant-wide AI waiter. */
  dish?: Dish | null;
  initialMessages?: ChatMessage[];
  compact?: boolean;
};

/** Voice-capable chat: dish-scoped AI or the restaurant-wide AI waiter.
 *  Persists messages to localStorage so they survive page navigation. */
export function ChatPanel({ restaurant, dish = null, compact = false }: Props) {
  const { table } = useParams();
  const tableNumber = table ? Number(table) : null;
  const navigate = useNavigate();
  const [messages, saveMessages, clearMessages] = useChatMessages(
    restaurant.slug,
    dish ? null : tableNumber,
    dish?.id
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(
    () => localStorage.getItem("dishexplain-voice") !== "off"
  );
  const logRef = useRef<HTMLDivElement>(null);
  const lastModeRef = useRef<"deterministic" | "ai">("deterministic");
  const lastSourcesRef = useRef<string[]>([]);
  const cart = useCart();

  const canSpeak = speechSynthesisSupported();
  const canDictate = speechRecognitionSupported();
  const maxChars = dish ? MAX_QUESTION_CHARS : MAX_AGENT_QUESTION_CHARS;

  useEffect(() => {
    localStorage.setItem("dishexplain-voice", voiceOn ? "on" : "off");
    if (!voiceOn) stopSpeaking();
  }, [voiceOn]);

  useEffect(() => () => stopSpeaking(), []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy]);

  async function submit(questionText?: string) {
    const text = (questionText ?? input).trim().slice(0, maxChars);
    if (!text || busy) return;
    setInput("");
    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    saveMessages([...history, { role: "assistant", content: "…" }]);
    setBusy(true);
    let answer = dish ? "Ask restaurant staff for details." : "Please ask the restaurant staff.";
    let mode: "deterministic" | "ai" = "deterministic";
    let sources: string[] = [];
    let actions: Array<{ type: string; dishId?: string; quantity?: number }> | undefined;
    try {
      const reply = dish
        ? await askQuestion(restaurant.slug, dish, history)
        : await askAgent(
            restaurant,
            history,
            cart.items.map((ci) => {
              const d = restaurant.dishes.find((dd) => dd.id === ci.dishId);
              return {
                dishId: ci.dishId,
                name: d?.name ?? ci.dishId,
                quantity: ci.quantity,
                price: d?.price ?? 0,
              };
            })
          );
      answer = reply.answer;
      mode = reply.mode;
      sources = reply.sources;
      actions = reply.actions;

      if (actions && actions.length > 0) {
        for (const a of actions) {
          if (a.type === "add_to_cart" && a.dishId) {
            addToCart(
              restaurant.slug,
              cart.tableNumber ?? tableNumber,
              a.dishId,
              a.quantity ?? 1
            );
          } else if (a.type === "remove_from_cart" && a.dishId) {
            removeAllByDishId(a.dishId);
          } else if (a.type === "update_cart_item" && a.dishId) {
            setQuantityAll(a.dishId, a.quantity ?? 0);
          } else if (a.type === "navigate_to_checkout") {
            const base = `/r/${restaurant.slug}${tableNumber ? `/t/${tableNumber}` : ""}`;
            saveMessages([...history, { role: "assistant", content: answer }]);
            setBusy(false);
            navigate(`${base}/checkout`);
            return;
          } else if (a.type === "set_instruction" && a.note) {
            setCustomerNote(a.note);
          }
        }
      }
    } catch {
      // keep fallback text
    }
    const finalMsgs: ChatMessage[] = [...history, { role: "assistant", content: answer }];
    saveMessages(finalMsgs);
    lastModeRef.current = mode;
    lastSourcesRef.current = sources;
    setBusy(false);
    if (voiceOn && canSpeak) {
      speak(answer);
    }
  }

  function dictate() {
    if (listening) return;
    setListening(true);
    const stop = startDictation(
      restaurant.default_language,
      (text) => {
        setListening(false);
        submit(text);
      },
      () => setListening(false)
    );
    if (!stop) setListening(false);
  }

  function handleStartOver() {
    clearMessages();
  }

  const scopeLabel = dish ? `about ${dish.name}` : "with the AI waiter";

  return (
    <div>
      {!compact && (
        <div className="sheet-actions voice-bar">
          {canSpeak && (
            <button onClick={() => setVoiceOn((v) => !v)} aria-pressed={voiceOn}>
              {voiceOn ? "🔊 Voice replies: on" : "🔇 Voice replies: off"}
            </button>
          )}
        </div>
      )}
      {voiceOn && canSpeak && canDictate && !compact && (
        <p className="voice-hint">
          Tap the mic and just ask out loud — I&apos;ll answer and read it aloud. Or type below.
        </p>
      )}
      <div className="chat-log" ref={logRef} aria-live="polite">
        {messages.length === 0 && !dish && (
          <div className="chat-msg assistant">
            Hi! I&apos;m this restaurant&apos;s AI waiter. Ask me about today&apos;s
            specials, any dish, spice levels, allergens, or what suits your diet.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.content}
            {m.role === "assistant" && i === messages.length - 1 && (
              <span className="meta">
                {lastModeRef.current === "ai" ? "AI answer" : "Menu information"}
                {lastSourcesRef.current.length > 0 && ` · from ${lastSourcesRef.current.join(", ")}`}
              </span>
            )}
          </div>
        ))}
        {busy && <div className="chat-msg assistant">…</div>}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="visually-hidden" htmlFor={`chat-input-${dish?.id ?? "agent"}`}>
          Your question {scopeLabel}
        </label>
        <input
          id={`chat-input-${dish?.id ?? "agent"}`}
          type="text"
          value={input}
          maxLength={maxChars}
          placeholder={
            listening
              ? "Listening…"
              : dish
                ? "e.g. Is it spicy?"
                : "e.g. What are today's specials?"
          }
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        {canDictate && (
          <button
            type="button"
            onClick={dictate}
            aria-pressed={listening}
            aria-label="Ask by voice"
            className={listening ? "mic-active" : ""}
          >
            🎤
          </button>
        )}
        <button className="primary" type="submit" disabled={busy || !input.trim()}>
          Ask
        </button>
      </form>
      <div className="sheet-actions" style={{ marginTop: 8 }}>
        <button type="button" onClick={handleStartOver}>Start over</button>
        {canSpeak && messages.length > 0 && (
          <button type="button" onClick={() => stopSpeaking()}>Stop voice</button>
        )}
      </div>
    </div>
  );
}

/** Backwards-compatible wrapper used by the dish sheet and dish page. */
export function DishChat({ restaurant, dish, initialMessages, compact }: {
  restaurant: Restaurant;
  dish: Dish;
  initialMessages?: ChatMessage[];
  compact?: boolean;
}) {
  return (
    <ChatPanel restaurant={restaurant} dish={dish} initialMessages={initialMessages} compact={compact} />
  );
}
