/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';
/** Fuzzy match using Dice's coefficient – preserved from src/lib/Correct.js. */
function compareTwoStrings(a, b) {
  a = (a || '').replace(/\s+/g, '');
  b = (b || '').replace(/\s+/g, '');
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.substring(i, i + 2);
    bigrams.set(g, (bigrams.get(g) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.substring(i, i + 2);
    const n = bigrams.get(g) || 0;
    if (n > 0) {
      bigrams.set(g, n - 1);
      hits++;
    }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

function correct(input, candidates) {
  candidates = Array.isArray(candidates) ? candidates : [];
  let best = { result: candidates[0] || '', rating: 0 };
  for (const c of candidates) {
    const r = compareTwoStrings(input, c);
    if (r > best.rating) best = { result: c, rating: r };
  }
  return best;
}

module.exports = { correct, compareTwoStrings };
