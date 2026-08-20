#!/usr/bin/env node
// Fails the build if superagent reaches the widget bundle.
//
// The fetch wrapper attaches the session token, and it only covers fetch.
// superagent is XHR-based, so any call made through it goes out with no token and
// fails silently. ChatBlockView.jsx and ChatBlockEdit.jsx both import superagent
// today; they are outside the widget's import graph, but the commented-out
// persona call in ChatBlockView is plainly meant to come back.
//
// That change would move no file, so the CI build guard on upstream paths would
// not notice. This is the check that would.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist', import.meta.url).pathname;
const FORBIDDEN = ['superagent'];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let files;
try {
  files = walk(DIST).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`check-bundle: no build output at ${DIST} — run vite build first`);
  process.exit(1);
}

const offenders = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const needle of FORBIDDEN) {
    // Match the package's own marker rather than the bare word, so a comment
    // mentioning superagent does not trip the build.
    if (source.includes(`node_modules/${needle}`) || source.includes(`require('${needle}')`)) {
      offenders.push(`${file}: ${needle}`);
    }
  }
}

if (offenders.length) {
  console.error('check-bundle: forbidden dependency reached the widget bundle:');
  for (const o of offenders) console.error(`  ${o}`);
  console.error('\nsuperagent bypasses the fetch wrapper, so its calls would carry no session token.');
  process.exit(1);
}

console.log(`check-bundle: ok (${files.length} bundle files, no forbidden dependencies)`);
