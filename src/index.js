'use strict';

const config = require('./config');
const { createApp } = require('./app');
const { listTemplates } = require('./resume-engine');

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  const templates = listTemplates();
  console.log(`Resume Builder API v${config.version} listening on http://${config.host}:${config.port}`);
  console.log(`  docs       http://localhost:${config.port}/`);
  console.log(`  auth       ${config.authRequired ? 'API key required' : 'open public mode'}`);
  console.log(`  templates  ${templates.length} (${templates.map((t) => t.id).join(', ')})`);
});

function shutdown(signal) {
  console.log(`\n${signal} received, closing server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server };
