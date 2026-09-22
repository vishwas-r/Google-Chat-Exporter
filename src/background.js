// ============================================================
// Google Chat Exporter v2.0 — background.js (Service Worker)
// 100% private: no external requests, no telemetry, no tracking
// ============================================================

importScripts('lib/jszip.min.js');
const mediaRequests = new Map();
// Persist pending download/checkpoint associations so worker suspension is safe.
let checkpointQueue = Promise.resolve();
function serializeCheckpoint(work) {
  const next = checkpointQueue.then(work);
  checkpointQueue = next.catch(() => {});
  return next;
}

async function reconcileCheckpoint(downloadId) {
  const pendingKey = `gcePending:${downloadId}`;
  const pending = (await chrome.storage.local.get(pendingKey))[pendingKey];
  if (!pending) return;
  const [download] = await chrome.downloads.search({ id: downloadId });
  if (download?.state === 'in_progress') return;
  if (download?.state === 'complete') {
    const old = (await chrome.storage.local.get(pending.key))[pending.key];
    if (!old || pending.value.timestamp > old.timestamp) {
      await chrome.storage.local.set({ [pending.key]: pending.value });
    } else if (pending.value.timestamp === old.timestamp) {
      const fingerprints = [...new Set([...old.fingerprints, ...pending.value.fingerprints])];
      await chrome.storage.local.set({ [pending.key]: { ...old, fingerprints } });
    }
  }
  await chrome.storage.local.remove(pendingKey);
}

function queueCheckpoint(downloadId, checkpoint) {
  if (!/^gceCheckpoint:[a-f0-9]{64}$/.test(checkpoint.key) ||
      !Number.isFinite(checkpoint.value?.timestamp) || checkpoint.value.timestamp <= 0 ||
      !Array.isArray(checkpoint.value.fingerprints) ||
      !checkpoint.value.fingerprints.every(id => /^[a-f0-9]{64}$/.test(id))) {
    throw new Error('Invalid checkpoint');
  }
  return serializeCheckpoint(async () => {
    await chrome.storage.local.set({ [`gcePending:${downloadId}`]: checkpoint });
    await reconcileCheckpoint(downloadId);
  });
}

chrome.downloads.onChanged.addListener(delta => {
  if (delta.state) serializeCheckpoint(() => reconcileCheckpoint(delta.id)).catch(console.error);
});

// Reconcile any downloads that completed while this worker was inactive.
chrome.storage.local.get(null).then(data => {
  for (const key of Object.keys(data)) {
    if (/^gcePending:\d+$/.test(key)) serializeCheckpoint(() => reconcileCheckpoint(Number(key.split(':')[1]))).catch(console.error);
  }
}).catch(console.error);
function mediaRequestKey(sender, id) {
  return `${sender.tab?.id}:${sender.frameId}:${id}`;
}

// ── Context Menu Setup ──────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Remove any existing menus to prevent duplicates on update
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'export_txt',
      title: '📄 Export Chat as TXT',
      contexts: ['all'],
      documentUrlPatterns: [
        'https://chat.google.com/*',
        'https://mail.google.com/*'
      ]
    });

    chrome.contextMenus.create({
      id: 'export_html',
      title: '🌐 Export Chat as HTML (with media)',
      contexts: ['all'],
      documentUrlPatterns: [
        'https://chat.google.com/*',
        'https://mail.google.com/*'
      ]
    });
  });
});

// ── Context Menu Click Handler ──────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const format = info.menuItemId === 'export_html' ? 'html' : 'txt';
  try {
    await triggerExport(tab, format);
  } catch (err) {
    console.error('[GCE BG] Export error:', err);
  }
});

// ── Message Handler (from popup & content script) ───────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'popupExport') {
    // Triggered from popup button
    (async () => {
      try {
        const tab = msg.tabId ? await chrome.tabs.get(msg.tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (!tab) { sendResponse({ success: false, error: 'No active tab found.' }); return; }
        await triggerExport(tab, msg.format || 'txt', msg.settings);
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // keep channel open
  }

  if (msg.action === 'packageAndDownload') {
    // Content script sends extracted data here for packaging
    (async () => {
      try {
        if (msg.payload.sourceUrl && sender.tab?.id) {
          const tab = await chrome.tabs.get(sender.tab.id);
          if (tab.url !== msg.payload.sourceUrl) throw new Error('Conversation changed during export. Please retry.');
        }
        const result = msg.format === 'html'
          ? await packageHtml(msg.payload)
          : await packageTxt(msg.payload);
        let checkpointWarning = '';
        if (msg.payload.checkpoint) {
          try { await queueCheckpoint(result.downloadId, msg.payload.checkpoint); }
          catch { checkpointWarning = 'Export downloaded, but its checkpoint could not be saved. Next export may repeat messages.'; }
        }
        sendResponse({ success: true, ...result, checkpointWarning });
      } catch (err) {
        console.error('[GCE BG] Package error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.action === 'cancelMediaBg') {
    mediaRequests.get(mediaRequestKey(sender, msg.requestId))?.abort();
    sendResponse({ success: true });
    return false;
  }

  if (msg.action === 'downloadMediaBg') {
    // Content script asks background to fetch media (bypasses CORS)
    (async () => {
      const key = mediaRequestKey(sender, msg.requestId);
      const controller = new AbortController();
      mediaRequests.set(key, controller);
      try {
        const result = await fetchMediaAsBase64(msg.url, controller.signal);
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      } finally {
        mediaRequests.delete(key);
      }
    })();
    return true;
  }

  if (msg.action === 'exportStateUpdate') {
    // Relay progress updates to popup
    chrome.runtime.sendMessage(msg).catch(() => {});
    return false;
  }
});

// ── Core Export Trigger (PWA-safe) ─────────────────────────

/**
 * Trigger export on a tab with PWA/app window support.
 * Uses multi-strategy injection to handle normal tabs AND PWA windows.
 */
async function triggerExport(contextMenuTab, format, overrides = {}) {
  // Find the best target tab (handles PWA windows)
  const targetTabId = await resolveTargetTab(contextMenuTab);
  if (!targetTabId) {
    console.error('[GCE BG] Could not find a Google Chat tab to export.');
    return;
  }

  // Ensure content script is alive in that tab; re-inject if needed
  const injected = await ensureContentScript(targetTabId);
  if (!injected) {
    console.error('[GCE BG] Could not inject content script into tab', targetTabId);
    return;
  }

  // Send export command
  const settings = { ...await getSettings(), ...overrides };
  settings.sourceUrl = (await chrome.tabs.get(targetTabId)).url;
  chrome.tabs.sendMessage(targetTabId, {
    action: 'startExport',
    format,
    loadAll: settings.loadAll !== false,  // default true
    includeMedia: settings.includeMedia !== false,  // default true for html
    dateFrom: settings.dateFrom || '',
    incremental: settings.incremental === true,
    sourceUrl: settings.sourceUrl
  }, (resp) => {
    if (chrome.runtime.lastError) {
      // Final fallback: direct script injection — bypasses message channel entirely
      // This is the key fix for Brave PWA windows
      chrome.scripting.executeScript({
        target: { tabId: targetTabId, allFrames: true },
        func: injectableExportTrigger,
        args: [format, settings]
      }).catch(err => console.error('[GCE BG] executeScript fallback failed:', err));
    }
  });
}

/**
 * Resolves the best tab for export.
 * Strategy 1: Use the tab from the context menu event (works in normal tabs).
 * Strategy 2: Query ALL open tabs (including app windows) for chat.google.com.
 * Strategy 3: Query for mail.google.com as fallback.
 */
async function resolveTargetTab(contextMenuTab) {
  // Check if the context menu tab itself is a valid chat tab
  if (contextMenuTab && contextMenuTab.url &&
      contextMenuTab.url.match(/^https:\/\/(chat|mail)\.google\.com/)) {
    return contextMenuTab.id;
  }

  // Query ALL windows (type: 'app' covers PWA windows; type: 'normal' covers browser tabs)
  const allTabs = await chrome.tabs.query({});
  const chatTab = allTabs.find(t => t.url?.match(/^https:\/\/chat\.google\.com/));
  if (chatTab) return chatTab.id;

  const mailTab = allTabs.find(t => t.url?.match(/^https:\/\/mail\.google\.com/));
  if (mailTab) return mailTab.id;

  return null;
}

/**
 * Ensures the content script is alive in the tab.
 * If not, re-injects it using scripting.executeScript.
 * This is critical for PWA windows where the content script
 * may not have a live message channel.
 */
async function ensureContentScript(tabId) {
  // Try a ping first
  const alive = await new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, resp => {
      if (chrome.runtime.lastError || !resp?.alive) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });

  if (alive) return true;

  // Re-inject the content script
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js']
    });
    // Wait for initialization
    await sleep(400);
    return true;
  } catch (err) {
    console.error('[GCE BG] Failed to inject content script:', err);
    return false;
  }
}

/**
 * Injectable function for the nuclear fallback.
 * This runs directly in the page context via executeScript,
 * bypassing message passing entirely — works in all PWA/app window scenarios.
 */
function injectableExportTrigger(format, settings) {
  // Dispatch a custom event that content.js listens for
  window.dispatchEvent(new CustomEvent('gce:startExport', {
    detail: { format, ...settings }
  }));
}

// ── Settings ────────────────────────────────────────────────

async function getSettings() {
  try {
    const data = await chrome.storage.local.get('gceSettings');
    return data.gceSettings || { loadAll: true, includeMedia: true };
  } catch {
    return { loadAll: true, includeMedia: true };
  }
}

// ── TXT Packaging ───────────────────────────────────────────

async function packageTxt({ conversationName, messages, exportDate, history }) {
  const name = conversationName || 'Google Chat';
  const line = '─'.repeat(60);
  const header = [
    '═'.repeat(60),
    '  GOOGLE CHAT EXPORT',
    '═'.repeat(60),
    '',
    `Chat:      ${name}`,
    `Messages:  ${messages.length}`,
    `Exported:  ${new Date(exportDate).toLocaleString()}`,
    `History:   ${history?.reason || 'unspecified'}${history?.warning ? ' — ' + history.warning : ''}`,
    ...(history?.since ? [`New since: ${new Date(history.since).toISOString()}`] : []),
    '',
    line,
    ''
  ].join('\n');

  let body = '';
  let lastDate = '';

  for (const msg of messages) {
    if (msg.date && msg.date !== lastDate) {
      body += `\n──────────── ${msg.date} ────────────\n\n`;
      lastDate = msg.date;
    }

    body += `[${msg.timestamp || '—'}] ${msg.sender || 'Unknown'}: ${msg.text || ''}`;

    if (msg.media && msg.media.length > 0) {
      for (const m of msg.media) {
        const label = {
          image: `📷 Image: ${m.name || 'image'}`,
          gif:   `🎞️  GIF: ${m.name || 'sticker'}`,
          audio: `🎤 Voice message${m.durationMs ? ' (' + fmtDur(m.durationMs) + ')' : ''}`,
          video: `🎬 Video: ${m.name || 'video'}${m.durationMs ? ' (' + fmtDur(m.durationMs) + ')' : ''}`,
          file:  `📄 File: ${m.name || 'file'}`
        }[m.type] || `📎 Attachment: ${m.name || m.type}`;
        body += `\n  ${label}`;
      }
    }

    body += '\n';
  }

  body += `\n${line}\nEnd of conversation — ${name}\n`;

  const fullText = header + body;
  const filename = `${sanitize(name)}_${dateStr()}.txt`;
  const dataUrl = 'data:text/plain;charset=utf-8;base64,' + b64EncodeUtf8(fullText);

  const downloadId = await triggerDownload(dataUrl, filename);
  return { filename, downloadId };
}

// ── HTML + ZIP Packaging ────────────────────────────────────

async function packageHtml({ conversationName, messages, mediaFiles, exportDate, history }) {
  const name = conversationName || 'Google Chat';
  const zip = new JSZip();

  const htmlContent = generateHtml({ conversationName: name, messages, exportDate, history });
  const cssContent = generateCss();

  zip.file('index.html', htmlContent);
  zip.file('styles.css', cssContent);

  if (mediaFiles && mediaFiles.length > 0) {
    for (const file of mediaFiles) {
      zip.file(file.path, file.base64, { base64: true });
    }
  }

  const zipBase64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const filename = `${sanitize(name)}_${dateStr()}.zip`;
  const dataUrl = 'data:application/zip;base64,' + zipBase64;

  const downloadId = await triggerDownload(dataUrl, filename);
  return { filename, downloadId };
}

// ── HTML Generator ──────────────────────────────────────────

function generateHtml({ conversationName, messages, exportDate, history }) {
  let messagesHtml = '';
  let lastDate = '';
  let lastSender = '';

  for (const msg of messages) {
    if (msg.date && msg.date !== lastDate) {
      messagesHtml += `<div class="date-sep"><span>${esc(msg.date)}</span></div>\n`;
      lastDate = msg.date;
      lastSender = '';
    }

    const isSelf = msg.sender === 'You';
    const cls = isSelf ? 'msg msg-self' : 'msg msg-other';
    const showHeader = msg.sender !== lastSender;
    lastSender = msg.sender;

    let avatarHtml = '';
    if (showHeader) {
      const avatarUrl = safeResourceUrl(msg.avatarUrl);
      if (avatarUrl) {
        avatarHtml = `<img class="avatar" src="${esc(avatarUrl)}" alt="${esc(msg.sender)}" loading="lazy">`;
      } else {
        const initial = (msg.sender || '?').charAt(0).toUpperCase();
        avatarHtml = `<div class="avatar avatar-initial">${esc(initial)}</div>`;
      }
    } else {
      avatarHtml = `<div class="avatar-spacer"></div>`;
    }

    const senderHtml = showHeader ? `<div class="sender-name">${esc(msg.sender || 'Unknown')}</div>` : '';
    const timeHtml = msg.timestamp ? `<div class="time">${esc(msg.timestamp)}</div>` : '';

    let contentHtml = '';
    if (msg.text) {
      contentHtml += `<div class="bubble"><div class="text">${formatTextContent(msg.text)}</div>${timeHtml}</div>`;
    }

    if (msg.media && msg.media.length > 0) {
      for (const m of msg.media) {
        contentHtml += `<div class="media-card">${renderMediaHtml(m)}</div>`;
      }
    }

    if (!contentHtml) {
      contentHtml = `<div class="bubble"><div class="text empty">[Empty message]</div>${timeHtml}</div>`;
    }

    messagesHtml += `<div class="${cls}">${senderHtml}<div class="msg-row">${avatarHtml}${contentHtml}</div></div>\n`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(conversationName)} — Google Chat Export</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<div class="chat">
  <header>
    <div class="header-icon">${getBrandLogoSvg(38)}</div>
    <div class="header-info">
      <h1>${esc(conversationName)}</h1>
      ${history?.since ? `<p>New since ${esc(new Date(history.since).toISOString())}</p>` : ''}
      ${history?.warning ? `<p>${esc(history.warning)}</p>` : ''}
      <p>${messages.length} messages &middot; Exported ${new Date(exportDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
  </header>
  <div class="messages">${messagesHtml}</div>
</div>
</body>
</html>`;
}

function renderMediaHtml(m) {
  const localPath = safeResourceUrl(m._localPath);
  const url = safeResourceUrl(m.url);
  const src = esc(localPath || url);
  const name = esc(m.name || 'file');

  if (!src) {
    return `<div class="media-item media-file"><span class="file-chip"><span class="file-icon">${fileTypeIcon(m.name)}</span><span class="file-name">${name} [unavailable]</span></span></div>`;
  }

  switch (m.type) {
    case 'image':
    case 'gif':
      return `<div class="media-item media-image">
  <a href="${src}" target="_blank" rel="noopener noreferrer"><img src="${src}" alt="${name}" loading="lazy"></a>
</div>`;

    case 'audio': {
      const dur = m.durationMs ? fmtDur(m.durationMs) : '';
      return `<div class="media-item media-audio">
  <div class="audio-chip">
    <svg class="audio-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
    <span class="audio-label">Voice message${dur ? ' &middot; ' + dur : ''}</span>
    <a class="dl-link" href="${src}" download="${name}" title="Download"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>
  </div>
  <audio controls preload="metadata"><source src="${src}" type="${esc(m.mimeType || 'audio/mpeg')}"></audio>
</div>`;
    }

    case 'video': {
      const dur = m.durationMs ? fmtDur(m.durationMs) : '';
      return `<div class="media-item media-video">
  <video controls preload="metadata" playsinline><source src="${src}" type="${esc(m.mimeType || 'video/mp4')}"></video>
  <div class="video-label">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2"></rect></svg>
    <span>${name}${dur ? ' &middot; ' + dur : ''}</span>
    <a class="dl-link" href="${src}" download="${name}" title="Download"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>
  </div>
</div>`;
    }

    default:
      return `<div class="media-item media-file">
  <a class="file-chip" href="${src}" download="${name}">
    <span class="file-icon">${fileTypeIcon(m.name)}</span>
    <span class="file-name">${name}</span>
    <svg class="dl-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
  </a>
</div>`;
  }
}

function fileTypeIcon(name) {
  const ext = (name || '').split('.').pop()?.toLowerCase() || '';
  const icons = {
    pdf:  '📕', doc: '📘', docx: '📘',
    xls:  '📗', xlsx: '📗',
    ppt:  '📙', pptx: '📙',
    zip:  '🗜️', rar: '🗜️',
    txt:  '📄', csv: '📊',
    png:  '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🎞️', webp: '🖼️',
    mp3:  '🎵', wav: '🎵', m4a: '🎵',
    mp4:  '🎬', mov: '🎬', avi: '🎬'
  };
  return icons[ext] || '📎';
}

function getBrandLogoSvg(size = 36) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="512" height="512" rx="40" fill="#f8f9fa"/>
  <g transform="translate(56, 56) scale(1.25)">
    <path d="M76.37 0.51l0.01 76.47L0 76.96V20.77c0.567-3.973 1.743-7.31 3.53-10.01C7.937 4.08 14.343 0.717 22.75 0.67 40.523 0.577 58.397 0.523 76.37 0.51z" fill="#0066da"/>
    <path d="M76.37 0.51l157.42 0.02c0.332 0 0.653 0.101 0.92 0.29l0.37 0.27c-0.107 0.04-0.197 0.083-0.27 0.13a0.297 0.297 0 00-0.17 0.28l-0.02 75.51H76.41l-0.03-0.03L76.37 0.51z" fill="#fbbc04"/>
    <path d="M235.08 1.09l75.45 75.68-75.91 0.24 0.02-75.51c0-0.127 0.057-0.22 0.17-0.28 0.073-0.047 0.163-0.09 0.27-0.13z" fill="#ea4335"/>
    <path d="M0 76.96l76.38 0.02 0.03 0.03 0.02 105.68L0 182.67V76.96z" fill="#2684fc"/>
    <path d="M310.53 76.77l0.47 0.34v161.9c-1.773 9.687-6.793 15.943-15.06 18.77-2.947 1.013-7.29 1.513-13.03 1.5-37.26-0.06-74.9-0.117-112.92-0.17-5.52-0.007-11.12 0.033-16.8 0.12-0.313 0.007-0.58 0.12-0.8 0.34a15823.329 15823.329 0 00-56 56.02c-2.87 2.89-6.12 4.5-10.24 3.89-3.84-0.567-6.67-2.547-8.49-5.94-0.767-1.44-1.157-4.067-1.17-7.88-0.047-15.46-0.063-30.97-0.05-46.53l-0.01-38.28 37.78-37.78c0.332-0.333 0.786-0.52 1.26-0.52l118.3 0.04c0.455 0 0.83-0.375 0.83-0.83l-0.03-104.75h0.05l75.91-0.24z" fill="#00ac47"/>
    <path d="M76.43 182.69v38.16l0.01 38.28c-15.98 0.093-31.823 0.123-47.53 0.09-6.547-0.013-11.263-0.527-14.15-1.54-8.093-2.827-13.013-9.093-14.76-18.8v-56.21l76.43 0.02z" fill="#00832d"/>
  </g>
  <circle cx="380" cy="380" r="90" fill="#ffffff" />
  <circle cx="380" cy="380" r="85" fill="#ffffff" stroke="#e8eaed" stroke-width="5" />
  <g transform="translate(345, 325)">
    <path d="M35,0 L35,65" stroke="#1a73e8" stroke-width="18" stroke-linecap="round" />
    <path d="M5,40 L35,70 L65,40" stroke="#1a73e8" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    <rect x="5" y="85" width="60" height="12" rx="6" fill="#34a853" />
  </g>
</svg>`;
}

function generateCss() {
  return `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Google Sans',Roboto,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f9;color:#202124;line-height:1.5}
.chat{max-width:760px;margin:0 auto;background:#fff;min-height:100vh;border-left:1px solid #dadce0;border-right:1px solid #dadce0;box-shadow:0 1px 6px rgba(0,0,0,0.08)}
header{padding:20px 24px;border-bottom:1px solid #dadce0;position:sticky;top:0;background:#fff;z-index:10;display:flex;align-items:center;gap:14px}
.header-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0}
.header-icon svg{border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,0.1)}
header h1{font-size:17px;font-weight:600;color:#202124}
header p{font-size:12px;color:#5f6368;margin-top:2px}
.messages{padding:16px 24px;display:flex;flex-direction:column;gap:2px}
.date-sep{text-align:center;margin:20px 0 12px}
.date-sep span{background:#e8eaed;padding:4px 16px;font-size:11px;color:#5f6368;border-radius:16px;font-weight:500;letter-spacing:.3px}
.msg{display:flex;flex-direction:column;margin-bottom:2px}
.msg-self{align-items:flex-end}
.msg-other{align-items:flex-start}
.sender-name{font-size:11.5px;font-weight:600;margin-bottom:3px;margin-top:12px}
.msg-self .sender-name{text-align:right;padding-right:44px;color:#1967d2}
.msg-other .sender-name{text-align:left;padding-left:44px;color:#3c4043}
.msg-row{display:flex;align-items:flex-end;gap:8px;max-width:78%}
.msg-self .msg-row{flex-direction:row-reverse}
.avatar{width:30px;height:30px;border-radius:50%;flex-shrink:0;object-fit:cover;align-self:flex-end;border:1px solid #e8eaed}
.avatar-initial{width:30px;height:30px;border-radius:50%;flex-shrink:0;background:#5f6368;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;align-self:flex-end}
.msg-self .avatar-initial{background:#1a73e8}
.avatar-spacer{width:30px;flex-shrink:0}
.bubble{padding:9px 14px;position:relative;word-wrap:break-word;flex:0 1 auto;min-width:0;border-radius:20px}
.msg-self .bubble{background:#d3e3fd;border-radius:20px 4px 4px 20px}
.msg-other .bubble{background:#f1f3f4;border-radius:4px 20px 20px 4px}
.text{font-size:14px;line-height:1.55;color:#202124;white-space:pre-wrap}
.text a{color:#1a73e8;text-decoration:none}.text a:hover{text-decoration:underline}
.text.empty{font-style:italic;color:#80868b;font-size:12px}
.time{font-size:10px;color:#80868b;margin-top:4px}
.msg-self .time{text-align:right}
.media-card{overflow:hidden;flex:0 1 auto;min-width:0;border-radius:12px;border:1px solid #e0e0e0;background:#fafafa}
.msg-self .media-card{border-radius:16px 4px 4px 16px}
.msg-other .media-card{border-radius:4px 16px 16px 4px}
.media-item{margin:0}
.media-image img{max-width:100%;max-height:300px;display:block;object-fit:cover;cursor:pointer;transition:opacity .2s}.media-image img:hover{opacity:.9}
.media-image a{display:block;text-decoration:none}
.media-audio{display:flex;flex-direction:column;gap:6px;padding:12px 14px}
.audio-chip{display:flex;align-items:center;gap:8px;color:#1a73e8;font-size:13px;font-weight:500}
.audio-icon{flex-shrink:0;color:#1a73e8}
audio{width:100%;height:34px;border-radius:17px;margin-top:4px}
.media-video video{width:100%;max-width:320px;display:block;background:#000}
.video-label{display:flex;align-items:center;gap:6px;padding:7px 12px;font-size:12px;color:#5f6368}
.video-label svg{flex-shrink:0}
.dl-link{display:inline-flex;align-items:center;color:#80868b;margin-left:auto;padding:4px;border-radius:4px;transition:color .15s}.dl-link:hover{color:#1a73e8}
.media-file{margin:0}
.file-chip{display:flex;align-items:center;gap:10px;padding:12px 14px;font-size:13px;color:#3c4043;text-decoration:none;transition:background .15s}
.file-chip:hover{background:#f8f9fa}
.file-icon{font-size:18px;flex-shrink:0}
.file-name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.dl-icon{flex-shrink:0;color:#5f6368;margin-left:auto}
@media(max-width:600px){.chat{border:none;box-shadow:none}.msg-row{max-width:94%}}`;
}

// ── Media Fetch (background-side, bypasses CORS) ────────────

async function fetchMediaAsBase64(url, signal) {
  const strategies = [
    () => fetch(url, { credentials: 'include', signal }),
    () => fetch(url, { credentials: 'omit', signal }),
    () => fetch(url, { redirect: 'follow', credentials: 'include', signal })
  ];

  for (const strategy of strategies) {
    signal?.throwIfAborted();
    try {
      const resp = await strategy();
      if (resp.ok) {
        const mimeType = resp.headers.get('content-type') || 'application/octet-stream';
        const buf = await resp.arrayBuffer();
        if (buf.byteLength === 0) continue;
        return { success: true, base64: arrayBufToBase64(buf), mimeType };
      }
    } catch {
      signal?.throwIfAborted();
      // try next strategy
    }
  }
  return { success: false, error: 'All fetch strategies failed' };
}

function arrayBufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i += 32768) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  }
  return btoa(bin);
}

// ── Utilities ───────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sanitize(str) {
  return (str || 'chat').replace(/[^a-z0-9\-_]/gi, '_').substring(0, 60);
}

function dateStr() {
  return new Date().toISOString().slice(0, 10);
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeResourceUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';

  if (/^media\/[a-zA-Z0-9._/-]+$/.test(candidate) &&
      !candidate.split('/').includes('..')) {
    return candidate;
  }

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function formatTextContent(text) {
  let t = esc(text);
  t = t.replace(/\n/g, '<br>');
  t = t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return t;
}

function fmtDur(ms) {
  const s = Math.round((ms || 0) / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function b64EncodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function triggerDownload(dataUrl, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (dlId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(dlId);
      }
    });
  });
}
