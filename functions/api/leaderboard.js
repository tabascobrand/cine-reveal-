export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const game = url.searchParams.get("game");

  if (!["cine", "animal"].includes(game)) {
    return Response.json({ error: "Invalid game" }, { status: 400 });
  }

  const { results } = await context.env.DB.prepare(`
    SELECT player_name, score, created_at
    FROM scores
    WHERE game = ?
    ORDER BY score DESC, created_at ASC
    LIMIT 100
  `).bind(game).all();

  return Response.json({ scores: results });
}

async function hashSecret(secret) {
  const data = new TextEncoder().encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createPlayerKey() {
  return crypto.randomUUID();
}

async function verifyTurnstile(context, token) {
  const secretKey = context.env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    return {
      success: false,
      error: "Turnstile secret missing"
    };
  }

  if (!token) {
    return {
      success: false,
      error: "Turnstile token missing"
    };
  }

  const formData = new FormData();
  formData.append("secret", secretKey);
  formData.append("response", token);

  const remoteIp = context.request.headers.get("CF-Connecting-IP");

  if (remoteIp) {
    formData.append("remoteip", remoteIp);
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData
      }
    );

    if (!response.ok) {
      return {
        success: false,
        error: "Turnstile verification unavailable"
      };
    }

    return await response.json();

  } catch (error) {
    return {
      success: false,
      error: "Turnstile verification failed"
    };
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const game = String(body.game || "").trim();
    const playerName = String(body.player_name || "").trim();
    const score = Number(body.score);
    const secret = String(body.secret || "").trim();
    const turnstileToken = String(body.turnstile_token || "").trim();

    if (!["cine", "animal"].includes(game)) {
      return Response.json({ error: "Invalid game" }, { status: 400 });
    }

    if (
      playerName.length < 1 ||
      playerName.length > 19 ||
      !/^[a-zA-Z0-9À-ÿ _.-]+$/.test(playerName)
    ) {
      return Response.json({ error: "Invalid player name" }, { status: 400 });
    }

    if (!Number.isInteger(score) || score < 0 || score > 100000) {
      return Response.json({ error: "Invalid score" }, { status: 400 });
    }

    if (
      secret.length < 4 ||
      secret.length > 30
    ) {
      return Response.json({ error: "Invalid secret" }, { status: 400 });
    }

    // Vérification anti-bot Cloudflare Turnstile.
    const turnstileResult = await verifyTurnstile(
      context,
      turnstileToken
    );

    if (!turnstileResult.success) {
      return Response.json(
        { error: "Turnstile verification failed" },
        { status: 403 }
      );
    }

    const secretHash = await hashSecret(secret);

    const existingPlayer = await context.env.DB.prepare(`
      SELECT id, player_name, score, player_key, secret_hash
      FROM scores
      WHERE game = ? AND player_name = ? COLLATE NOCASE
      LIMIT 1
    `).bind(game, playerName).first();

    // Le pseudo existe déjà.
    if (existingPlayer) {
      // Ancienne entrée créée avant le système de codes.
      if (!existingPlayer.secret_hash) {
        return Response.json(
          { error: "Reserved legacy player" },
          { status: 409 }
        );
      }

      // Mauvais code : impossible de prendre le pseudo.
      if (existingPlayer.secret_hash !== secretHash) {
        return Response.json(
          { error: "Player name already taken" },
          { status: 409 }
        );
      }

      // Bon code : c'est bien le propriétaire du pseudo.
      // On ne remplace le score que s'il a battu son record.
      const bestScore = Math.max(existingPlayer.score, score);

      await context.env.DB.prepare(`
        UPDATE scores
        SET score = ?
        WHERE id = ?
      `).bind(bestScore, existingPlayer.id).run();

      return Response.json({
        success: true,
        status: "updated",
        player_key: existingPlayer.player_key,
        score: bestScore
      });
    }

    // Nouveau pseudo : création du joueur.
    const playerKey = createPlayerKey();

    await context.env.DB.prepare(`
      INSERT INTO scores (
        game,
        player_name,
        score,
        player_key,
        secret_hash
      )
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      game,
      playerName,
      score,
      playerKey,
      secretHash
    ).run();

    return Response.json({
      success: true,
      status: "created",
      player_key: playerKey,
      score
    });

  } catch (error) {
    return Response.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
