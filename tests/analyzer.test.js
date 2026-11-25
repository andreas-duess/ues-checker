import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeUES,
  buildRevisionChecklist,
  computeWordDiff,
  extractMetrics,
  findStaleDates,
  splitSentences,
} from '../src/engine/analyzer.js';
import { SAMPLE_UES } from '../src/data/sample-ues.js';

test('splitSentences preserves U.S. abbreviations and decimals', () => {
  const input =
    'In FY2025, U.S. specialty grain exports reached $18.4 million across 42 buyers. Dr. Smith presented e.g. milling results in Ho Chi Minh City.';
  const sents = splitSentences(input);
  assert.equal(sents.length, 2);
  assert.match(sents[0], /U\.S\. specialty grain exports reached \$18\.4 million/);
  assert.match(sents[1], /^Dr\. Smith/);
});

test('detects verbatim copy-forward and template number-swaps distinctly', () => {
  const prior = `
    Southeast Asia remains one of the fastest-growing destinations for U.S. specialty grains and milled bakery ingredients.
    Trade servicing activities included 3 technical baking seminars in Ho Chi Minh City and Manila, drawing 165 commercial bakers.
  `;
  const draft = `
    Southeast Asia remains one of the fastest-growing destinations for U.S. specialty grains and milled bakery ingredients.
    Trade servicing activities included 4 technical baking seminars in Ho Chi Minh City and Manila, drawing 210 commercial bakers.
    In October 2026, VietCrust signed a new $680,000 commercial contract with a Kansas mill verified via shipping manifests.
  `;

  const result = analyzeUES(prior, draft, { targetCycle: 2027 });
  const sents = result.paragraphs.flatMap((p) => p.sentences);

  assert.equal(sents[0].status, 'verbatim');
  assert.equal(sents[1].status, 'light_edit');
  assert.equal(sents[1].templateSwap, true);
  assert.equal(sents[2].status, 'fresh');
});

test('findStaleDates catches leftover FYs and future-stale years while allowing historical ranges', () => {
  const bad = findStaleDates('During FY2026, we will host a pavilion in upcoming 2025.', 2027);
  assert.ok(bad.some((f) => /FY2026/i.test(f.token)));
  assert.ok(bad.some((f) => f.token === '2025' && f.severity === 'high'));

  const historical = findStaleDates('Exports grew steadily from 2021 to 2025 across Southeast Asia.', 2027);
  assert.equal(historical.length, 0);
});

test('extractMetrics catches unchanged currencies, percentages, and buyer counts', () => {
  const metrics = extractMetrics('Exports hit $18.4 million (14.5%) across 42 buyers and 3,400 MT.');
  const canonicals = metrics.map((m) => m.canonical);
  assert.ok(canonicals.includes('$18.4 million'));
  assert.ok(canonicals.includes('14.5%'));
  assert.ok(canonicals.includes('42 buyers'));
  assert.ok(canonicals.includes('3,400 mt'));
});

test('sample UES exercises every detector cleanly', () => {
  const result = analyzeUES(SAMPLE_UES.priorText, SAMPLE_UES.draftText, {
    targetCycle: SAMPLE_UES.targetCycle,
  });

  assert.ok(result.scores.verbatimCount >= 5, `expected >=5 verbatim, got ${result.scores.verbatimCount}`);
  assert.ok(result.scores.lightEditCount >= 2, `expected >=2 light edits, got ${result.scores.lightEditCount}`);
  assert.ok(result.scores.freshCount >= 3, `expected >=3 fresh, got ${result.scores.freshCount}`);
  assert.ok(result.flags.staleDates.length >= 2, 'should catch FY2026 and upcoming 2025');
  assert.ok(
    result.flags.unchangedMetrics.some((m) => m.canonical === '$18.4 million'),
    'should catch unchanged $18.4 million'
  );
  assert.ok(
    result.flags.unchangedMetrics.some((m) => m.canonical === '14.5%'),
    'should catch unchanged 14.5%'
  );
  assert.equal(result.flags.unquantifiedParagraphs.length, 1, 'should flag the long unquantified narrative paragraph');

  const md = buildRevisionChecklist(result, {
    priorName: SAMPLE_UES.priorLabel,
    draftName: SAMPLE_UES.draftLabel,
  });
  assert.match(md, /# UES Copy-Forward Review — FY2027/);
  assert.match(md, /\$18\.4 million/);
});

test('computeWordDiff highlights exact added and removed words', () => {
  const diff = computeWordDiff(
    'Hosted 3 seminars drawing 165 bakers.',
    'Hosted 4 seminars drawing 210 bakers.'
  );
  assert.ok(diff.priorTokens.some((t) => t.text === '3' && t.type === 'removed'));
  assert.ok(diff.draftTokens.some((t) => t.text === '4' && t.type === 'added'));
  assert.ok(diff.draftTokens.some((t) => t.text === '210' && t.type === 'added'));
});
