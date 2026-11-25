import './styles.css';
import { analyzeUES, buildRevisionChecklist, tokenize } from './engine/analyzer.js';
import { parseDocumentFile } from './engine/parsers.js';
import { SAMPLE_UES } from './data/sample-ues.js';

const SENSITIVITY_PRESETS = {
  standard: { label: 'Standard', verbatim: 0.85, light: 0.60 },
  strict: { label: 'Strict', verbatim: 0.78, light: 0.52 },
  relaxed: { label: 'Relaxed', verbatim: 0.90, light: 0.68 },
};

const ARROW_RIGHT = `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

const state = {
  priorText: '',
  draftText: '',
  priorMeta: null,
  draftMeta: null,
  priorError: '',
  draftError: '',
  priorLoading: false,
  draftLoading: false,
  targetCycle: 2027,
  sensitivity: 'standard',
  result: null,
  filter: 'all',
  selectedSentenceId: null,
  copyConfirm: false,
};

const app = document.getElementById('app');

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wordCount(text) {
  return tokenize(text).length;
}

function runCheck({ scrollToResults = false } = {}) {
  if (!state.priorText.trim() || !state.draftText.trim()) {
    state.result = null;
    state.selectedSentenceId = null;
    render();
    return;
  }

  const preset = SENSITIVITY_PRESETS[state.sensitivity] || SENSITIVITY_PRESETS.standard;
  state.result = analyzeUES(state.priorText, state.draftText, {
    targetCycle: state.targetCycle,
    verbatimThreshold: preset.verbatim,
    lightEditThreshold: preset.light,
  });

  state.selectedSentenceId = findFirstFlaggedSentenceId(state.result);
  state.filter = 'all';
  render();

  if (scrollToResults) {
    document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function findFirstFlaggedSentenceId(result) {
  if (!result) return null;
  for (const p of result.paragraphs) {
    for (const s of p.sentences) {
      if (s.status === 'verbatim' || s.status === 'light_edit') return s.id;
    }
  }
  return null;
}

function findSentenceById(result, id) {
  if (!result || !id) return null;
  for (const p of result.paragraphs) {
    for (const s of p.sentences) {
      if (s.id === id) return { paragraph: p, sentence: s };
    }
  }
  return null;
}

function loadSample() {
  state.priorText = SAMPLE_UES.priorText;
  state.draftText = SAMPLE_UES.draftText;
  state.priorMeta = { name: SAMPLE_UES.priorLabel, format: 'sample', pages: null };
  state.draftMeta = { name: SAMPLE_UES.draftLabel, format: 'sample', pages: null };
  state.priorError = '';
  state.draftError = '';
  state.targetCycle = SAMPLE_UES.targetCycle;
  runCheck({ scrollToResults: true });
}

function clearAll() {
  state.priorText = '';
  state.draftText = '';
  state.priorMeta = null;
  state.draftMeta = null;
  state.priorError = '';
  state.draftError = '';
  state.result = null;
  state.selectedSentenceId = null;
  render();
}

async function handleFileInput(side, file) {
  if (!file) return;
  const errKey = side === 'prior' ? 'priorError' : 'draftError';
  const loadKey = side === 'prior' ? 'priorLoading' : 'draftLoading';
  const textKey = side === 'prior' ? 'priorText' : 'draftText';
  const metaKey = side === 'prior' ? 'priorMeta' : 'draftMeta';

  state[errKey] = '';
  state[loadKey] = true;
  render();

  try {
    const parsed = await parseDocumentFile(file);
    state[textKey] = parsed.text;
    state[metaKey] = { name: file.name, format: parsed.format, pages: parsed.pages };
    state[loadKey] = false;
    if (state.priorText.trim() && state.draftText.trim()) {
      runCheck();
    } else {
      render();
    }
  } catch (err) {
    state[loadKey] = false;
    state[errKey] = err?.message || 'Could not read this file.';
    render();
  }
}

function sentenceMatchesFilter(sentence, filter) {
  if (filter === 'all') return true;
  if (filter === 'flagged') {
    return sentence.status === 'verbatim' || sentence.status === 'light_edit' ||
      sentence.staleDates.length > 0 || sentence.unchangedMetrics.length > 0;
  }
  if (filter === 'verbatim') return sentence.status === 'verbatim';
  if (filter === 'light_edit') return sentence.status === 'light_edit';
  if (filter === 'dates') return sentence.staleDates.length > 0;
  if (filter === 'metrics') return sentence.unchangedMetrics.length > 0;
  return true;
}

function renderDiffTokens(tokens) {
  return tokens
    .map((t) => {
      if (t.type === 'removed') return `<span class="tok-removed">${esc(t.text)}</span>`;
      if (t.type === 'added') return `<span class="tok-added">${esc(t.text)}</span>`;
      return esc(t.text);
    })
    .join(' ');
}

function renderInspector(result) {
  const found = findSentenceById(result, state.selectedSentenceId);
  if (!found) {
    return `<p class="inspector-empty">Click any highlighted sentence in the draft to inspect its side-by-side match against last year’s submission.</p>`;
  }

  const { paragraph, sentence } = found;
  const pct = Math.round(Math.max(sentence.rawSim, sentence.skeletonSim) * 100);

  let badgeHtml = '';
  if (sentence.status === 'verbatim') {
    badgeHtml = `<span class="inspector-badge badge-verbatim">Verbatim copy-forward · ${Math.round(sentence.rawSim * 100)}% match · ¶${paragraph.index}</span>`;
  } else if (sentence.status === 'light_edit') {
    const label = sentence.templateSwap
      ? `Template swap (only numbers/dates changed) · ¶${paragraph.index}`
      : `Light find-and-replace · ${pct}% match · ¶${paragraph.index}`;
    badgeHtml = `<span class="inspector-badge badge-light">${label}</span>`;
  } else {
    badgeHtml = `<span class="inspector-badge badge-info">Fresh wording with date/figure alert · ¶${paragraph.index}</span>`;
  }

  let matchHtml = '';
  if (sentence.match) {
    matchHtml = `
      <div class="diff-box">
        <span class="diff-box-label">Last year (¶${sentence.match.paragraphIndex})</span>
        <div>${renderDiffTokens(sentence.match.diff.priorTokens)}</div>
      </div>
      <div class="diff-box">
        <span class="diff-box-label">This year’s draft (¶${paragraph.index})</span>
        <div>${renderDiffTokens(sentence.match.diff.draftTokens)}</div>
      </div>
    `;
  } else {
    matchHtml = `
      <div class="diff-box">
        <span class="diff-box-label">Draft sentence (¶${paragraph.index})</span>
        <div>${esc(sentence.text)}</div>
      </div>
    `;
  }

  const extras = [];
  for (const d of sentence.staleDates) {
    extras.push(`<p class="flag-desc" style="margin-top:0.65rem"><strong>Stale date (${esc(d.token)}):</strong> ${esc(d.reason)}</p>`);
  }
  for (const m of sentence.unchangedMetrics) {
    extras.push(`<p class="flag-desc" style="margin-top:0.55rem"><strong>Unchanged figure (${esc(m.raw)}):</strong> Identical value appeared in last year’s ¶${m.priorParagraph}.</p>`);
  }

  return `${badgeHtml}${matchHtml}${extras.join('')}`;
}

function renderResults(result) {
  if (!result) {
    return `
      <section class="results-band" id="results-section">
        <div class="inner">
          <div class="empty-state">
            <div class="empty-instructions">
              <p class="eyebrow"><span class="dash" aria-hidden="true"></span>How to run a check</p>
              <h2>Ready when your two drafts are</h2>
              <p>Drop last year’s UES on the left and this year’s draft on the right: Word (<code>.docx</code>), PDF exports from the UES portal, or pasted text. Everything runs locally in this browser tab.</p>
            </div>
            <div class="empty-sample-box">
              <p class="eyebrow"><span class="dash" aria-hidden="true"></span>Sample UES</p>
              <p>Load our fictional commodity sample to see every detector in action.</p>
              <button type="button" class="btn btn-amber" data-action="load-sample">
                <span>Load sample UES</span>
                ${ARROW_RIGHT}
              </button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  const { meta, scores, flags, paragraphs } = result;
  const verdictClass = `verdict-${scores.verdict.level}`;

  const filterCounts = {
    all: meta.substantiveSentenceCount,
    flagged: scores.verbatimCount + scores.lightEditCount,
    verbatim: scores.verbatimCount,
    light_edit: scores.lightEditCount,
    dates: flags.staleDates.length,
    metrics: flags.unchangedMetrics.length,
  };

  const paraHtml = paragraphs
    .map((p) => {
      if (p.isHeading) {
        return `
          <div class="para-block">
            <div class="para-num">¶${p.index}</div>
            <div><h3 class="para-heading">${esc(p.sentences[0]?.text || '')}</h3></div>
          </div>
        `;
      }

      const sentHtml = p.sentences
        .map((s) => {
          const hasExtra = s.staleDates.length > 0 || s.unchangedMetrics.length > 0;
          const isInteractive = s.status === 'verbatim' || s.status === 'light_edit' || hasExtra;
          const matches = sentenceMatchesFilter(s, state.filter);
          const classes = ['sent', `sent-${s.status}`];
          if (hasExtra) classes.push('has-extra-flag');
          if (state.selectedSentenceId === s.id) classes.push('is-selected');
          if (!matches) classes.push('is-dimmed');

          const chips = [];
          for (const d of s.staleDates) {
            chips.push(`<span class="inline-chip chip-date" title="${esc(d.reason)}">${esc(d.token)}?</span>`);
          }
          for (const m of s.unchangedMetrics) {
            chips.push(`<span class="inline-chip chip-metric" title="Identical figure appeared in prior draft ¶${m.priorParagraph}">${esc(m.raw)} =</span>`);
          }

          return `<span class="${classes.join(' ')}" data-sent-id="${s.id}" ${isInteractive ? 'role="button" tabindex="0"' : ''}>${esc(s.text)}${chips.join('')}</span>`;
        })
        .join(' ');

      const unqHtml = p.isUnquantified
        ? `<div class="unquantified-banner"><strong>No quantified result (${p.wordCount} words):</strong> FAS weights evaluation &amp; results at 50 of 100 UES points. Consider adding concrete buyer counts, sales figures, or measurable outcomes.</div>`
        : '';

      return `
        <div class="para-block" data-para-index="${p.index}">
          <div class="para-num">¶${p.index}</div>
          <div>
            <p class="para-body">${sentHtml}</p>
            ${unqHtml}
          </div>
        </div>
      `;
    })
    .join('');

  const staleDatesList = flags.staleDates.length
    ? `<ul class="flag-list">${flags.staleDates
        .map(
          (f) => `
          <li>
            <button type="button" class="flag-item" data-jump-sent="${f.sentenceId}">
              <div class="flag-item-top">
                <span class="flag-token">${esc(f.token)}</span>
                <span class="flag-loc">¶${f.paragraphIndex}</span>
              </div>
              <p class="flag-desc">${esc(f.reason)}</p>
            </button>
          </li>`
        )
        .join('')}</ul>`
    : `<p class="inspector-empty">No suspicious leftover years or fiscal-cycle labels detected for FY${meta.targetCycle}.</p>`;

  const unchangedMetricsList = flags.unchangedMetrics.length
    ? `<ul class="flag-list">${flags.unchangedMetrics
        .map(
          (m) => `
          <li>
            <button type="button" class="flag-item" data-jump-sent="${m.sentenceId}">
              <div class="flag-item-top">
                <span class="flag-token">${esc(m.raw)}</span>
                <span class="flag-loc">¶${m.paragraphIndex} ← prior ¶${m.priorParagraph}</span>
              </div>
              <p class="flag-desc">Exact same figure appeared in last year’s draft. Confirm whether it needs updating.</p>
            </button>
          </li>`
        )
        .join('')}</ul>`
    : `<p class="inspector-empty">No identical dollar amounts, percentages, or counts carried over from last year.</p>`;

  const unquantifiedList = flags.unquantifiedParagraphs.length
    ? `<ul class="flag-list">${flags.unquantifiedParagraphs
        .map(
          (u) => `
          <li>
            <button type="button" class="flag-item" data-jump-sent="${u.firstSentenceId || ''}">
              <div class="flag-item-top">
                <span class="flag-token">Paragraph ${u.paragraphIndex}</span>
                <span class="flag-loc">${u.wordCount} words</span>
              </div>
              <p class="flag-desc">${esc(u.preview)}</p>
            </button>
          </li>`
        )
        .join('')}</ul>`
    : `<p class="inspector-empty">Every substantive paragraph includes numbers or concrete indicators.</p>`;

  return `
    <section class="results-band" id="results-section">
      <div class="inner">
        <div class="score-card">
          <div class="score-top">
            <div>
              <div class="score-hero">
                <span class="score-number">${scores.copyForwardPct}%</span>
                <div>
                  <div class="score-label">Copy-Forward Score · FY${meta.targetCycle}</div>
                  <span class="verdict-pill ${verdictClass}">${esc(scores.verdict.label)}</span>
                </div>
              </div>
              <p class="verdict-summary">${esc(scores.verdict.summary)}</p>
            </div>
            <div class="export-actions">
              <button type="button" class="btn btn-ink" data-action="copy-checklist">
                <span>${state.copyConfirm ? '✓ Checklist copied' : 'Copy revision checklist'}</span>
                ${state.copyConfirm ? '' : ARROW_RIGHT}
              </button>
              <button type="button" class="btn btn-ghost" data-action="print-report">Print / Save PDF</button>
            </div>
          </div>

          <div class="ratio-bar" aria-label="Copy-forward breakdown">
            <div class="ratio-seg-verbatim" style="width:${scores.verbatimPct}%"></div>
            <div class="ratio-seg-light" style="width:${scores.lightEditPct}%"></div>
            <div class="ratio-seg-fresh" style="width:${scores.freshPct}%"></div>
          </div>
          <div class="ratio-legend">
            <span class="legend-item"><span class="swatch swatch-verbatim"></span>Verbatim recycled (${scores.verbatimPct}%)</span>
            <span class="legend-item"><span class="swatch swatch-light"></span>Light find-and-replace (${scores.lightEditPct}%)</span>
            <span class="legend-item"><span class="swatch swatch-fresh"></span>Fresh / rewritten (${scores.freshPct}%)</span>
          </div>

          <div class="stat-grid">
            <div class="stat-tile">
              <div class="stat-val">${scores.verbatimCount}</div>
              <div class="stat-name">Verbatim sentences</div>
              <div class="stat-sub">${scores.verbatimPct}% of draft words</div>
            </div>
            <div class="stat-tile">
              <div class="stat-val">${scores.lightEditCount}</div>
              <div class="stat-name">Find &amp; replace</div>
              <div class="stat-sub">${scores.lightEditPct}% of draft words</div>
            </div>
            <div class="stat-tile">
              <div class="stat-val">${flags.staleDates.length}</div>
              <div class="stat-name">Stale years / FYs</div>
              <div class="stat-sub">Relative to FY${meta.targetCycle}</div>
            </div>
            <div class="stat-tile">
              <div class="stat-val">${flags.unchangedMetrics.length}</div>
              <div class="stat-name">Unchanged figures</div>
              <div class="stat-sub">Same number as last year</div>
            </div>
            <div class="stat-tile">
              <div class="stat-val">${flags.unquantifiedParagraphs.length}</div>
              <div class="stat-name">Unquantified ¶</div>
              <div class="stat-sub">75+ words, zero metrics</div>
            </div>
          </div>
        </div>

        <div class="filter-bar">
          <div class="filter-pills" role="tablist" aria-label="Highlight filters">
            ${[
              ['all', `All (${filterCounts.all})`],
              ['flagged', `Flagged (${filterCounts.flagged})`],
              ['verbatim', `Verbatim (${filterCounts.verbatim})`],
              ['light_edit', `Find & replace (${filterCounts.light_edit})`],
              ['dates', `Stale years (${filterCounts.dates})`],
              ['metrics', `Unchanged figures (${filterCounts.metrics})`],
            ]
              .map(
                ([key, label]) =>
                  `<button type="button" class="filter-pill ${state.filter === key ? 'is-active' : ''}" data-filter="${key}">${label}</button>`
              )
              .join('')}
          </div>
          <span class="hint-text">Click any highlighted sentence to inspect its word diff →</span>
        </div>

        <div class="review-grid">
          <div class="draft-pane">
            <div class="draft-pane-head">
              <h2>Annotated FY${meta.targetCycle} Draft</h2>
              <span class="draft-pane-meta">${meta.draftWordCount.toLocaleString()} words · ${meta.draftParagraphCount} paragraphs</span>
            </div>
            ${paraHtml}
          </div>

          <aside class="sidebar">
            <div class="panel">
              <div class="panel-head">
                <h3 class="panel-title">Sentence Inspector</h3>
                <span class="panel-count">Side-by-side</span>
              </div>
              <div class="panel-body panel-body-inspector">${renderInspector(result)}</div>
            </div>

            <div class="panel">
              <div class="panel-head">
                <h3 class="panel-title">Stale Years &amp; Fiscal Cycles</h3>
                <span class="panel-count">${flags.staleDates.length}</span>
              </div>
              <div class="panel-body">${staleDatesList}</div>
            </div>

            <div class="panel">
              <div class="panel-head">
                <h3 class="panel-title">Unchanged Figures</h3>
                <span class="panel-count">${flags.unchangedMetrics.length}</span>
              </div>
              <div class="panel-body">${unchangedMetricsList}</div>
            </div>

            <div class="panel">
              <div class="panel-head">
                <h3 class="panel-title">Paragraphs Missing Numbers</h3>
                <span class="panel-count">${flags.unquantifiedParagraphs.length}</span>
              </div>
              <div class="panel-body">${unquantifiedList}</div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  `;
}

function renderDocCard(side) {
  const isPrior = side === 'prior';
  const text = isPrior ? state.priorText : state.draftText;
  const meta = isPrior ? state.priorMeta : state.draftMeta;
  const error = isPrior ? state.priorError : state.draftError;
  const loading = isPrior ? state.priorLoading : state.draftLoading;
  const words = wordCount(text);

  const badgeText = loading
    ? 'Reading file locally…'
    : meta
      ? `${meta.name}${meta.pages ? ` · ${meta.pages}p` : ''}`
      : 'Drop .docx, .pdf, .txt, or paste below';

  return `
    <div class="doc-card" data-dropzone="${side}">
      <div class="doc-card-head">
        <div>
          <span class="doc-step">${isPrior ? '01 · Baseline' : '02 · New Submission'}</span>
          <h2 class="doc-title">${isPrior ? 'Last year’s UES' : `This year’s FY${state.targetCycle} draft`}</h2>
        </div>
        <label class="upload-btn">
          <span>Choose file</span>
          <input type="file" accept=".docx,.pdf,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-file-input="${side}" hidden />
        </label>
      </div>
      <div class="file-meta">
        <span class="file-badge">${esc(badgeText)}</span>
        <span>${words.toLocaleString()} words</span>
      </div>
      ${error ? `<div class="file-error">${esc(error)}</div>` : ''}
      <textarea
        class="doc-textarea"
        data-textarea="${side}"
        placeholder="${isPrior ? 'Paste last year’s UES narrative here, or drag a .docx / .pdf file onto this card…' : 'Paste this year’s UES draft here, or drag a .docx / .pdf file onto this card…'}"
      >${esc(text)}</textarea>
    </div>
  `;
}

function render() {
  const canRun = Boolean(state.priorText.trim() && state.draftText.trim());

  app.innerHTML = `
    <header class="site-header">
      <div class="inner header-bar">
        <div class="header-left">
          <a class="site-name" href="https://duess.com/for-usaedc-members/" target="_blank" rel="noopener">
            <img src="/ds-logo-light.svg" alt="Duess Strategies" class="site-logo" />
          </a>
          <span class="header-tool-tag">ues-checker.duess.com</span>
        </div>
        <div class="header-right">
          <a class="header-link" href="https://duess.com/for-usaedc-members/" target="_blank" rel="noopener">USAEDC Members</a>
          <div class="privacy-pill" title="Pure JavaScript inside this browser tab. Zero uploads, zero AI APIs, zero analytics.">
            <span class="privacy-dot" aria-hidden="true"></span>
            <span>Zero uploads · 100% in your browser</span>
          </div>
        </div>
      </div>
    </header>

    <section class="hero">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="inner">
        <p class="eyebrow"><span class="dash" aria-hidden="true"></span>Free tool for FAS cooperators &amp; USAEDC members</p>
        <h1>Spot <em>copy-forward</em> text in your UES before FAS reviewers do.</h1>
        <p class="hero-lead">
          FAS specialists compare this year’s Unified Export Strategy against last year’s submission to flag recycled language, while half of every review score rests on evaluation and results. Drop both drafts below to catch verbatim copy-forward, light find-and-replace swaps, stale years, and unchanged numbers without uploading a single byte.
        </p>
        <ul class="hero-chips">
          <li>Reads .docx, .pdf, .txt &amp; pasted text locally</li>
          <li>Catches template swaps &amp; stale fiscal years</li>
          <li>Flags unchanged stats &amp; unquantified paragraphs</li>
          <li>Exports a printable PDF or Markdown checklist</li>
        </ul>
      </div>
    </section>

    <main>
      <section class="workbench">
        <div class="inner">
          <div class="controls-bar">
            <div class="controls-left">
              <label class="field-inline">
                <span>Target cycle</span>
                <select data-select="cycle">
                  ${[2026, 2027, 2028]
                    .map((yr) => `<option value="${yr}" ${state.targetCycle === yr ? 'selected' : ''}>FY${yr}</option>`)
                    .join('')}
                </select>
              </label>
              <label class="field-inline">
                <span>Sensitivity</span>
                <select data-select="sensitivity">
                  ${Object.entries(SENSITIVITY_PRESETS)
                    .map(([k, v]) => `<option value="${k}" ${state.sensitivity === k ? 'selected' : ''}>${v.label}</option>`)
                    .join('')}
                </select>
              </label>
            </div>
            <div class="controls-right">
              <button type="button" class="btn btn-amber btn-compact" data-action="load-sample">
                <span>Load sample UES</span>
                ${ARROW_RIGHT}
              </button>
              <button type="button" class="btn-link" data-action="clear">Clear</button>
            </div>
          </div>

          <div class="input-grid">
            ${renderDocCard('prior')}
            ${renderDocCard('draft')}
          </div>

          <div class="action-row">
            <button type="button" class="btn btn-ink" data-action="analyze" ${canRun ? '' : 'disabled'}>
              <span>Check for copy-forward text</span>
              ${ARROW_RIGHT}
            </button>
          </div>
        </div>
      </section>

      ${renderResults(state.result)}
    </main>

    <footer class="site-footer">
      <div class="inner footer-inner">
        <div>
          Built by <a href="https://duess.com/about/" target="_blank" rel="noopener">Andreas Duess</a> ·
          <a href="https://duess.com/for-usaedc-members/" target="_blank" rel="noopener">Duess Strategies</a> (USAEDC member).
          Open source under MIT.
        </div>
        <div class="footer-links">
          <a href="https://duess.com/for-usaedc-members/" target="_blank" rel="noopener">AI for FAS Cooperators</a>
          <a href="https://duess.com/ai-policy/#fas" target="_blank" rel="noopener">One-Page FAS AI Policy</a>
          <a href="https://github.com/andreas-duess/ues-checker" target="_blank" rel="noopener">GitHub</a>
        </div>
      </div>
    </footer>
  `;

  bindEvents();
}

function bindEvents() {
  app.querySelectorAll('[data-textarea]').forEach((el) => {
    el.addEventListener('input', (e) => {
      const side = e.currentTarget.dataset.textarea;
      const val = e.currentTarget.value;
      if (side === 'prior') {
        state.priorText = val;
        if (!val.trim()) state.priorMeta = null;
      } else {
        state.draftText = val;
        if (!val.trim()) state.draftMeta = null;
      }
      const card = e.currentTarget.closest('.doc-card');
      const countSpan = card?.querySelector('.file-meta span:last-child');
      if (countSpan) countSpan.textContent = `${wordCount(val).toLocaleString()} words`;
      const runBtn = app.querySelector('[data-action="analyze"]');
      if (runBtn) runBtn.disabled = !(state.priorText.trim() && state.draftText.trim());
    });
  });

  app.querySelectorAll('[data-file-input]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const side = e.currentTarget.dataset.fileInput;
      const file = e.currentTarget.files?.[0];
      if (file) handleFileInput(side, file);
    });
  });

  app.querySelectorAll('[data-dropzone]').forEach((card) => {
    const side = card.dataset.dropzone;
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('is-dragover');
    });
    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget)) card.classList.remove('is-dragover');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileInput(side, file);
    });
  });

  app.querySelector('[data-select="cycle"]')?.addEventListener('change', (e) => {
    state.targetCycle = Number(e.currentTarget.value);
    if (state.result) runCheck();
    else render();
  });

  app.querySelector('[data-select="sensitivity"]')?.addEventListener('change', (e) => {
    state.sensitivity = e.currentTarget.value;
    if (state.result) runCheck();
  });

  app.querySelectorAll('[data-action="load-sample"]').forEach((btn) => {
    btn.addEventListener('click', loadSample);
  });

  app.querySelector('[data-action="clear"]')?.addEventListener('click', clearAll);

  app.querySelector('[data-action="analyze"]')?.addEventListener('click', () => {
    runCheck({ scrollToResults: true });
  });

  app.querySelector('[data-action="copy-checklist"]')?.addEventListener('click', async () => {
    if (!state.result) return;
    const md = buildRevisionChecklist(state.result, {
      priorName: state.priorMeta?.name,
      draftName: state.draftMeta?.name,
    });
    try {
      await navigator.clipboard.writeText(md);
      state.copyConfirm = true;
      render();
      setTimeout(() => {
        state.copyConfirm = false;
        render();
      }, 2200);
    } catch {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ues-copy-forward-checklist-FY${state.targetCycle}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  app.querySelector('[data-action="print-report"]')?.addEventListener('click', () => {
    window.print();
  });

  app.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      state.filter = e.currentTarget.dataset.filter;
      render();
    });
  });

  app.querySelectorAll('[data-sent-id]').forEach((el) => {
    const select = () => {
      const id = el.dataset.sentId;
      const found = findSentenceById(state.result, id);
      if (!found) return;
      const s = found.sentence;
      if (s.status === 'verbatim' || s.status === 'light_edit' || s.staleDates.length || s.unchangedMetrics.length) {
        state.selectedSentenceId = id;
        render();
      }
    };
    el.addEventListener('click', select);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
  });

  app.querySelectorAll('[data-jump-sent]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.jumpSent;
      if (!id) return;
      state.selectedSentenceId = id;
      state.filter = 'all';
      render();
      const target = app.querySelector(`[data-sent-id="${id}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('is-flashed');
      }
    });
  });
}

render();
