(function () {
  const PROMPT_POSITIONS = {
    topLeft: { alignItems: 'flex-start', justifyContent: 'flex-start' },
    topRight: { alignItems: 'flex-start', justifyContent: 'flex-end' },
    topCenter: { alignItems: 'flex-start', justifyContent: 'center' },
    bottomLeft: { alignItems: 'flex-end', justifyContent: 'flex-start' },
    bottomRight: { alignItems: 'flex-end', justifyContent: 'flex-end' },
    center: { alignItems: 'center', justifyContent: 'center' }
  };

  const ACTION_LABELS = {
    close: '清理',
    organize: '整理',
    none: '无操作'
  };

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
    if (key === '1' || key === 'c' || key === 'C') {
      event.preventDefault();
      sendChoice('close');
    } else if (key === '2' || key === 'g' || key === 'G') {
      event.preventDefault();
      sendChoice('organize');
    } else if (key === '3' || key === 'n' || key === 'N' || key === 'Escape') {
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

  function formatActionButtonText(action, remaining) {
    const label = ACTION_LABELS[action] || ACTION_LABELS.close;
    if (remaining > 0) {
      return `${label}（${remaining}s 后自动执行）`;
    }
    return label;
  }

  function showOverlay(payload) {
    removeOverlay();
    const generation = promptGeneration;

    const position = payload.promptPosition || 'topRight';
    const size = payload.promptSize || 'small';
    const layout = PROMPT_POSITIONS[position] || PROMPT_POSITIONS.topRight;
    const autoAction = payload.autoActionOnTimeout || 'close';

    const host = document.createElement('div');
    host.id = 'tab-dedup-overlay-host';
    host.className = `tab-dedup-pos-${position}`;
    host.style.alignItems = layout.alignItems;
    host.style.justifyContent = layout.justifyContent;

    const banner = document.createElement('div');
    banner.className = `tab-dedup-banner tab-dedup-size-${size}`;

    const text = document.createElement('div');
    text.className = 'tab-dedup-text';

    const title = document.createElement('p');
    title.className = 'tab-dedup-title';
    title.textContent =
      payload.scanMode === 'bulk'
        ? `检测到 ${payload.duplicateCount} 个重复 Tab（${payload.groupCount} 组）`
        : `检测到 ${payload.matchCount} 个相同域名的 Tab`;

    const subtitle = document.createElement('p');
    subtitle.className = 'tab-dedup-subtitle';
    if (payload.scanMode === 'bulk') {
      subtitle.textContent = '可选择清理、整理到分组或忽略';
    } else {
      subtitle.textContent = payload.hostname
        ? `${payload.hostname}${payload.sampleTitle ? ` · ${payload.sampleTitle}` : ''}`
        : payload.sampleTitle || '';
    }

    text.appendChild(title);
    text.appendChild(subtitle);

    const actions = document.createElement('div');
    actions.className = 'tab-dedup-actions';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tab-dedup-btn tab-dedup-btn-primary';
    closeBtn.textContent = ACTION_LABELS.close;
    closeBtn.addEventListener('click', () => sendChoice('close'));

    const organizeBtn = document.createElement('button');
    organizeBtn.type = 'button';
    organizeBtn.className = 'tab-dedup-btn tab-dedup-btn-secondary';
    organizeBtn.textContent = ACTION_LABELS.organize;
    organizeBtn.addEventListener('click', () => sendChoice('organize'));

    const keepBtn = document.createElement('button');
    keepBtn.type = 'button';
    keepBtn.className = 'tab-dedup-btn tab-dedup-btn-secondary';
    keepBtn.textContent = '忽略';
    keepBtn.addEventListener('click', () => sendChoice('keep'));

    actions.appendChild(closeBtn);
    actions.appendChild(organizeBtn);
    actions.appendChild(keepBtn);

    banner.appendChild(text);
    banner.appendChild(actions);
    host.appendChild(banner);
    document.documentElement.appendChild(host);

    promptKeydownHandler = handlePromptKeydown;
    document.addEventListener('keydown', promptKeydownHandler, true);

    const shouldCountdown =
      payload.autoCloseEnabled &&
      payload.autoCloseSeconds > 0 &&
      autoAction !== 'none';

    if (shouldCountdown) {
      const targetBtn =
        autoAction === 'organize' ? organizeBtn : autoAction === 'close' ? closeBtn : null;

      if (targetBtn) {
        let remaining = payload.autoCloseSeconds;
        targetBtn.textContent = formatActionButtonText(autoAction, remaining);

        countdownTimer = setInterval(() => {
          if (generation !== promptGeneration) {
            return;
          }
          remaining -= 1;
          if (remaining <= 0) {
            sendChoice(autoAction);
            return;
          }
          targetBtn.textContent = formatActionButtonText(autoAction, remaining);
        }, 1000);
      }
    }
  }

  function showSwitchToast(payload) {
    removeToast();

    const durationMs = payload.durationMs || 1500;
    const host = document.createElement('div');
    host.id = 'tab-dedup-toast-host';
    if (payload.showUndoButton) {
      host.className = 'tab-dedup-toast-interactive';
    }

    const toast = document.createElement('div');
    toast.className = 'tab-dedup-toast';

    if (payload.showUndoButton) {
      const message = document.createElement('span');
      message.className = 'tab-dedup-toast-message';
      message.textContent = payload.message || '操作已完成';
      toast.appendChild(message);

      const actions = document.createElement('div');
      actions.className = 'tab-dedup-toast-actions';

      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'tab-dedup-toast-btn';
      undoBtn.textContent = '取消';
      undoBtn.addEventListener('click', () => {
        removeToast();
        chrome.runtime.sendMessage({ type: 'DEDUP_UNDO_ORGANIZE' });
      });

      actions.appendChild(undoBtn);
      toast.appendChild(actions);
    } else {
      toast.textContent = payload.message || '操作已完成';
    }

    host.appendChild(toast);
    document.documentElement.appendChild(host);

    toastTimer = setTimeout(() => {
      toast.classList.add('tab-dedup-toast-out');
      toastTimer = setTimeout(removeToast, 200);
    }, durationMs);
  }

  function bindOverlay() {
    window.__tabDedupOverlay = {
      showOverlay,
      showSwitchToast
    };

    if (window.__tabDedupOverlayListenerBound) {
      return;
    }

    chrome.runtime.onMessage.addListener((message) => {
      const overlay = window.__tabDedupOverlay;
      if (!overlay) {
        return;
      }

      if (message.type === 'SHOW_DEDUP_PROMPT') {
        overlay.showOverlay(message.payload);
      }

      if (message.type === 'SHOW_SWITCH_TOAST') {
        overlay.showSwitchToast(message.payload);
      }
    });

    window.__tabDedupOverlayListenerBound = true;
  }

  bindOverlay();
})();
