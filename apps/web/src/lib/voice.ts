/**
 * Voice layer: ElevenLabs TTS (server-side proxy) with browser TTS fallback.
 * The ElevenLabs API key never reaches the browser — it stays in the
 * server environment and is called through /api/tts.
 */

/* ---------------------- Spoken-text cleaner ---------------------- */

/**
 * Strips markdown, bullets, metadata, and UI formatting so TTS sounds
 * like a real person talking, not a screen reader.
 */
export function cleanSpokenText(text: string): string {
  let t = text;
  // Remove markdown bold/italic
  t = t.replace(/\*\*(.+?)\*\*/g, "$1");
  t = t.replace(/\*(.+?)\*/g, "$1");
  t = t.replace(/__(.+?)__/g, "$1");
  t = t.replace(/_(.+?)_/g, "$1");
  // Remove markdown links [text](url) → text
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Remove bullet points and list markers
  t = t.replace(/^[\s]*[-*•]\s+/gm, "");
  t = t.replace(/^[\s]*\d+\.\s+/gm, "");
  // Remove heading markers
  t = t.replace(/^#{1,6}\s+/gm, "");
  // Remove horizontal rules
  t = t.replace(/^[-*_]{3,}\s*$/gm, "");
  // Remove table pipes and formatting
  t = t.replace(/\|[^|\n]*\|/g, "");
  t = t.replace(/^[\s]*[-:]+[-| :]*$/gm, "");
  // Remove metadata lines like "Menu information · from menu"
  t = t.replace(/\b(Menu information|AI answer|from menu|restaurant-approved)[^.]*\./gi, "");
  // Remove safety note suffixes that get appended to every response
  t = t.replace(/Allergy note:.*$/gi, "");
  // Collapse multiple newlines/spaces
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.replace(/[ \t]{2,}/g, " ");
  // Trim
  t = t.trim();
  // If nothing meaningful is left, return original
  if (t.length < 10) return text.trim();
  return t;
}

/* -------------------- ElevenLabs TTS (proxy) -------------------- */

let audioElement: HTMLAudioElement | null = null;

async function speakWithElevenLabs(text: string): Promise<boolean> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: cleanSpokenText(text) }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (blob.size === 0) return false;
    const url = URL.createObjectURL(blob);
    // Clean up previous
    if (audioElement) {
      audioElement.pause();
      URL.revokeObjectURL(audioElement.src);
    }
    audioElement = new Audio(url);
    await audioElement.play();
    return true;
  } catch {
    return false;
  }
}

/* -------------------- Browser TTS fallback -------------------- */

export function speechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function speakBrowser(text: string, onEnd?: () => void): boolean {
  if (!speechSynthesisSupported()) {
    onEnd?.();
    return false;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanSpokenText(text));
  utterance.rate = 1;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
  return true;
}

/* -------------------- Public API -------------------- */

/**
 * Speak text using ElevenLabs (via server proxy). Falls back to browser
 * TTS if ElevenLabs is unavailable or fails.
 */
export async function speak(text: string, onEnd?: () => void): Promise<boolean> {
  const usedEleven = await speakWithElevenLabs(text);
  if (usedEleven) {
    // Wait for audio to finish, then call onEnd
    if (audioElement && onEnd) {
      audioElement.onended = () => onEnd();
      audioElement.onerror = () => onEnd();
    }
    return true;
  }
  return speakBrowser(text, onEnd);
}

export function stopSpeaking(): void {
  // Stop ElevenLabs audio
  if (audioElement) {
    audioElement.pause();
    audioElement.currentTime = 0;
  }
  // Stop browser TTS
  if (speechSynthesisSupported()) window.speechSynthesis.cancel();
}

/* -------------------- Speech-to-text -------------------- */

type RecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function speechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/**
 * Starts dictation. Returns a stop function, or null when unsupported.
 * onFinal receives each finalized phrase.
 */
export function startDictation(
  lang: string,
  onFinal: (text: string) => void,
  onEnd?: () => void
): (() => void) | null {
  if (!speechRecognitionSupported()) return null;
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as RecognitionCtor;
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    if (last && last[0]) onFinal(last[0].transcript);
  };
  recognition.onend = () => onEnd?.();
  recognition.onerror = () => onEnd?.();
  recognition.start();
  return () => recognition.stop();
}