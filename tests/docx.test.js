import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { zipSync, strToU8 } from 'fflate';
import { extractDocxText } from '../src/engine/docx.js';

globalThis.DOMParser = DOMParser;

function makeDocx(bodyXml) {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${bodyXml}</w:body></w:document>`;
  return zipSync({ 'word/document.xml': strToU8(xml) }).buffer;
}

const para = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('extractDocxText reads plain paragraphs and skips deleted tracked changes', () => {
  const docx = makeDocx(
    `${para('Market overview.')}<w:p><w:r><w:t>Exports grew</w:t></w:r><w:del><w:r><w:delText> slightly</w:delText></w:r></w:del><w:r><w:t> 12%.</w:t></w:r></w:p>`
  );
  assert.equal(extractDocxText(docx), 'Market overview.\n\nExports grew 12%.');
});

test('extractDocxText reads a text box once, not from both mc:Choice and mc:Fallback', () => {
  const box = `<w:txbxContent>${para('Callout: 42 new buyers.')}</w:txbxContent>`;
  const docx = makeDocx(
    `${para('Before the box.')}` +
      `<w:p><w:r><w:t>Anchor text.</w:t></w:r><w:r><mc:AlternateContent>` +
      `<mc:Choice Requires="wps"><w:drawing><wps:txbx>${box}</wps:txbx></w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict><v:textbox>${box}</v:textbox></w:pict></mc:Fallback>` +
      `</mc:AlternateContent></w:r></w:p>` +
      `${para('After the box.')}`
  );
  const text = extractDocxText(docx);
  assert.equal(text.match(/Callout/g)?.length, 1, text);
  assert.equal(text, 'Before the box.\n\nAnchor text.\n\nCallout: 42 new buyers.\n\nAfter the box.');
});
