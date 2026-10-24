
import { FILMS } from './films.js';

const SIZE = 10;
const TICK_MS = 120;
const REVEAL_STEP = 0.4;
const BONUSES = { 3: 220, 6: 440, 10: 2000 };
const TTL = 30 * 60 * 1000;

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

// Nombres écrits en français ou en anglais.
const NUMBER_WORDS = {
  zero: 0,
  un: 1, une: 1, one: 1,
  premier: 1, premiere: 1, first: 1,
  deux: 2, two: 2, second: 2, seconde: 2, deuxieme: 2,
  trois: 3, three: 3, troisieme: 3, third: 3,
  quatre: 4, four: 4, quatrieme: 4, fourth: 4,
  cinq: 5, five: 5, cinquieme: 5, fifth: 5,
  six: 6, sixieme: 6, sixth: 6,
  sept: 7, seven: 7, septieme: 7, seventh: 7,
  huit: 8, eight: 8, huitieme: 8, eighth: 8,
  neuf: 9, nine: 9, neuvieme: 9, ninth: 9,
  dix: 10, ten: 10, dixieme: 10, tenth: 10,
  onze: 11, eleven: 11,
  douze: 12, twelve: 12,
  treize: 13, thirteen: 13,
  quatorze: 14, fourteen: 14,
  quinze: 15, fifteen: 15,
  seize: 16, sixteen: 16,
  dixsept: 17, seventeen: 17,
  dixhuit: 18, eighteen: 18,
  dixneuf: 19, nineteen: 19,
  vingt: 20, twenty: 20
};

const ROMAN_NUMERALS = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5,
  vi: 6, vii: 7, viii: 8, ix: 9, x: 10
};

function normalize(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Convertit les nombres en une forme commune.
function canonicalNumbers(s) {
  const words = s.split(' ');

  return words.map((word, index) => {
    if (/^\d+(?:er|ere|e|eme|st|nd|rd|th)$/.test(word)) {
      return String(Number(word.match(/^\d+/)[0]));
    }

    if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, word)) {
      // Évite de convertir les articles initiaux un/une/one.
      if (
        index === 0 &&
        ['un', 'une', 'one'].includes(word)
      ) {
        return word;
      }

      return String(NUMBER_WORDS[word]);
    }

    // Chiffres romains, sauf en première position.
    if (
      index > 0 &&
      Object.prototype.hasOwnProperty.call(ROMAN_NUMERALS, word)
    ) {
      return String(ROMAN_NUMERALS[word]);
    }

    return word;
  }).join(' ');
}

// Génère les versions avec ou sans article initial.
function variants(s) {
  const raw = String(s)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const base = canonicalNumbers(normalize(raw));
  const result = new Set([base]);

  const withoutArticle = raw
    .replace(/^(?:the|les|des|le|la|un|une|a|an)\s+/i, '')
    .replace(/^l[’']\s*/i, '');

  if (withoutArticle !== raw) {
    result.add(canonicalNumbers(normalize(withoutArticle)));
  }

  return [...result].filter(Boolean);
}

// Tolérance aux fautes de frappe.
function levenshtein(a, b) {
  const dp = Array.from(
    { length: a.length + 1 },
    (_, i) => Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) {
    dp[i][0] = i;
  }

  for (let j = 0; j <= b.length; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(
            dp[i - 1][j],
            dp[i][j - 1],
            dp[i - 1][j - 1]
          );
    }
  }

  return dp[a.length][b.length];
}

const SAGA_FAMILIES = [
  'taxi',
  'bronzes',
  'seigneur',
  'visiteurs',
  'pirate'
];

function saga(s) {
  return SAGA_FAMILIES.find(f => s.startsWith(f)) || null;
}

function match(input, target) {
  const inputVariants = variants(input);
  const targetVariants = variants(target);

  for (const a of inputVariants) {
    for (const b of targetVariants) {
      if (a === b) return true;

      // Les numéros doivent être identiques après conversion.
      const numbers = s => s.match(/\b\d+\b/g) || [];

      if (numbers(a).join(',') !== numbers(b).join(',')) {
        continue;
      }

      const fam = saga(b);

      if (fam && saga(a) !== fam) {
        continue;
      }

      const tolerance = b.length <= 5
        ? 1
        : b.length <= 10
          ? 2
          : 3;

      if (levenshtein(a, b) <= tolerance) {
        return true;
      }
    }
  }

  return false;
}

function validAnswer(film, answer) {
  // Les réponses interdites restent prioritaires.
  if ((film.reject || []).some(r =>
    variants(answer).some(a => variants(r).includes(a))
  )) {
    return false;
  }

  return (film.accept || []).some(a => match(answer, a));
}

function publicFilm(film, index) {
  // Interface actuelle conservée.
  return {
    round: index + 1,
    clean: film.clean,
    full: film.full
  };
}

function shuffleIndices() {
  const ids = FILMS.map((_, i) => i);

  for (let i = ids.length - 1; i > 0; i--) {
    const bound =
      Math.floor(0x100000000 / (i + 1)) * (i + 1);

    let value;

    do {
      value = crypto.getRandomValues(
        new Uint32Array(1)
      )[0];
    } while (value >= bound);

    const j = value % (i + 1);

    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  return ids.slice(0, SIZE);
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      return json({ error: 'Invalid request' }, 400);
    }

    const db = context.env.DB;
    const now = Date.now();

    if (body.action === 'start') {
      if (FILMS.length < SIZE) {
        return json({
          error: 'Catalogue unavailable'
        }, 500);
      }

      const id = crypto.randomUUID();
      const ids = shuffleIndices();

      await db.prepare(`
        INSERT INTO cine_sessions
        (
          id,
          created_at,
          expires_at,
          round_index,
          score,
          streak,
          used,
          films_json,
          round_started_at
        )
        VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?)
      `)
        .bind(
          id,
          now,
          now + TTL,
          JSON.stringify(ids),
          0
        )
        .run();

      return json({
        session_id: id,
        film: publicFilm(FILMS[ids[0]], 0)
      });
    }

    if (
      !['ready', 'answer', 'skip', 'expire']
        .includes(body.action)
    ) {
      return json({
        error: 'Invalid action'
      }, 400);
    }

    const id = body.session_id;

    if (
      typeof id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(id)
    ) {
      return json({
        error: 'Invalid session'
      }, 400);
    }

    const row = await db
      .prepare('SELECT * FROM cine_sessions WHERE id = ?')
      .bind(id)
      .first();

    if (
      !row ||
      row.used ||
      row.expires_at < now
    ) {
      return json({
        error: 'Session unavailable'
      }, 403);
    }

    const ids = JSON.parse(row.films_json || '[]');

    if (
      !Array.isArray(ids) ||
      ids.length !== SIZE ||
      !Number.isInteger(row.round_index) ||
      row.round_index < 0 ||
      row.round_index >= SIZE
    ) {
      return json({
        error: 'Invalid session state'
      }, 409);
    }

    const filmIndex = ids[row.round_index];

    if (
      !Number.isInteger(filmIndex) ||
      !FILMS[filmIndex]
    ) {
      return json({
        error: 'Invalid film state'
      }, 409);
    }

    const film = FILMS[filmIndex];

    if (body.action === 'ready') {
      if (row.round_started_at > 0) {
        return json({
          started_at: row.round_started_at
        });
      }

      const result = await db.prepare(`
        UPDATE cine_sessions
        SET round_started_at = ?
        WHERE id = ?
          AND round_index = ?
          AND round_started_at = 0
          AND used = 0
          AND expires_at >= ?
      `)
        .bind(
          now,
          id,
          row.round_index,
          now
        )
        .run();

      if (result.meta?.changes !== 1) {
        return json({
          error: 'Already started'
        }, 409);
      }

      return json({
        started_at: now
      });
    }

    if (!row.round_started_at) {
      return json({
        error: 'Round not started'
      }, 409);
    }

    const elapsed = Math.max(
      0,
      now - row.round_started_at
    );

    const pct = Math.min(
      100,
      (elapsed / TICK_MS) * REVEAL_STEP
    );

    const expired = pct >= 100;

    const answer =
      typeof body.answer === 'string'
        ? body.answer.slice(0, 150)
        : '';

    const correct =
      body.action === 'answer' &&
      !expired &&
      validAnswer(film, answer);

    if (
      body.action === 'answer' &&
      !correct &&
      !expired
    ) {
      return json({
        correct: false,
        completed: false
      });
    }

    if (
      body.action === 'expire' &&
      !expired
    ) {
      return json({
        error: 'Round still active'
      }, 409);
    }

    const points = correct
      ? Math.max(
          0,
          Math.round(100 * (1 - pct / 100))
        )
      : 0;

    const streak = correct
      ? row.streak + 1
      : 0;

    const bonus = correct
      ? (BONUSES[streak] || 0)
      : 0;

    const score =
      row.score + points + bonus;

    const next = row.round_index + 1;
    const finished = next === SIZE;

    const result = await db.prepare(`
      UPDATE cine_sessions
      SET
        round_index = ?,
        score = ?,
        streak = ?,
        round_started_at = ?,
        completed_at = ?
      WHERE id = ?
        AND round_index = ?
        AND used = 0
        AND expires_at >= ?
    `)
      .bind(
        next,
        score,
        streak,
        0,
        finished ? now : null,
        id,
        row.round_index,
        now
      )
      .run();

    if (result.meta?.changes !== 1) {
      return json({
        error: 'Concurrent request; retry'
      }, 409);
    }

    return json({
      correct,
      points,
      bonus,
      score,
      completed: finished,
      revealed_title: film.title,
      next_film: finished
        ? null
        : publicFilm(FILMS[ids[next]], next)
    });

  } catch (error) {
    return json({
      error: 'Invalid request'
    }, 400);
  }
}
