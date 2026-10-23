import { FILMS } from './films.js';

const SIZE = 10;
const TICK_MS = 120;
const REVEAL_STEP = 0.4;
const BONUSES = { 3: 220, 6: 440, 10: 2000 };
const TTL = 30 * 60 * 1000;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
function normalize(s) {
  return String(s).toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '');
}
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  }
  return dp[a.length][b.length];
}
const SAGA_FAMILIES = ['taxi', 'bronzes', 'seigneur', 'visiteurs', 'pirate'];
function saga(s) { return SAGA_FAMILIES.find(f => s.startsWith(f)) || null; }
function match(input, target) {
  const a = normalize(input), b = normalize(target);
  if (a === b) return true;
  const fam = saga(b);
  if (fam) {
    const n = s => (s.match(/(\d+)\s*$/) || [])[1] || null;
    if (saga(a) !== fam || n(a) !== n(b)) return false;
  }
  return levenshtein(a, b) <= (b.length <= 5 ? 1 : b.length <= 10 ? 2 : 3);
}
function validAnswer(film, answer) {
  if ((film.reject || []).some(r => normalize(answer) === normalize(r))) return false;
  return film.accept.some(a => match(answer, a));
}
function publicFilm(film, index) {
  return { round: index + 1, clean: film.clean, full: film.full };
}
function shuffleIndices() {
  const ids = FILMS.map((_, i) => i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, SIZE);
}
export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const db = context.env.DB;
    const now = Date.now();
    if (body.action === 'start') {
      const id = crypto.randomUUID();
      const ids = shuffleIndices();
      await db.prepare(`INSERT INTO cine_sessions
        (id, created_at, expires_at, round_index, score, streak, used, films_json, round_started_at)
        VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?)`)
        .bind(id, now, now + TTL, JSON.stringify(ids), 0).run();
      return json({ session_id: id, film: publicFilm(FILMS[ids[0]], 0) });
    }
    if (!['ready', 'answer', 'skip', 'expire'].includes(body.action)) return json({ error: 'Invalid action' }, 400);
    const id = body.session_id;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Invalid session' }, 400);
    const row = await db.prepare('SELECT * FROM cine_sessions WHERE id = ?').bind(id).first();
    if (!row || row.used || row.expires_at < now) return json({ error: 'Session unavailable' }, 403);
    const ids = JSON.parse(row.films_json || '[]');
    if (ids.length !== SIZE || row.round_index >= SIZE) return json({ error: 'Invalid session state' }, 409);
    const film = FILMS[ids[row.round_index]];
    if (body.action === 'ready') {
      if (row.round_started_at > 0) return json({ started_at: row.round_started_at });
      const result = await db.prepare(`UPDATE cine_sessions SET round_started_at = ?
        WHERE id = ? AND round_index = ? AND round_started_at = 0 AND used = 0`)
        .bind(now, id, row.round_index).run();
      if (result.meta?.changes !== 1) return json({ error: 'Already started' }, 409);
      return json({ started_at: now });
    }
    if (!row.round_started_at) return json({ error: 'Round not started' }, 409);
    const elapsed = Math.max(0, now - row.round_started_at);
    const pct = Math.min(100, (elapsed / TICK_MS) * REVEAL_STEP);
    const expired = pct >= 100;
    const answer = String(body.answer || '').slice(0, 150);
    const correct = body.action === 'answer' && !expired && validAnswer(film, answer);
    if (body.action === 'answer' && !correct && !expired) {
      return json({ correct: false, completed: false });
    }
    if (body.action === 'expire' && !expired) return json({ error: 'Round still active' }, 409);
    const points = correct ? Math.max(0, Math.round(100 * (1 - pct / 100))) : 0;
    const streak = correct ? row.streak + 1 : 0;
    const bonus = correct ? (BONUSES[streak] || 0) : 0;
    const score = row.score + points + bonus;
    const next = row.round_index + 1;
    const finished = next === SIZE;
    // Atomic update prevents two simultaneous requests from advancing the same round twice.
    const result = await db.prepare(`UPDATE cine_sessions SET round_index = ?, score = ?, streak = ?,
      round_started_at = ?, completed_at = ?
      WHERE id = ? AND round_index = ? AND used = 0 AND expires_at >= ?`)
      .bind(next, score, streak, 0, finished ? now : null, id, row.round_index, now).run();
    if (result.meta?.changes !== 1) return json({ error: 'Concurrent request; retry' }, 409);
    return json({
      correct, points, bonus, score, completed: finished,
      revealed_title: film.title,
      next_film: finished ? null : publicFilm(FILMS[ids[next]], next)
    });
  } catch (error) {
    return json({ error: 'Invalid request' }, 400);
  }
}
