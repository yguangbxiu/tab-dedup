(function () {
  if (window.__tabDedupOverlay) {
    return;
  }

  let countdownTimer = null;
  let toastTimer = null;
  let promptGeneration = 0;
  let promptKeydownHandler = null;

  function removeToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    const host = document.getElementById('tab-dedup-toast-host');
    if (host) {
      host.remove();
    }
  }

  function removeOverlay() {
    promptGeneration += 1;
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (promptKeydownHandler) {
      document.removeEventListener('keydown', promptKeydownHandler, true);
      promptKeydownHandler = null;
    }
    const host = document.getElementById('tab-dedup-overlay-host');
    if (host) {
      host.remove();
    }
  }

  function handlePromptKeydown(event) {
    const key = event.key;
    if (key === '1' || key === 'y' || key === 'Y') {
      event.preventDefault();
      sendChoice('close');
    } else if (key === '2' || key === 'n' || key === 'N') {
      event.preventDefault();
      sendChoice('keep');
    }
  }

  function sendChoice(choice) {
    removeOverlay();
    chrome.runtime.sendMessage({
      type: 'DEDUP_USER_CHOICE',
      choice
    });
  }

  function formatCloseButtonText(remaining) {
    if (remaining > 0) {
      return `是（${remaining}s 后自动执行）`;
    }
    return '是';
  }

  function showOverlay(payload) {
    removeOverlay();
    const generation = promptGeneration;

    const host = document.createElement('div');
    host.id = 'tab-dedup-overlay-host';

    const banner = document.createElement('div');
    banner.className = 'tab-dedup-banner';

    const text = document.createElement('div');
    text.className = 'tab-dedup-text';

    const title = document.createElement('p');
    title.className = 'tab-dedup-title';
    title.textContent = `检测到 ${payload.matchCount} 个相同域名的 Tab，是否关闭？`;

    const subtitle = document.createElement('p');
    subtitle.className = 'tab-dedup-subtitle';
    subtitle.textContent = payload.hostname
      ? `${payload.hostname}${payload.sampleTitle ? ` · ${payload.sampleTitle}` : ''}`
      : payload.sampleTitle || '';

    text.appendChild(title);
    text.appendChild(subtitle);

    const actions = document.createElement('div');
    actions.className = 'tab-dedup-actions';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tab-dedup-btn tab-dedup-btn-primary';
    closeBtn.textContent = '是';
    closeBtn.addEventListener('click', () => sendChoice('close'));

    const keepBtn = document.createElement('button');
    keepBtn.type = 'button';
    keepBtn.className = 'tab-dedup-btn tab-dedup-btn-secondary';
    keepBtn.textContent = '否';
    keepBtn.addEventListener('click', () => sendChoice('keep'));

    actions.appendChild(closeBtn);
    actions.appendChild(keepBtn);

    banner.appendChild(text);
    banner.appendChild(actions);
    host.appendChild(banner);
    document.documentElement.appendChild(host);

    promptKeydownHandler = handlePromptKeydown;
    document.addEventListener('keydown', promptKeydownHandler, true);

    if (payload.autoCloseEnabled && payload.autoCloseSeconds > 0) {
      let remaining = payload.autoCloseSeconds;
      closeBtn.textContent = formatCloseButtonText(remaining);

      countdownTimer = setInterval(() => {
        if (generation !== promptGeneration) {
          return;
        }
        remaining -= 1;
        if (remaining <= 0) {
          sendChoice('close');
          return;
        }
        closeBtn.textContent = formatCloseButtonText(remaining);
      }, 1000);
    }
  }

  function showSwitchToast(payload) {
    removeToast();

    const durationMs = payload.durationMs || 1500;
    const host = document.createElement('div');
    host.id = 'tab-dedup-toast-host';

    const toast = document.createElement('div');
    toast.className = 'tab-dedup-toast';
    toast.textContent = payload.message || '操作已完成';

    host.appendChild(toast);
    document.documentElement.appendChild(host);

    toastTimer = setTimeout(() => {
      toast.classList.add('tab-dedup-toast-out');
      toastTimer = setTimeout(removeToast, 200);
    }, durationMs);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SHOW_DEDUP_PROMPT') {
      showOverlay(message.payload);
    }

    if (message.type === 'SHOW_SWITCH_TOAST') {
      showSwitchToast(message.payload);
    }
  });

  window.__tabDedupOverlay = {
    showOverlay,
    showSwitchToast
  };
})();
