
function toHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function signSession(secret, payload) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  return toHex(new Uint8Array(signature));
}

export async function onRequestPost(context) {
  const secret = context.env.GAME_SIGNING_SECRET;

  if (!secret) {
    return Response.json(
      { error: "Server configuration missing" },
      { status: 500 }
    );
  }

  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();

  const payload = `${sessionId}.${startedAt}`;
  const signature = await signSession(secret, payload);

  return Response.json(
    {
      session_id: sessionId,
      started_at: startedAt,
      signature,
      status: "prepared"
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}
