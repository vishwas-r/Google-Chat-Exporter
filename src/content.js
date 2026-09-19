// ============================================================
// Google Chat Exporter v2.0 — content.js
// Runs in Google Chat tabs (normal, Gmail-embedded, PWA/app window)
// 100% private: all extraction is local, zero external requests
// ============================================================

'use strict';

// ── Selector Configuration ──────────────────────────────────
// Loaded from selectors.json; populated on init
let SEL = null;

async function loadSelectors() {
  if (SEL) return SEL;
  try {
    const url = chrome.runtime.getURL('selectors.json');
    const resp = await fetch(url);
    SEL = await resp.json();
  } catch (err) {
    console.error('[GCE] Failed to load selectors.json, using inline fallback:', err);
    // Inline fallback so the extension still works even if resource load fails
    SEL = {
      frameName: 'single_full_screen',
      scrollContainers: ['.Bl2pUd','[role="main"]','div[data-is-scroll-wrapper="true"]','[data-conversation-container]'],
      messageGroups: 'div.nF6pT',
      messageText: 'div.DTp27d[jsname="bgckF"], div.DTp27d.Zc1Emd, div.GDhqjd, div.vdlEi',
      senderNameText: 'span.njhDLd, span.zX8Xib',
      senderNameAttr: 'span.ZTmjQb[data-name]',
      timestamp: 'span.FvYVyf, span.ud0FPb, [data-absolute-timestamp]',
      absoluteTimestampAttr: '[data-absolute-timestamp]',
      dateSeparator: 'div.Ao1xUb[role="heading"]',
      imageChip: 'div.avsS6d',
      imageImg: 'img.HQLhSc',
      imageButton: '.SMTuwf[data-action="7"]',
      gifChip: 'div.T0oWF',
      audioPlayer: '[data-media-type="audio"]',
      videoPlayer: '[data-media-type="video"]',
      fileChip: 'div.lRPruf',
      fileName: 'span.RhNmFb',
      fileButton: '[data-action="7"][title]',
      fileThumb: 'img.INRavc',
      videoLabel: '[aria-label^="Video,"]',
      avatarImg: 'img.hy2WD',
      avatarContainer: '.HTZBof',
      chipParentItem: 'li',
      chipWrapperFallback: '.V5MAMb',
      downloadAnchorGeneric: 'a[href*="DOWNLOAD_URL"]',
      chipDownloadAnchor: '.zeIMme a[href*="DOWNLOAD_URL"]',
      noiseSelectors: ['[aria-hidden="true"]','[role="tooltip"]','.R7SUqc','.UgwGlb'],
      conversationTitle: ['header.QHAzdb[aria-label]','[role="main"][aria-label]','span.mUIrbf-vQzf8d','div.nfJ0Zd','h1'],
      fallbackScrollable: 'div',
      attrs: {
        absoluteTimestamp: 'data-absolute-timestamp',
        groupId: 'data-id',
        senderName: 'data-name',
        mediaUrl: 'data-media-url',
        mediaDuration: 'data-media-duration-ms',
        mediaSourceType: 'data-media-source-type',
        ariaLabel: 'aria-label',
        title: 'title',
        href: 'href'
      }
    };
  }
  return SEL;
}

// ── Frame Detection ─────────────────────────────────────────

function isInChatFrame() {
  if (!SEL) return false;
  // Works for: normal tab, Gmail iframe (window.name), PWA standalone window
  const byName = window.name === SEL.frameName;
  const byContent = SEL.scrollContainers.some(sel => document.querySelector(sel));
  return byName || byContent;
}

// ── Progress Overlay ────────────────────────────────────────

let progressEl = null;

function showProgress(text, percent, state = 'working') {
  if (!progressEl) {
    progressEl = document.createElement('div');
    progressEl.id = 'gce-progress';

    const style = document.createElement('style');
    style.textContent = `
      #gce-progress {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: 'Google Sans', Roboto, sans-serif;
        pointer-events: auto;
      }
      .gce-card {
        background: #fff;
        border-radius: 14px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08);
        width: 320px;
        overflow: hidden;
        animation: gce-slide-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes gce-slide-in {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .gce-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px 10px;
      }
      .gce-spinner {
        width: 18px;
        height: 18px;
        border: 2.5px solid #e0e0e0;
        border-top-color: #1a73e8;
        border-radius: 50%;
        animation: gce-spin 0.7s linear infinite;
        flex-shrink: 0;
        transition: border-color 0.3s;
      }
      .gce-spinner.done { border-color: #34a853; border-top-color: #34a853; animation: none; }
      .gce-spinner.error { border-color: #ea4335; border-top-color: #ea4335; animation: none; }
      @keyframes gce-spin { to { transform: rotate(360deg); } }
      .gce-label {
        font-size: 13px;
        color: #3c4043;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
      }
      .gce-close {
        background: none;
        border: none;
        font-size: 18px;
        color: #80868b;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        border-radius: 4px;
        flex-shrink: 0;
      }
      .gce-close:hover { color: #3c4043; background: #f1f3f4; }
      .gce-bar-wrap { height: 4px; background: #e8eaed; }
      .gce-bar {
        height: 100%;
        background: #1a73e8;
        width: 0%;
        transition: width 0.4s ease, background 0.3s ease;
        border-radius: 0 2px 2px 0;
      }
      .gce-bar.done { background: #34a853; }
      .gce-bar.error { background: #ea4335; }
    `;
    document.documentElement.appendChild(style);

    progressEl.innerHTML = `
      <div class="gce-card">
        <div class="gce-header">
          <div class="gce-logo" style="width:22px;height:22px;flex-shrink:0;display:flex;align-items:center;">
            <svg width="22" height="22" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style="border-radius:4px;">
              <rect width="512" height="512" rx="40" fill="#f8f9fa"/>
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
            </svg>
          </div>
          <div class="gce-spinner"></div>
          <span class="gce-label">Initializing...</span>
          <button class="gce-close" title="Dismiss">&times;</button>
        </div>
        <div class="gce-bar-wrap"><div class="gce-bar"></div></div>
      </div>`;

    document.documentElement.appendChild(progressEl);
    progressEl.querySelector('.gce-close').addEventListener('click', hideProgress);
  }

  const label = progressEl.querySelector('.gce-label');
  const bar = progressEl.querySelector('.gce-bar');
  const spinner = progressEl.querySelector('.gce-spinner');

  if (label) label.textContent = text;
  if (bar) {
    bar.style.width = percent + '%';
    bar.className = 'gce-bar' + (state === 'done' ? ' done' : state === 'error' ? ' error' : '');
  }
  if (spinner) {
    spinner.className = 'gce-spinner' + (state === 'done' ? ' done' : state === 'error' ? ' error' : '');
  }

  // Relay to background for popup display
  try {
    chrome.runtime.sendMessage({ action: 'exportStateUpdate', text, percent, state });
  } catch { /* service worker may be inactive */ }
}

function hideProgress() {
  if (progressEl) {
    progressEl.remove();
    progressEl = null;
  }
}

// ── Scroll to Load All Messages ─────────────────────────────

function findScrollContainer() {
  for (const sel of SEL.scrollContainers) {
    const el = document.querySelector(sel);
    if (el && el.scrollHeight > el.clientHeight) return el;
  }
  // Dynamic fallback: find the tallest scrollable div
  let best = null, bestH = 0;
  for (const el of document.querySelectorAll(SEL.fallbackScrollable)) {
    if (el.scrollHeight > el.clientHeight + 100 && el.scrollHeight > bestH) {
      const style = getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        best = el;
        bestH = el.scrollHeight;
      }
    }
  }
  return best;
}

async function scrollToLoadAll(onProgress, dateFromTs = 0) {
  const container = findScrollContainer();
  if (!container) {
    onProgress && onProgress('No scroll container found — exporting visible messages only');
    return null;
  }

  const dedupMap = new Map();
  const collectCurrent = () => {
    for (const msg of extractMessages()) {
      const key = msg._dedupKey || `${msg.sender}|${msg.absoluteTimestamp}|${(msg.text || '').slice(0, 80)}`;
      if (!dedupMap.has(key)) dedupMap.set(key, msg);
    }
  };

  collectCurrent();
  let prevHeight = container.scrollHeight;
  let noChangeCount = 0;
  let iterations = 0;
  const MAX_ITER = 600;

  onProgress && onProgress('Scrolling up to load full history...');

  while (iterations < MAX_ITER) {
    iterations++;

    // Stop early if we've passed our date range
    if (dateFromTs && iterations % 3 === 0) {
      const oldest = getOldestTimestamp();
      if (oldest && oldest < dateFromTs) {
        onProgress && onProgress('Reached date range boundary — stopping scroll.');
        break;
      }
    }

    container.scrollTop = Math.max(0, container.scrollTop - 600);
    await sleep(500);

    if (iterations % 3 === 0) collectCurrent();

    const curHeight = container.scrollHeight;

    if (container.scrollTop === 0) {
      if (curHeight === prevHeight) {
        noChangeCount++;
        if (noChangeCount >= 4) break;
        // Nudge to trigger lazy load
        container.scrollTop = 150;
        await sleep(300);
      } else {
        noChangeCount = 0;
        prevHeight = curHeight;
      }
    }

    if (iterations % 5 === 0) {
      onProgress && onProgress(`Loading history... ${dedupMap.size} messages collected`);
    }
  }

  collectCurrent();
  await sleep(300);
  onProgress && onProgress(`Scroll complete. ${dedupMap.size} messages collected.`);

  const sorted = [...dedupMap.values()].sort(
    (a, b) => (a.absoluteTimestamp || 0) - (b.absoluteTimestamp || 0)
  );
  return sorted;
}

function getOldestTimestamp() {
  const el = document.querySelector(SEL.messageGroups);
  const ts = el && el.querySelector(SEL.absoluteTimestampAttr);
  return ts ? parseInt(ts.getAttribute(SEL.attrs.absoluteTimestamp), 10) || 0 : 0;
}

// ── Message Extraction ──────────────────────────────────────

function getConversationName() {
  for (const sel of SEL.conversationTitle) {
    const el = document.querySelector(sel);
    if (el) {
      const label = el.getAttribute('aria-label');
      const text = cleanText(label || el.textContent);
      if (text && text.length > 0 && text.length < 120) return text;
    }
  }
  return '';
}

function extractMessages() {
  const results = [];
  const seen = new Set();

  // Build date separator positions for date association
  const dateSeps = [];
  document.querySelectorAll(SEL.dateSeparator).forEach(el => {
    const text = cleanText(el.textContent);
    if (text) dateSeps.push({ text, top: el.getBoundingClientRect().top });
  });

  const groups = document.querySelectorAll(SEL.messageGroups);
  for (const group of groups) {
    const msgs = extractFromGroup(group, dateSeps);
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const hasMedia = msg.media && msg.media.length > 0;
      if (!msg.text && !hasMedia) continue;

      const groupId = group.getAttribute(SEL.attrs.groupId) || '';
      const key = groupId ? `${groupId}/${i}` : `${msg.sender}|${msg.absoluteTimestamp}|${(msg.text || '').slice(0, 80)}`;
      msg._dedupKey = key;

      if (!seen.has(key)) {
        seen.add(key);
        results.push(msg);
      }
    }
  }

  // Fallback: try individual message text elements
  if (results.length === 0) {
    document.querySelectorAll(SEL.messageText).forEach(el => {
      const text = getCleanText(el);
      if (!text || text.length < 1) return;
      const key = '_|' + text;
      if (seen.has(key)) return;
      seen.add(key);
      const { sender, timestamp } = findSenderAndTime(el);
      results.push({ sender, timestamp, absoluteTimestamp: 0, text, date: '', media: [], _dedupKey: key });
    });
  }

  return results;
}

function extractFromGroup(group, dateSeps) {
  const results = [];

  // Sender
  let sender = 'Unknown';
  const senderAttrEl = group.querySelector(SEL.senderNameAttr);
  if (senderAttrEl) {
    const nameAttr = senderAttrEl.getAttribute(SEL.attrs.senderName);
    const nameText = group.querySelector(SEL.senderNameText);
    sender = (nameText ? cleanText(nameText.textContent) : '') || nameAttr || 'Unknown';
  } else {
    const nameText = group.querySelector(SEL.senderNameText);
    if (nameText) sender = cleanText(nameText.textContent) || 'Unknown';
  }

  // Avatar
  let avatarUrl = '';
  const avatarContainer = group.querySelector(SEL.avatarContainer);
  const avatarImg = avatarContainer ? avatarContainer.querySelector(SEL.avatarImg) : null;
  if (avatarImg && avatarImg.src) {
    // Normalize to a reasonable size
    avatarUrl = avatarImg.src.replace(/=s\d+-w\d+-h\d+/, '=s64-w64-h64');
  }

  // Timestamp
  let timestamp = '';
  let absoluteTimestamp = 0;
  const tsEl = group.querySelector(SEL.timestamp);
  if (tsEl) {
    timestamp = cleanText(tsEl.textContent);
    const tsAttr = tsEl.getAttribute(SEL.attrs.absoluteTimestamp);
    if (tsAttr) absoluteTimestamp = parseInt(tsAttr, 10) || 0;
  }

  // Date association
  let date = '';
  if (dateSeps.length > 0) {
    const groupTop = group.getBoundingClientRect().top;
    for (let i = dateSeps.length - 1; i >= 0; i--) {
      if (dateSeps[i].top <= groupTop) { date = dateSeps[i].text; break; }
    }
    if (!date) date = dateSeps[0].text;
  }

  // Message text elements
  const textEls = group.querySelectorAll(SEL.messageText);
  for (const el of textEls) {
    const text = getCleanText(el);
    if (text) results.push({ sender, timestamp, absoluteTimestamp, date, avatarUrl, text, media: [] });
  }

  // ── Bot / Card messages (e.g. Login AlertX, Geo-PulseX) ──
  // These use div.bBOrFb > ... > span.nr7tub instead of div.DTp27d
  if (results.length === 0) {
    const cardBody = group.querySelector('div.bBOrFb');
    if (cardBody) {
      const cardLines = [];
      cardBody.querySelectorAll('span.nr7tub').forEach(span => {
        const t = cleanText(span.textContent);
        if (t) cardLines.push(t);
      });
      if (cardLines.length > 0) {
        results.push({ sender, timestamp, absoluteTimestamp, date, avatarUrl, text: cardLines.join('\n'), media: [] });
      }
    }
  }

  // ── Meet / video call chips ──
  // Rendered as a.Pj9rof[href*="meet.google.com"] — NO DTp27d element exists
  if (results.length === 0) {
    const meetLinks = group.querySelectorAll('a[href*="meet.google.com"]');
    for (const a of meetLinks) {
      const href = a.href || a.getAttribute('href') || '';
      if (!href) continue;
      const label = a.getAttribute('title') || a.getAttribute('aria-label')?.split(',')[0] || 'Join video meeting';
      results.push({ sender, timestamp, absoluteTimestamp, date, avatarUrl, text: `${label}: ${href}`, media: [] });
    }
  }

  // ── Generic link chip fallback ──
  // For any remaining empty message groups that have a link (e.g. other chips)
  if (results.length === 0) {
    const seenUrls = new Set();
    group.querySelectorAll('a[href^="http"]').forEach(a => {
      const href = a.href || '';
      if (!href || seenUrls.has(href)) return;
      // Skip chrome-extension internal links
      if (href.startsWith('chrome-extension://')) return;
      seenUrls.add(href);
      const label = cleanText(a.getAttribute('title') || a.textContent) || href;
      results.push({ sender, timestamp, absoluteTimestamp, date, avatarUrl, text: label !== href ? `${label}: ${href}` : href, media: [] });
    });
  }

  // Media
  const media = extractMedia(group);
  if (media.length > 0) {
    if (results.length > 0) {
      results[results.length - 1].media = media;
    } else {
      results.push({ sender, timestamp, absoluteTimestamp, date, avatarUrl, text: '', media });
    }
  }

  return results;
}

function extractMedia(group) {
  const media = [];

  // Images
  for (const chip of group.querySelectorAll(SEL.imageChip)) {
    const img = chip.querySelector(SEL.imageImg);
    const btn = chip.querySelector(SEL.imageButton);
    if (img && img.src) {
      const name = (btn?.getAttribute(SEL.attrs.title) || 'image.png').trim() || 'image.png';
      const ext = name.split('.').pop()?.toLowerCase() || 'png';
      media.push({ type: 'image', url: img.src, name, mimeType: mimeFromExt(ext) });
    }
  }

  // GIFs / stickers
  for (const chip of group.querySelectorAll(SEL.gifChip)) {
    if (chip.closest(SEL.imageChip)) continue; // avoid double-counting
    const img = chip.querySelector(SEL.imageImg);
    if (img && img.src) {
      const parts = img.src.split('/');
      let name = parts[parts.length - 1] || 'sticker';
      if (!name.includes('.')) name += '.gif';
      media.push({ type: 'gif', url: img.src, name, mimeType: 'image/gif' });
    }
  }

  // Audio (voice messages)
  for (const player of group.querySelectorAll(SEL.audioPlayer)) {
    const url = decodeHtmlEntities(player.getAttribute(SEL.attrs.mediaUrl) || '');
    if (!url) continue;
    const durationMs = parseFloat(player.getAttribute(SEL.attrs.mediaDuration) || '0');
    const sourceType = player.getAttribute(SEL.attrs.mediaSourceType) || 'audio/mpeg';
    const ext = sourceType.includes('mp4') ? 'mp4' : 'mp3';
    media.push({ type: 'audio', url, name: `voice_message.${ext}`, mimeType: sourceType.startsWith('audio/') ? sourceType : 'audio/mpeg', durationMs });
  }

  // Videos
  const videoSeen = new Set();
  for (const player of group.querySelectorAll(SEL.videoPlayer)) {
    const rawUrl = player.getAttribute(SEL.attrs.mediaUrl) || '';
    if (!rawUrl) continue;
    const url = decodeHtmlEntities(rawUrl.replace('url_type=STREAMING_URL', 'url_type=DOWNLOAD_URL'));
    const fallbackUrl = rawUrl !== url ? decodeHtmlEntities(rawUrl) : '';
    const durationMs = parseFloat(player.getAttribute(SEL.attrs.mediaDuration) || '0');

    const labelEl = player.querySelector(SEL.videoLabel) || player.closest(SEL.videoLabel);
    let name = 'video.mp4';
    if (labelEl) {
      const m = (labelEl.getAttribute(SEL.attrs.ariaLabel) || '').match(/^Video,\s*(.+)\.\s+\d+\s+(?:second|minute|hour)/);
      if (m) {
        name = m[1].trim();
        if (!/\.[a-zA-Z0-9]{2,5}$/.test(name)) name += '.mp4';
      }
    }

    const ctMatch = (rawUrl || '').match(/content_type=([^&]+)/);
    const mimeType = ctMatch ? decodeURIComponent(ctMatch[1]) : 'video/mp4';

    const fileChipEl = player.closest(SEL.fileChip);
    if (fileChipEl) videoSeen.add(fileChipEl);

    media.push({ type: 'video', url, fallbackUrl, name, mimeType: mimeType.startsWith('video/') ? mimeType : 'video/mp4', durationMs });
  }

  // File attachments
  for (const chip of group.querySelectorAll(SEL.fileChip)) {
    if (videoSeen.has(chip)) continue;
    const nameEl = chip.querySelector(SEL.fileName);
    const btnEl = chip.querySelector(SEL.fileButton);
    const thumbEl = chip.querySelector(SEL.fileThumb);
    const name = nameEl ? cleanText(nameEl.textContent) : (btnEl?.getAttribute(SEL.attrs.title) || 'file');
    const thumbUrl = thumbEl?.src || '';
    const type = detectChipType(btnEl?.getAttribute(SEL.attrs.ariaLabel) || '', thumbUrl, name);
    const downloadUrl = findChipDownloadUrl(chip, thumbUrl);
    const ctMatch = (thumbUrl || downloadUrl || '').match(/content_type=([^&]+)/);
    const mimeType = ctMatch ? decodeURIComponent(ctMatch[1]) : guessMimeFromName(name);

    media.push({ type, url: downloadUrl, fallbackUrl: type === 'video' ? '' : undefined, thumbUrl: type === 'file' ? thumbUrl : undefined, name, mimeType });
  }

  return media;
}

// ── DOM Helpers ─────────────────────────────────────────────

/**
 * Extracts clean text from an element, preserving meaningful line breaks.
 * Handles <br>, <div>, <p> block boundaries so multi-line messages stay multi-line.
 */
function getCleanText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  // Remove noise elements
  for (const noiseSel of SEL.noiseSelectors) {
    try { clone.querySelectorAll(noiseSel).forEach(n => n.remove()); } catch {}
  }
  // Replace <br> with newline markers
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  // Insert newlines after block-level elements so paragraphs are separated
  clone.querySelectorAll('p, div').forEach(el => {
    if (el.nextSibling) el.insertAdjacentText('afterend', '\n');
  });
  return cleanMessageText(clone.textContent);
}

/**
 * Cleans message body text — preserves internal line breaks, collapses excess whitespace per line.
 */
function cleanMessageText(str) {
  if (!str) return '';
  return str
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Cleans single-line UI text (sender names, timestamps, date separators).
 * Collapses all whitespace to a single space.
 */
function cleanText(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function findSenderAndTime(el) {
  let node = el;
  for (let i = 0; i < 8 && node?.parentElement; i++) {
    node = node.parentElement;
    if (node.matches && node.matches(SEL.messageGroups)) {
      const senderEl = node.querySelector(SEL.senderNameAttr) || node.querySelector(SEL.senderNameText);
      const tsEl = node.querySelector(SEL.timestamp);
      return {
        sender: senderEl ? cleanText(senderEl.textContent) : 'Unknown',
        timestamp: tsEl ? cleanText(tsEl.textContent) : ''
      };
    }
  }
  return { sender: 'Unknown', timestamp: '' };
}

function detectChipType(ariaLabel, thumbUrl, name) {
  if (/^Video,/i.test(ariaLabel)) return 'video';
  if (/^Audio,/i.test(ariaLabel)) return 'audio';
  if (/^Image,/i.test(ariaLabel)) return 'image';
  if (/content_type=video/i.test(thumbUrl)) return 'video';
  if (/content_type=audio/i.test(thumbUrl)) return 'audio';
  if (/content_type=image/i.test(thumbUrl)) return 'image';
  const ext = (name || '').split('.').pop()?.toLowerCase() || '';
  if (['mp4','mov','avi','webm','mkv','flv','wmv','m4v','3gp'].includes(ext)) return 'video';
  if (['mp3','wav','ogg','m4a','flac','aac','wma'].includes(ext)) return 'audio';
  if (['png','jpg','jpeg','gif','webp','svg','bmp','ico','heic'].includes(ext)) return 'image';
  return 'file';
}

function findChipDownloadUrl(chip, thumbUrl) {
  let url = '';
  const parentItem = chip.closest(SEL.chipParentItem);
  if (parentItem) {
    const anchor = parentItem.querySelector(SEL.chipDownloadAnchor);
    if (anchor) url = decodeHtmlEntities(anchor.getAttribute(SEL.attrs.href) || '');
  }
  if (!url) {
    const wrapper = chip.closest(SEL.chipWrapperFallback) || chip.parentElement;
    const anchor = wrapper?.querySelector(SEL.downloadAnchorGeneric);
    if (anchor) url = decodeHtmlEntities(anchor.getAttribute(SEL.attrs.href) || '');
  }
  if (!url && thumbUrl && thumbUrl.includes('get_attachment_url')) {
    url = thumbUrl
      .replace(/url_type=[A-Z_]+/, 'url_type=DOWNLOAD_URL')
      .replace(/[&?]sz=[^&]*/g, '')
      .replace(/[&?]allow_caching=[^&]*/g, '');
  }
  return url;
}

function mimeFromExt(ext) {
  return {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml'
  }[ext] || 'image/png';
}

function guessMimeFromName(name) {
  return {
    csv: 'text/csv', txt: 'text/plain', pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
    webm: 'video/webm', zip: 'application/zip'
  }[(name || '').split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';
}

function decodeHtmlEntities(str) {
  const t = document.createElement('textarea');
  t.innerHTML = str;
  return t.value;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Media Download (content-side fetch with bg fallback) ────

async function downloadMedia(url) {
  // Strategy 1: fetch with credentials (works for authenticated Google content)
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (resp.ok) return await blobToBase64(resp);
  } catch { /* try next */ }

  // Strategy 2: fetch without credentials
  try {
    const resp = await fetch(url, { credentials: 'omit' });
    if (resp.ok) return await blobToBase64(resp);
  } catch { /* try next */ }

  // Strategy 3: ask background service worker (can use cookies API)
  try {
    const result = await chrome.runtime.sendMessage({ action: 'downloadMediaBg', url });
    if (result?.success) return result;
  } catch { /* give up */ }

  return { success: false, error: 'All download strategies failed' };
}

async function blobToBase64(resp) {
  const mimeType = resp.headers.get('content-type') || 'application/octet-stream';
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve({ success: true, base64: reader.result.split(',')[1], mimeType });
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

// ── Main Export Flow ─────────────────────────────────────────

async function runExport({ format = 'txt', loadAll = true, includeMedia = true }) {
  await loadSelectors();

  if (!isInChatFrame()) {
    showProgress('⚠️ Please open a Google Chat conversation first.', 0, 'error');
    setTimeout(hideProgress, 5000);
    return;
  }

  showProgress('⏳ Preparing export...', 2);

  try {
    let messages;

    if (loadAll) {
      messages = await scrollToLoadAll(
        (text) => showProgress(text, 15),
        0
      );
      await sleep(800);
    }

    showProgress('📝 Extracting messages...', 30);
    await sleep(100);

    if (!messages) messages = extractMessages();
    const conversationName = getConversationName() || 'Google Chat';

    if (!messages || messages.length === 0) {
      showProgress('❌ No messages found. Try opening a conversation first.', 0, 'error');
      setTimeout(hideProgress, 5000);
      return;
    }

    showProgress(`Found ${messages.length} messages`, 35);

    const exportDate = new Date().toISOString();
    let mediaFiles = [];

    if (format === 'html' && includeMedia) {
      // Download all media
      let totalMedia = 0;
      messages.forEach(m => { totalMedia += (m.media || []).filter(x => x.url).length; });
      const maxMedia = Math.max(totalMedia, 1);
      let downloaded = 0;

      for (const msg of messages) {
        if (!msg.media || !msg.media.length) continue;
        for (const m of msg.media) {
          if (!m.url) continue;
          downloaded++;
          const pct = 35 + Math.round((downloaded / maxMedia) * 50);
          showProgress(`Downloading media ${downloaded}/${totalMedia}...`, pct);

          const result = await downloadMedia(m.url);
          if (!result?.success && m.fallbackUrl) {
            const fb = await downloadMedia(m.fallbackUrl);
            if (fb?.success) {
              const safeName = (m.name || `media_${downloaded}`).replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 80);
              const path = `media/${downloaded}_${safeName}`;
              mediaFiles.push({ path, base64: fb.base64, mimeType: fb.mimeType });
              m._localPath = path;
            }
          } else if (result?.success) {
            const safeName = (m.name || `media_${downloaded}`).replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 80);
            const path = `media/${downloaded}_${safeName}`;
            mediaFiles.push({ path, base64: result.base64, mimeType: result.mimeType });
            m._localPath = path;
          }
        }
      }
    }

    showProgress('📦 Packaging...', 88);
    await sleep(200);

    // Send to background for packaging & download
    chrome.runtime.sendMessage({
      action: 'packageAndDownload',
      format,
      payload: { conversationName, messages, mediaFiles, exportDate }
    }, (resp) => {
      if (resp && resp.success) {
        showProgress(`✅ Exported! Saved as ${resp.filename}`, 100, 'done');
        setTimeout(hideProgress, 4000);
      } else {
        showProgress('❌ Export failed: ' + (resp?.error || 'Unknown error'), 0, 'error');
        setTimeout(hideProgress, 6000);
      }
    });

  } catch (err) {
    console.error('[GCE] Export error:', err);
    showProgress('❌ Export failed: ' + err.message, 0, 'error');
    setTimeout(hideProgress, 6000);
  }
}

// ── Message Listener ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'ping') {
    sendResponse({ alive: true, inChatFrame: isInChatFrame() });
    return false;
  }

  if (msg.action === 'startExport') {
    runExport({
      format: msg.format || 'txt',
      loadAll: msg.loadAll !== false,
      includeMedia: msg.includeMedia !== false
    });
    sendResponse({ received: true });
    return false;
  }

  if (msg.action === 'getConversationName') {
    loadSelectors().then(() => {
      sendResponse({ name: getConversationName() });
    });
    return true;
  }

  return false;
});

// ── Custom Event Listener (PWA fallback trigger) ─────────────
// background.js injects a dispatchEvent when message passing fails in PWA windows

window.addEventListener('gce:startExport', async (e) => {
  const detail = e.detail || {};
  await loadSelectors();
  runExport({
    format: detail.format || 'txt',
    loadAll: detail.loadAll !== false,
    includeMedia: detail.includeMedia !== false
  });
});

// ── Init ─────────────────────────────────────────────────────

(async () => {
  await loadSelectors();
  if (isInChatFrame()) {
    console.log('[Google Chat Exporter] Content script active in chat frame');
  }
})();