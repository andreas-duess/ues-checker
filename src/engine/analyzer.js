/**
 * Zero-upload UES Copy-Forward Analysis Engine
 * Pure deterministic JS — runs identically in browser and Node tests.
 */

const ABBREVIATIONS = new Set([
  'u.s', 'u.s.a', 'u.k', 'e.u', 'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr',
  'inc', 'ltd', 'corp', 'co', 'vs', 'etc', 'e.g', 'i.e', 'fig', 'no', 'nos',
  'est', 'approx', 'dept', 'gov', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul',
  'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'st', 'ave', 'blvd', 'mt', 'vol',
  'p', 'pp', 'sec', 'fy', 'cy', 'my',
]);

// Abbreviations that can close a sentence ("...exports to the U.S. The...").
const SENTENCE_END_ABBREVIATIONS = new Set([
  'u.s', 'u.s.a', 'u.k', 'e.u', 'inc', 'ltd', 'corp', 'co', 'etc',
]);

// Capitalised words that start a new sentence rather than continue a name.
const SENTENCE_STARTERS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'In', 'On', 'At', 'For', 'From', 'During',
  'Our', 'We', 'It', 'Its', 'They', 'Their', 'There', 'A', 'An', 'As', 'By', 'With',
  'While', 'However', 'Additionally', 'Also', 'Since', 'Through', 'Over', 'Under',
  'After', 'Before', 'Despite', 'Although', 'Because', 'Today', 'Currently', 'Overall',
  'Furthermore', 'Moreover', 'Meanwhile', 'Each', 'All', 'Most', 'Many', 'Several',
  'Such', 'To', 'If', 'When', 'Following', 'Building',
]);

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'will', 'have', 'been',
  'were', 'are', 'was', 'their', 'they', 'them', 'into', 'over', 'also', 'more',
  'than', 'which', 'through', 'across', 'between', 'during', 'under', 'about',
  'would', 'could', 'should', 'other', 'such', 'these', 'those', 'while', 'where',
  'being', 'both', 'each', 'some', 'most', 'very', 'well', 'including', 'within',
]);

export function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function splitParagraphs(text) {
  const clean = normalizeWhitespace(text);
  if (!clean) return [];

  // Split on blank lines first; if the user pasted single-newline paragraphs,
  // respect explicit heading/bullet lines while keeping wrapped prose together.
  const rawBlocks = clean.split(/\n\s*\n+/);
  const paragraphs = [];

  for (const block of rawBlocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length <= 1) {
      if (lines[0]) paragraphs.push(lines[0]);
      continue;
    }

    // Check if lines look like distinct headings/paragraphs vs hard-wrapped text
    let current = '';
    for (const line of lines) {
      const looksLikeHeading = isLikelyHeading(line);
      const looksLikeBullet = /^([-*•]|\d+[.)]|[a-z][.)])\s+/.test(line);

      if (looksLikeHeading || looksLikeBullet) {
        if (current) {
          paragraphs.push(current.trim());
          current = '';
        }
        paragraphs.push(line);
      } else if (current && /[.!?:]$/.test(current) && /^[A-Z]/.test(line) && current.length > 140) {
        paragraphs.push(current.trim());
        current = line;
      } else {
        current = current ? `${current} ${line}` : line;
      }
    }
    if (current) paragraphs.push(current.trim());
  }

  return paragraphs.filter(Boolean);
}

export function isLikelyHeading(text) {
  const t = text.trim();
  if (!t) return false;
  const words = t.split(/\s+/);
  if (words.length > 16) return false;
  if (/[.!?]$/.test(t)) return false;
  if (/^#{1,6}\s+/.test(t)) return true;
  if (/^(section|part|appendix|market|program|activity|constraint|performance|executive|overview)\b/i.test(t) && words.length <= 12) {
    return true;
  }
  if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(t) && words.length <= 12) return true;
  // Short title-like line without terminal punctuation
  if (words.length <= 9 && !/[,;]$/.test(t)) {
    const alpha = t.replace(/[^A-Za-z]/g, '');
    if (alpha && alpha === alpha.toUpperCase()) return true;
    const capWords = words.filter((w) => /^[A-Z0-9(]/.test(w)).length;
    if (capWords / words.length >= 0.6) return true;
  }
  return false;
}

export function splitSentences(paragraph) {
  const clean = normalizeWhitespace(paragraph);
  if (!clean) return [];
  if (isLikelyHeading(clean)) return [clean];

  const sentences = [];
  let start = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // Skip decimals like 4.2 or $12.5M
    if (ch === '.' && i > 0 && /\d/.test(clean[i - 1]) && i + 1 < clean.length && /\d/.test(clean[i + 1])) {
      continue;
    }

    // Look ahead past optional closing quotes/parens
    let j = i + 1;
    while (j < clean.length && /["')\]”’]/.test(clean[j])) j++;

    // Must be end of string or followed by whitespace
    if (j < clean.length && !/\s/.test(clean[j])) continue;

    // Check abbreviation before period
    if (ch === '.') {
      const before = clean.slice(start, i).trim();
      const lastTokenMatch = before.match(/([A-Za-z.]+)$/);
      if (lastTokenMatch) {
        const token = lastTokenMatch[1].toLowerCase().replace(/^\.+/, '');
        if (ABBREVIATIONS.has(token) || /^([a-z]\.)+[a-z]?$/.test(token)) {
          // "U.S.", "Inc." etc. can also end a sentence. Break only when the next word is a
          // typical sentence opener, so "U.S. Grains Council" and "U.S. Department" stay whole.
          const nextWord = clean.slice(j).match(/^\s+([A-Za-z]+)/)?.[1];
          const canEnd = SENTENCE_END_ABBREVIATIONS.has(token) && before.split(/\s+/).length >= 3;
          if (!(canEnd && nextWord && SENTENCE_STARTERS.has(nextWord))) continue;
        }
      }
    }

    const candidate = clean.slice(start, j).trim();
    if (candidate) sentences.push(candidate);
    start = j;
    while (start < clean.length && /\s/.test(clean[start])) start++;
    i = start - 1;
  }

  const tail = clean.slice(start).trim();
  if (tail) sentences.push(tail);

  return sentences;
}

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9$%'-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Replaces numbers, currencies, percentages, and years with <NUM>
 * so we can catch "same sentence template, only figures/years swapped".
 */
export function skeletonize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\bfy\s*['’]?\d{2,4}\b/gi, ' <FY> ')
    .replace(/\b(?:19|20)\d{2}(?:\s*[-–/]\s*(?:(?:19|20)?\d{2}))?\b/g, ' <YEAR> ')
    .replace(/(?:us)?\$\s*\d[\d,.]*(?:\s*(?:billion|million|thousand|bn|mn|m|k|b))?\b/gi, ' <MONEY> ')
    .replace(/\b\d[\d,.]*\s*(?:%|percent|pct)\b/gi, ' <PCT> ')
    .replace(/\b\d[\d,.]*\b/g, ' <NUM> ')
    .replace(/[^a-z<>'\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function bigramMultiset(tokens) {
  const map = new Map();
  if (tokens.length === 1) {
    map.set(tokens[0], 1);
    return map;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const bg = `${tokens[i]} ${tokens[i + 1]}`;
    map.set(bg, (map.get(bg) || 0) + 1);
  }
  return map;
}

function diceSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  if (tokensA.length === 1 && tokensB.length === 1) {
    return tokensA[0] === tokensB[0] ? 1 : 0;
  }
  const a = bigramMultiset(tokensA);
  const b = bigramMultiset(tokensB);
  let totalA = 0;
  let totalB = 0;
  let overlap = 0;
  for (const v of a.values()) totalA += v;
  for (const v of b.values()) totalB += v;
  for (const [k, countA] of a.entries()) {
    const countB = b.get(k);
    if (countB) overlap += Math.min(countA, countB);
  }
  return (2 * overlap) / (totalA + totalB);
}

function tokenOverlapSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const mapA = new Map();
  const mapB = new Map();
  for (const t of tokensA) mapA.set(t, (mapA.get(t) || 0) + 1);
  for (const t of tokensB) mapB.set(t, (mapB.get(t) || 0) + 1);
  let overlap = 0;
  for (const [t, cA] of mapA.entries()) {
    const cB = mapB.get(t);
    if (cB) overlap += Math.min(cA, cB);
  }
  return (2 * overlap) / (tokensA.length + tokensB.length);
}

export function sentenceSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  // Blend order-sensitive bigrams (65%) with bag-of-words overlap (35%)
  const dice = diceSimilarity(tokensA, tokensB);
  const bow = tokenOverlapSimilarity(tokensA, tokensB);
  return 0.65 * dice + 0.35 * bow;
}

/**
 * Word-level LCS diff for inline side-by-side inspection when clicking a flagged sentence.
 */
export function computeWordDiff(priorText, draftText) {
  const a = normalizeWhitespace(priorText).split(/\s+/).filter(Boolean);
  const b = normalizeWhitespace(draftText).split(/\s+/).filter(Boolean);
  const n = a.length;
  const m = b.length;

  // Guard against extreme pathological single sentences
  if (n * m > 90000) {
    return {
      priorTokens: a.map((w) => ({ text: w, type: 'same' })),
      draftTokens: b.map((w) => ({ text: w, type: 'same' })),
    };
  }

  const normA = a.map((w) => w.toLowerCase().replace(/^[^\w$]+|[^\w%]+$/g, ''));
  const normB = b.map((w) => w.toLowerCase().replace(/^[^\w$]+|[^\w%]+$/g, ''));

  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (normA[i] && normA[i] === normB[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const priorTokens = [];
  const draftTokens = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (normA[i] && normA[i] === normB[j]) {
      priorTokens.push({ text: a[i], type: 'same' });
      draftTokens.push({ text: b[j], type: 'same' });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      priorTokens.push({ text: a[i], type: 'removed' });
      i++;
    } else {
      draftTokens.push({ text: b[j], type: 'added' });
      j++;
    }
  }
  while (i < n) priorTokens.push({ text: a[i++], type: 'removed' });
  while (j < m) draftTokens.push({ text: b[j++], type: 'added' });

  return { priorTokens, draftTokens };
}

/**
 * Extracts stale year & fiscal-year flags relative to targetCycle (e.g., 2027 for FY2027).
 */
export function findStaleDates(sentence, targetCycle = 2027) {
  const flags = [];
  // One key per date token across all three passes, so "2025" is flagged once
  // even when it matches both the forward-looking and standalone checks.
  const seen = new Set();
  const dateKey = (raw) => raw.toLowerCase().replace(/[\s'’]/g, '');

  // 1. Future-tense + past/prior year dead giveaways (always high severity)
  const futureStaleRe = /\b(?:(?:upcoming|planned\s+for|scheduled\s+for|launching\s+in)\s+|will\s+(?:host|launch|expand|conduct|hold|participate|attend|begin|run|target)\b[^.]{0,45}?\b)(FY\s*['’]?\d{2,4}|20\d{2})\b/gi;
  let match;
  while ((match = futureStaleRe.exec(sentence)) !== null) {
    const raw = match[1];
    const yr = parseYearToken(raw);
    if (yr && yr < targetCycle) {
      const key = dateKey(raw);
      if (!seen.has(key)) {
        seen.add(key);
        flags.push({
          token: raw,
          year: yr,
          severity: 'high',
          reason: `Forward-looking phrasing references ${raw} (before FY${targetCycle})`,
        });
      }
    }
  }

  // 2. Explicit FY mentions (e.g. FY25, FY2025, FY 2026)
  const fyRe = /\b(FY\s*['’]?(\d{2,4}))\b/gi;
  while ((match = fyRe.exec(sentence)) !== null) {
    const raw = match[1];
    const yr = parseYearToken(raw);
    if (!yr || yr >= targetCycle) continue;

    // Allow explicit retrospective framing for immediately preceding FY (e.g. "in FY2026, we achieved...")
    // unless the clause uses future-tense planning verbs ("During FY2026, USHGC will expand...").
    // The clause stops at a relative/coordinate break, so "In FY2026 we achieved X, which will
    // inform planning" stays retrospective. "project" and "target" only count as verbs.
    const idx = match.index;
    const contextBefore = sentence.slice(Math.max(0, idx - 45), idx).toLowerCase();
    const clauseBreak = sentence.slice(idx).search(/;|,\s*(?:which|and|but|while)\b|\b(?:which|that)\s+will\b/i);
    const clause = clauseBreak === -1 ? sentence : sentence.slice(0, idx + clauseBreak);
    const hasFutureTense = /\b(will|shall|plan(?:s|ning)?\s+to|intend(?:s)?\s+to|aim(?:s)?\s+to|targeting|projecting|expect(?:s)?\s+to|upcoming|scheduled\s+for)\b/i.test(clause);
    const isRetrospective = !hasFutureTense && /\b(in|during|from|since|prior|previous|last|achieved|completed|actual|compared\s+to|vs\.?|versus|baseline|between)\s*$/.test(contextBefore.trim());
    const isRange = /^\s*[-–/]\s*(?:fy\s*)?\d{2,4}/i.test(sentence.slice(idx + raw.length, idx + raw.length + 14));

    if (isRange) continue;
    if (yr === targetCycle - 1 && isRetrospective) continue;

    const key = dateKey(raw);
    if (!seen.has(key)) {
      seen.add(key);
      const isFuturePrior = yr === targetCycle - 1 && hasFutureTense;
      flags.push({
        token: raw,
        year: yr,
        severity: yr <= targetCycle - 2 || isFuturePrior ? 'high' : 'medium',
        reason: isFuturePrior
          ? `Future-tense phrasing still says ${raw} instead of FY${targetCycle}`
          : yr <= targetCycle - 2
            ? `Leftover ${raw} fiscal-year reference (two+ cycles behind FY${targetCycle})`
            : `Prior-cycle ${raw} reference — confirm this isn't a leftover FY${targetCycle} label`,
      });
    }
  }

  // 3. Standalone calendar years older than targetCycle - 1 (e.g. 2024 or 2025 for FY2027)
  const yearRe = /\b(20\d{2})\b/g;
  while ((match = yearRe.exec(sentence)) !== null) {
    const raw = match[1];
    const yr = Number(raw);
    if (yr < 2018 || yr >= targetCycle - 1) continue;

    const idx = match.index;
    const before = sentence.slice(Math.max(0, idx - 32), idx).toLowerCase();
    const after = sentence.slice(idx + raw.length, idx + raw.length + 18).toLowerCase();

    // Skip if already part of FY2025
    if (/fy\s*$/.test(before)) continue;
    // Skip explicit historical ranges or baselines ("2021-2025", "2020 to 2025", "since 2022", "between 2022 and 2025")
    if (/\b(since|from|between|baseline|established\s+in|founded\s+in|average\s+of)\s*$/.test(before.trim())) continue;
    if (/^\s*(?:[-–/]|to|through|and)\s*20\d{2}/.test(after)) continue;
    if (/(?:20\d{2}\s*(?:[-–/]|to|through|and)\s*)$/.test(before)) continue;

    const key = dateKey(raw);
    if (!seen.has(key)) {
      seen.add(key);
      flags.push({
        token: raw,
        year: yr,
        severity: yr <= targetCycle - 2 ? 'medium' : 'low',
        reason: `Standalone ${raw} reference — verify whether newer data is available for FY${targetCycle}`,
      });
    }
  }

  return flags;
}

function parseYearToken(raw) {
  const m = String(raw).match(/(\d{2,4})/);
  if (!m) return null;
  let n = Number(m[1]);
  if (n < 100) n += 2000;
  return n;
}

/**
 * Extracts meaningful metrics (currencies, percentages, quantified nouns)
 * so we can catch figures carried over unchanged from last year's draft.
 */
export function extractMetrics(text) {
  const metrics = [];
  const patterns = [
    // Currencies: $4.8 million, US$125,000, $18.2M
    {
      kind: 'currency',
      re: /(?:US)?\$\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:billion|million|thousand|bn|mn|m|k|b)\b)?/gi,
    },
    // Percentages: 14.5%, 22 percent, 22 per cent, 22 pct
    {
      kind: 'percent',
      re: /\b\d+(?:\.\d+)?(?:\s*%|\s+(?:percent|per\s+cent|pct)\b)/gi,
    },
    // Quantified nouns: 42 importers, 14,500 MT, 12 trade shows
    {
      kind: 'quantity',
      re: /\b\d[\d,]*(?:\.\d+)?\s+(?:metric\s+tons?|mt\b|tons?|tonnes?|buyers?|importers?|exporters?|distributors?|retailers?|chefs?|leads?|contacts?|companies|firms?|participants?|attendees?|members?|missions?|seminars?|workshops?|shows?|exhibitions?|countries|markets?|states?|head|doses?|cases?|bushels?|hectares?|acres?)\b/gi,
    },
  ];

  const seen = new Set();
  for (const { kind, re } of patterns) {
    let match;
    while ((match = re.exec(text)) !== null) {
      const raw = match[0].replace(/\s+/g, ' ').trim();
      const canonical = kind === 'currency'
        ? canonicalCurrency(raw)
        : raw
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/\s*\b(?:percent|per cent|pct)\b/, '%')
          .replace(/\s+%/, '%');

      // Skip trivial 1-digit quantities like "1 country" unless currency/percent
      if (kind === 'quantity') {
        const num = Number(canonical.match(/^[\d,.]+/)?.[0]?.replace(/,/g, '') || 0);
        if (num <= 2) continue;
      }

      if (!seen.has(canonical)) {
        seen.add(canonical);
        metrics.push({ raw, canonical, kind });
      }
    }
  }
  return metrics;
}

const CURRENCY_UNITS = {
  k: 1e3, thousand: 1e3,
  m: 1e6, mn: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
};

/**
 * One canonical form per dollar value, so $18.4M, $18.4 million and
 * US$18,400,000 all compare equal: "$18.4 million", "$125,000".
 */
function canonicalCurrency(raw) {
  const m = raw.toLowerCase().match(/\$\s*([\d,]+(?:\.\d+)?)\s*([a-z]+)?/);
  if (!m) return raw.toLowerCase();
  const value = Math.round(Number(m[1].replace(/,/g, '')) * (CURRENCY_UNITS[m[2]] || 1));
  if (value >= 1e9) return `$${Number((value / 1e9).toFixed(4))} billion`;
  if (value >= 1e6) return `$${Number((value / 1e6).toFixed(4))} million`;
  return `$${value.toLocaleString('en-US')}`;
}

function hasQuantifiedEvidence(text) {
  // Numbers (not just a lone year), currencies, percentages, or explicit count terms
  if (/(?:US)?\$\s*\d/i.test(text)) return true;
  if (/\b\d+(?:\.\d+)?\s*(?:%|percent)\b/i.test(text)) return true;
  // Non-year numbers (e.g. 42 buyers, 14,500 MT, 3.2x)
  const strippedYears = text.replace(/\b(?:FY\s*['’]?\d{2,4}|(?:19|20)\d{2})\b/gi, '');
  if (/\b\d[\d,.]*\b/.test(strippedYears)) return true;
  return false;
}

/**
 * Build an inverted index over prior sentences for fast candidate lookup.
 */
function buildPriorIndex(priorSentences) {
  const index = new Map();
  for (let idx = 0; idx < priorSentences.length; idx++) {
    const s = priorSentences[idx];
    const keys = new Set();

    // Content words
    for (const w of s.tokens) {
      if (w.length >= 4 && !STOP_WORDS.has(w)) keys.add(`w:${w}`);
    }
    // 3-word skeleton shingles (catches template matches even when numbers change)
    for (let i = 0; i <= s.skeleton.length - 3; i++) {
      keys.add(`s:${s.skeleton[i]} ${s.skeleton[i + 1]} ${s.skeleton[i + 2]}`);
    }

    for (const k of keys) {
      let bucket = index.get(k);
      if (!bucket) {
        bucket = [];
        index.set(k, bucket);
      }
      bucket.push(idx);
    }
  }
  return index;
}

function findBestPriorMatch(draftSent, priorSentences, priorIndex) {
  if (!priorSentences.length) return null;

  // Candidate scoring via inverted index
  const hits = new Map();
  const keys = new Set();
  for (const w of draftSent.tokens) {
    if (w.length >= 4 && !STOP_WORDS.has(w)) keys.add(`w:${w}`);
  }
  for (let i = 0; i <= draftSent.skeleton.length - 3; i++) {
    keys.add(`s:${draftSent.skeleton[i]} ${draftSent.skeleton[i + 1]} ${draftSent.skeleton[i + 2]}`);
  }

  for (const k of keys) {
    const bucket = priorIndex.get(k);
    if (!bucket || bucket.length > 80) continue; // skip ultra-common boilerplate keys
    for (const idx of bucket) {
      hits.set(idx, (hits.get(idx) || 0) + (k.startsWith('s:') ? 3 : 1));
    }
  }

  let candidateIndices;
  if (priorSentences.length <= 40) {
    candidateIndices = priorSentences.map((_, idx) => idx);
  } else {
    candidateIndices = [...hits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([idx]) => idx);
  }

  let best = null;
  for (const idx of candidateIndices) {
    const prior = priorSentences[idx];
    // Quick length ratio guard
    const lenRatio = Math.min(draftSent.tokens.length, prior.tokens.length) /
      Math.max(draftSent.tokens.length, prior.tokens.length, 1);
    if (lenRatio < 0.35) continue;

    const rawSim = sentenceSimilarity(draftSent.tokens, prior.tokens);
    const skeletonSim = sentenceSimilarity(draftSent.skeleton, prior.skeleton);
    const effective = Math.max(rawSim, skeletonSim * 0.96);

    if (!best || effective > best.effective) {
      best = {
        prior,
        rawSim,
        skeletonSim,
        effective,
      };
    }
  }

  return best;
}

/**
 * Main analysis entry point.
 * @param {string} priorText - Last year's UES text
 * @param {string} draftText - This year's UES draft text
 * @param {object} options
 * @param {number} [options.targetCycle=2027] - Target fiscal year (e.g., 2027)
 * @param {number} [options.verbatimThreshold=0.85]
 * @param {number} [options.lightEditThreshold=0.60]
 */
export function analyzeUES(priorText, draftText, options = {}) {
  const targetCycle = Number(options.targetCycle || 2027);
  const verbatimThreshold = options.verbatimThreshold ?? 0.85;
  const lightEditThreshold = options.lightEditThreshold ?? 0.60;

  const priorParagraphs = splitParagraphs(priorText);
  const draftParagraphs = splitParagraphs(draftText);

  // Prepare prior sentences + global metric inventory
  const priorSentences = [];
  const priorMetricsMap = new Map(); // canonical -> array of { raw, paragraphIndex, sentenceText }

  priorParagraphs.forEach((pText, pIdx) => {
    const heading = isLikelyHeading(pText);
    const sents = splitSentences(pText);
    sents.forEach((sText) => {
      const tokens = tokenize(sText);
      const skeleton = skeletonize(sText);
      const metrics = extractMetrics(sText);
      metrics.forEach((m) => {
        const list = priorMetricsMap.get(m.canonical) || [];
        list.push({ raw: m.raw, paragraphIndex: pIdx + 1, sentenceText: sText });
        priorMetricsMap.set(m.canonical, list);
      });
      if (!heading && tokens.length >= 4) {
        priorSentences.push({
          text: sText,
          tokens,
          skeleton,
          paragraphIndex: pIdx + 1,
        });
      }
    });
  });

  const priorIndex = buildPriorIndex(priorSentences);

  // Analyze draft paragraphs and sentences
  let sentenceCounter = 0;
  let totalSubstantiveWords = 0;
  let verbatimWords = 0;
  let lightEditWords = 0;
  let freshWords = 0;

  let verbatimCount = 0;
  let lightEditCount = 0;
  let freshCount = 0;

  const allStaleDates = [];
  const allUnchangedMetrics = [];
  const unquantifiedParagraphs = [];

  const paragraphs = draftParagraphs.map((pText, pIdx) => {
    const heading = isLikelyHeading(pText);
    const rawSents = splitSentences(pText);
    let pWords = 0;

    const sentences = rawSents.map((sText) => {
      const id = `s-${++sentenceCounter}`;
      const tokens = tokenize(sText);
      const skeleton = skeletonize(sText);
      const wordCount = tokens.length;
      pWords += wordCount;

      const staleDates = findStaleDates(sText, targetCycle);
      staleDates.forEach((f) => {
        allStaleDates.push({
          ...f,
          sentenceId: id,
          paragraphIndex: pIdx + 1,
          sentenceText: sText,
        });
      });

      // Metrics carried over identically from prior draft
      const metrics = extractMetrics(sText);
      const unchangedMetrics = [];
      for (const m of metrics) {
        const priorHits = priorMetricsMap.get(m.canonical);
        if (priorHits && priorHits.length > 0) {
          const item = {
            raw: m.raw,
            canonical: m.canonical,
            kind: m.kind,
            priorParagraph: priorHits[0].paragraphIndex,
            priorSentence: priorHits[0].sentenceText,
            sentenceId: id,
            paragraphIndex: pIdx + 1,
            sentenceText: sText,
          };
          unchangedMetrics.push(item);
          allUnchangedMetrics.push(item);
        }
      }

      if (heading || wordCount < 5) {
        return {
          id,
          text: sText,
          wordCount,
          isHeading: heading,
          isShort: wordCount < 5,
          status: 'neutral',
          rawSim: 0,
          skeletonSim: 0,
          templateSwap: false,
          match: null,
          staleDates,
          unchangedMetrics,
        };
      }

      totalSubstantiveWords += wordCount;
      const best = findBestPriorMatch({ text: sText, tokens, skeleton }, priorSentences, priorIndex);

      let status = 'fresh';
      let templateSwap = false;
      const rawSim = best ? best.rawSim : 0;
      const skeletonSim = best ? best.skeletonSim : 0;

      const isNumericTemplateSwap =
        skeletonSim >= 0.85 &&
        wordCount >= 6 &&
        rawSim < 0.94 &&
        skeletonSim - rawSim >= 0.03;

      if (rawSim >= verbatimThreshold && !isNumericTemplateSwap) {
        status = 'verbatim';
        verbatimWords += wordCount;
        verbatimCount++;
      } else if (rawSim >= lightEditThreshold || isNumericTemplateSwap) {
        status = 'light_edit';
        templateSwap = isNumericTemplateSwap || (skeletonSim >= 0.85 && rawSim < verbatimThreshold);
        lightEditWords += wordCount;
        lightEditCount++;
      } else {
        status = 'fresh';
        freshWords += wordCount;
        freshCount++;
      }

      return {
        id,
        text: sText,
        wordCount,
        isHeading: false,
        isShort: false,
        status,
        rawSim: Number(rawSim.toFixed(3)),
        skeletonSim: Number(skeletonSim.toFixed(3)),
        templateSwap,
        match: status !== 'fresh' && best
          ? {
              text: best.prior.text,
              paragraphIndex: best.prior.paragraphIndex,
              diff: computeWordDiff(best.prior.text, sText),
            }
          : null,
        staleDates,
        unchangedMetrics,
      };
    });

    const isUnquantified = !heading && pWords >= 75 && !hasQuantifiedEvidence(pText);
    if (isUnquantified) {
      unquantifiedParagraphs.push({
        paragraphIndex: pIdx + 1,
        wordCount: pWords,
        preview: pText.length > 180 ? `${pText.slice(0, 177)}...` : pText,
        firstSentenceId: sentences[0]?.id || null,
      });
    }

    const pVerbatim = sentences.filter((s) => s.status === 'verbatim').length;
    const pLight = sentences.filter((s) => s.status === 'light_edit').length;
    const pSubstantive = sentences.filter((s) => s.status !== 'neutral').length;

    return {
      index: pIdx + 1,
      isHeading: heading,
      wordCount: pWords,
      isUnquantified,
      flaggedCount: pVerbatim + pLight,
      substantiveCount: pSubstantive,
      sentences,
    };
  });

  const denom = Math.max(totalSubstantiveWords, 1);
  const verbatimPct = Math.round((verbatimWords / denom) * 100);
  const lightEditPct = Math.round((lightEditWords / denom) * 100);
  const copyForwardPct = Math.min(100, verbatimPct + lightEditPct);
  const freshPct = Math.max(0, 100 - copyForwardPct);

  // Deduplicate unchanged metrics by canonical + sentenceId
  const uniqueMetrics = [];
  const metricSeen = new Set();
  for (const m of allUnchangedMetrics) {
    const k = `${m.sentenceId}:${m.canonical}`;
    if (!metricSeen.has(k)) {
      metricSeen.add(k);
      uniqueMetrics.push(m);
    }
  }

  const verdict = getVerdict(copyForwardPct);

  return {
    meta: {
      targetCycle,
      priorWordCount: tokenize(priorText).length,
      draftWordCount: tokenize(draftText).length,
      priorParagraphCount: priorParagraphs.length,
      draftParagraphCount: draftParagraphs.length,
      substantiveSentenceCount: verbatimCount + lightEditCount + freshCount,
    },
    scores: {
      copyForwardPct,
      verbatimPct,
      lightEditPct,
      freshPct,
      verbatimCount,
      lightEditCount,
      freshCount,
      verdict,
    },
    flags: {
      staleDates: allStaleDates,
      unchangedMetrics: uniqueMetrics,
      unquantifiedParagraphs,
    },
    paragraphs,
  };
}

function getVerdict(copyForwardPct) {
  if (copyForwardPct < 20) {
    return {
      level: 'low',
      label: 'Fresh draft',
      summary: 'Low copy-forward risk. Most of this section reads as genuinely updated for the new cycle.',
    };
  }
  if (copyForwardPct < 40) {
    return {
      level: 'moderate',
      label: 'Moderate reuse',
      summary: 'A noticeable share of sentences carried over. Tighten the highlighted passages and check dates before filing.',
    };
  }
  if (copyForwardPct < 60) {
    return {
      level: 'high',
      label: 'High copy-forward risk',
      summary: 'Roughly half this draft matches last year verbatim or via light swaps. FAS reviewers are likely to notice.',
    };
  }
  return {
    level: 'critical',
    label: 'Heavy copy-forward',
    summary: 'Most of this draft mirrors last year’s submission. Rewrite the flagged narrative around current-cycle results.',
  };
}

/**
 * Generates a clean, ready-to-paste Markdown revision checklist for Slack, email, Word, or Obsidian.
 */
export function buildRevisionChecklist(result, labels = {}) {
  const { meta, scores, flags, paragraphs } = result;
  const lines = [];

  lines.push(`# UES Copy-Forward Review — FY${meta.targetCycle}`);
  if (labels.priorName || labels.draftName) {
    lines.push(`- **Prior file:** ${labels.priorName || 'Pasted text'}`);
    lines.push(`- **New draft:** ${labels.draftName || 'Pasted text'}`);
  }
  lines.push('');
  lines.push('## Summary');
  lines.push(`- **Copy-Forward Score:** ${scores.copyForwardPct}% (${scores.verdict.label})`);
  lines.push(`  - Verbatim recycled: ${scores.verbatimPct}% (${scores.verbatimCount} sentences)`);
  lines.push(`  - Light find-and-replace: ${scores.lightEditPct}% (${scores.lightEditCount} sentences)`);
  lines.push(`  - Fresh / rewritten: ${scores.freshPct}% (${scores.freshCount} sentences)`);
  lines.push(`- **Stale year / FY flags:** ${flags.staleDates.length}`);
  lines.push(`- **Unchanged numbers:** ${flags.unchangedMetrics.length}`);
  lines.push(`- **Unquantified long paragraphs:** ${flags.unquantifiedParagraphs.length}`);
  lines.push('');

  if (flags.staleDates.length) {
    lines.push('## 1. Stale Years & Fiscal-Cycle References');
    for (const f of flags.staleDates) {
      lines.push(`- [ ] **Paragraph ${f.paragraphIndex}** (\`${f.token}\`): ${f.reason}`);
    }
    lines.push('');
  }

  if (flags.unchangedMetrics.length) {
    lines.push('## 2. Figures Carried Over Identically');
    for (const m of flags.unchangedMetrics) {
      lines.push(`- [ ] **Paragraph ${m.paragraphIndex}** (\`${m.raw}\`): Appeared identically in prior draft (Paragraph ${m.priorParagraph}) — confirm updated figure.`);
    }
    lines.push('');
  }

  const flaggedSents = [];
  for (const p of paragraphs) {
    for (const s of p.sentences) {
      if (s.status === 'verbatim' || s.status === 'light_edit') {
        flaggedSents.push({ paragraphIndex: p.index, ...s });
      }
    }
  }

  if (flaggedSents.length) {
    lines.push('## 3. Copy-Forward & Light-Edit Sentences to Refresh');
    for (const s of flaggedSents) {
      const tag = s.status === 'verbatim'
        ? `Verbatim ${Math.round(s.rawSim * 100)}%`
        : s.templateSwap
          ? 'Template swap (structure unchanged)'
          : `Light edit ${Math.round(s.rawSim * 100)}%`;
      lines.push(`- [ ] **Paragraph ${s.paragraphIndex}** [${tag}]: "${s.text}"`);
    }
    lines.push('');
  }

  if (flags.unquantifiedParagraphs.length) {
    lines.push('## 4. Narrative Paragraphs Without Quantified Results');
    for (const u of flags.unquantifiedParagraphs) {
      lines.push(`- [ ] **Paragraph ${u.paragraphIndex}** (${u.wordCount} words): Add concrete metrics, buyer outcomes, or measurable results (FAS weights evaluation & results at 50/100 points).`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('Generated locally in browser via ues-checker.duess.com (zero data uploaded).');
  return lines.join('\n');
}
