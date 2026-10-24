export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const game = url.searchParams.get("game");

  if (!["cine", "animal"].includes(game)) {
    return Response.json({ error: "Invalid game" }, { status: 400 });
  }

  // Cache partagé entre visiteurs : une seule lecture D1 par minute
  // et par jeu dans chaque emplacement de cache Cloudflare.
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/leaderboard?game=${game}`, {
    method: "GET"
  });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const { results } = await context.env.DB.prepare(`
    SELECT player_name, score, created_at
    FROM scores
    WHERE game = ?
    ORDER BY score DESC, created_at ASC
    LIMIT 1000
  `).bind(game).all();

  const response = Response.json({ scores: results }, {
    headers: { "Cache-Control": "public, max-age=60" }
  });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
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

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const game = String(body.game || "").trim();
    const playerName = String(body.player_name || "").trim();
    const score = Number(body.score);
    const secret = String(body.secret || "").trim();
    const sessionId = body.session_id;

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

    // Animal Reveal conserve exactement son ancien fonctionnement.
    // Ciné Reveal n'accepte que le score calculé par une session D1 terminée.
    let cineSession = null;
    if (game === "cine") {
      if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
        return Response.json({ error: "Invalid session" }, { status: 403 });
      }
      cineSession = await context.env.DB.prepare(`
        SELECT score, round_index, completed_at, expires_at, used
        FROM cine_sessions WHERE id = ?
      `).bind(sessionId).first();
      if (!cineSession || cineSession.used !== 0 || cineSession.round_index !== 10 ||
          cineSession.completed_at == null || cineSession.expires_at < Date.now() ||
          !Number.isInteger(cineSession.score) || cineSession.score < 0 || cineSession.score > 3660) {
        return Response.json({ error: "Session incomplete or unavailable" }, { status: 403 });
      }
      if (score !== cineSession.score) {
        return Response.json({ error: "Score does not match session" }, { status: 403 });
      }
    }

    const secretHash = await hashSecret(secret);

    const existingPlayer = await context.env.DB.prepare(`
      SELECT id, player_name, score, player_key, secret_hash
      FROM scores
      WHERE game = ? AND player_name = ? COLLATE NOCASE
      LIMIT 1
    `).bind(game, playerName).first();

    // On ne consomme une session qu'après vérification du pseudo et du code.
    if (game === "cine" && existingPlayer &&
        (!existingPlayer.secret_hash || existingPlayer.secret_hash !== secretHash)) {
      return Response.json({ error: existingPlayer.secret_hash
        ? "Player name already taken" : "Reserved legacy player" }, { status: 409 });
    }

    // Réservation atomique : une même session ne peut servir qu'une seule fois.
    if (game === "cine") {
      const claim = await context.env.DB.prepare(`
        UPDATE cine_sessions SET used = 1
        WHERE id = ? AND used = 0 AND round_index = 10
          AND completed_at IS NOT NULL AND expires_at >= ? AND score = ?
      `).bind(sessionId, Date.now(), score).run();
      if (claim.meta?.changes !== 1) {
        return Response.json({ error: "Session already submitted or expired" }, { status: 403 });
      }
    }

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
