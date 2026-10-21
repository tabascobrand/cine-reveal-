
export async function onRequestPost(context) {
  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();

  return Response.json(
    {
      session_id: sessionId,
      started_at: startedAt,
      status: 'prepared'
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );
}
