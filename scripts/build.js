'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

if (!fs.existsSync(dist)) {
  fs.mkdirSync(dist, { recursive: true });
}

function zipDirectory(sourceDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (process.platform === 'win32') {
    const ps = `Compress-Archive -Path "${sourceDir}\\*" -DestinationPath "${zipPath}" -Force`;
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  } else {
    try {
      execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: sourceDir, stdio: 'inherit' });
    } catch {
      execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', sourceDir, '.'], { stdio: 'inherit' });
    }
  }
}

const target = process.argv[2] || 'all';

if (target === 'chrome' || target === 'all') {
  console.log(`Building Chrome package v${version}...`);
  const chromeZip = path.join(dist, `google-chat-exporter-chrome-v${version}.zip`);
  const genericZip = path.join(dist, `google-chat-exporter-v${version}.zip`);
  zipDirectory(path.join(root, 'chrome'), chromeZip);
  fs.copyFileSync(chromeZip, genericZip);
  const size = (fs.statSync(chromeZip).size / 1024).toFixed(1);
  console.log(`✔ Chrome build ready: dist/google-chat-exporter-chrome-v${version}.zip (${size} KB)`);
}

if (target === 'firefox' || target === 'all') {
  console.log(`Building Firefox package v${version}...`);
  const firefoxZip = path.join(dist, `google-chat-exporter-firefox-v${version}.zip`);
  zipDirectory(path.join(root, 'firefox'), firefoxZip);
  const size = (fs.statSync(firefoxZip).size / 1024).toFixed(1);
  console.log(`✔ Firefox build ready: dist/google-chat-exporter-firefox-v${version}.zip (${size} KB)`);
}
