const assert = require('assert');
const pkg = require('../src/utils/domain-list.node.js');
assert.deepStrictEqual(pkg.parseDomainList('GitHub.com, docs.google.com'), ['github.com','docs.google.com']);
assert.strictEqual(pkg.hostnameMatchesList('api.github.com', ['github.com']), true);
assert.strictEqual(pkg.shouldSkipByDomain('example.com', '', ''), false);
assert.strictEqual(pkg.shouldSkipByDomain('other.com', 'example.com', ''), true);
console.log('domain-list.test.js: all passed');