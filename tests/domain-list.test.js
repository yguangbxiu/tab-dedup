const assert = require('assert');
const pkg = require('../src/utils/domain-list.node.js');

assert.deepStrictEqual(pkg.parseDomainList('GitHub.com, docs.google.com'), [
  'github.com',
  'docs.google.com'
]);
assert.strictEqual(pkg.hostnameMatchesList('api.github.com', ['github.com']), true);

// URL format normalization
assert.strictEqual(pkg.normalizeDomainEntry('github.com'), 'github.com');
assert.strictEqual(pkg.normalizeDomainEntry('https://github.com/repo'), 'github.com');
assert.strictEqual(pkg.normalizeDomainEntry('http://docs.google.com/a/b'), 'docs.google.com');
assert.strictEqual(pkg.normalizeDomainEntry('https://github.com?x=1'), 'github.com');
assert.strictEqual(pkg.normalizeDomainEntry('https://github.com#top'), 'github.com');
assert.strictEqual(pkg.normalizeDomainEntry('http://192.168.1.1:8080/'), '192.168.1.1');
assert.strictEqual(pkg.normalizeDomainEntry('localhost:3000'), 'localhost');
assert.strictEqual(pkg.normalizeDomainEntry('//stackoverflow.com/questions'), 'stackoverflow.com');
assert.strictEqual(pkg.normalizeDomainEntry('HTTPS://GitHub.COM/Path'), 'github.com');
assert.strictEqual(pkg.normalizeDomainEntry('not a domain!!!'), 'not a domain!!!');

assert.deepStrictEqual(
  pkg.parseDomainList('https://github.com, docs.google.com\nhttps://example.com/path'),
  ['github.com', 'docs.google.com', 'example.com']
);

assert.strictEqual(
  pkg.shouldSkipByDomain('github.com', 'https://github.com/issues?q=1', ''),
  false
);
assert.strictEqual(
  pkg.shouldSkipByDomain('github.com', '', 'http://github.com/any/path'),
  true
);
assert.strictEqual(
  pkg.shouldAutoGroupByDomain('stackoverflow.com', 'http://stackoverflow.com'),
  true
);

// No lists: detect all
assert.strictEqual(pkg.shouldSkipByDomain('example.com', '', ''), false);

// Whitelist only
assert.strictEqual(pkg.shouldSkipByDomain('example.com', 'example.com', ''), false);
assert.strictEqual(pkg.shouldSkipByDomain('other.com', 'example.com', ''), true);
assert.strictEqual(pkg.shouldSkipByDomain('api.example.com', 'example.com', ''), false);

// Blacklist only
assert.strictEqual(pkg.shouldSkipByDomain('example.com', '', 'example.com'), true);
assert.strictEqual(pkg.shouldSkipByDomain('other.com', '', 'example.com'), false);
assert.strictEqual(pkg.shouldSkipByDomain('api.example.com', '', 'example.com'), true);

// Both lists: must be in whitelist and not in blacklist
assert.strictEqual(
  pkg.shouldSkipByDomain('github.com', 'github.com\ngoogle.com', 'google.com'),
  false
);
assert.strictEqual(
  pkg.shouldSkipByDomain('google.com', 'github.com\ngoogle.com', 'google.com'),
  true
);
assert.strictEqual(
  pkg.shouldSkipByDomain('other.com', 'github.com\ngoogle.com', 'google.com'),
  true
);

// Auto-group domains
assert.strictEqual(pkg.shouldAutoGroupByDomain('github.com', ''), false);
assert.strictEqual(pkg.shouldAutoGroupByDomain('github.com', 'github.com'), true);
assert.strictEqual(pkg.shouldAutoGroupByDomain('api.github.com', 'github.com'), true);
assert.strictEqual(pkg.shouldAutoGroupByDomain('other.com', 'github.com'), false);
assert.strictEqual(pkg.shouldAutoGroupByDomain('github.com', 'GitHub.com, stackoverflow.com'), true);

// Per-domain tab limits
assert.deepStrictEqual(pkg.parseDomainTabLimits('https://alidocs.dingtalk.com/,3'), [
  { hostname: 'alidocs.dingtalk.com', limit: 3 }
]);
assert.deepStrictEqual(pkg.parseDomainTabLimits('github.com, 5\n\ninvalid\nbad,0'), [
  { hostname: 'github.com', limit: 5 }
]);
assert.strictEqual(pkg.getPerDomainTabLimit('api.github.com', 'github.com,2'), 2);
assert.strictEqual(
  pkg.getPerDomainTabLimit('api.github.com', 'github.com,2\napi.github.com,5'),
  5
);
assert.strictEqual(pkg.getPerDomainTabLimit('other.com', 'github.com,2'), null);

const navSettings = { sameSiteTabLimit: 1, domainTabLimits: 'github.com,3' };
assert.strictEqual(pkg.getSameSiteTabLimitForHostname('github.com', navSettings), 3);
assert.strictEqual(pkg.getSameSiteTabLimitForHostname('other.com', navSettings), 1);

const bulkSettings = { sameSiteTabLimit: 5, domainTabLimits: 'github.com,3' };
assert.strictEqual(pkg.getBulkScanTabLimitForHostname('github.com', bulkSettings), 3);
assert.strictEqual(pkg.getBulkScanTabLimitForHostname('other.com', bulkSettings), 1);

console.log('domain-list.test.js: all passed');
