function parseDomainList(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  return text
    .split(/[\n,]+/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => entry.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
}

function hostnameMatchesList(hostname, list) {
  const host = hostname.toLowerCase();
  return list.some((entry) => host === entry || host.endsWith('.' + entry));
}

function shouldSkipByDomain(hostname, whitelist, blacklist) {
  const whitelistEntries = parseDomainList(whitelist);
  const blacklistEntries = parseDomainList(blacklist);

  if (whitelistEntries.length > 0) {
    return !hostnameMatchesList(hostname, whitelistEntries);
  }

  if (blacklistEntries.length > 0) {
    return !hostnameMatchesList(hostname, blacklistEntries);
  }

  return false;
}

module.exports = {
  parseDomainList,
  hostnameMatchesList,
  shouldSkipByDomain
};
