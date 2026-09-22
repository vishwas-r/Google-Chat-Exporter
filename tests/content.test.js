'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadContent() {
  const event = { addListener() {} };
  const selectors = {
    frameName: 'single_full_screen',
    scrollContainers: [],
    fallbackScrollable: 'div',
    absoluteTimestampAttr: '[data-absolute-timestamp]',
    attrs: { absoluteTimestamp: 'data-absolute-timestamp' }
  };
  const document = {
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const window = { name: '', addEventListener() {}, dispatchEvent() {} };
  const chrome = {
    storage: { local: { async get() { return {}; } } },
    runtime: {
      getURL(value) { return value; },
      onMessage: event,
      async sendMessage() { return {}; },
      lastError: null
    }
  };
  class MutationObserver {
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  const context = vm.createContext({
    AbortController,
    URL,
    TextEncoder,
    crypto: require('node:crypto').webcrypto,
    chrome,
    clearTimeout,
    console,
    document,
    fetch: async () => ({ json: async () => selectors }),
    FileReader: class {},
    getComputedStyle: () => ({ overflowY: 'auto' }),
    Map,
    MutationObserver,
    Promise,
    Set,
    setTimeout,
    window
  });
  const filename = path.join(__dirname, '..', 'src', 'content.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context;
}

test('restoreScrollPosition preserves distance from the bottom', () => {
  const context = loadContent();
  const container = { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 };
  context.restoreScrollPosition(container, 25);
  assert.equal(container.scrollTop, 775);
});

test('abortable sleep stops promptly with AbortError', async () => {
  const context = loadContent();
  const controller = new AbortController();
  const pending = context.sleep(10_000, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError', message: 'Export cancelled' });
});

test('already-aborted work fails before it starts', () => {
  const context = loadContent();
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => context.throwIfAborted(controller.signal), { name: 'AbortError' });
});

test('virtualized history visits overlapping windows, deduplicates, and warns at idle', async () => {
  const c = loadContent();
  await c.loadSelectors();
  const container = { scrollHeight: 1200, clientHeight: 400, scrollTop: 800,
    getBoundingClientRect: () => ({ top: 0 }), querySelectorAll: () => [] };
  c.findScrollContainer = () => container;
  c.extractMessages = () => Array.from({ length: 4 }, (_, i) => {
    const id = Math.floor(container.scrollTop / 100) + i;
    return { _dedupKey: String(id), text: String(id), absoluteTimestamp: id + 1 };
  });
  c.getOldestTimestamp = () => Math.floor(container.scrollTop / 100) + 1;
  const waits = [];
  c.waitForHistoryMutation = async (_el, _height, _oldest, timeout) => { waits.push(timeout); };
  c.sleep = async () => {};
  const result = await c.scrollToLoadAll();
  assert.deepEqual(Array.from(result.messages, m => m.text), Array.from({ length: 12 }, (_, i) => String(i)));
  assert.equal(result.reason, 'idle');
  assert.match(result.warning, /could not be verified/);
  assert.deepEqual(waits.slice(-3), [600, 1200, 1800], 'final idle checks total 3.6 seconds');
  assert.equal(container.scrollTop, 800);
});

test('cancel during history restores position and disconnects its observer', async () => {
  const c = loadContent();
  await c.loadSelectors();
  let disconnected = false;
  c.MutationObserver = class { observe() {} disconnect() { disconnected = true; } };
  const container = { scrollHeight: 1200, clientHeight: 400, scrollTop: 800,
    getBoundingClientRect: () => ({ top: 0 }), querySelectorAll: () => [] };
  c.findScrollContainer = () => container;
  c.extractMessages = () => [];
  c.getOldestTimestamp = () => 1;
  const controller = new AbortController();
  const pending = c.scrollToLoadAll(null, 0, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(container.scrollTop, 800);
  assert.ok(disconnected);
});

test('anchor restoration handles prepended content and changed layout', async () => {
  const c = loadContent();
  await c.loadSelectors();
  const container = { scrollTop: 100, scrollHeight: 3000, clientHeight: 400,
    getBoundingClientRect: () => ({ top: 20 }),
    querySelectorAll: () => [{ getAttribute: () => 'message-1', getBoundingClientRect: () => ({ top: 170 }) }] };
  c.restoreScrollPosition(container, 0, { id: 'message-1', offset: 30 });
  assert.equal(container.scrollTop, 220, 'uses anchor offset instead of jumping to bottom');
});

test('FileReader conversion is aborted and rejects with AbortError', async () => {
  const c = loadContent();
  let reader;
  c.FileReader = class { constructor() { reader = this; } readAsDataURL() {} abort() { this.aborted = true; } };
  const controller = new AbortController();
  const pending = c.blobToBase64({ headers: { get: () => 'image/png' }, blob: async () => ({}) }, controller.signal);
  for (let i = 0; i < 10 && !reader; i++) await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(reader.aborted);
});

test('full export waits for cancelled background workers, blocks duplicates, and restarts', async () => {
  const c = loadContent();
  await c.loadSelectors();
  c.isInChatFrame = () => true;
  c.getConversationName = () => 'Fixture';
  c.extractMessages = () => [{ text: 'hello', media: Array.from({ length: 6 }, (_, i) => ({ url: `https://example.com/${i}`, name: `${i}.png` })) }];
  c.sleep = async (_ms, signal) => c.throwIfAborted(signal);
  c.setTimeout = () => 0; // terminal HUD dismissal is irrelevant to lifecycle
  c.fetch = async () => ({ ok: false });
  const pending = new Map();
  const cancelled = [];
  const packaged = [];
  const progress = [];
  c.showProgress = text => progress.push(text);
  c.chrome.runtime.sendMessage = async msg => {
    if (msg.action === 'downloadMediaBg') return new Promise(resolve => pending.set(msg.requestId, resolve));
    if (msg.action === 'cancelMediaBg') { cancelled.push(msg.requestId); return {}; }
    if (msg.action === 'packageAndDownload') { packaged.push(msg); return { success: true, filename: 'fixture.txt' }; }
  };
  const run = c.runExport({ format: 'html', loadAll: false });
  for (let i = 0; i < 30 && pending.size < 4; i++) await Promise.resolve();
  assert.equal(pending.size, 4);
  vm.runInContext('exportController.abort()', c);
  assert.equal(cancelled.length, 4);
  await c.runExport({ loadAll: false });
  assert.equal(packaged.length, 0, 'restart blocked while workers drain');
  for (const resolve of pending.values()) resolve({ success: false });
  await run;
  assert.equal(packaged.length, 0, 'cancelled export never packages');
  assert.equal(progress.at(-1), 'Export cancelled.');
  assert.equal(vm.runInContext('exportInProgress', c), false);
  await c.runExport({ format: 'txt', loadAll: false });
  assert.equal(packaged.length, 1);
  assert.equal(packaged[0].payload.history.reason, 'visible-only');
});

test('full export propagates history warning into the saved payload', async () => {
  const c = loadContent();
  await c.loadSelectors();
  c.isInChatFrame = () => true;
  c.showProgress = () => {};
  c.getConversationName = () => 'Fixture';
  c.sleep = async () => {};
  c.scrollToLoadAll = async () => ({ messages: [{ text: 'hello' }], reason: 'limit', warning: 'May be incomplete' });
  let payload;
  c.chrome.runtime.sendMessage = async msg => { payload = msg.payload; return { success: true, filename: 'fixture.txt' }; };
  await c.runExport({});
  assert.equal(payload.history.warning, 'May be incomplete');
  assert.equal(vm.runInContext('exportInProgress', c), false);
});

test('history observer accepts delayed history and ignores unrelated mutations', async () => {
  const c = loadContent();
  let mutation;
  let disconnected = false;
  c.MutationObserver = class { constructor(fn) { mutation = fn; } observe() {} disconnect() { disconnected = true; } };
  c.getOldestTimestamp = () => 10;
  const container = { scrollHeight: 500 };
  let finished = false;
  const pending = c.waitForHistoryMutation(container, 500, 10, 1000).then(() => { finished = true; });
  mutation();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(finished, false);
  container.scrollHeight = 800;
  mutation();
  await pending;
  assert.ok(disconnected);
});

test('loaded viewport proceeds after two frames; boundary still waits for history', async () => {
  const c = loadContent();
  const frames = [];
  c.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  c.cancelAnimationFrame = () => {};
  c.getOldestTimestamp = () => 10;
  const container = { scrollHeight: 1000 };
  const controller = new AbortController();
  const fast = c.waitForHistoryMutation(container, 1000, 10, 10000, controller.signal, true);
  assert.equal(frames.length, 1);
  frames.shift()();
  frames.shift()();
  await fast;
  const slow = c.waitForHistoryMutation(container, 1000, 10, 10000, controller.signal, false);
  assert.equal(frames.length, 0, 'no frame shortcut at history boundary');
  controller.abort();
  await assert.rejects(slow, { name: 'AbortError' });
});

test('extraction cache reuses unchanged groups and reparses edited or recycled content', async () => {
  const c = loadContent();
  await c.loadSelectors();
  let records = [];
  let disconnected = false;
  c.MutationObserver = class {
    observe() {}
    takeRecords() { const batch = records; records = []; return batch; }
    disconnect() { disconnected = true; }
  };
  const cache = c.createExtractionCache({});
  const group = { nodeType: 1, closest() { return this; } };
  let parses = 0;
  let text = 'original';
  const parse = () => { parses++; return [{ text }]; };
  for (let i = 0; i < 100; i++) assert.equal(cache.read(group, 'Today', parse)[0].text, 'original');
  assert.equal(parses, 1, '100 overlapping collections parse once');
  text = 'edited';
  records = [{ target: group }];
  assert.equal(cache.read(group, 'Today', parse)[0].text, 'edited');
  assert.equal(parses, 2);
  cache.read(group, 'Yesterday', parse);
  assert.equal(parses, 3, 'date reassociation invalidates cached extraction');
  records = [{ target: { nodeType: 1, closest: () => null } }];
  cache.read(group, 'Yesterday', parse);
  assert.equal(parses, 3, 'adding another group does not reparse unchanged groups');
  cache.disconnect();
  assert.ok(disconnected);
});

test('checkpoint scope separates conversations, accounts and export modes', () => {
  const c = loadContent();
  const url = 'https://chat.google.com/u/0/app/chat/ABC123';
  const txt = c.checkpointScope(url, 'txt', true);
  assert.ok(txt);
  assert.notEqual(txt, c.checkpointScope(url.replace('ABC123', 'XYZ'), 'txt', true));
  assert.notEqual(txt, c.checkpointScope(url.replace('/u/0/', '/u/1/'), 'txt', true));
  assert.notEqual(txt, c.checkpointScope(url, 'html', false));
  assert.notEqual(c.checkpointScope(url, 'html', true), c.checkpointScope(url, 'html', false));
  assert.ok(c.checkpointScope('https://mail.google.com/mail/u/0/#chat/space/AAA123', 'txt', false));
  assert.ok(c.checkpointScope('https://chat.google.com/u/0/room/AAA123', 'txt', false));
  assert.ok(c.checkpointScope('https://chat.google.com/u/0/dm/AAA123', 'txt', false));
  assert.equal(c.checkpointScope('https://chat.google.com/u/0/', 'txt', false), '');
});

test('web-app checkpoint scope uses the selected conversation link', () => {
  const c = loadContent();
  c.location = { href: 'https://chat.google.com/u/0/' };
  c.document.querySelectorAll = selector => selector.includes('aria-current') ? [{
    href: 'https://chat.google.com/u/0/room/PWA123',
    getAttribute() { return this.href; }
  }] : [];
  const scope = c.checkpointScopeFromPage('txt', false, 'https://chat.google.com/u/0/');
  assert.equal(scope, 'chat.google.com|0|room|PWA123|txt');
});

test('web-app checkpoint scope inspects the outer application document', () => {
  const c = loadContent();
  c.location = { href: 'https://chat.google.com/u/0/frame' };
  const selected = {
    href: 'https://chat.google.com/u/0/app/chat/OUTER123',
    getAttribute() { return this.href; }
  };
  const outerDocument = { querySelectorAll: selector => selector.includes('aria-current') ? [selected] : [] };
  const outer = { location: { href: 'https://chat.google.com/u/0/' }, document: outerDocument };
  outer.parent = outer;
  c.window.parent = outer;
  assert.equal(c.checkpointScopeFromPage('html', true, 'https://chat.google.com/u/0/'),
    'chat.google.com|0|chat|OUTER123|html-media');
});

test('web-app title fallback requires exactly one matching conversation link', () => {
  const c = loadContent();
  c.location = { href: 'https://chat.google.com/u/0/' };
  c.getConversationName = () => 'Project Room';
  const link = id => ({
    href: `https://chat.google.com/u/0/room/${id}`,
    textContent: 'Project Room',
    getAttribute(name) { return name === 'aria-label' ? '' : this.href; }
  });
  c.document.querySelectorAll = selector => selector === 'a[href]' ? [link('ONE')] : [];
  assert.equal(c.checkpointScopeFromPage('txt', false), 'chat.google.com|0|room|ONE|txt');
  c.document.querySelectorAll = selector => selector === 'a[href]' ? [link('ONE'), link('TWO')] : [];
  assert.equal(c.checkpointScopeFromPage('txt', false), '', 'ambiguous titles fail closed');
});

test('incremental selection preserves equal-time new messages and unknown timestamps', async () => {
  const c = loadContent();
  const old = { _dedupKey: 'a', absoluteTimestamp: 100, text: 'old' };
  const checkpoint = await c.buildCheckpoint([old]);
  const equalTime = { _dedupKey: 'b', absoluteTimestamp: 100, text: 'new at same time' };
  const unknown = { text: 'unknown' };
  const selected = await c.selectNewMessages([{ absoluteTimestamp: 99 }, old, equalTime, unknown], checkpoint);
  assert.deepEqual(Array.from(selected), [equalTime, unknown]);
  assert.equal(await c.buildCheckpoint([unknown]), null);
  assert.equal(JSON.stringify(checkpoint).includes('old'), false, 'checkpoint stores hashes rather than text');
});

test('content-derived checkpoint scope is stable and separates conversations and modes', async () => {
  const c = loadContent();
  const history = [
    { _dedupKey: 'first', sender: 'A', absoluteTimestamp: 10, text: 'one', media: [] },
    { _dedupKey: 'second', sender: 'B', absoluteTimestamp: 20, text: 'two', media: [] }
  ];
  const scope = await c.contentCheckpointScope(history, 'Room', 'txt', false, 'https://chat.google.com/u/2/');
  assert.equal(scope, await c.contentCheckpointScope(history, 'Room', 'txt', false, 'https://chat.google.com/u/2/'));
  assert.notEqual(scope, await c.contentCheckpointScope([{ ...history[0], text: 'different' }], 'Room', 'txt', false, 'https://chat.google.com/u/2/'));
  assert.notEqual(scope, await c.contentCheckpointScope(history, 'Room', 'html', true, 'https://chat.google.com/u/2/'));
  assert.match(scope, /^chat\.google\.com\|2\|content\|/);
  assert.equal(scope.includes('Room'), false, 'scope hashes the title');
});

test('incremental web-app export falls back to a content-derived checkpoint', async () => {
  const c = loadContent();
  await c.loadSelectors();
  c.isInChatFrame = () => true;
  c.findScrollContainer = () => null;
  c.getConversationName = () => 'PWA Fixture';
  c.checkpointScopeFromPage = () => '';
  c.sleep = async () => {};
  c.setTimeout = () => 0;
  c.showProgress = () => {};
  const messages = [{ _dedupKey: 'oldest', sender: 'A', absoluteTimestamp: 100, text: 'first', media: [] }];
  const cutoffs = [];
  c.scrollToLoadAll = async (_progress, cutoff) => { cutoffs.push(cutoff); return { messages, reason: 'idle', warning: '' }; };
  const stored = {};
  c.chrome.storage.local.get = async key => ({ [key]: stored[key] });
  let downloads = 0;
  c.chrome.runtime.sendMessage = async msg => {
    downloads++;
    stored[msg.payload.checkpoint.key] = msg.payload.checkpoint.value;
    return { success: true, filename: 'pwa.txt' };
  };
  const options = { format: 'txt', incremental: true, sourceUrl: 'https://chat.google.com/u/0/' };
  await c.runExport(options);
  await c.runExport(options);
  assert.equal(downloads, 1, 'the second identical export finds its content-derived checkpoint');
  assert.deepEqual(cutoffs, [0, 0], 'route-less PWA mode safely scans full history before identifying the conversation');
});

test('incremental export establishes baseline, exports new files, then reports no new messages', async () => {
  const c = loadContent();
  await c.loadSelectors();
  c.isInChatFrame = () => true;
  c.findScrollContainer = () => null;
  c.getConversationName = () => 'Fixture';
  c.sleep = async () => {};
  c.setTimeout = () => 0;
  const progress = [];
  c.showProgress = text => progress.push(text);
  let messages = [{ _dedupKey: 'a', absoluteTimestamp: 100, text: 'first', media: [] }];
  const cutoffs = [];
  c.scrollToLoadAll = async (_progress, cutoff) => { cutoffs.push(cutoff); return { messages, reason: cutoff ? 'date-boundary' : 'idle', warning: '' }; };
  const stored = {};
  c.chrome.storage.local.get = async key => ({ [key]: stored[key] });
  const packages = [];
  c.chrome.runtime.sendMessage = async msg => {
    packages.push(msg.payload);
    if (msg.payload.checkpoint) stored[msg.payload.checkpoint.key] = msg.payload.checkpoint.value;
    return { success: true, filename: 'fixture.zip' };
  };
  c.downloadMedia = async () => ({ success: true, base64: 'eA==', mimeType: 'text/plain' });
  const options = { format: 'html', includeMedia: true, incremental: true, sourceUrl: 'https://chat.google.com/u/0/app/chat/ABC' };
  await c.runExport(options);
  messages = [...messages, { _dedupKey: 'b', absoluteTimestamp: 200, text: 'second', media: [{ url: 'https://example.com/a.txt', name: 'a.txt', type: 'file' }] }];
  await c.runExport(options);
  assert.equal(packages[1].messages.length, 1);
  assert.equal(packages[1].messages[0].text, 'second');
  assert.equal(packages[1].mediaFiles.length, 1);
  await c.runExport(options);
  assert.equal(packages.length, 2, 'nothing new produces no empty archive');
  assert.match(progress.at(-1), /No new messages/);
  assert.deepEqual(cutoffs, [0, 100, 200]);
  // Failed attachments must remain eligible on the next attempt.
  messages = [...messages, { _dedupKey: 'c', absoluteTimestamp: 300, text: 'third', media: [{ url: 'https://example.com/b.txt' }] }];
  c.downloadMedia = async () => ({ success: false });
  await c.runExport(options);
  assert.equal(packages[2].checkpoint, null);
  assert.match(packages[2].history.warning, /attachments failed/);
  assert.equal(Object.values(stored)[0].timestamp, 200);
  await c.runExport({ ...options, format: 'txt' });
  assert.equal(packages[3].messages.length, 3, 'TXT starts its own baseline rather than inheriting the media checkpoint');
  assert.equal(Object.keys(stored).length, 2);
});
