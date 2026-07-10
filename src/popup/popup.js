const form = document.getElementById('settings-form');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');
const openOptionsBtn = document.getElementById('open-options');
const quickActionButtons = [
  document.getElementById('quick-ungroup'),
  document.getElementById('quick-dedup'),
  document.getElementById('quick-group')
];

function readForm() {
  return {
    askAutoCloseSeconds: Number(document.getElementById('askAutoCloseSeconds').value) || DEFAULT_SETTINGS.askAutoCloseSeconds,
    checkEmptyTabs: document.getElementById('checkEmptyTabs').checked,
    sameSiteTabLimit: Number(document.getElementById('sameSiteTabLimit').value) || DEFAULT_SETTINGS.sameSiteTabLimit
  };
}

function fillForm(settings) {
  document.getElementById('askAutoCloseSeconds').value = settings.askAutoCloseSeconds;
  document.getElementById('checkEmptyTabs').checked = Boolean(settings.checkEmptyTabs);
  document.getElementById('sameSiteTabLimit').value = settings.sameSiteTabLimit;
}

function showStatus(message) {
  statusEl.textContent = message;
  setTimeout(() => {
    if (statusEl.textContent === message) {
      statusEl.textContent = '';
    }
  }, 2000);
}

function setQuickActionsDisabled(disabled) {
  for (const button of quickActionButtons) {
    button.disabled = disabled;
  }
}

function formatQuickActionStatus(action, response) {
  if (!response?.ok) {
    if (response?.reason === 'busy') {
      return '当前 Tab 正在处理中';
    }
    return '操作失败，请重试';
  }

  if (action === 'ungroup-all') {
    if (!response.ungroupedCount) {
      return '当前窗口没有已分组的 Tab';
    }
    return `已取消 ${response.ungroupedCount} 个 Tab 的分组`;
  }

  if (action === 'dedup-close') {
    if (!response.closedCount) {
      return '未发现重复 Tab';
    }
    return `已关闭 ${response.closedCount} 个重复 Tab`;
  }

  if (action === 'dedup-organize') {
    if (!response.groupCount) {
      return '未发现重复 Tab';
    }
    return `已整理 ${response.groupCount} 组重复 Tab`;
  }

  return '操作完成';
}

async function runQuickAction(action) {
  setQuickActionsDisabled(true);

  try {
    const response = await chrome.runtime.sendMessage({ type: 'QUICK_ACTION', action });
    showStatus(formatQuickActionStatus(action, response));
  } catch (error) {
    console.error('[Tab Dedup] Quick action failed:', error);
    showStatus('操作失败，请重试');
  } finally {
    setQuickActionsDisabled(false);
  }
}

function clampSettings(settings) {
  settings.askAutoCloseSeconds = Math.min(30, Math.max(1, settings.askAutoCloseSeconds));
  settings.sameSiteTabLimit = Math.min(20, Math.max(1, Math.round(settings.sameSiteTabLimit)));
  return settings;
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(null);
  fillForm(mergeSettings(stored));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  saveBtn.disabled = true;

  const partial = clampSettings(readForm());
  const stored = await chrome.storage.sync.get(null);
  const merged = mergeSettings({ ...stored, ...partial });

  await chrome.storage.sync.set({
    askAutoCloseSeconds: merged.askAutoCloseSeconds,
    checkEmptyTabs: merged.checkEmptyTabs,
    sameSiteTabLimit: merged.sameSiteTabLimit
  });

  fillForm(merged);
  showStatus('已保存');
  saveBtn.disabled = false;
});

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('quick-ungroup').addEventListener('click', () => {
  runQuickAction('ungroup-all');
});

document.getElementById('quick-dedup').addEventListener('click', () => {
  runQuickAction('dedup-close');
});

document.getElementById('quick-group').addEventListener('click', () => {
  runQuickAction('dedup-organize');
});

loadSettings();
