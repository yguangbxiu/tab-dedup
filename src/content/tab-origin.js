const STORAGE_KEY = '__tab_dedup_origin_tab_id__';

function isExtensionContextValid() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function readStoredTabId() {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredTabId(tabId) {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(tabId));
  } catch {
    // sessionStorage may be unavailable in restricted contexts.
  }
}

function shouldRetryMessage(lastErrorMessage, retriesLeft) {
  if (retriesLeft <= 0) {
    return false;
  }

  if (!lastErrorMessage) {
    return false;
  }

  if (lastErrorMessage.includes('Extension context invalidated')) {
    return false;
  }

  return true;
}

function sendOriginCheck(storedValue, retriesLeft) {
  if (!isExtensionContextValid()) {
    return;
  }

  const storedTabId = storedValue ? Number(storedValue) : null;

  try {
    chrome.runtime.sendMessage(
      { type: 'TAB_ORIGIN_CHECK', storedTabId: Number.isFinite(storedTabId) ? storedTabId : null },
      (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          if (shouldRetryMessage(lastError.message, retriesLeft)) {
            setTimeout(() => sendOriginCheck(storedValue, retriesLeft - 1), 50);
          }
          return;
        }

        if (!response?.tabId) {
          return;
        }

        if (!storedValue) {
          writeStoredTabId(response.tabId);
        }
      }
    );
  } catch {
    // Extension reloaded or messaging unavailable.
  }
}

if (isExtensionContextValid()) {
  sendOriginCheck(readStoredTabId(), 5);
}
