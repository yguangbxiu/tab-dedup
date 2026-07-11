importScripts('../utils/defaults.js', '../utils/domain-list.js', '../utils/url-matcher.js');

const processingTabs = new Set();
const activePrompts = new Map();
const pendingNotifications = new Map();
const pendingOrganizeUndo = new Map();
const recentChecks = new Map();
const dismissedPrompts = new Map();
const duplicatedTabIds = new Set();
const originCheckCompleted = new Set();

const ORGANIZE_UNDO_DURATION_MS = 8000;

function clearOrganizeUndo(currentTabId) {
  const record = pendingOrganizeUndo.get(currentTabId);
  if (record?.timerId) {
    clearTimeout(record.timerId);
  }
  pendingOrganizeUndo.delete(currentTabId);
}

function saveOrganizeUndo(currentTabId, tabIds) {
  clearOrganizeUndo(currentTabId);
  const record = {
    tabIds,
    expiresAt: Date.now() + ORGANIZE_UNDO_DURATION_MS,
    timerId: setTimeout(() => clearOrganizeUndo(currentTabId), ORGANIZE_UNDO_DURATION_MS)
  };
  pendingOrganizeUndo.set(currentTabId, record);
}

function getValidOrganizeUndo(currentTabId) {
  const record = pendingOrganizeUndo.get(currentTabId);
  if (!record || Date.now() > record.expiresAt) {
    clearOrganizeUndo(currentTabId);
    return null;
  }
  return record;
}

function isDuplicatedTab(tabId) {
  return duplicatedTabIds.has(tabId);
}

function urlsEquivalent(urlA, urlB) {
  if (!urlA || !urlB) {
    return false;
  }

  if (urlA === urlB) {
    return true;
  }

  const normalizedA = normalizeUrl(urlA, 'strict');
  const normalizedB = normalizeUrl(urlB, 'strict');
  return Boolean(normalizedA && normalizedB && normalizedA === normalizedB);
}

function isAdjacentLeftTab(leftTab, currentTab) {
  return leftTab.windowId === currentTab.windowId && leftTab.index + 1 === currentTab.index;
}

async function verifyDuplicatedTab(storedTabId, currentTabId) {
  if (!Number.isFinite(storedTabId) || storedTabId <= 0 || storedTabId === currentTabId) {
    return false;
  }

  try {
    const currentTab = await chrome.tabs.get(currentTabId);
    let storedTab;

    try {
      storedTab = await chrome.tabs.get(storedTabId);
    } catch {
      return false;
    }

    if (storedTab.windowId !== currentTab.windowId) {
      return false;
    }

    if (!urlsEquivalent(storedTab.url, currentTab.url)) {
      return false;
    }

    if (isAdjacentLeftTab(storedTab, currentTab)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    const [storedAgain, currentAgain] = await Promise.all([
      chrome.tabs.get(storedTabId),
      chrome.tabs.get(currentTabId)
    ]);

    return isAdjacentLeftTab(storedAgain, currentAgain);
  } catch {
    return false;
  }
}

function markDuplicateTab(tabId) {
  duplicatedTabIds.add(tabId);
  originCheckCompleted.add(tabId);
}

async function probeDuplicateByAdjacentTab(tabId, settings) {
  if (isDuplicatedTab(tabId)) {
    return true;
  }

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return false;
  }

  if (!isHttpUrl(tab.url)) {
    return false;
  }

  const tabsInWindow = await chrome.tabs.query({ windowId: tab.windowId });
  const leftTab = tabsInWindow.find((candidate) => candidate.index === tab.index - 1);

  if (!leftTab || !isHttpUrl(leftTab.url)) {
    return false;
  }

  if (!urlsMatchForDedup(leftTab.url, tab.url, settings)) {
    return false;
  }

  // Link-opened tabs record their opener; duplicated tabs do not.
  if (tab.openerTabId === leftTab.id) {
    return false;
  }

  markDuplicateTab(tabId);
  return true;
}

async function probeDuplicateOnCreate(tab) {
  if (!tab.id || isDuplicatedTab(tab.id)) {
    return;
  }

  const url = tab.pendingUrl || tab.url;
  if (!isHttpUrl(url)) {
    return;
  }

  if (tab.openerTabId) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 0));

  let currentTab;
  try {
    currentTab = await chrome.tabs.get(tab.id);
  } catch {
    return;
  }

  const tabsInWindow = await chrome.tabs.query({ windowId: currentTab.windowId });
  const leftTab = tabsInWindow.find((candidate) => candidate.index === currentTab.index - 1);

  if (!leftTab || !urlsEquivalent(leftTab.url, url)) {
    return;
  }

  markDuplicateTab(tab.id);
}

async function waitForDuplicateClassification(tabId, settings, maxMs = 500) {
  if (isDuplicatedTab(tabId)) {
    return true;
  }

  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (originCheckCompleted.has(tabId)) {
      return isDuplicatedTab(tabId);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return probeDuplicateByAdjacentTab(tabId, settings);
}

const TAB_ORIGIN_STORAGE_KEY = '__tab_dedup_origin_tab_id__';
const POPUP_PATH = 'src/popup/popup.html';
const DOUBLE_CLICK_MS = 400;
const TAB_GROUP_ID_NONE = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1;

let pendingSingleClickTimer = null;

function isTabInGroup(tab) {
  return tab?.groupId !== undefined && tab.groupId !== TAB_GROUP_ID_NONE;
}

function isPinnedTab(tab) {
  return Boolean(tab?.pinned);
}

async function ensureActionPopupDisabled() {
  await chrome.action.setPopup({ popup: '' });
}

async function openSettingsPopup() {
  await chrome.action.setPopup({ popup: POPUP_PATH });

  try {
    await chrome.action.openPopup();
  } finally {
    await ensureActionPopupDisabled();
  }
}

function getTabEffectiveUrl(tab) {
  return tab.pendingUrl || tab.url || '';
}

function getBulkScanDedupKey(url, settings) {
  if (isEmptyTabUrl(url)) {
    return '__empty__';
  }

  if (!isHttpUrl(url)) {
    return null;
  }

  return normalizeUrl(url, settings.matchMode) || url;
}

function shouldIncludeTabInBulkScan(tab, settings) {
  if (isTabInGroup(tab) || isPinnedTab(tab)) {
    return false;
  }

  const url = getTabEffectiveUrl(tab);

  if (isEmptyTabUrl(url)) {
    return true;
  }

  if (!isHttpUrl(url)) {
    return false;
  }

  try {
    const hostname = new URL(url).hostname;
    if (shouldAutoGroupByDomain(hostname, settings.autoGroupDomains)) {
      return false;
    }
    return !shouldSkipByDomain(hostname, settings.whitelist, settings.blacklist);
  } catch {
    return false;
  }
}

function getDuplicateGroupTitle(key, settings) {
  if (key === '__empty__') {
    return '空 Tab';
  }

  if (settings.matchMode === 'domainOnly') {
    try {
      return new URL(`https://${key}`).hostname || key;
    } catch {
      // key may already be a hostname from normalizeUrl
    }

    try {
      return new URL(key).hostname || key;
    } catch {
      return key;
    }
  }

  try {
    const parsed = new URL(key);
    return parsed.hostname || key;
  } catch {
    return key.length > 40 ? `${key.slice(0, 37)}…` : key;
  }
}

function getAutoActionLabel(action, seconds, includeCountdown) {
  const labels = {
    close: '清理',
    organize: '整理',
    none: '无操作'
  };

  const base = labels[action] || labels.close;

  if (includeCountdown && seconds > 0) {
    return `${base}（${seconds}s 后自动执行）`;
  }

  return base;
}

function findWindowDuplicates(tabsInWindow, settings, activeTabId) {
  const groups = new Map();

  for (const tab of tabsInWindow) {
    if (!shouldIncludeTabInBulkScan(tab, settings)) {
      continue;
    }

    const key = getBulkScanDedupKey(getTabEffectiveUrl(tab), settings);
    if (!key) {
      continue;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(tab);
  }

  const tabIdsToClose = [];
  const duplicateGroups = [];
  let groupCount = 0;

  for (const [key, group] of groups.entries()) {
    let tabLimit = 1;
    if (key !== '__empty__') {
      try {
        const url = getTabEffectiveUrl(group[0]);
        const hostname = new URL(url).hostname;
        tabLimit = getBulkScanTabLimitForHostname(hostname, settings);
      } catch {
        tabLimit = 1;
      }
    }

    if (group.length <= tabLimit) {
      continue;
    }

    groupCount += 1;

    const sorted = [...group].sort((a, b) => a.index - b.index);
    const keep = sorted.find((candidate) => candidate.id === activeTabId) || sorted[0];

    duplicateGroups.push({
      key,
      tabIds: sorted.map((tab) => tab.id),
      title: getDuplicateGroupTitle(key, settings)
    });

    for (const tab of sorted) {
      if (tab.id !== keep.id) {
        tabIdsToClose.push(tab.id);
      }
    }
  }

  return { tabIdsToClose, duplicateGroups, groupCount, duplicateCount: tabIdsToClose.length };
}

async function closeDuplicateTabIds(currentTabId, tabIdsToClose) {
  if (tabIdsToClose.length === 0) {
    return 0;
  }

  processingTabs.add(currentTabId);

  try {
    await chrome.tabs.remove(tabIdsToClose);

    const currentTab = await chrome.tabs.get(currentTabId).catch(() => null);
    if (currentTab) {
      showCloseToast(currentTab, tabIdsToClose.length, 'bulk').catch(() => {});
    }

    return tabIdsToClose.length;
  } catch (error) {
    console.error('[Tab Dedup] Failed to close duplicate tabs:', error);
    return 0;
  } finally {
    processingTabs.delete(currentTabId);
    activePrompts.delete(currentTabId);
  }
}

async function showOrganizeToast(currentTab, message, undoable = false) {
  if (!isHttpUrl(currentTab.url)) {
    return;
  }

  const payload = {
    message,
    durationMs: undoable ? ORGANIZE_UNDO_DURATION_MS : 1500,
    showUndoButton: undoable
  };

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: currentTab.id },
      files: ['src/content/overlay.css']
    });

    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['src/content/overlay.js']
    });

    await chrome.tabs.sendMessage(currentTab.id, {
      type: 'SHOW_SWITCH_TOAST',
      payload
    });
  } catch (error) {
    console.warn('[Tab Dedup] Organize toast injection failed:', error);
  }
}

async function organizeMatchingTabs(currentTabId, matchTabIds, url) {
  const tabIds = [currentTabId, ...matchTabIds];

  if (tabIds.length < 2) {
    return 0;
  }

  processingTabs.add(currentTabId);

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = 'Tab 分组';
  }

  try {
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: hostname, collapsed: false });

    const currentTab = await chrome.tabs.get(currentTabId).catch(() => null);
    if (currentTab) {
      saveOrganizeUndo(currentTabId, tabIds);
      showOrganizeToast(
        currentTab,
        `已将 ${tabIds.length} 个 Tab 整理到分组「${hostname}」`,
        true
      ).catch(() => {});
    }

    return tabIds.length;
  } catch (error) {
    console.error('[Tab Dedup] Failed to organize matching tabs:', error);
    return 0;
  } finally {
    processingTabs.delete(currentTabId);
    activePrompts.delete(currentTabId);
  }
}

async function autoOrganizeMatchingTabs(currentTabId, matchTabIds, url) {
  const tabIds = [currentTabId, ...matchTabIds];

  if (tabIds.length < 2) {
    return 0;
  }

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = 'Tab 分组';
  }

  try {
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: hostname, collapsed: false });
    return tabIds.length;
  } catch (error) {
    console.error('[Tab Dedup] Failed to auto-organize matching tabs:', error);
    return 0;
  }
}

async function handleAutoGroupNavigation(tabId, tab, url, settings) {
  const windowId = tab.windowId;
  if (windowId === undefined) {
    return;
  }

  const tabsInWindow = await chrome.tabs.query({ windowId });
  const matchingTabs = tabsInWindow.filter(
    (candidate) =>
      candidate.id !== tabId &&
      !isPinnedTab(candidate) &&
      !processingTabs.has(candidate.id) &&
      !isExcludedDuplicatedTab(candidate.id, settings) &&
      isCheckableUrl(candidate.url, settings) &&
      urlsMatchForDedup(candidate.url, url, settings)
  );

  if (matchingTabs.length === 0) {
    return;
  }

  let tabLimit = settings.sameSiteTabLimit;
  try {
    const hostname = new URL(url).hostname;
    tabLimit = getSameSiteTabLimitForHostname(hostname, settings);
  } catch {
    // keep global limit
  }

  if (matchingTabs.length + 1 <= tabLimit) {
    return;
  }

  processingTabs.add(tabId);

  try {
    const groupedMatches = matchingTabs.filter(isTabInGroup);
    const ungroupedMatchIds = matchingTabs
      .filter((candidate) => !isTabInGroup(candidate))
      .map((candidate) => candidate.id);

    if (groupedMatches.length > 0) {
      const targetGroupId = groupedMatches[0].groupId;
      const tabIdsToAdd = [tabId, ...ungroupedMatchIds];
      await chrome.tabs.group({ tabIds: tabIdsToAdd, groupId: targetGroupId });
      return;
    }

    await autoOrganizeMatchingTabs(tabId, ungroupedMatchIds, url);
  } catch (error) {
    console.error('[Tab Dedup] Auto-group navigation failed:', error);
  } finally {
    processingTabs.delete(tabId);
  }
}

async function organizeBulkDuplicateGroups(currentTabId, duplicateGroups) {
  const groupsToOrganize = duplicateGroups.filter((group) => group.tabIds.length >= 2);

  if (groupsToOrganize.length === 0) {
    return 0;
  }

  processingTabs.add(currentTabId);

  try {
    for (const group of groupsToOrganize) {
      const groupId = await chrome.tabs.group({ tabIds: group.tabIds });
      await chrome.tabGroups.update(groupId, { title: group.title, collapsed: false });
    }

    const allTabIds = groupsToOrganize.flatMap((group) => group.tabIds);
    const currentTab = await chrome.tabs.get(currentTabId).catch(() => null);
    if (currentTab) {
      saveOrganizeUndo(currentTabId, allTabIds);
      showOrganizeToast(
        currentTab,
        `已将 ${groupsToOrganize.length} 组重复 Tab 整理到分组`,
        true
      ).catch(() => {});
    }

    return groupsToOrganize.length;
  } catch (error) {
    console.error('[Tab Dedup] Failed to organize bulk duplicate groups:', error);
    return 0;
  } finally {
    processingTabs.delete(currentTabId);
    activePrompts.delete(currentTabId);
  }
}

async function executeUndoOrganize(currentTabId) {
  const record = getValidOrganizeUndo(currentTabId);
  if (!record) {
    return;
  }

  clearOrganizeUndo(currentTabId);

  const validTabIds = [];
  for (const tabId of record.tabIds) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab) {
      validTabIds.push(tabId);
    }
  }

  if (validTabIds.length === 0) {
    return;
  }

  try {
    await chrome.tabs.ungroup(validTabIds);
  } catch (error) {
    console.error('[Tab Dedup] Failed to undo organize:', error);
    return;
  }

  const currentTab = await chrome.tabs.get(currentTabId).catch(() => null);
  if (currentTab) {
    showOrganizeToast(currentTab, '已取消整理，Tab 已重新展开').catch(() => {});
  }
}

async function executeOrganizeChoice(prompt) {
  if (!prompt) {
    return;
  }

  if (prompt.type === 'bulk') {
    await organizeBulkDuplicateGroups(prompt.currentTabId, prompt.duplicateGroups || []);
    return;
  }

  await organizeMatchingTabs(prompt.currentTabId, prompt.matchTabIds || [], prompt.newUrl);
}

async function executeUserChoice(prompt, choice) {
  if (!prompt) {
    return;
  }

  if (choice === 'close') {
    if (prompt.type === 'bulk') {
      await closeDuplicateTabIds(prompt.currentTabId, prompt.tabIdsToClose);
    } else {
      await executeCloseChoice(prompt);
    }
    return;
  }

  if (choice === 'organize') {
    await executeOrganizeChoice(prompt);
    return;
  }

  if (choice === 'keep' && prompt.type !== 'bulk') {
    markPromptDismissed(
      prompt.currentTabId,
      prompt.newUrl,
      prompt.settings.matchMode,
      prompt.settings.checkEmptyTabs
    );
  }
}

async function executeAutoAction(prompt) {
  if (!prompt) {
    return;
  }

  const action = prompt.settings.autoActionOnTimeout || 'close';

  if (action === 'none') {
    activePrompts.delete(prompt.currentTabId);
    return;
  }

  await executeUserChoice(prompt, action);
}

async function showBulkScanNotification(
  currentTab,
  duplicateCount,
  groupCount,
  tabIdsToClose,
  duplicateGroups,
  settings
) {
  const notificationId = `tab-dedup-bulk-${currentTab.id}-${Date.now()}`;
  const autoCloseSeconds = settings.askAutoCloseSeconds;
  const autoAction = settings.autoActionOnTimeout || 'close';

  const pending = {
    type: 'bulk',
    currentTabId: currentTab.id,
    tabIdsToClose,
    duplicateGroups,
    settings
  };

  pendingNotifications.set(notificationId, pending);
  activePrompts.set(currentTab.id, pending);

  const includeCountdown =
    settings.askAutoCloseEnabled && autoCloseSeconds > 0 && autoAction !== 'none';
  const autoLabel = getAutoActionLabel(autoAction, autoCloseSeconds, includeCountdown);

  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Tab Dedup — 检测到重复 Tab',
    message: `当前窗口有 ${duplicateCount} 个重复 Tab（${groupCount} 组），可选择清理、整理或忽略。`,
    buttons: [{ title: autoLabel }, { title: '忽略' }],
    requireInteraction: true
  });

  if (includeCountdown) {
    pending.autoCloseTimerId = setTimeout(async () => {
      const currentPending = pendingNotifications.get(notificationId);
      if (!currentPending) {
        return;
      }

      clearNotificationPending(currentPending, notificationId);

      const current = await chrome.tabs.get(currentPending.currentTabId).catch(() => null);
      if (current) {
        await executeAutoAction(currentPending);
      }
    }, autoCloseSeconds * 1000);
  }
}

async function showBulkScanPrompt(
  currentTab,
  duplicateCount,
  groupCount,
  tabIdsToClose,
  duplicateGroups,
  settings
) {
  if (activePrompts.has(currentTab.id)) {
    return;
  }

  activePrompts.set(currentTab.id, {
    type: 'bulk',
    currentTabId: currentTab.id,
    tabIdsToClose,
    duplicateGroups,
    settings
  });

  const payload = {
    scanMode: 'bulk',
    duplicateCount,
    groupCount,
    autoCloseEnabled: settings.askAutoCloseEnabled,
    autoCloseSeconds: settings.askAutoCloseSeconds,
    autoActionOnTimeout: settings.autoActionOnTimeout,
    promptPosition: settings.promptPosition,
    promptSize: settings.promptSize
  };

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: currentTab.id },
      files: ['src/content/overlay.css']
    });

    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['src/content/overlay.js']
    });

    await chrome.tabs.sendMessage(currentTab.id, {
      type: 'SHOW_DEDUP_PROMPT',
      payload
    });
  } catch (error) {
    console.warn('[Tab Dedup] Bulk scan overlay failed, using notification fallback:', error);
    activePrompts.delete(currentTab.id);
    await showBulkScanNotification(
      currentTab,
      duplicateCount,
      groupCount,
      tabIdsToClose,
      duplicateGroups,
      settings
    );
  }
}

async function showNoDuplicatesToast(currentTab) {
  if (!isHttpUrl(currentTab.url)) {
    return;
  }

  const payload = {
    message: '未发现重复 Tab',
    durationMs: 2000
  };

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: currentTab.id },
      files: ['src/content/overlay.css']
    });

    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['src/content/overlay.js']
    });

    await chrome.tabs.sendMessage(currentTab.id, {
      type: 'SHOW_SWITCH_TOAST',
      payload
    });
  } catch (error) {
    console.warn('[Tab Dedup] No-duplicates toast failed:', error);
  }
}

async function handleQuickUngroupAll(activeTab) {
  if (!activeTab?.id || activeTab.windowId === undefined) {
    return { ok: false, reason: 'invalid-tab' };
  }

  const tabsInWindow = await chrome.tabs.query({ windowId: activeTab.windowId });
  const groupedTabIds = tabsInWindow.filter(isTabInGroup).map((tab) => tab.id);

  if (groupedTabIds.length === 0) {
    await showOrganizeToast(activeTab, '当前窗口没有已分组的 Tab');
    return { ok: true, ungroupedCount: 0 };
  }

  try {
    await chrome.tabs.ungroup(groupedTabIds);
    await showOrganizeToast(activeTab, `已取消 ${groupedTabIds.length} 个 Tab 的分组`);
    return { ok: true, ungroupedCount: groupedTabIds.length };
  } catch (error) {
    console.error('[Tab Dedup] Failed to ungroup tabs:', error);
    return { ok: false, reason: 'error' };
  }
}

async function handleQuickDedupClose(activeTab) {
  if (!activeTab?.id || activeTab.windowId === undefined) {
    return { ok: false, reason: 'invalid-tab' };
  }

  if (activePrompts.has(activeTab.id)) {
    return { ok: false, reason: 'busy' };
  }

  const settings = await getSettings();
  const tabsInWindow = await chrome.tabs.query({ windowId: activeTab.windowId });
  const { tabIdsToClose, duplicateCount } = findWindowDuplicates(
    tabsInWindow,
    settings,
    activeTab.id
  );

  if (duplicateCount === 0) {
    await showNoDuplicatesToast(activeTab);
    return { ok: true, closedCount: 0 };
  }

  const closedCount = await closeDuplicateTabIds(activeTab.id, tabIdsToClose);
  return { ok: true, closedCount };
}

async function handleQuickDedupOrganize(activeTab) {
  if (!activeTab?.id || activeTab.windowId === undefined) {
    return { ok: false, reason: 'invalid-tab' };
  }

  if (activePrompts.has(activeTab.id)) {
    return { ok: false, reason: 'busy' };
  }

  const settings = await getSettings();
  const tabsInWindow = await chrome.tabs.query({ windowId: activeTab.windowId });
  const { duplicateGroups, groupCount, duplicateCount } = findWindowDuplicates(
    tabsInWindow,
    settings,
    activeTab.id
  );

  if (duplicateCount === 0) {
    await showNoDuplicatesToast(activeTab);
    return { ok: true, groupCount: 0 };
  }

  const organizedCount = await organizeBulkDuplicateGroups(activeTab.id, duplicateGroups);
  return { ok: true, groupCount: organizedCount || groupCount };
}

async function handleQuickAction(action) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    return { ok: false, reason: 'invalid-tab' };
  }

  switch (action) {
    case 'ungroup-all':
      return handleQuickUngroupAll(activeTab);
    case 'dedup-close':
      return handleQuickDedupClose(activeTab);
    case 'dedup-organize':
      return handleQuickDedupOrganize(activeTab);
    default:
      return { ok: false, reason: 'unknown-action' };
  }
}

async function handleBulkDuplicateScan(activeTab) {
  if (!activeTab?.id || activeTab.windowId === undefined) {
    return;
  }

  if (activePrompts.has(activeTab.id)) {
    return;
  }

  const settings = await getSettings();
  const tabsInWindow = await chrome.tabs.query({ windowId: activeTab.windowId });
  const { tabIdsToClose, duplicateGroups, groupCount, duplicateCount } = findWindowDuplicates(
    tabsInWindow,
    settings,
    activeTab.id
  );

  if (duplicateCount === 0) {
    await showNoDuplicatesToast(activeTab);
    return;
  }

  await showBulkScanPrompt(
    activeTab,
    duplicateCount,
    groupCount,
    tabIdsToClose,
    duplicateGroups,
    settings
  );
}

function handleActionClick(tab) {
  if (pendingSingleClickTimer) {
    clearTimeout(pendingSingleClickTimer);
    pendingSingleClickTimer = null;
    handleBulkDuplicateScan(tab).catch((error) => {
      console.error('[Tab Dedup] Bulk duplicate scan failed:', error);
    });
    return;
  }

  pendingSingleClickTimer = setTimeout(() => {
    pendingSingleClickTimer = null;
    openSettingsPopup().catch((error) => {
      console.warn('[Tab Dedup] Failed to open settings popup:', error);
    });
  }, DOUBLE_CLICK_MS);
}

chrome.action.onClicked.addListener(handleActionClick);

async function seedSessionStorageOnExistingTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });

  for (const tab of tabs) {
    if (!tab.id) {
      continue;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (storageKey, tabId) => {
          try {
            if (!sessionStorage.getItem(storageKey)) {
              sessionStorage.setItem(storageKey, String(tabId));
            }
          } catch {
            // sessionStorage may be unavailable in restricted contexts.
          }
        },
        args: [TAB_ORIGIN_STORAGE_KEY, tab.id]
      });
    } catch {
      // Restricted or unloaded tabs are skipped.
    }
  }
}

function isExcludedDuplicatedTab(tabId, settings) {
  return settings.excludeDuplicatedTabs && isDuplicatedTab(tabId);
}

function getDismissKey(url, matchMode, checkEmptyTabs) {
  if (checkEmptyTabs && isEmptyTabUrl(url)) {
    return '__empty__';
  }

  return normalizeUrl(url, matchMode) || url;
}

function markPromptDismissed(tabId, url, matchMode, checkEmptyTabs) {
  dismissedPrompts.set(tabId, getDismissKey(url, matchMode, checkEmptyTabs));
}

function isPromptDismissed(tabId, url, matchMode, checkEmptyTabs) {
  return dismissedPrompts.get(tabId) === getDismissKey(url, matchMode, checkEmptyTabs);
}

function isHttpUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

function isCheckableUrl(url, settings) {
  if (isHttpUrl(url)) {
    return true;
  }

  return Boolean(settings.checkEmptyTabs && isEmptyTabUrl(url));
}

function urlsMatchForDedup(urlA, urlB, settings) {
  if (settings.checkEmptyTabs && isEmptyTabUrl(urlA) && isEmptyTabUrl(urlB)) {
    return true;
  }

  if (!isHttpUrl(urlA) || !isHttpUrl(urlB)) {
    return false;
  }

  return urlsMatch(urlA, urlB, settings.matchMode);
}

function clearNotificationPending(pending, notificationId) {
  if (pending.autoCloseTimerId) {
    clearTimeout(pending.autoCloseTimerId);
  }
  pendingNotifications.delete(notificationId);
  chrome.notifications.clear(notificationId);
}

function clearTabPromptState(tabId) {
  activePrompts.delete(tabId);

  for (const [notificationId, pending] of pendingNotifications.entries()) {
    if (pending.currentTabId === tabId) {
      clearNotificationPending(pending, notificationId);
    }
  }
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  return mergeSettings(stored);
}

function shouldDebounce(tabId, url) {
  const key = `${tabId}:${url}`;
  const now = Date.now();
  const last = recentChecks.get(key);

  if (last && now - last < 800) {
    return true;
  }

  recentChecks.set(key, now);
  return false;
}

async function showCloseToast(currentTab, closedCount, mode = 'navigation') {
  if (!isHttpUrl(currentTab.url) || closedCount === 0) {
    return;
  }

  const payload = {
    message:
      mode === 'bulk'
        ? `已关闭 ${closedCount} 个重复 Tab`
        : `已关闭 ${closedCount} 个同域名 Tab`,
    durationMs: 1500
  };

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: currentTab.id },
      files: ['src/content/overlay.css']
    });

    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['src/content/overlay.js']
    });

    await chrome.tabs.sendMessage(currentTab.id, {
      type: 'SHOW_SWITCH_TOAST',
      payload
    });
  } catch (error) {
    console.warn('[Tab Dedup] Close toast injection failed:', error);
  }
}

async function closeMatchingTabs(currentTabId, windowId, url, settings) {
  processingTabs.add(currentTabId);

  try {
    const tabsInWindow = await chrome.tabs.query({ windowId });
    const toClose = tabsInWindow
      .filter(
        (candidate) =>
          candidate.id !== currentTabId &&
          !isTabInGroup(candidate) &&
          !isPinnedTab(candidate) &&
          !isExcludedDuplicatedTab(candidate.id, settings) &&
          isCheckableUrl(candidate.url, settings) &&
          urlsMatchForDedup(candidate.url, url, settings)
      )
      .map((candidate) => candidate.id);

    if (toClose.length === 0) {
      return 0;
    }

    await chrome.tabs.remove(toClose);

    const currentTab = await chrome.tabs.get(currentTabId).catch(() => null);
    if (currentTab) {
      showCloseToast(currentTab, toClose.length).catch(() => {});
    }

    return toClose.length;
  } catch (error) {
    console.error('[Tab Dedup] Failed to close matching tabs:', error);
    return 0;
  } finally {
    processingTabs.delete(currentTabId);
    activePrompts.delete(currentTabId);
  }
}

async function executeCloseChoice(prompt) {
  if (!prompt) {
    return;
  }

  await closeMatchingTabs(
    prompt.currentTabId,
    prompt.windowId,
    prompt.newUrl,
    prompt.settings
  );
}

async function showNotificationFallback(currentTab, matches, settings, newUrl) {
  const notificationId = `tab-dedup-${currentTab.id}-${Date.now()}`;
  const autoCloseSeconds = settings.askAutoCloseSeconds;
  const autoAction = settings.autoActionOnTimeout || 'close';

  const pending = {
    type: 'navigation',
    currentTabId: currentTab.id,
    windowId: currentTab.windowId,
    matchTabIds: matches.map((match) => match.id),
    newUrl,
    settings
  };

  pendingNotifications.set(notificationId, pending);
  activePrompts.set(currentTab.id, pending);

  const includeCountdown =
    settings.askAutoCloseEnabled && autoCloseSeconds > 0 && autoAction !== 'none';
  const autoLabel = getAutoActionLabel(autoAction, autoCloseSeconds, includeCountdown);

  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Tab Dedup — 检测到同域名 Tab',
    message: `当前窗口另有 ${matches.length} 个相同域名的 Tab，可选择清理、整理或忽略。`,
    buttons: [{ title: autoLabel }, { title: '忽略' }],
    requireInteraction: true
  });

  if (includeCountdown) {
    pending.autoCloseTimerId = setTimeout(async () => {
      const currentPending = pendingNotifications.get(notificationId);
      if (!currentPending) {
        return;
      }

      clearNotificationPending(currentPending, notificationId);

      const current = await chrome.tabs.get(currentPending.currentTabId).catch(() => null);
      if (current) {
        await executeAutoAction(currentPending);
      }
    }, autoCloseSeconds * 1000);
  }
}

async function showClosePrompt(currentTab, matches, settings, newUrl) {
  if (activePrompts.has(currentTab.id)) {
    return;
  }

  let hostname;
  try {
    hostname = new URL(newUrl).hostname;
  } catch {
    hostname = '';
  }

  activePrompts.set(currentTab.id, {
    type: 'navigation',
    currentTabId: currentTab.id,
    windowId: currentTab.windowId,
    matchTabIds: matches.map((match) => match.id),
    newUrl,
    settings
  });

  const payload = {
    matchCount: matches.length,
    hostname,
    sampleTitle: matches[0]?.title || matches[0]?.url || '',
    autoCloseEnabled: settings.askAutoCloseEnabled,
    autoCloseSeconds: settings.askAutoCloseSeconds,
    autoActionOnTimeout: settings.autoActionOnTimeout,
    promptPosition: settings.promptPosition,
    promptSize: settings.promptSize
  };

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: currentTab.id },
      files: ['src/content/overlay.css']
    });

    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['src/content/overlay.js']
    });

    await chrome.tabs.sendMessage(currentTab.id, {
      type: 'SHOW_DEDUP_PROMPT',
      payload
    });
  } catch (error) {
    console.warn('[Tab Dedup] Overlay injection failed, using notification fallback:', error);
    activePrompts.delete(currentTab.id);
    await showNotificationFallback(currentTab, matches, settings, newUrl);
  }
}

async function handleDuplicateNavigation(tabId, tab, url) {
  if (processingTabs.has(tabId) || activePrompts.has(tabId)) {
    return;
  }

  if (shouldDebounce(tabId, url)) {
    return;
  }

  const settings = await getSettings();

  if (!isCheckableUrl(url, settings)) {
    return;
  }

  if (isPromptDismissed(tabId, url, settings.matchMode, settings.checkEmptyTabs)) {
    return;
  }

  if (isTabInGroup(tab) || isPinnedTab(tab)) {
    return;
  }

  if (settings.excludeDuplicatedTabs) {
    const isDuplicated = await waitForDuplicateClassification(tabId, settings);
    if (isDuplicated) {
      return;
    }
  }

  const isEmptyTab = settings.checkEmptyTabs && isEmptyTabUrl(url);

  if (!isEmptyTab) {
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return;
    }

    if (shouldSkipByDomain(hostname, settings.whitelist, settings.blacklist)) {
      return;
    }

    if (shouldAutoGroupByDomain(hostname, settings.autoGroupDomains)) {
      await handleAutoGroupNavigation(tabId, tab, url, settings);
      return;
    }
  }

  const windowId = tab.windowId;
  if (windowId === undefined) {
    return;
  }

  const tabsInWindow = await chrome.tabs.query({ windowId });
  const matches = tabsInWindow.filter((candidate) => {
    return (
      candidate.id !== tabId &&
      !isTabInGroup(candidate) &&
      !isPinnedTab(candidate) &&
      !processingTabs.has(candidate.id) &&
      !isExcludedDuplicatedTab(candidate.id, settings) &&
      isCheckableUrl(candidate.url, settings) &&
      urlsMatchForDedup(candidate.url, url, settings)
    );
  });

  if (matches.length === 0) {
    return;
  }

  let tabLimit = settings.sameSiteTabLimit;
  if (!isEmptyTab) {
    try {
      const matchHostname = new URL(url).hostname;
      tabLimit = getSameSiteTabLimitForHostname(matchHostname, settings);
    } catch {
      // keep global limit
    }
  }

  if (matches.length + 1 <= tabLimit) {
    return;
  }

  await showClosePrompt(tab, matches, settings, url);
}

function scheduleDuplicateCheck(tabId, tab, url) {
  handleDuplicateNavigation(tabId, tab, url).catch((error) => {
    console.error('[Tab Dedup] Duplicate check failed:', error);
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    originCheckCompleted.delete(tabId);

    getSettings().then((settings) => {
      if (isCheckableUrl(changeInfo.url, settings)) {
        clearTabPromptState(tabId);
      }
    });
  }

  if (changeInfo.status === 'complete' && tab.url) {
    scheduleDuplicateCheck(tabId, tab, tab.url);
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  clearTabPromptState(details.tabId);
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  chrome.tabs.get(details.tabId).then((tab) => {
    scheduleDuplicateCheck(details.tabId, tab, details.url);
  }).catch(() => {});
});

chrome.tabs.onCreated.addListener((tab) => {
  probeDuplicateOnCreate(tab).catch((error) => {
    console.warn('[Tab Dedup] Duplicate probe on create failed:', error);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabPromptState(tabId);
  clearOrganizeUndo(tabId);
  processingTabs.delete(tabId);
  dismissedPrompts.delete(tabId);
  duplicatedTabIds.delete(tabId);
  originCheckCompleted.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TAB_ORIGIN_CHECK') {
    const currentTabId = sender.tab?.id;
    if (!currentTabId) {
      sendResponse({ tabId: null, isDuplicated: false });
      return;
    }

    verifyDuplicatedTab(message.storedTabId, currentTabId).then((isDuplicated) => {
      if (isDuplicated) {
        markDuplicateTab(currentTabId);
      } else {
        duplicatedTabIds.delete(currentTabId);
        originCheckCompleted.add(currentTabId);
      }

      sendResponse({ tabId: currentTabId, isDuplicated });
    });

    return true;
  }

  if (message.type === 'DEDUP_UNDO_ORGANIZE') {
    const currentTabId = sender.tab?.id;
    if (currentTabId) {
      executeUndoOrganize(currentTabId);
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'QUICK_ACTION') {
    handleQuickAction(message.action)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Tab Dedup] Quick action failed:', error);
        sendResponse({ ok: false, reason: 'error' });
      });
    return true;
  }

  if (message.type !== 'DEDUP_USER_CHOICE') {
    return;
  }

  const currentTabId = sender.tab?.id;
  if (!currentTabId) {
    sendResponse({ ok: false });
    return;
  }

  const prompt = activePrompts.get(currentTabId);
  activePrompts.delete(currentTabId);

  if (!prompt) {
    sendResponse({ ok: true });
    return;
  }

  if (message.choice === 'close' || message.choice === 'organize' || message.choice === 'keep') {
    executeUserChoice(prompt, message.choice);
  }

  sendResponse({ ok: true });
});

async function handleNotificationChoice(notificationId, executeAuto) {
  const pending = pendingNotifications.get(notificationId);
  if (!pending) {
    return;
  }

  clearNotificationPending(pending, notificationId);

  if (!executeAuto) {
    activePrompts.delete(pending.currentTabId);
    if (pending.type !== 'bulk') {
      markPromptDismissed(
        pending.currentTabId,
        pending.newUrl,
        pending.settings.matchMode,
        pending.settings.checkEmptyTabs
      );
    }
    return;
  }

  await executeAutoAction(pending);
}

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  handleNotificationChoice(notificationId, buttonIndex === 0);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  handleNotificationChoice(notificationId, true);
});

chrome.notifications.onClosed.addListener((notificationId) => {
  const pending = pendingNotifications.get(notificationId);
  if (!pending) {
    return;
  }

  clearNotificationPending(pending, notificationId);
  activePrompts.delete(pending.currentTabId);
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureActionPopupDisabled();

  const existing = await chrome.storage.sync.get(null);

  if (Object.keys(existing).length === 0) {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  } else if (details.reason === 'update') {
    const updates = {};

    if (!existing.matchMode || existing.matchMode === 'ignoreHash') {
      updates.matchMode = 'domainOnly';
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.sync.set(updates);
    }
  }

  await seedSessionStorageOnExistingTabs();
});

chrome.runtime.onStartup.addListener(() => {
  ensureActionPopupDisabled().catch((error) => {
    console.warn('[Tab Dedup] Failed to disable action popup on startup:', error);
  });
});

ensureActionPopupDisabled().catch((error) => {
  console.warn('[Tab Dedup] Failed to disable action popup:', error);
});

seedSessionStorageOnExistingTabs().catch((error) => {
  console.warn('[Tab Dedup] Failed to seed tab origin on existing tabs:', error);
});
