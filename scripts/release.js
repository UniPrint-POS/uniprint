#!/usr/bin/env node
'use strict';

const { execSync }                         = require('child_process');
const { readFileSync, existsSync }         = require('fs');
const { version, build: { publish: pub } } = require('../package.json');

// Load .env from the project root (project-scoped token, not system-wide)
const envPath = require('path').join(__dirname, '../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const [key, ...rest] = line.trim().split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

const repo  = `${pub.owner}/${pub.repo}`;
const tag   = `v${version}`;
const title = `UniPrint ${version}`;

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

// ── 1. Verify gh CLI is available and authenticated ──────────
try {
  execSync('gh auth status', { stdio: 'pipe' });
} catch {
  console.error('ERROR: gh CLI is not installed or not authenticated.');
  console.error('  Install : https://cli.github.com');
  console.error('  Login   : gh auth login');
  process.exit(1);
}

// ── 2. Build and publish to GitHub ───────────────────────────
console.log(`\nBuilding UniPrint ${version}...\n`);
run('electron-builder --win --x64 --publish always');

// ── 3. Rename the release title ──────────────────────────────
console.log(`\nSetting release title to "${title}"...`);
run(`gh release edit ${tag} --title "${title}" --repo ${repo}`);

console.log(`\nRelease "${title}" is live at:`);
console.log(`  https://github.com/${repo}/releases/tag/${tag}\n`);
