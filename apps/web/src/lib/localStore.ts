/**
 * Tiny observable localStorage-backed store used by the prototype layer.
 * In the deployed product these stores are replaced by Supabase queries and
 * realtime subscriptions; the UI code only consumes the subscribe/get API,
 * so the swap is local to the lib/ modules.
 *
 * Emits across tabs via the `storage` event, so a guest tab placing an order
 * updates an open dashboard tab without refresh.
 */

type Listener = () => void;

const memoryFallback = new Map<string, string>();

function safeStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // SSR / restricted context
  }
  return {
    getItem: (k: string) => memoryFallback.get(k) ?? null,
    setItem: (k: string, v: string) => void memoryFallback.set(k, v),
    removeItem: (k: string) => void memoryFallback.delete(k),
  };
}

export function createLocalStore<T>(key: string, initial: T) {
  const storage = safeStorage();
  const listeners = new Set<Listener>();

  function get(): T {
    try {
      const raw = storage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  }

  function set(value: T): void {
    storage.setItem(key, JSON.stringify(value));
    listeners.forEach((l) => l());
    try {
      window.dispatchEvent(new CustomEvent(`store:${key}`));
    } catch {
      // no window (tests)
    }
  }

  function update(fn: (current: T) => T): void {
    set(fn(get()));
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) listener();
    };
    const onCustom = (e: Event) => {
      if ((e as CustomEvent).type === `store:${key}`) listener();
    };
    try {
      window.addEventListener("storage", onStorage);
      window.addEventListener(`store:${key}`, onCustom as EventListener);
    } catch {
      // no window (tests)
    }
    return () => {
      listeners.delete(listener);
      try {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(`store:${key}`, onCustom as EventListener);
      } catch {
        // no window (tests)
      }
    };
  }

  return { key, get, set, update, subscribe };
}

export function formatPrice(currency: string, amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `${currency}${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
