#!/usr/bin/env node
/**
 * Copies the built widget into the Onyx web server's public directory, which is
 * where nginx already serves static files from.
 *
 * There is no service to deploy: nginx routes /api to the backend and everything
 * else to the web server, so the widget lands on the SAME ORIGIN as the API and
 * there is no cross-origin request at all.
 *
 * Usage:
 *   node scripts/install-to-onyx.js [--onyx <path-to-onyx-checkout>]
 *
 * Defaults to the sibling search/onyx checkout, which is only a convenience —
 * pass --onyx once the add-on moves.
 */
import { existsSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');

const flagIndex = process.argv.indexOf('--onyx');
const onyxRoot =
  flagIndex !== -1
    ? resolve(process.argv[flagIndex + 1])
    : resolve(here, '..', '..', '..', '..', '..', '..', 'search', 'onyx');

// Namespaced rather than dropped at the root: public/ is an upstream directory
// shared with Onyx's own assets, and the widget's file names are hashed.
//
// NOT /chat — Onyx's next.config.js permanently redirects /chat/:path* to
// /app/:path*, so anything mounted there is unreachable.
const target = join(onyxRoot, 'web', 'public', 'embed');

if (!existsSync(dist)) {
  console.error(`No build at ${dist}. Run "npm run build" first.`);
  process.exit(1);
}
if (!existsSync(join(onyxRoot, 'web', 'public'))) {
  console.error(`Not an Onyx checkout: ${onyxRoot} has no web/public.`);
  process.exit(1);
}

// Replace rather than merge. Asset names carry a content hash, so copying over
// the top would accumulate every past build's files forever.
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, target, { recursive: true });

console.log(`installed widget -> ${target}`);
console.log('served at /embed/loader.js once the Onyx web server is deployed');
