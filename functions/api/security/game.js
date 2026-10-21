
const encoder = new TextEncoder();

async function getSigningKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toHex(bytes) {
  return Array.from(bytes, b =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function fromHex(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function onRequestPost(context) {
  try {
    const secret = context.env.GAME_SIGNING_SECRET;

    if (!secret) {
      return json({ error: "Server configuration missing" }, 500);
    }

    const key = await getSigningKey(secret);
    const body = await context.request.json().catch(() => ({}));

    // Vérification d'un justificatif existant.
    if (body.action === "verify") {
      const sessionId = body.session_id;
      const startedAt = body.started_at;
      const signature = body.signature;

      if (
        typeof sessionId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(sessionId) ||
        !Number.isSafeInteger(startedAt) ||
        typeof signature !== "string"
      ) {
        return json({ valid: false }, 400);
      }

      const signatureBytes = fromHex(signature);
      if (!signatureBytes) {
        return json({ valid: false }, 400);
      }

      const payload = `${sessionId}.${startedAt}`;

      const valid = await crypto.subtle.verify(
        "HMAC",
        key,
        signatureBytes,
        encoder.encode(payload)
      );

      // Refuse les justificatifs datant de plus de 30 minutes
      // et ceux dont l'heure de départ est dans le futur.
      const age = Date.now() - startedAt;
      const withinTimeLimit = age >= 0 && age <= 30 * 60 * 1000;

      return json({ valid: valid && withinTimeLimit });
    }

    // Création d'un nouveau justificatif.
    if (body.action && body.action !== "start") {
      return json({ error: "Invalid action" }, 400);
    }

    const sessionId = crypto.randomUUID();
    const startedAt = Date.now();
    const payload = `${sessionId}.${startedAt}`;

    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );

    return json({
      session_id: sessionId,
      started_at: startedAt,
      signature: toHex(new Uint8Array(signature)),
      status: "prepared"
    });

  } catch (error) {
    return json({ error: "Invalid request" }, 400);
  }
}
