const form = document.getElementById('settings-form');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');

function getSelectedRadio(name) {
  const selected = form.querySelector(`input[name="${name}"]:checked`);
  return selected ? selected.value : null;
}

function setSelectedRadio(name, value) {
  const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) {
    input.checked = true;
  }
}

function readForm() {
  return {
    matchMode: getSelectedRadio('matchMode') || DEFAULT_SETTINGS.matchMode,
    whitelist: document.getElementById('whitelist').value,
    blacklist: document.getElementById('blacklist').value,
    askAutoCloseEnabled: document.getElementById('askAutoCloseEnabled').checked,
    askAutoCloseSeconds: Number(document.getElementById('askAutoCloseSeconds').value) || DEFAULT_SETTINGS.askAutoCloseSeconds
  };
}

function fillForm(settings) {
  setSelectedRadio('matchMode', settings.matchMode);
  document.getElementById('whitelist').value = settings.whitelist || '';
  document.getElementById('blacklist').value = settings.blacklist || '';
  document.getElementById('askAutoCloseEnabled').checked = Boolean(settings.askAutoCloseEnabled);
  document.getElementById('askAutoCloseSeconds').value = settings.askAutoCloseSeconds;
}

function showStatus(message) {
  statusEl.textContent = message;
  setTimeout(() => {
    if (statusEl.textContent === message) {
      statusEl.textContent = '';
    }
  }, 2000);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(null);
  fillForm(mergeSettings(stored));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  saveBtn.disabled = true;

  const settings = readForm();
  settings.askAutoCloseSeconds = Math.min(30, Math.max(1, settings.askAutoCloseSeconds));

  await chrome.storage.sync.set(settings);
  fillForm(settings);
  showStatus('设置已保存');
  saveBtn.disabled = false;
});

loadSettings();
