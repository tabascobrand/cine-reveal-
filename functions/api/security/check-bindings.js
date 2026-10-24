// Diagnostic sans accès aux données, à retirer après validation.
export function onRequestGet({ env }) {
  return Response.json({
    r2: Boolean(env.AFFICHES && typeof env.AFFICHES.get === 'function'),
    images: Boolean(env.IMAGES && typeof env.IMAGES.input === 'function'),
    database: Boolean(env.DB && typeof env.DB.prepare === 'function')
  }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
