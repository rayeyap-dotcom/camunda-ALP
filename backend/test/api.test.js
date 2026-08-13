const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('../src/server');

const PORT = 3100;
let server;

async function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: 'localhost', port: PORT, path, headers: { Accept: 'application/json' } }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        const data = raw ? JSON.parse(raw) : null;
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
  });
}

test.before(async () => {
  server = startServer(PORT);
  server.on('error', (error) => {
    throw error;
  });
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('GET /api/test returns ok status', async () => {
  const response = await fetchJson('/api/test');
  assert.equal(response.status, 200);
  assert.equal(response.data.ok, true);
});

test('GET /api/collection/:id/dashboards returns an array', async () => {
  const response = await fetchJson('/api/collection/demo-collection/dashboards');
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.data));
});
