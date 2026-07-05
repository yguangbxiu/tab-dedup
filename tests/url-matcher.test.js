const assert = require('assert');
const { normalizeUrl, urlsMatch } = require('../src/utils/url-matcher.node.js');

assert.strictEqual(
  urlsMatch(
    'https://platform.ai.qingyao.link/application/index',
    'https://platform.ai.qingyao.link/2',
    'domainOnly'
  ),
  true
);
assert.strictEqual(
  urlsMatch(
    'https://platform.ai.qingyao.link/',
    'https://platform.ai.qingyao.link/login',
    'domainOnly'
  ),
  true
);
assert.strictEqual(
  urlsMatch('https://platform.ai.qingyao.link', 'https://platform.ai.qingyao.link/', 'domainOnly'),
  true
);
assert.strictEqual(
  urlsMatch('https://example.com/page', 'https://other.com/page', 'domainOnly'),
  false
);
assert.strictEqual(
  urlsMatch('https://example.com/a#one', 'https://example.com/a#two', 'ignoreHash'),
  true
);
assert.strictEqual(
  urlsMatch('https://example.com/a?q=1', 'https://example.com/a?q=2', 'ignoreQueryHash'),
  true
);
assert.strictEqual(
  urlsMatch('https://example.com/path/', 'https://example.com/path', 'strict'),
  true
);
assert.strictEqual(normalizeUrl('not-a-url', 'strict'), null);
assert.strictEqual(
  urlsMatch('https://example.com', 'https://other.com', 'ignoreHash'),
  false
);

console.log('url-matcher.test.js: all passed');