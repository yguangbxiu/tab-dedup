const DEFAULT_SETTINGS = {
  matchMode: 'domainOnly',
  whitelist: '',
  blacklist: '',
  askAutoCloseEnabled: true,
  askAutoCloseSeconds: 1
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

  return merged;
}
