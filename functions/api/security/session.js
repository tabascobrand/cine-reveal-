
function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    if (body.action !== "start") {
      return json({ error: "Invalid action" }, 400);
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 30 * 60 * 1000;

    await context.env.DB.prepare(`
      INSERT INTO cine_sessions (
        id,
        created_at,
        expires_at,
        round_index,
        score,
        streak,
        used
      )
      VALUES (?, ?, ?, 0, 0, 0, 0)
    `).bind(id, now, expiresAt).run();

    return json({
      session_id: id,
      status: "started"
    });

  } catch (error) {
    return json({ error: "Invalid request" }, 400);
  }
}
