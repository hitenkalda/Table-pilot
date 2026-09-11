import { useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "./supabase";

export type Session = { userId: string; email: string | null } | null;

let session: Session = null;
const listeners = new Set<() => void>();

function setSession(next: Session): void {
  session = next;
  listeners.forEach((l) => l());
}

async function snapshot(sb: NonNullable<ReturnType<typeof getSupabase>>): Promise<Session> {
  const { data } = await sb.auth.getUser();
  const u = data.user;
  return u ? { userId: u.id, email: u.email ?? null } : null;
}

/** Restores any saved session and keeps the local snapshot in sync. */
export async function initAuth(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  setSession(await snapshot(sb));
  sb.auth.onAuthStateChange(async () => setSession(await snapshot(sb)));
}

export async function signIn(email: string, password: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Auth is not configured.");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  setSession(await snapshot(sb));
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
  setSession(null);
}

export function getSession(): Session {
  return session;
}

export function useSession(): Session {
  const [s, setS] = useState<Session>(session);
  useEffect(() => {
    listeners.add(update);
    function update() {
      setS(session);
    }
    return () => {
      listeners.delete(update);
    };
  }, []);
  return s;
}

export function authEnabled(): boolean {
  return isSupabaseConfigured();
}