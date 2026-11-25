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

test('splitSentences breaks after a sentence-ending U.S. but keeps U.S. names whole', () => {
  assert.deepEqual(
    splitSentences('We ship premium grain to buyers across the U.S. The market grew in 2026.'),
    ['We ship premium grain to buyers across the U.S.', 'The market grew in 2026.']
  );
  assert.equal(splitSentences('Demand rose after the U.S. Grains Council hosted buyers.').length, 1);
  assert.equal(splitSentences('Funding came from the U.S. Department of Agriculture in 2026.').length, 1);
  assert.equal(splitSentences('U.S. The figures are preliminary.').length, 1);
  assert.equal(splitSentences('Contracts were signed with Acme Foods Inc. In 2026, volumes doubled.').length, 2);
});

test('extractMetrics treats $18.4M, $18.4 million and US$18,400,000 as the same figure', () => {
  const canon = (s) => extractMetrics(s)[0]?.canonical;
  assert.equal(canon('$18.4M'), '$18.4 million');
  assert.equal(canon('US$18,400,000'), '$18.4 million');
  assert.equal(canon('$125k'), canon('$125,000'));
  assert.equal(canon('$2.1bn'), canon('$2.1 billion'));
  assert.equal(canon('22 pct'), '22%');
  assert.equal(canon('22 per cent'), '22%');

  const result = analyzeUES('Sales reached $18.4M in Vietnam last cycle.', 'Sales again reached $18.4 million across Vietnam.');
  assert.ok(result.flags.unchangedMetrics.some((m) => m.canonical === '$18.4 million'));
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

test('findStaleDates flags upcoming / planned for / scheduled for / launching in as high', () => {
  for (const s of [
    'The upcoming 2025 trade mission targets Vietnam.',
    'A buyer mission is planned for 2025 in Manila.',
    'The seminar series is scheduled for FY2025 in Seoul.',
    'The program is launching in 2024 across Mexico.',
  ]) {
    const flags = findStaleDates(s, 2027);
    assert.equal(flags.length, 1, s);
    assert.equal(flags[0].severity, 'high', s);
  }
});

test('findStaleDates flags each date token once', () => {
  const flags = findStaleDates('During FY2026, we will host a pavilion in upcoming 2025.', 2027);
  assert.deepEqual(flags.map((f) => f.token).sort(), ['2025', 'FY2026']);
});

test('findStaleDates does not treat project/target nouns or later clauses as future tense', () => {
  assert.equal(findStaleDates('In FY2026, the project achieved 42 new buyer contacts.', 2027).length, 0);
  assert.equal(findStaleDates('In FY2026, sales in our target market grew 12%.', 2027).length, 0);
  assert.equal(findStaleDates('In FY2026 we achieved 42 contacts, which will inform FY2027 planning.', 2027).length, 0);
  const stillFuture = findStaleDates('During FY2026, USHGC will expand its buyer missions.', 2027);
  assert.equal(stillFuture[0]?.severity, 'high');
  const verbTarget = findStaleDates('In FY2026, USHGC is targeting 50 new importers.', 2027);
  assert.equal(verbTarget[0]?.severity, 'high');
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
