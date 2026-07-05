importScripts('../utils/defaults.js', '../utils/domain-list.js', '../utils/url-matcher.js');

const processingTabs = new Set();
const activePrompts = new Map();
const pendingNotifications = new Map();
const recentChecks = new Map();
const dismissedPrompts = new Map();

function getDismissKey(url, matchMode) {
  return normalizeUrl(url, matchMode) || url;
}

function markPromptDismissed(tabId, url, matchMode) {
  dismissedPrompts.set(tabId, getDismissKey(url, matchMode));
}

function isPromptDismissed(tabId, url, matchMode) {
  return dismissedPrompts.get(tabId) === getDismissKey(url, matchMode);
}

function isHttpUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
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

async function closeMatchingTabs(currentTabId, windowId, url, matchMode) {
  processingTabs.add(currentTabId);

  try {
    const tabsInWindow = await chrome.tabs.query({ windowId });
    const toClose = tabsInWindow
      .filter(
        (candidate) =>
          candidate.id !== currentTabId &&
          isHttpUrl(candidate.url) &&
          urlsMatch(candidate.url, url, matchMode)
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
    prompt.matchMode
  );
}

async function showNotificationFallback(currentTab, matches, settings, newUrl) {
  const notificationId = `tab-dedup-${currentTab.id}-${Date.now()}`;
  const autoCloseSeconds = settings.askAutoCloseSeconds;

  const pending = {
    currentTabId: currentTab.id,
    windowId: currentTab.windowId,
    newUrl,
    matchMode: settings.matchMode
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
    matchMode: settings.matchMode
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

  if (isPromptDismissed(tabId, url, settings.matchMode)) {
    return;
  }

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return;
  }

  if (shouldSkipByDomain(hostname, settings.whitelist, settings.blacklist)) {
    return;
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
      isHttpUrl(candidate.url) &&
      urlsMatch(candidate.url, url, settings.matchMode)
    );
  });

  if (matches.length === 0) {
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
  if (changeInfo.url && isHttpUrl(changeInfo.url)) {
    clearTabPromptState(tabId);
  }

  if (changeInfo.status === 'complete' && isHttpUrl(tab.url)) {
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
  if (details.frameId !== 0 || !isHttpUrl(details.url)) {
    return;
  }

  chrome.tabs.get(details.tabId).then((tab) => {
    scheduleDuplicateCheck(details.tabId, tab, details.url);
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabPromptState(tabId);
  processingTabs.delete(tabId);
  dismissedPrompts.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    markPromptDismissed(currentTabId, prompt.newUrl, prompt.matchMode);
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
    markPromptDismissed(pending.currentTabId, pending.newUrl, pending.matchMode);
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
    return;
  }

  if (details.reason === 'update') {
    const updates = {};

    if (!existing.matchMode || existing.matchMode === 'ignoreHash') {
      updates.matchMode = 'domainOnly';
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.sync.set(updates);
    }
  }
});
