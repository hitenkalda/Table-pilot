/**
 * Vercel Serverless Function: POST /api/tts
 *
 * Proxies text-to-speech to ElevenLabs, keeping the API key server-side.
 */

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return new Response(JSON.stringify({ error: "No text provided." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "TTS not configured." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }

    const voiceId = process.env.ELEVENLABS_VOICE_ID || "VHg5nt4lZ9eZImP1eIEw";
    const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let providerRes: Response;
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
      const audio = Buffer.from(await providerRes.arrayBuffer());
      return new Response(audio, {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "content-length": String(audio.length),
        },
      });
    }

    return new Response(JSON.stringify({ error: "TTS provider error." }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "TTS proxy failure." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
