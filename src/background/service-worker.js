importScripts('../utils/defaults.js', '../utils/domain-list.js', '../utils/url-matcher.js');

const processingTabs = new Set();
const activePrompts = new Map();
const pendingNotifications = new Map();
const recentChecks = new Map();
const dismissedPrompts = new Map();
const duplicatedTabIds = new Set();
const originCheckCompleted = new Set();

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

async function showCloseToast(currentTab, closedCount) {
  if (!isHttpUrl(currentTab.url) || closedCount === 0) {
    return;
  }

  const payload = {
    message: `已关闭 ${closedCount} 个同域名 Tab`,
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

  const pending = {
    currentTabId: currentTab.id,
    windowId: currentTab.windowId,
    newUrl,
    settings
  };

  pendingNotifications.set(notificationId, pending);
  activePrompts.set(currentTab.id, pending);

  const autoLabel =
    settings.askAutoCloseEnabled && autoCloseSeconds > 0
      ? `是（${autoCloseSeconds}s 后自动执行）`
      : '是';

  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Tab Dedup — 检测到同域名 Tab',
    message: `当前窗口另有 ${matches.length} 个相同域名的 Tab，是否关闭？`,
    buttons: [{ title: autoLabel }, { title: '否' }],
    requireInteraction: true
  });

  if (settings.askAutoCloseEnabled && autoCloseSeconds > 0) {
    pending.autoCloseTimerId = setTimeout(async () => {
      const currentPending = pendingNotifications.get(notificationId);
      if (!currentPending) {
        return;
      }

      clearNotificationPending(currentPending, notificationId);

      const current = await chrome.tabs.get(currentPending.currentTabId).catch(() => null);
      if (current) {
        await executeCloseChoice(currentPending);
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
    autoCloseSeconds: settings.askAutoCloseSeconds
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
  }

  const windowId = tab.windowId;
  if (windowId === undefined) {
    return;
  }

  const tabsInWindow = await chrome.tabs.query({ windowId });
  const matches = tabsInWindow.filter((candidate) => {
    return (
      candidate.id !== tabId &&
      !processingTabs.has(candidate.id) &&
      !isExcludedDuplicatedTab(candidate.id, settings) &&
      isCheckableUrl(candidate.url, settings) &&
      urlsMatchForDedup(candidate.url, url, settings)
    );
  });

  if (matches.length === 0) {
    return;
  }

  if (matches.length + 1 <= settings.sameSiteTabLimit) {
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

  if (message.choice === 'close') {
    executeCloseChoice(prompt);
  } else if (message.choice === 'keep') {
    markPromptDismissed(currentTabId, prompt.newUrl, prompt.settings.matchMode, prompt.settings.checkEmptyTabs);
  }

  sendResponse({ ok: true });
});

async function handleNotificationChoice(notificationId, shouldClose) {
  const pending = pendingNotifications.get(notificationId);
  if (!pending) {
    return;
  }

  clearNotificationPending(pending, notificationId);

  if (!shouldClose) {
    activePrompts.delete(pending.currentTabId);
    markPromptDismissed(pending.currentTabId, pending.newUrl, pending.settings.matchMode, pending.settings.checkEmptyTabs);
    return;
  }

  await executeCloseChoice(pending);
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

seedSessionStorageOnExistingTabs().catch((error) => {
  console.warn('[Tab Dedup] Failed to seed tab origin on existing tabs:', error);
});
