const DEFAULT_SETTINGS = {
  matchMode: 'domainOnly',
  whitelist: '',
  blacklist: '',
  askAutoCloseEnabled: true,
  askAutoCloseSeconds: 5,
  checkEmptyTabs: false,
  sameSiteTabLimit: 1,
  excludeDuplicatedTabs: true
};

const VALID_MATCH_MODES = ['domainOnly', 'strict', 'ignoreHash', 'ignoreQueryHash'];

function mergeSettings(stored) {
  const merged = { ...DEFAULT_SETTINGS, ...stored };

  if (stored.askAutoSwitchEnabled !== undefined && stored.askAutoCloseEnabled === undefined) {
    merged.askAutoCloseEnabled = stored.askAutoSwitchEnabled;
  }

  if (stored.askAutoSwitchSeconds !== undefined && stored.askAutoCloseSeconds === undefined) {
    merged.askAutoCloseSeconds = stored.askAutoSwitchSeconds;
  }

  if (!VALID_MATCH_MODES.includes(merged.matchMode)) {
    merged.matchMode = DEFAULT_SETTINGS.matchMode;
  }

  merged.checkEmptyTabs = Boolean(merged.checkEmptyTabs);
  merged.excludeDuplicatedTabs = Boolean(merged.excludeDuplicatedTabs);

  const limit = Number(merged.sameSiteTabLimit);
  merged.sameSiteTabLimit = Number.isFinite(limit)
    ? Math.min(20, Math.max(1, Math.round(limit)))
    : DEFAULT_SETTINGS.sameSiteTabLimit;

  return merged;
}
