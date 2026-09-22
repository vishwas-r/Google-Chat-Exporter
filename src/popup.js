// ============================================================
// Google Chat Exporter v2.1 — popup.js
// ============================================================

'use strict';

const $ = id => document.getElementById(id);

// ── Settings persistence ─────────────────────────────────────

async function loadSettings() {
  try {
    const { gceSettings } = await chrome.storage.local.get('gceSettings');
    const s = gceSettings || {};
    if (s.format) $('format-select').value = s.format;
    if (typeof s.loadAll !== 'undefined') $('load-all').checked = s.loadAll;
    if (typeof s.includeMedia !== 'undefined') $('include-media').checked = s.includeMedia;
    if (s.dateFrom) $('date-from').value = s.dateFrom;
    $('incremental').checked = s.incremental === true;
    updateIncrementalControls();
    updateMediaRowVisibility();
  } catch { /* storage not accessible */ }
}

function saveSettings() {
  const settings = {
    format: $('format-select').value,
    loadAll: $('load-all').checked,
    includeMedia: $('include-media').checked,
    dateFrom: $('date-from').value,
    incremental: $('incremental').checked
  };
  chrome.storage.local.set({ gceSettings: settings }).catch(() => {});
}

function updateMediaRowVisibility() {
  const isHtml = $('format-select').value === 'html';
  $('media-row').style.opacity = isHtml ? '1' : '0.45';
  $('include-media').disabled = !isHtml;
}

function updateIncrementalControls() {
  const enabled = $('incremental').checked;
  $('load-all').disabled = enabled;
  $('date-from').disabled = enabled;
}

// ── Conversation Status Bar ──────────────────────────────────

async function detectConversation() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || !tab.url?.match(/^https:\/\/(chat|mail)\.google\.com/)) {
      setConvStatus(false, 'Not on Google Chat');
      return;
    }

    // Try to get conversation name from content script
    chrome.tabs.sendMessage(tab.id, { action: 'getConversationName' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        setConvStatus(true, 'Google Chat — open a conversation');
        return;
      }
      const name = resp.name;
      if (name) {
        setConvStatus(true, name);
      } else {
        setConvStatus(true, 'Google Chat — open a conversation');
      }
    });
  } catch {
    setConvStatus(false, 'Not on Google Chat');
  }
}

function setConvStatus(online, name) {
  const dot = $('conv-dot');
  const label = $('conv-name');
  dot.className = 'conv-dot' + (online ? '' : ' offline');
  label.textContent = name;
  label.className = 'conv-name' + (online ? '' : ' muted');
}

// ── Export ───────────────────────────────────────────────────

let isExporting = false;

async function triggerExport() {
  if (isExporting) return;
  isExporting = true;

  const btn = $('export-btn');
  btn.disabled = true;
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="animation:spin .7s linear infinite;fill:white;width:17px;height:17px;flex-shrink:0">
      <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
    </svg>
    Exporting...`;

  showStatus('Starting export...', 2);

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab) {
      throw new Error('No active tab found.');
    }

    if (!tab.url?.match(/^https:\/\/(chat|mail)\.google\.com/)) {
      throw new Error('Please navigate to Google Chat first.');
    }

    const format = $('format-select').value;
    const loadAll = $('load-all').checked;
    const includeMedia = $('include-media').checked;
    const dateFrom = $('date-from').value;

    const incremental = $('incremental').checked;
    const settings = { loadAll, includeMedia, dateFrom, incremental };

    const response = await chrome.runtime.sendMessage({
      action: 'popupExport',
      format,
      tabId: tab.id,
      settings
    }).catch(err => ({ success: false, error: err?.message }));

    if (!response?.success) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'startExport',
        format,
        loadAll,
        includeMedia,
        dateFrom,
        incremental
      }, () => {
        if (chrome.runtime.lastError) {
          showStatus('❌ ' + (response?.error || 'Could not start export'), 0, 'error');
          resetBtn();
        }
      });
    }

  } catch (err) {
    showStatus('❌ ' + err.message, 0, 'error');
    resetBtn();
  }
}

function resetBtn() {
  isExporting = false;
  const btn = $('export-btn');
  btn.disabled = false;
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="fill:white;width:17px;height:17px;flex-shrink:0">
      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
    </svg>
    Export Current Conversation`;
}

// ── Status / Progress ────────────────────────────────────────

function showStatus(text, percent, state = 'working') {
  $('status-area').classList.add('visible');
  $('status-text').textContent = text;
  const bar = $('progress-bar');
  bar.style.width = percent + '%';
  bar.className = 'progress-bar' + (state === 'done' ? ' done' : state === 'error' ? ' error' : '');

  const spinner = $('status-spinner');
  spinner.style.display = (state === 'done' || state === 'error') ? 'none' : 'block';
}

function hideStatus() {
  $('status-area').classList.remove('visible');
  $('progress-bar').style.width = '0%';
  $('progress-bar').className = 'progress-bar';
}

// ── Background message relay (progress updates from content) ─

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'exportStateUpdate') {
    showStatus(msg.text || '', msg.percent || 0, msg.state || 'working');
    if (msg.state === 'done') {
      resetBtn();
      setTimeout(hideStatus, 3500);
    } else if (msg.state === 'error') {
      resetBtn();
      setTimeout(hideStatus, 5000);
    }
  }
});

// Add spin keyframe to popup
const style = document.createElement('style');
style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(style);

// ── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  detectConversation();

  $('export-btn').addEventListener('click', triggerExport);
  $('format-select').addEventListener('change', () => {
    updateMediaRowVisibility();
    saveSettings();
  });
  $('load-all').addEventListener('change', saveSettings);
  $('include-media').addEventListener('change', saveSettings);
  $('date-from').addEventListener('change', saveSettings);
  $('incremental').addEventListener('change', () => { updateIncrementalControls(); saveSettings(); });
});
