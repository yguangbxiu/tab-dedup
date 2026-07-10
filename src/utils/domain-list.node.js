function normalizeDomainEntry(entry) {
  const trimmed = entry.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  let candidate = trimmed;
  if (candidate.startsWith('//')) {
    candidate = 'https:' + candidate;
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    candidate = 'https://' + candidate;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname;
    }
  } catch {
    // fall through
  }

  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
}

function parseDomainList(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  return text
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((entry) => normalizeDomainEntry(entry))
    .filter(Boolean);
}

function hostnameMatchesList(hostname, list) {
  const host = hostname.toLowerCase();
  return list.some((entry) => host === entry || host.endsWith('.' + entry));
}

function shouldSkipByDomain(hostname, whitelist, blacklist) {
  const whitelistEntries = parseDomainList(whitelist);
  const blacklistEntries = parseDomainList(blacklist);

  if (whitelistEntries.length > 0 && !hostnameMatchesList(hostname, whitelistEntries)) {
    return true;
  }

  if (blacklistEntries.length > 0 && hostnameMatchesList(hostname, blacklistEntries)) {
    return true;
  }

  return false;
}

function shouldAutoGroupByDomain(hostname, autoGroupDomains) {
  const entries = parseDomainList(autoGroupDomains);
  if (entries.length === 0) {
    return false;
  }

  return hostnameMatchesList(hostname, entries);
}

const MIN_TAB_LIMIT = 1;
const MAX_TAB_LIMIT = 20;

function clampTabLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) {
    return null;
  }
  const rounded = Math.round(limit);
  if (rounded < MIN_TAB_LIMIT || rounded > MAX_TAB_LIMIT) {
    return null;
  }
  return rounded;
}

function parseDomainTabLimits(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const entries = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const commaIndex = trimmed.lastIndexOf(',');
    if (commaIndex <= 0) {
      continue;
    }

    const domainPart = trimmed.slice(0, commaIndex).trim();
    const limitPart = trimmed.slice(commaIndex + 1).trim();
    const hostname = normalizeDomainEntry(domainPart);
    const limit = clampTabLimit(limitPart);

    if (!hostname || limit === null) {
      continue;
    }

    entries.push({ hostname, limit });
  }

  return entries;
}

function getPerDomainTabLimit(hostname, domainTabLimits) {
  const entries = parseDomainTabLimits(domainTabLimits);
  if (entries.length === 0) {
    return null;
  }

  const host = hostname.toLowerCase();
  let bestMatch = null;

  for (const entry of entries) {
    if (host !== entry.hostname && !host.endsWith('.' + entry.hostname)) {
      continue;
    }

    if (!bestMatch || entry.hostname.length > bestMatch.hostname.length) {
      bestMatch = entry;
    }
  }

  return bestMatch ? bestMatch.limit : null;
}

function getSameSiteTabLimitForHostname(hostname, settings) {
  const perDomain = getPerDomainTabLimit(hostname, settings.domainTabLimits);
  if (perDomain !== null) {
    return perDomain;
  }

  return settings.sameSiteTabLimit;
}

function getBulkScanTabLimitForHostname(hostname, settings) {
  const perDomain = getPerDomainTabLimit(hostname, settings.domainTabLimits);
  if (perDomain !== null) {
    return perDomain;
  }

  return 1;
}

module.exports = {
  normalizeDomainEntry,
  parseDomainList,
  hostnameMatchesList,
  shouldSkipByDomain,
  shouldAutoGroupByDomain,
  parseDomainTabLimits,
  getPerDomainTabLimit,
  getSameSiteTabLimitForHostname,
  getBulkScanTabLimitForHostname
};
