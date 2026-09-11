import { useState } from "react";
import type { ChatMessage } from "../types";

const memoryFallback = new Map<string, string>();

function safeStorage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {}
  return {
    getItem: (k: string) => memoryFallback.get(k) ?? null,
    setItem: (k: string, v: string) => void memoryFallback.set(k, v),
  };
}

function chatKey(restaurantSlug: string, tableNumber: number | null, dishId?: string): string {
  const base = `tp-chat-${restaurantSlug}`;
  const table = tableNumber != null ? `-t${tableNumber}` : "-notable";
  const dish = dishId ? `-d${dishId}` : "-agent";
  return base + table + dish;
}

function loadMessages(restaurantSlug: string, tableNumber: number | null, dishId?: string): ChatMessage[] {
  const storage = safeStorage();
  try {
    const raw = storage.getItem(chatKey(restaurantSlug, tableNumber, dishId));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function persistMessages(
  restaurantSlug: string,
  tableNumber: number | null,
  messages: ChatMessage[],
  dishId?: string
): void {
  const storage = safeStorage();
  storage.setItem(chatKey(restaurantSlug, tableNumber, dishId), JSON.stringify(messages));
}

export function useChatMessages(
  restaurantSlug: string,
  tableNumber: number | null,
  dishId?: string
): [ChatMessage[], (msgs: ChatMessage[]) => void, () => void] {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadMessages(restaurantSlug, tableNumber, dishId)
  );

  const save = (msgs: ChatMessage[]) => {
    setMessages(msgs);
    persistMessages(restaurantSlug, tableNumber, msgs, dishId);
  };

  const clear = () => {
    setMessages([]);
    persistMessages(restaurantSlug, tableNumber, [], dishId);
  };

  return [messages, save, clear];
}
