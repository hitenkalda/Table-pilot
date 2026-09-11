import type { IncomingMessage, ServerResponse } from "http";

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    return json(res, { error: "Method not allowed" }, 405);
  }

  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return json(res, { error: "No text provided." }, 400);
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return json(res, { error: "TTS not configured." }, 503);
    }

    const voiceId = process.env.ELEVENLABS_VOICE_ID || "VHg5nt4lZ9eZImP1eIEw";
    const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let providerRes: globalThis.Response;
    try {
      providerRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (providerRes.ok) {
      const buffer = Buffer.from(await providerRes.arrayBuffer());
      res.writeHead(200, {
        "content-type": "audio/mpeg",
        "content-length": buffer.length,
      });
      res.end(buffer);
      return;
    }

    return json(res, { error: "TTS provider error." }, 502);
  } catch {
    return json(res, { error: "TTS proxy failure." }, 500);
  }
}
