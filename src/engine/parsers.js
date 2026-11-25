/**
 * 100% browser-side file parsers for .txt, .md, .docx, and .pdf.
 * Uses locally bundled fflate and pdfjs-dist — zero external CDN requests, zero uploads.
 */

import { extractDocxText } from './docx.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB safety ceiling

export async function parseDocumentFile(file) {
  if (!file) throw new Error('No file provided.');
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('File exceeds 25 MB browser limit. Split into smaller sections first.');
  }

  const name = file.name || 'document';
  const ext = name.split('.').pop()?.toLowerCase() || '';

  if (ext === 'txt' || ext === 'md' || ext === 'markdown' || file.type === 'text/plain') {
    const text = await file.text();
    return { text: text.trim(), format: ext || 'txt', pages: null };
  }

  if (ext === 'docx') {
    const buffer = await file.arrayBuffer();
    const text = extractDocxText(buffer);
    return { text, format: 'docx', pages: null };
  }

  if (ext === 'pdf') {
    const buffer = await file.arrayBuffer();
    const { text, pages } = await extractPdfText(buffer);
    return { text, format: 'pdf', pages };
  }

  if (ext === 'doc') {
    throw new Error('Legacy .doc files are binary. Save as .docx or .pdf in Word, or paste the text directly.');
  }

  throw new Error(`Unsupported file type (.${ext || 'unknown'}). Use .docx, .pdf, .txt, or .md.`);
}

export { extractDocxText };

/**
 * Pure client-side PDF text extraction using locally bundled pdf.js worker.
 * Preserves paragraph breaks by clustering Y-coordinates and line spacing.
 */
async function extractPdfText(arrayBuffer) {
  let pdf;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useSystemFonts: true,
      isEvalSupported: false,
    });
    pdf = await loadingTask.promise;
  } catch {
    throw new Error('Could not open PDF. Make sure it is not encrypted or corrupted.');
  }

  const pageTexts = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const lines = groupPdfItemsIntoLines(content.items);
    if (lines.length) {
      pageTexts.push(reconstructPdfParagraphs(lines));
    }
  }

  const text = pageTexts.join('\n\n').trim();
  if (!text) {
    throw new Error('No selectable text found in this PDF (it may be a scanned image). Copy-paste from Word or run OCR first.');
  }

  return { text, pages: pdf.numPages };
}

function groupPdfItemsIntoLines(items) {
  const lines = [];
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    const str = item.str;
    if (!str.trim() && !item.hasEOL) continue;

    const y = Math.round(item.transform?.[5] ?? 0);
    const x = item.transform?.[4] ?? 0;
    const height = Math.abs(item.height || item.transform?.[3] || 11);

    let line = lines.find((l) => Math.abs(l.y - y) <= Math.max(2.5, height * 0.35));
    if (!line) {
      line = { y, height, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, str });
    if (height > line.height) line.height = height;
  }

  // Sort top-to-bottom (higher Y first in PDF coordinates)
  lines.sort((a, b) => b.y - a.y);

  return lines
    .map((line) => {
      line.parts.sort((a, b) => a.x - b.x);
      const text = line.parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim();
      return { y: line.y, height: line.height, text };
    })
    .filter((l) => l.text && !/^\d+$/.test(l.text)); // drop bare page numbers
}

function reconstructPdfParagraphs(lines) {
  if (!lines.length) return '';
  const paragraphs = [];
  let current = lines[0].text;

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    const gap = Math.abs(prev.y - curr.y);
    const threshold = Math.max(prev.height, curr.height, 10) * 1.55;

    if (gap > threshold) {
      paragraphs.push(current.trim());
      current = curr.text;
    } else {
      // A line ending in a hyphen joins without a space and keeps the hyphen:
      // Word-exported PDFs rarely auto-hyphenate, so "fastest-" / "growing" is
      // almost always a real compound, not a split word.
      if (/[a-z]-$/.test(current) && /^[a-z]/.test(curr.text)) {
        current = `${current}${curr.text}`;
      } else {
        current = `${current} ${curr.text}`;
      }
    }
  }
  if (current) paragraphs.push(current.trim());
  return paragraphs.join('\n\n');
}
