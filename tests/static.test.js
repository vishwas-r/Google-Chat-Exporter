'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('2.1 retains Gmail-integrated Chat support', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '2.1.4');
  const popup = fs.readFileSync(path.join(root, 'src', 'popup.html'), 'utf8');
  assert.ok(popup.includes(`v${manifest.version}`));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, manifest.version);
  assert.ok(manifest.host_permissions.includes('https://mail.google.com/*'));
  assert.ok(manifest.content_scripts.some(script =>
    script.matches.includes('https://mail.google.com/*')
  ));
});

test('popup has no external font or stylesheet requests', () => {
  const popup = fs.readFileSync(path.join(root, 'src', 'popup.html'), 'utf8');
  assert.doesNotMatch(popup, /fonts\.(?:googleapis|gstatic)\.com/i);
  assert.doesNotMatch(popup, /<link[^>]+href=["']https?:/i);
});
