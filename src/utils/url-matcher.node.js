function isEmptyTabUrl(url) {
  if (!url) {
    return true;
  }

  if (url === 'about:blank') {
    return true;
  }

  const lower = url.toLowerCase();
  return (
    lower.startsWith('chrome://newtab') ||
    lower.startsWith('chrome://new-tab-page') ||
    lower.startsWith('edge://newtab') ||
    lower.startsWith('edge://new-tab-page') ||
    lower.startsWith('chrome-untrusted://new-tab-page') ||
    lower.startsWith('chrome-untrusted://newtab') ||
    lower.startsWith('about:newtab')
  );
}

function shouldUseHostKey(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost') {
    return true;
  }
  if (h.startsWith('[')) {
    return true;
  }
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(h);
}

function getDomainOnlyKey(parsed) {
  if (shouldUseHostKey(parsed.hostname)) {
    return parsed.host;
  }
  return parsed.hostname;
}

function normalizeUrl(url, mode) {
  try {
    const parsed = new URL(url);

    if (mode === 'domainOnly') {
      return getDomainOnlyKey(parsed);
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
  isEmptyTabUrl,
  normalizeUrl,
  urlsMatch
};
