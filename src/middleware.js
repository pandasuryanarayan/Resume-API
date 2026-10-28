'use strict';

/**
 * Cross-cutting middleware: request id, CORS, API key auth, per-IP rate limit
 * and a single JSON error shape for every failure.
 */

const crypto = require('crypto');
const config = require('./config');

function requestId(req, res, next) {
  req.id = req.get('x-request-id') || crypto.randomBytes(8).toString('hex');
  res.set('X-Request-Id', req.id);
  next();
}

function cors(req, res, next) {
  const origin = req.get('origin');
  const allowAny = config.corsOrigins.includes('*');
  const allowed = allowAny || !origin || config.corsOrigins.includes(origin);

  if (origin && allowed) {
    res.set('Access-Control-Allow-Origin', allowAny ? '*' : origin);
    res.set('Vary', 'Origin');
  } else if (allowAny) {
    res.set('Access-Control-Allow-Origin', '*');
  }

  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Template, X-Request-Id');
  res.set('Access-Control-Expose-Headers', 'X-Request-Id, Content-Disposition, X-Template, X-Pages');
  res.set('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
}

function apiKey(req, res, next) {
  if (!config.authRequired) return next();

  const header = req.get('x-api-key');
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const supplied = (header || bearer || '').trim();

  if (!supplied) {
    return res.status(401).json({
      ok: false,
      error: {
        code: 'missing_api_key',
        message: 'This API requires a key. Send it as the X-API-Key header (or Authorization: Bearer <key>).',
      },
      request_id: req.id,
    });
  }

  if (!config.apiKeys.includes(supplied)) {
    return res.status(403).json({
      ok: false,
      error: { code: 'invalid_api_key', message: 'The supplied API key is not recognised.' },
      request_id: req.id,
    });
  }

  return next();
}

const buckets = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + config.rateWindowMs };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  const remaining = Math.max(0, config.rateMax - bucket.count);
  res.set('X-RateLimit-Limit', String(config.rateMax));
  res.set('X-RateLimit-Remaining', String(remaining));
  res.set('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > config.rateMax) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      ok: false,
      error: {
        code: 'rate_limited',
        message: `Too many requests. Try again in ${retryAfter}s or contact the operator for a higher limit.`,
      },
      request_id: req.id,
    });
  }

  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }

  return next();
}

function notFound(req, res) {
  res.status(404).json({
    ok: false,
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}. See GET /v1 for the API index.` },
    request_id: req.id,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      ok: false,
      error: { code: 'invalid_json', message: 'Request body is not valid JSON.' },
      request_id: req.id,
    });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      ok: false,
      error: { code: 'payload_too_large', message: `Request body exceeds the ${config.maxBody} limit.` },
      request_id: req.id,
    });
  }

  const status = err && err.status ? err.status : 500;
  if (status >= 500) console.error(`[${req.id}]`, err);

  return res.status(status).json({
    ok: false,
    error: {
      code: (err && err.code) || 'internal_error',
      message: status >= 500 ? 'Something went wrong while generating the document.' : String(err && err.message),
    },
    request_id: req.id,
  });
}

module.exports = { requestId, cors, apiKey, rateLimit, notFound, errorHandler };
