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

assert.strictEqual(
  urlsMatch(
    'http://192.168.20.50:30847/xxxx',
    'http://192.168.20.50:30848/yyyy',
    'domainOnly'
  ),
  false
);
assert.strictEqual(
  urlsMatch(
    'http://192.168.20.50:30847/a',
    'http://192.168.20.50:30847/b',
    'domainOnly'
  ),
  true
);
assert.strictEqual(
  urlsMatch('http://example.com:8080/a', 'http://example.com:9090/b', 'domainOnly'),
  true
);
assert.strictEqual(
  urlsMatch('http://localhost:3000/a', 'http://localhost:4000/b', 'domainOnly'),
  false
);
assert.strictEqual(
  urlsMatch('http://[::1]:8080/a', 'http://[::1]:8081/b', 'domainOnly'),
  false
);
assert.strictEqual(
  normalizeUrl('http://192.168.20.50:30847/xxxx', 'domainOnly'),
  '192.168.20.50:30847'
);
assert.strictEqual(normalizeUrl('https://example.com:8080/page', 'domainOnly'), 'example.com');

const { isEmptyTabUrl } = require('../src/utils/url-matcher.node.js');

assert.strictEqual(isEmptyTabUrl(''), true);
assert.strictEqual(isEmptyTabUrl('about:blank'), true);
assert.strictEqual(isEmptyTabUrl('chrome://newtab/'), true);
assert.strictEqual(isEmptyTabUrl('chrome://new-tab-page/'), true);
assert.strictEqual(isEmptyTabUrl('chrome-untrusted://new-tab-page/'), true);
assert.strictEqual(isEmptyTabUrl('edge://newtab/'), true);
assert.strictEqual(isEmptyTabUrl('https://example.com'), false);

console.log('url-matcher.test.js: all passed');