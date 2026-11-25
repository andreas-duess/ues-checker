/**
 * Pure client-side DOCX text extraction. Kept apart from parsers.js (which pulls in
 * pdf.js and a Vite worker URL) so Node tests can run it with an XML DOMParser.
 */

import { unzipSync, strFromU8 } from 'fflate';

/**
 * Unzips word/document.xml via fflate and reconstructs clean paragraphs
 * using the browser's native DOMParser.
 *
 * Each w:p is read once. Text boxes hold their own w:p inside the anchoring
 * paragraph, so nested paragraphs are skipped when collecting the outer one.
 * Word also stores every text box twice (mc:Choice and an mc:Fallback copy
 * for older readers); the fallback copy is ignored.
 */
export function extractDocxText(arrayBuffer) {
  let files;
  try {
    files = unzipSync(new Uint8Array(arrayBuffer));
  } catch {
    throw new Error('Could not open .docx archive. Make sure the file is not password-protected or corrupted.');
  }

  const docXmlBytes = files['word/document.xml'];
  if (!docXmlBytes) {
    throw new Error('Missing word/document.xml inside this .docx file.');
  }

  const xmlStr = strFromU8(docXmlBytes);
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');

  if (xmlDoc.getElementsByTagName('parsererror').length) {
    throw new Error('Could not read XML inside this .docx file.');
  }

  const paragraphs = [];
  const pNodes = xmlDoc.getElementsByTagName('w:p');

  for (let i = 0; i < pNodes.length; i++) {
    const pNode = pNodes[i];
    if (isInsideFallback(pNode)) continue;
    const parts = [];
    collectTextNodes(pNode, parts);
    const joined = parts.join('').replace(/[ \t]+/g, ' ').trim();
    if (joined) paragraphs.push(joined);
  }

  if (!paragraphs.length) {
    throw new Error('No readable text found in this .docx file.');
  }

  return paragraphs.join('\n\n');
}

function isInsideFallback(node) {
  for (let n = node.parentNode; n; n = n.parentNode) {
    if (n.nodeName === 'mc:Fallback') return true;
  }
  return false;
}

function collectTextNodes(node, parts) {
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType !== 1) continue;
    const tag = child.nodeName;
    if (tag === 'w:t') {
      parts.push(child.textContent || '');
    } else if (tag === 'w:tab') {
      parts.push(' ');
    } else if (tag === 'w:br' || tag === 'w:cr') {
      parts.push('\n');
    } else if (tag === 'w:delText' || tag === 'w:p' || tag === 'mc:Fallback') {
      // Skip deleted tracked-change text, nested text-box paragraphs (read on
      // their own) and the legacy fallback copy of text boxes.
      continue;
    } else if (child.childNodes && child.childNodes.length) {
      collectTextNodes(child, parts);
    }
  }
}
