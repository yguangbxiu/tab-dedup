const form = document.getElementById('settings-form');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');
const openOptionsBtn = document.getElementById('open-options');

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

loadSettings();
