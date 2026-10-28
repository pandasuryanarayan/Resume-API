'use strict';

/**
 * Resume engine.
 *
 * The website's own renderer is reused verbatim, so a PDF produced by the API
 * is identical to the PDF a visitor downloads from the Resume Builder site.
 * `assets/js/templates.js` is pure JavaScript with no DOM dependency, so it can
 * be evaluated in a Node VM context and driven with the `jspdf` package
 * instead of the browser bundle.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { jsPDF } = require('jspdf');
const config = require('./config');

const ROOT = path.join(__dirname, '..');
const TEMPLATES_SRC = path.join(ROOT, 'assets', 'js', 'templates.js');
const STYLES_SRC = path.join(ROOT, 'assets', 'css', 'style.css');

let engine = null;

function loadEngine() {
  if (engine) return engine;
  const source = fs.readFileSync(TEMPLATES_SRC, 'utf8');
  const context = vm.createContext({ console });
  engine = vm.runInContext(
    `${source}\n;({ Templates, getTemplate, PDFUtils, enginePreview, CATEGORIES })`,
    context,
    { filename: TEMPLATES_SRC }
  );
  return engine;
}

function listTemplates() {
  return loadEngine().Templates.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.desc,
  }));
}

function templateExists(id) {
  return loadEngine().Templates.some((t) => t.id === id);
}

function drawFooter(doc, text) {
  if (!text) return;
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(text, 105, 287, { align: 'center' });
  }
}

/**
 * @param {object} state  Normalised resume state (same shape the site stores).
 * @param {string} templateId
 * @returns {{ buffer: Buffer, pages: number, template: string, templateName: string }}
 */
function renderPdf(state, templateId) {
  const e = loadEngine();
  const tpl = e.getTemplate(templateId || config.defaultTemplate);
  const doc = new jsPDF('p', 'mm', 'a4');

  tpl.draw(doc, state);
  drawFooter(doc, config.footerText);

  return {
    buffer: Buffer.from(doc.output('arraybuffer')),
    pages: doc.internal.getNumberOfPages(),
    template: tpl.id,
    templateName: tpl.name,
  };
}

/**
 * @param {object} state
 * @param {string} templateId
 * @param {{ full?: boolean }} options  full=true wraps the fragment in a
 *   complete HTML document with the site's stylesheet inlined, so an iframe
 *   srcDoc shows the same design as the website preview.
 */
function renderPreview(state, templateId, options = {}) {
  const e = loadEngine();
  const tpl = e.getTemplate(templateId || config.defaultTemplate);
  const fragment = tpl.preview(state);

  if (!options.full) {
    return { html: fragment, template: tpl.id, templateName: tpl.name };
  }

  const css = fs.readFileSync(STYLES_SRC, 'utf8');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${tpl.name} template preview</title>
<style>
${css}
body { margin: 0; padding: 16px; background: #eef2f7; }
#preview-paper { max-width: 672px; }
</style>
</head>
<body>
<div id="preview-paper">${fragment}</div>
</body>
</html>`;

  return { html, template: tpl.id, templateName: tpl.name };
}

module.exports = { loadEngine, listTemplates, templateExists, renderPdf, renderPreview, drawFooter };
