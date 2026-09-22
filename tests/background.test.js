'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadBackground() {
  const event = { addListener() {} };
  const stored = {};
  const chrome = {
    runtime: { onInstalled: event, onMessage: { addListener(fn) { this.listener = fn; } }, lastError: null },
    contextMenus: { removeAll(callback) { callback(); }, create() {}, onClicked: event },
    tabs: { async query() { return []; }, sendMessage() {} },
    scripting: { async executeScript() {} },
    storage: { local: {
      async get(key) { return key ? { [key]: stored[key] } : { ...stored }; },
      async set(values) { Object.assign(stored, values); },
      async remove(key) { delete stored[key]; }
    } },
    downloads: { download(_options, callback) { callback(1); },
      async search() { return [{ state: 'complete' }]; },
      onChanged: { addListener(fn) { this.listener = fn; } }
    }
  };
  const context = vm.createContext({
    chrome,
    AbortController,
    console,
    URL,
    Uint8Array,
    TextEncoder,
    btoa,
    clearTimeout,
    encodeURIComponent,
    importScripts() {},
    setTimeout,
    unescape
  });
  const filename = path.join(__dirname, '..', 'src', 'background.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context;
}

test('safeResourceUrl permits HTTPS and safe packaged media paths', () => {
  const context = loadBackground();
  assert.equal(context.safeResourceUrl('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(context.safeResourceUrl('media/4_photo.png'), 'media/4_photo.png');
});

test('safeResourceUrl rejects active, insecure, and traversing URLs', () => {
  const context = loadBackground();
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'http://example.com/file.png',
    'media/../index.html',
    '../media/file.png'
  ]) {
    assert.equal(context.safeResourceUrl(value), '', value);
  }
});

test('rendered media never emits a rejected URL', () => {
  const context = loadBackground();
  const html = context.renderMediaHtml({
    type: 'image',
    url: 'javascript:alert(1)',
    name: '<unsafe>.png'
  });
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /&lt;unsafe&gt;\.png/);
  assert.match(html, /\[unavailable\]/);
});

test('external media links isolate the opened page', () => {
  const context = loadBackground();
  const html = context.renderMediaHtml({
    type: 'image',
    url: 'https://example.com/photo.png',
    name: 'photo.png'
  });
  assert.match(html, /rel="noopener noreferrer"/);
});

test('background cancellation aborts the matching request and prevents retries', async () => {
  const c = loadBackground();
  let signal;
  let calls = 0;
  c.fetch = (_url, options) => {
    calls++;
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  };
  const sender = { tab: { id: 10 }, frameId: 2 };
  const listener = c.chrome.runtime.onMessage.listener;
  const response = new Promise(resolve => listener({ action: 'downloadMediaBg', requestId: 'one', url: 'https://example.com/a' }, sender, resolve));
  listener({ action: 'cancelMediaBg', requestId: 'one' }, { tab: { id: 11 }, frameId: 2 }, () => {});
  assert.equal(signal.aborted, false, 'another tab cannot cancel this request');
  listener({ action: 'cancelMediaBg', requestId: 'one' }, sender, () => {});
  assert.equal((await response).success, false);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  assert.equal(vm.runInContext('mediaRequests.size', c), 0);
});

test('saved TXT and HTML carry incomplete-history warnings', async () => {
  const c = loadBackground();
  let download;
  c.chrome.downloads.download = (options, callback) => { download = options; callback(1); };
  const payload = { conversationName: 'Fixture', messages: [], exportDate: new Date().toISOString(), history: { reason: 'limit', warning: 'May be incomplete' } };
  await c.packageTxt(payload);
  assert.match(Buffer.from(download.url.split(',')[1], 'base64').toString(), /May be incomplete/);
  assert.match(c.generateHtml(payload), /May be incomplete/);
});

test('checkpoint advances only after completed download and survives pending state', async () => {
  const c = loadBackground();
  let state = 'in_progress';
  c.chrome.downloads.search = async () => [{ state }];
  const key = 'gceCheckpoint:' + 'a'.repeat(64);
  const checkpoint = { key, value: { timestamp: 100, fingerprints: ['b'.repeat(64)] } };
  await c.queueCheckpoint(123, checkpoint);
  assert.equal((await c.chrome.storage.local.get(key))[key], undefined);
  assert.ok((await c.chrome.storage.local.get('gcePending:123'))['gcePending:123']);
  state = 'complete';
  c.chrome.downloads.onChanged.listener({ id: 123, state: { current: state } });
  await vm.runInContext('checkpointQueue', c);
  assert.equal((await c.chrome.storage.local.get(key))[key].timestamp, 100);
  assert.equal((await c.chrome.storage.local.get('gcePending:123'))['gcePending:123'], undefined);
  state = 'interrupted';
  await c.queueCheckpoint(124, { key, value: { timestamp: 200, fingerprints: [] } });
  assert.equal((await c.chrome.storage.local.get(key))[key].timestamp, 100);
  state = 'complete';
  await c.queueCheckpoint(125, { key, value: { timestamp: 50, fingerprints: [] } });
  assert.equal((await c.chrome.storage.local.get(key))[key].timestamp, 100, 'late older download cannot rewind checkpoint');
});
