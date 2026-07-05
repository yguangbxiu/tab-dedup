function normalizeUrl(url, mode) {
  try {
    const parsed = new URL(url);

    if (mode === 'domainOnly') {
      return parsed.hostname;
    }

    if (mode === 'ignoreHash') {
      parsed.hash = '';
    } else if (mode === 'ignoreQueryHash') {
      parsed.search = '';
      parsed.hash = '';
    }

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.href;
  } catch {
    return null;
  }
}

function urlsMatch(urlA, urlB, mode) {
  const normalizedA = normalizeUrl(urlA, mode);
  const normalizedB = normalizeUrl(urlB, mode);

  return normalizedA !== null && normalizedB !== null && normalizedA === normalizedB;
}

module.exports = {
  normalizeUrl,
  urlsMatch
};
