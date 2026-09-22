const test = require('node:test');
const assert = require('node:assert/strict');

const { generateCandidateTests, discoverTests, discoveryRouteKey } = require('./aiService');

test('discoveryRouteKey generically collapses repeated dynamic route templates', () => {
  const catalogUrls = [
    'https://example.com/inventory/items/1',
    'https://example.com/inventory/items/2',
    'https://example.com/inventory/items/3'
  ];
  assert.equal(
    discoveryRouteKey(catalogUrls[0], catalogUrls),
    discoveryRouteKey(catalogUrls[2], catalogUrls)
  );

  const tenantUrls = [
    'https://example.com/tenant/acme',
    'https://example.com/tenant/globex',
    'https://example.com/tenant/initech'
  ];
  assert.equal(
    discoveryRouteKey(tenantUrls[0], tenantUrls),
    discoveryRouteKey(tenantUrls[1], tenantUrls)
  );
  assert.notEqual(
    discoveryRouteKey('https://example.com/account/login'),
    discoveryRouteKey('https://example.com/account/settings')
  );
});

test('generateCandidateTests returns valid fallback candidates without external AI', async () => {
  const items = generateCandidateTests({ targetUrl: 'https://example.com/products', limit: 5 });

  assert.ok(Array.isArray(items));
  assert.ok(items.length > 0);
  assert.ok(items.length <= 5);
  assert.ok(items.every((item) => item && item.title && item.description));
  assert.ok(items.some((item) => /product|catalog|search|shop/i.test(item.title + ' ' + item.description)));
});

test('discoverTests matches the app contract expected by the route', async () => {
  const pages = [
    { url: 'https://example.com/', title: 'Home', text: 'Home', links: [], controls: [] },
    { url: 'https://example.com/contact', title: 'Contact', text: 'Contact', links: [], controls: [] }
  ];
  const items = await discoverTests({ targetUrl: 'https://example.com', pages });

  assert.ok(Array.isArray(items));
  assert.equal(items.length, pages.length);
  assert.ok(items.every((item) => item.type === 'browser'));
  assert.ok(items.every((item) => item.title && item.description));
  assert.deepEqual(items.map((item) => item.targetUrl), pages.map((page) => page.url));
});

test('discoverTests adds positive and negative coverage for observed forms', async () => {
  const pages = [{
    url: 'https://example.com/contact',
    title: 'Contact',
    text: 'Contact us',
    links: [],
    controls: [
      { tag: 'input', type: 'email', id: 'email', name: 'email', required: true, formId: 'contact', formAction: '/contact', label: 'Email' },
      { tag: 'textarea', type: '', id: 'message', name: 'message', required: true, formId: 'contact', formAction: '/contact', label: 'Message' },
      { tag: 'button', type: 'submit', id: '', name: '', required: false, formId: 'contact', formAction: '/contact', label: 'Send' }
    ]
  }];

  const items = await discoverTests({ targetUrl: 'https://example.com', pages });

  assert.ok(items.some((item) => /valid submission/i.test(item.title)));
  assert.ok(items.some((item) => /required-field validation/i.test(item.title)));
  assert.ok(items.some((item) => /invalid email/i.test(item.title)));
});
