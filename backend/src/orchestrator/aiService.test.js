const test = require('node:test');
const assert = require('node:assert/strict');

const { generateCandidateTests, discoverTests } = require('./aiService');

test('generateCandidateTests returns valid fallback candidates without external AI', async () => {
  const items = generateCandidateTests({ targetUrl: 'https://example.com/products', limit: 5 });

  assert.ok(Array.isArray(items));
  assert.ok(items.length > 0);
  assert.ok(items.length <= 5);
  assert.ok(items.every((item) => item && item.title && item.description));
  assert.ok(items.some((item) => /product|catalog|search|shop/i.test(item.title + ' ' + item.description)));
});

test('discoverTests matches the app contract expected by the route', async () => {
  const items = await discoverTests({ targetUrl: 'https://example.com', limit: 3 });

  assert.ok(Array.isArray(items));
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.type === 'browser'));
  assert.ok(items.every((item) => item.title && item.description));
});
