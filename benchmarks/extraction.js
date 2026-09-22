'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..');
const upstreamV2Commit = '005a22f6ab493d9c2f828edf60ae97c54feab00b';
const currentSource = fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8');
const upstreamSource = execFileSync('git', ['show', `${upstreamV2Commit}:src/content.js`], { cwd: root, encoding: 'utf8' });
const groupCount = 250;
const passes = 160;
const rounds = 7;

function createHarness(source) {
  const groups = Array.from({ length: groupCount }, (_, id) => ({
    nodeType: 1,
    id,
    closest() { return this; },
    getBoundingClientRect() { return { top: id * 20, bottom: id * 20 + 18 }; },
    getAttribute(name) { return name === 'data-id' ? `group-${id}` : ''; }
  }));
  let records = [];
  const selectors = {
    frameName: 'single_full_screen', scrollContainers: [], fallbackScrollable: 'div',
    dateSeparator: '.date', messageGroups: '.group', messageText: '.text',
    absoluteTimestampAttr: '[data-absolute-timestamp]',
    attrs: { absoluteTimestamp: 'data-absolute-timestamp', groupId: 'data-id' }
  };
  const document = {
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === '.group' ? groups : []; }
  };
  class MutationObserver {
    observe() {}
    disconnect() {}
    takeRecords() { const result = records; records = []; return result; }
  }
  const event = { addListener() {} };
  const context = vm.createContext({
    AbortController, URL, TextEncoder, chrome: {
      runtime: { getURL: value => value, onMessage: event, sendMessage: async () => ({}), lastError: null },
      storage: { local: { async get() { return {}; } } }
    },
    clearTimeout, console: { log() {}, error() {} }, document,
    fetch: async () => ({ json: async () => selectors }), FileReader: class {},
    getComputedStyle: () => ({ overflowY: 'auto' }), Map, MutationObserver, Promise, Set,
    setTimeout, window: { name: '', addEventListener() {}, dispatchEvent() {} }
  });
  vm.runInContext(source, context, { filename: 'content.js' });
  return { context, groups, setRecords(value) { records = value; } };
}

async function runOnce(source, optimized, changedPerPass) {
  const harness = createHarness(source);
  const c = harness.context;
  await c.loadSelectors();
  let parses = 0;
  c.extractFromGroup = group => {
    parses++;
    let value = group.id + 1;
    for (let i = 0; i < 100; i++) value = (value * 33 + i) % 10000019;
    return [{ sender: 'Person', absoluteTimestamp: group.id + 1, text: `message-${value}`, media: [] }];
  };
  const cache = optimized ? c.createExtractionCache({}) : null;
  const start = performance.now();
  for (let pass = 0; pass < passes; pass++) {
    if (optimized && pass && changedPerPass) {
      harness.setRecords(harness.groups.slice(0, changedPerPass).map(target => ({ target })));
    }
    c.extractMessages(cache);
  }
  const elapsed = performance.now() - start;
  cache?.disconnect();
  return { elapsed, parses };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function benchmark(label, changedPerPass) {
  const upstream = [];
  const current = [];
  let upstreamParses = 0;
  let currentParses = 0;
  for (let round = 0; round < rounds; round++) {
    const first = round % 2 ? await runOnce(currentSource, true, changedPerPass) : await runOnce(upstreamSource, false, changedPerPass);
    const second = round % 2 ? await runOnce(upstreamSource, false, changedPerPass) : await runOnce(currentSource, true, changedPerPass);
    const oldResult = round % 2 ? second : first;
    const newResult = round % 2 ? first : second;
    upstream.push(oldResult.elapsed);
    current.push(newResult.elapsed);
    upstreamParses = oldResult.parses;
    currentParses = newResult.parses;
  }
  const oldMedian = median(upstream);
  const newMedian = median(current);
  return { label, oldMedian, newMedian, speedup: oldMedian / newMedian, upstreamParses, currentParses };
}

(async () => {
  const results = [
    await benchmark('Stable overlapping viewport', 0),
    await benchmark('10% of groups changed each pass', Math.ceil(groupCount * 0.10))
  ];
  console.log(`Google Chat Exporter extraction benchmark (${groupCount} groups × ${passes} collections; median of ${rounds})`);
  console.log(`Baseline: upstream v2 commit ${upstreamV2Commit.slice(0, 7)}`);
  console.log('Workload'.padEnd(38), 'Upstream v2'.padStart(12), 'v2.1.4'.padStart(12), 'Speedup'.padStart(10), 'Parses (old/new)'.padStart(20));
  for (const result of results) {
    console.log(
      result.label.padEnd(38),
      `${result.oldMedian.toFixed(1)} ms`.padStart(12),
      `${result.newMedian.toFixed(1)} ms`.padStart(12),
      `${result.speedup.toFixed(2)}×`.padStart(10),
      `${result.upstreamParses}/${result.currentParses}`.padStart(20)
    );
  }
  console.log('\nThis measures local DOM extraction only; Google history-fetch latency and media downloads are excluded.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
