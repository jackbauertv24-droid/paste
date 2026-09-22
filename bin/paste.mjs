#!/usr/bin/env node
// paste - encrypt text locally and push it to a fixed gist that the
// viewer page at <pages-url> decrypts with a PIN.
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { homedir } from 'node:os';

const CONF_DIR = process.env.PASTE_HOME || `${homedir()}/.paste`;
const CONF = `${CONF_DIR}/config.json`;
const PIN_FILE = `${CONF_DIR}/pin`;
const KDF = { iter: 250000, hash: 'SHA-256' };
const KEEP = 30;
const MAX_BYTES = 512 * 1024;

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64');

const die = (msg) => { console.error(`paste: ${msg}`); process.exit(1); };

function conf() {
  if (!existsSync(CONF)) die(`not initialised - run: paste --init`);
  return JSON.parse(readFileSync(CONF, 'utf8'));
}
function saveConf(c) {
  mkdirSync(CONF_DIR, { recursive: true });
  writeFileSync(CONF, JSON.stringify(c, null, 2) + '\n');
  chmodSync(CONF, 0o600);
}
function pin() {
  if (!existsSync(PIN_FILE)) die(`no PIN set - run: paste --set-pin <pin>`);
  return readFileSync(PIN_FILE, 'utf8').trim();
}
function setPin(p) {
  if (!p || p.length < 4) die('PIN must be at least 4 characters');
  mkdirSync(CONF_DIR, { recursive: true });
  writeFileSync(PIN_FILE, p + '\n');
  chmodSync(PIN_FILE, 0o600);
}

async function deriveKey(pinStr, saltB64) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pinStr), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: KDF.iter, hash: KDF.hash },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}

async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}

const gh = (args, input) =>
  execFileSync('gh', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function readGist(id) {
  const g = JSON.parse(gh(['api', `/gists/${id}`]));
  const f = g.files['inbox.json'];
  if (!f) return null;
  return JSON.parse(f.truncated ? gh(['api', '--method', 'GET', f.raw_url]) : f.content);
}

function writeGist(id, inbox) {
  const body = JSON.stringify({ files: { 'inbox.json': { content: JSON.stringify(inbox) } } });
  gh(['api', '--method', 'PATCH', `/gists/${id}`, '--input', '-'], body);
}

function stdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// ---- commands ----------------------------------------------------------

async function cmdInit() {
  const body = JSON.stringify({
    // Secret, not private: still readable anonymously by the viewer page, but
    // not listed on the owner's profile and not reachable without the id.
    description: 'notes',
    public: false,
    files: { 'inbox.json': { content: '{}' } },
  });
  const g = JSON.parse(gh(['api', '--method', 'POST', '/gists', '--input', '-'], body));
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  saveConf({ gist: g.id, salt, kdf: KDF });
  writeGist(g.id, { v: 1, kdf: KDF, salt, entries: [] });
  console.log(`gist  ${g.id}`);
  console.log('bookmark the URL printed by: paste --where');
}

async function cmdPush(argv) {
  const c = conf();
  let title = null, lang = null, file = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-t' || a === '--title') title = argv[++i];
    else if (a === '-l' || a === '--lang') lang = argv[++i];
    else if (a === '-f' || a === '--file') file = argv[++i];
    else rest.push(a);
  }
  let body;
  if (file) { body = readFileSync(file, 'utf8'); title ||= basename(file); }
  else if (rest.length) body = rest.join(' ');
  else body = stdin();
  if (!body.trim()) die('nothing to paste (pass text, -f FILE, or pipe stdin)');
  if (Buffer.byteLength(body) > MAX_BYTES) die(`too large (${Buffer.byteLength(body)} bytes, max ${MAX_BYTES})`);

  const key = await deriveKey(pin(), c.salt);
  const entry = await seal(key, {
    ts: new Date().toISOString(),
    title: title || null,
    lang: lang || (file ? (file.split('.').pop() || null) : null),
    body,
  });

  const inbox = readGist(c.gist) || { v: 1, kdf: KDF, salt: c.salt, entries: [] };
  if (inbox.salt !== c.salt) die('gist salt differs from local config - PIN was rotated elsewhere');
  inbox.entries.unshift(entry);
  inbox.entries = inbox.entries.slice(0, KEEP);
  writeGist(c.gist, inbox);
  console.log(`posted -> ${c.url || 'viewer'}  (${inbox.entries.length} in inbox)`);
}

function cmdClear() {
  const c = conf();
  writeGist(c.gist, { v: 1, kdf: KDF, salt: c.salt, entries: [] });
  console.log('inbox cleared');
}

async function cmdRotate(newPin) {
  const c = conf();
  setPin(newPin);
  c.salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  saveConf(c);
  writeGist(c.gist, { v: 1, kdf: KDF, salt: c.salt, entries: [] });
  console.log('PIN rotated; inbox cleared (old entries are undecryptable)');
}

const USAGE = `usage:
  paste [-t TITLE] [-l LANG] [TEXT...]     post text (or pipe via stdin)
  paste -f FILE [-t TITLE]                 post a file
  paste --clear                            empty the inbox
  paste --set-pin PIN                      set the unlock PIN
  paste --rotate-pin PIN                   new PIN + wipe inbox
  paste --init                             create the gist (once)
  paste --where                            print viewer URL and gist id`;

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === '--init') await cmdInit();
  else if (cmd === '--set-pin') { setPin(rest[0]); console.log('PIN set'); }
  else if (cmd === '--rotate-pin') await cmdRotate(rest[0]);
  else if (cmd === '--clear') cmdClear();
  else if (cmd === '--where') {
    const c = conf();
    // The fragment carries the gist id; it is never sent to the server and is
    // not in the public repo, so the full link is the thing worth bookmarking.
    console.log(c.url ? `${c.url}#${c.gist}` : `(no url set) gist ${c.gist}`);
  }
  else if (cmd === '-h' || cmd === '--help') console.log(USAGE);
  else await cmdPush(process.argv.slice(2));
} catch (e) {
  die(e.stderr ? String(e.stderr).trim() : e.message);
}
