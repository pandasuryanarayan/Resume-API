'use strict';

/**
 * Express application: routes, docs and the OpenAPI description.
 *
 * Routes
 *   GET  /                     API docs + live playground
 *   GET  /v1                   route index
 *   GET  /v1/health            liveness probe
 *   GET  /v1/templates         template catalogue
 *   GET  /v1/schema            JSON Schema of the resume payload
 *   GET  /v1/openapi.json      OpenAPI 3.0 description
 *   POST /v1/validate          normalise + validate a payload, no rendering
 *   POST /v1/resumes/preview   HTML preview of the resume
 *   POST /v1/resumes/pdf       the PDF itself
 */

const path = require('path');
const express = require('express');
const config = require('./config');
const { listTemplates, renderPdf, renderPreview } = require('./resume-engine');
const { normalise, extractPayload, schema } = require('./validate');
const { requestId, cors, apiKey, rateLimit, notFound, errorHandler } = require('./middleware');

const ROOT = path.join(__dirname, '..');

function slug(value) {
  return (
    String(value || 'Resume')
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'Resume'
  );
}

function wantsBase64(req) {
  const format = String(req.query.format || '').toLowerCase();
  if (format === 'base64' || format === 'json') return true;
  if (format === 'pdf' || req.query.download) return false;
  const accept = String(req.get('accept') || '');
  return accept.includes('application/json') && !accept.includes('*/*');
}

function fail(req, res, status, code, message, details) {
  return res.status(status).json({
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
    request_id: req.id,
  });
}

function createApp() {
  const app = express();

  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(cors);
  app.use(express.json({ limit: config.maxBody }));

  // ---- Docs ----
  app.use(express.static(path.join(ROOT, 'public'), { index: false, maxAge: '1h' }));
  app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

  const api = express.Router();
  api.use(rateLimit);
  api.use(apiKey);

  api.get('/', (req, res) => {
    res.json({
      ok: true,
      service: 'Resume Builder API',
      version: config.version,
      auth_required: config.authRequired,
      docs: '/',
      routes: [
        'GET  /v1/health',
        'GET  /v1/templates',
        'GET  /v1/schema',
        'GET  /v1/openapi.json',
        'POST /v1/validate',
        'POST /v1/resumes/preview',
        'POST /v1/resumes/pdf',
      ],
    });
  });

  api.get('/health', (req, res) => {
    res.json({
      ok: true,
      status: 'healthy',
      version: config.version,
      uptime_seconds: Math.round(process.uptime()),
      auth_required: config.authRequired,
    });
  });

  api.get('/templates', (req, res) => {
    const templates = listTemplates();
    res.json({ ok: true, count: templates.length, templates });
  });

  api.get('/schema', (req, res) => res.json(schema()));

  api.get('/openapi.json', (req, res) => res.json(openapiDocument()));

  api.post('/validate', (req, res) => {
    const { raw, template } = extractPayload(req.body, req.query, req.headers);
    const result = normalise(raw, template);
    const status = result.errors.length ? 422 : 200;
    res.status(status).json({
      ok: result.errors.length === 0,
      template: result.template,
      errors: result.errors,
      warnings: result.warnings,
      resume: result.resume,
      request_id: req.id,
    });
  });

  api.post('/resumes/preview', (req, res) => {
    const { raw, template } = extractPayload(req.body, req.query, req.headers);
    const result = normalise(raw, template);
    if (result.errors.length) {
      return fail(req, res, 422, 'invalid_payload', 'The resume payload has errors.', result.errors);
    }

    const full = req.query.full === '1' || req.query.full === 'true';
    const preview = renderPreview(result.resume, result.template, { full });

    if (full || String(req.get('accept') || '').includes('text/html')) {
      res.type('html').send(preview.html);
      return undefined;
    }

    return res.json({
      ok: true,
      template: preview.template,
      template_name: preview.templateName,
      warnings: result.warnings,
      html: preview.html,
      request_id: req.id,
    });
  });

  api.post('/resumes/pdf', (req, res) => {
    const { raw, template } = extractPayload(req.body, req.query, req.headers);
    const result = normalise(raw, template);
    if (result.errors.length) {
      return fail(req, res, 422, 'invalid_payload', 'The resume payload has errors.', result.errors);
    }

    let output;
    try {
      output = renderPdf(result.resume, result.template);
    } catch (err) {
      err.status = 500;
      return errorHandler(err, req, res);
    }

    const filename = `${slug(result.resume.fullName)}_Resume.pdf`;

    if (wantsBase64(req)) {
      return res.json({
        ok: true,
        template: output.template,
        template_name: output.templateName,
        pages: output.pages,
        bytes: output.buffer.length,
        filename,
        warnings: result.warnings,
        pdf_base64: output.buffer.toString('base64'),
        request_id: req.id,
      });
    }

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('X-Template', output.template);
    res.set('X-Pages', String(output.pages));
    res.set('Content-Length', String(output.buffer.length));
    return res.send(output.buffer);
  });

  app.use('/v1', api);
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

function openapiDocument() {
  const templateIds = listTemplates().map((t) => t.id);
  const resumeExample = {
    fullName: 'Suryanarayan Panda',
    email: 'psuryanarayan94@gmail.com',
    phone: '9876543210',
    address: 'Bhubaneswar, Odisha - 751024',
    linkedin: 'linkedin.com/in/suryanarayan',
    github: 'github.com/pandasuryanarayan',
    languages: 'English, Hindi, Odia',
    summary: 'Backend engineer building APIs and data pipelines.',
    qualifications: [
      { degree: 'B.Tech Computer Science', university: 'IIT Bhubaneswar', year: '2019', score: '8.4 CGPA' },
    ],
    workExperience: '- Software Engineer at ABC Tech (2022-Present): Built REST APIs.',
    projects: '- Resume Builder API: Node.js connector for PDF generation.',
    skills: 'Node.js, Python, PostgreSQL, Docker',
    certifications: '- AWS Solutions Architect',
    actHob: 'Cricket, Chess',
    template: 'classic',
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'Resume Builder API',
      version: config.version,
      description:
        'Send resume data as JSON, receive a print-ready A4 PDF rendered by the same templates the Resume Builder website uses.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        Resume: schema(),
        Error: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'invalid_payload' },
                message: { type: 'string' },
                details: { type: 'array', items: { type: 'object' } },
              },
            },
            request_id: { type: 'string' },
          },
        },
      },
    },
    security: config.authRequired ? [{ ApiKeyAuth: [] }] : [],
    paths: {
      '/v1/health': { get: { summary: 'Liveness probe', responses: { 200: { description: 'Healthy' } } } },
      '/v1/templates': {
        get: {
          summary: 'List templates',
          responses: { 200: { description: `Available ids: ${templateIds.join(', ')}` } },
        },
      },
      '/v1/schema': { get: { summary: 'JSON Schema of the resume payload', responses: { 200: { description: 'Schema' } } } },
      '/v1/validate': {
        post: {
          summary: 'Validate and normalise a payload without rendering',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Resume' }, example: resumeExample } },
          },
          responses: {
            200: { description: 'Valid; returns the normalised resume' },
            422: { description: 'Invalid', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/v1/resumes/preview': {
        post: {
          summary: 'HTML preview of the resume',
          parameters: [
            { name: 'template', in: 'query', schema: { type: 'string', enum: templateIds } },
            { name: 'full', in: 'query', schema: { type: 'boolean' }, description: 'Wrap in a full HTML document with the site stylesheet.' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Resume' }, example: resumeExample } },
          },
          responses: { 200: { description: 'HTML fragment or full document' }, 422: { description: 'Invalid payload' } },
        },
      },
      '/v1/resumes/pdf': {
        post: {
          summary: 'Generate the resume PDF',
          parameters: [
            { name: 'template', in: 'query', schema: { type: 'string', enum: templateIds } },
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['pdf', 'base64'] } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Resume' }, example: resumeExample } },
          },
          responses: {
            200: {
              description: 'PDF bytes, or JSON with pdf_base64 when format=base64',
              content: {
                'application/pdf': { schema: { type: 'string', format: 'binary' } },
                'application/json': { schema: { type: 'object' } },
              },
            },
            422: { description: 'Invalid payload' },
          },
        },
      },
    },
  };
}

module.exports = { createApp, openapiDocument };
