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

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const game = String(body.game || "").trim();
    const playerName = String(body.player_name || "").trim();
    const score = Number(body.score);

    if (!["cine", "animal"].includes(game)) {
      return Response.json({ error: "Invalid game" }, { status: 400 });
    }

    if (
      playerName.length < 2 ||
      playerName.length > 20 ||
      !/^[a-zA-Z0-9À-ÿ _.-]+$/.test(playerName)
    ) {
      return Response.json({ error: "Invalid player name" }, { status: 400 });
    }

    if (!Number.isInteger(score) || score < 0 || score > 100000) {
      return Response.json({ error: "Invalid score" }, { status: 400 });
    }

    await context.env.DB.prepare(`
      INSERT INTO scores (game, player_name, score)
      VALUES (?, ?, ?)
    `).bind(game, playerName, score).run();

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
