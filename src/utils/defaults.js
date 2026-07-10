const DEFAULT_SETTINGS = {
  matchMode: 'domainOnly',
  whitelist: '',
  blacklist: '',
  autoGroupDomains: '',
  askAutoCloseEnabled: true,
  askAutoCloseSeconds: 5,
  autoActionOnTimeout: 'close',
  checkEmptyTabs: false,
  sameSiteTabLimit: 1,
  domainTabLimits: '',
  excludeDuplicatedTabs: true,
  promptPosition: 'topRight',
  promptSize: 'small'
};

const VALID_MATCH_MODES = ['domainOnly', 'strict', 'ignoreHash', 'ignoreQueryHash'];
const VALID_PROMPT_POSITIONS = ['topLeft', 'topRight', 'topCenter', 'bottomLeft', 'bottomRight', 'center'];
const VALID_PROMPT_SIZES = ['small', 'medium', 'large'];
const VALID_AUTO_ACTIONS = ['close', 'organize', 'none'];

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

  merged.domainTabLimits =
    typeof merged.domainTabLimits === 'string' ? merged.domainTabLimits : DEFAULT_SETTINGS.domainTabLimits;

  if (!VALID_PROMPT_POSITIONS.includes(merged.promptPosition)) {
    merged.promptPosition = DEFAULT_SETTINGS.promptPosition;
  }

  if (!VALID_PROMPT_SIZES.includes(merged.promptSize)) {
    merged.promptSize = DEFAULT_SETTINGS.promptSize;
  }

  if (!VALID_AUTO_ACTIONS.includes(merged.autoActionOnTimeout)) {
    merged.autoActionOnTimeout = DEFAULT_SETTINGS.autoActionOnTimeout;
  }

  return merged;
}
