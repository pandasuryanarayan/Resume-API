'use strict';

/**
 * End-to-end smoke tests against a real HTTP listener.
 * Run with: npm test
 *
 * Uses node:http rather than global fetch so the suite runs on any Node 18+
 * build (some sandboxes ship an undici that cannot allocate its WASM parser).
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createApp } = require('../src/app');
const { listTemplates } = require('../src/resume-engine');

let server;
let port;

test.before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

const SAMPLE = {
  fullName: 'Asha Rao',
  email: 'asha.rao@example.com',
  phone: '9876543210',
  address: 'Pune, Maharashtra',
  languages: 'English, Hindi, Marathi',
  summary: 'Data engineer with a bias for boring, reliable pipelines.',
  qualifications: [
    { degree: 'B.E. Information Technology', university: 'COEP Pune', year: '2020', score: '8.1 CGPA' },
  ],
  workExperience: '- Data Engineer at Acme (2021-Present): Built batch and streaming pipelines.',
  projects: '- Ledger API: double-entry accounting service.',
  skills: 'Python, SQL, Airflow, dbt',
  certifications: '- Google Cloud Professional Data Engineer',
  actHob: 'Cycling',
};

function request(method, path, options = {}) {
  const body =
    options.body === undefined
      ? null
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body);

  const headers = Object.assign({}, options.headers);
  if (body !== null) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer,
          text,
          json: () => JSON.parse(text),
        });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

const get = (path, options) => request('GET', path, options);
const post = (path, body, options = {}) => request('POST', path, Object.assign({ body }, options));

test('health reports healthy', async () => {
  const res = await get('/v1/health');
  assert.strictEqual(res.status, 200);
  const body = res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.status, 'healthy');
});

test('templates lists every template', async () => {
  const res = await get('/v1/templates');
  const body = res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.count, listTemplates().length);
  assert.ok(body.templates.some((t) => t.id === 'classic'));
});

test('schema is a JSON Schema object', async () => {
  const res = await get('/v1/schema');
  const body = res.json();
  assert.strictEqual(body.type, 'object');
  assert.deepStrictEqual(body.required, ['fullName', 'email']);
});

test('openapi document is served', async () => {
  const res = await get('/v1/openapi.json');
  const body = res.json();
  assert.strictEqual(body.openapi, '3.0.3');
  assert.ok(body.paths['/v1/resumes/pdf']);
});

test('validate accepts a good payload and warns about junk fields', async () => {
  const res = await post('/v1/validate', Object.assign({ nonsense: true }, SAMPLE));
  const body = res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.ok, true);
  assert.ok(body.warnings.some((w) => w.includes('nonsense')));
});

test('validate rejects a payload with no name or email', async () => {
  const res = await post('/v1/validate', { phone: '123' });
  const body = res.json();
  assert.strictEqual(res.status, 422);
  assert.strictEqual(body.ok, false);
  const fields = body.errors.map((e) => e.field);
  assert.ok(fields.includes('fullName'));
  assert.ok(fields.includes('email'));
});

test('pdf endpoint returns real PDF bytes for every template', async () => {
  const templates = listTemplates();
  for (const tpl of templates) {
    const res = await post(`/v1/resumes/pdf?template=${tpl.id}`, SAMPLE);
    assert.strictEqual(res.status, 200, `template ${tpl.id} failed`);
    assert.match(res.headers['content-type'], /application\/pdf/);
    assert.strictEqual(res.buffer.subarray(0, 5).toString(), '%PDF-', `template ${tpl.id} is not a PDF`);
    assert.ok(res.buffer.length > 2000, `template ${tpl.id} produced a suspiciously small file`);
    assert.strictEqual(res.headers['x-template'], tpl.id);
    assert.match(res.headers['content-disposition'], /Asha_Rao_Resume\.pdf/);
  }
});

test('pdf endpoint honours format=base64', async () => {
  const res = await post('/v1/resumes/pdf?format=base64', SAMPLE);
  const body = res.json();
  assert.strictEqual(body.ok, true);
  assert.ok(body.pages >= 1);
  assert.strictEqual(Buffer.from(body.pdf_base64, 'base64').subarray(0, 5).toString(), '%PDF-');
  assert.match(body.filename, /_Resume\.pdf$/);
});

test('pdf endpoint rejects an unknown template', async () => {
  const res = await post('/v1/resumes/pdf?template=does-not-exist', SAMPLE);
  const body = res.json();
  assert.strictEqual(res.status, 422);
  assert.strictEqual(body.error.code, 'invalid_payload');
  assert.ok(body.error.details.some((d) => d.field === 'template'));
});

test('preview returns an html fragment and a full document', async () => {
  const fragment = await post('/v1/resumes/preview', SAMPLE);
  assert.ok(fragment.json().html.includes('tpl'));

  const full = await post('/v1/resumes/preview?full=1', SAMPLE);
  assert.match(full.headers['content-type'], /text\/html/);
  assert.match(full.text, /<!DOCTYPE html>/);
  assert.match(full.text, /\.tpl-classic/);
});

test('aliases are mapped onto canonical fields', async () => {
  const res = await post('/v1/resumes/pdf?format=base64', {
    name: 'Ravi Kumar',
    mail: 'ravi@example.com',
    objective: 'Frontend developer.',
    education: [{ degree: 'B.Sc', institute: 'Fergusson College', year: '2021' }],
    skills: ['React', 'TypeScript'],
  });
  const body = res.json();
  assert.strictEqual(res.status, 200);
  assert.ok(body.pdf_base64.length > 0);
});

test('malformed JSON is reported as invalid_json', async () => {
  const res = await post('/v1/resumes/pdf', '{not json');
  const body = res.json();
  assert.strictEqual(res.status, 400);
  assert.strictEqual(body.error.code, 'invalid_json');
});

test('unknown route returns a json 404', async () => {
  const res = await get('/v1/nope');
  const body = res.json();
  assert.strictEqual(res.status, 404);
  assert.strictEqual(body.error.code, 'not_found');
});

test('cors headers are present', async () => {
  const res = await get('/v1/health', { headers: { Origin: 'https://example.com' } });
  assert.strictEqual(res.headers['access-control-allow-origin'], '*');
});

test('rate limit headers are exposed', async () => {
  const res = await get('/v1/health');
  assert.ok(res.headers['x-ratelimit-limit']);
  assert.ok(res.headers['x-ratelimit-remaining'] !== undefined);
});

test('docs page and its assets are served', async () => {
  const docs = await get('/');
  assert.strictEqual(docs.status, 200);
  assert.match(docs.text, /Resume Builder API/);

  const css = await get('/docs.css');
  assert.strictEqual(css.status, 200);

  const js = await get('/docs.js');
  assert.strictEqual(js.status, 200);
});
