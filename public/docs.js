'use strict';

/**
 * Docs page behaviour: load the template catalogue, then drive the playground
 * against the API the page is served from.
 */

const SAMPLE = {
  fullName: 'Suryanarayan Panda',
  email: 'psuryanarayan94@gmail.com',
  phone: '9876543210',
  address: 'Bhubaneswar, Odisha - 751024',
  linkedin: 'linkedin.com/in/suryanarayan',
  github: 'github.com/pandasuryanarayan',
  languages: 'English, Hindi, Odia',
  summary: 'Backend engineer building APIs and data pipelines, with a focus on reliability and clean interfaces.',
  qualifications: [
    { degree: 'B.Tech Computer Science', university: 'IIT Bhubaneswar', year: '2019', score: '8.4 CGPA' },
  ],
  edu_12th_school: 'Delhi Public School',
  edu_12th_board: 'CBSE',
  edu_12th_stream: 'Science (PCM)',
  edu_12th_year: '2015',
  edu_12th_score: '92',
  edu_10th_school: 'Delhi Public School',
  edu_10th_board: 'CBSE',
  edu_10th_year: '2013',
  edu_10th_score: '95',
  workExperience: '- Software Engineer at ABC Tech (2022-Present): Built REST APIs serving 2M requests a day.',
  projects: '- Resume Builder API: Node.js connector that renders PDFs from JSON.',
  skills: 'Node.js, Python, PostgreSQL, Docker, AWS',
  certifications: '- AWS Solutions Architect Associate',
  actHob: 'Cricket, Chess, Volunteering',
  template: 'classic',
};

const $ = (id) => document.getElementById(id);
const payloadEl = $('payload');
const statusEl = $('status');
const previewEl = $('preview');
const templateEl = $('template');

payloadEl.value = JSON.stringify(SAMPLE, null, 2);

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function readPayload() {
  try {
    return JSON.parse(payloadEl.value);
  } catch (err) {
    setStatus('Payload is not valid JSON: ' + err.message, 'err');
    return null;
  }
}

async function loadTemplates() {
  try {
    const res = await fetch('/v1/templates');
    const data = await res.json();
    templateEl.innerHTML = '';
    data.templates.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name + ' · ' + t.category;
      templateEl.appendChild(opt);
    });
    templateEl.value = 'classic';
  } catch (err) {
    setStatus('Could not load templates: ' + err.message, 'err');
  }
}

async function loadMode() {
  try {
    const res = await fetch('/v1/health');
    const data = await res.json();
    const mode = data.auth_required ? 'API key required' : 'Open public mode';
    $('mode-badge').textContent = 'v' + data.version + ' · ' + mode;
    $('footer-mode').textContent = mode;
  } catch (err) {
    $('mode-badge').textContent = 'API unreachable';
  }
}

$('btn-pdf').addEventListener('click', async () => {
  const payload = readPayload();
  if (!payload) return;
  setStatus('Generating PDF…');
  try {
    const res = await fetch('/v1/resumes/pdf?template=' + encodeURIComponent(templateEl.value), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus('Failed: ' + JSON.stringify(body.error || res.status), 'err');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = String(payload.fullName || 'Resume').replace(/\s+/g, '_') + '_Resume.pdf';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('PDF generated (' + Math.round(blob.size / 1024) + ' KB).', 'ok');
  } catch (err) {
    setStatus('Request failed: ' + err.message, 'err');
  }
});

$('btn-preview').addEventListener('click', async () => {
  const payload = readPayload();
  if (!payload) return;
  setStatus('Rendering preview…');
  try {
    const res = await fetch('/v1/resumes/preview?full=1&template=' + encodeURIComponent(templateEl.value), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus('Failed: ' + JSON.stringify(body.error || res.status), 'err');
      return;
    }
    previewEl.srcdoc = await res.text();
    setStatus('Preview updated.', 'ok');
  } catch (err) {
    setStatus('Request failed: ' + err.message, 'err');
  }
});

$('btn-validate').addEventListener('click', async () => {
  const payload = readPayload();
  if (!payload) return;
  setStatus('Validating…');
  try {
    const res = await fetch('/v1/validate?template=' + encodeURIComponent(templateEl.value), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      const warn = data.warnings.length ? ' Warnings: ' + data.warnings.join(' ') : '';
      setStatus('Valid.' + warn, 'ok');
    } else {
      setStatus('Errors: ' + data.errors.map((e) => e.field + ' — ' + e.message).join(' | '), 'err');
    }
  } catch (err) {
    setStatus('Request failed: ' + err.message, 'err');
  }
});

loadTemplates();
loadMode();
