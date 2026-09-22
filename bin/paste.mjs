#!/usr/bin/env node
// paste - encrypt text locally and push it to a fixed gist that the viewer
// page decrypts. One secret, the code, both locates and unlocks the inbox.
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { homedir } from 'node:os';

const CONF_DIR = process.env.PASTE_HOME || `${homedir()}/.paste`;
const CONF = `${CONF_DIR}/config.json`;
const PIN_FILE = `${CONF_DIR}/pin`;
// One secret guards both the directory and the inbox, so an attacker will
// always attack whichever is cheaper per guess. Keeping the inbox cost high
// means the weaker link is not much weaker: 4M is ~2s on a phone.
const KDF = { iter: 4000000, hash: 'SHA-256' };
const KEEP = 30;
// The directory maps a memorable code to the gist address. It is resolved once
// per device and then cached, so it can afford far more work than the inbox.
const DIR_KDF = { iter: 8000000, hash: 'SHA-256' };
// Codes are compared in normalised form, so spacing and case never matter.
const normCode = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
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
// The readable form is what gets stored, so --where can print it; every
// cryptographic use normalises first. This keeps the secret in one file only.
function codeRaw() {
  if (!existsSync(PIN_FILE)) die(`no code set - run: paste --set-code "word word word word"`);
  return readFileSync(PIN_FILE, 'utf8').trim();
}
const pin = () => normCode(codeRaw());
function setPin(p) {
  if (!p || normCode(p).length < 12) die('code must be at least four words');
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

async function deriveFor(secret, saltB64, kdf, usages) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: kdf.iter, hash: kdf.hash },
    base, { name: 'AES-GCM', length: 256 }, false, usages);
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

  // The gist is writable by anything holding the GitHub token, with or without
  // the code. Entries this key cannot open did not come from here.
  const vkey = await deriveFor(pin(), inbox.salt, inbox.kdf || KDF, ['decrypt']);
  let foreign = 0;
  for (const e of inbox.entries) {
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) }, vkey, unb64(e.ct));
    } catch { foreign++; }
  }
  if (foreign) console.error(foreign > 1
    ? `paste: warning - ${foreign} entries in the inbox were written with a different key`
    : 'paste: warning - 1 entry in the inbox was written with a different key');
}

// The code is the only secret. It encrypts the directory that names the inbox
// and it encrypts the inbox contents, so setting it rewrites both.
async function cmdSetCode(words, repoDir) {
  const c = conf();
  const code = normCode(words);
  setPin(String(words).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'));

  const dirSalt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const dirKey = await deriveFor(code, dirSalt, DIR_KDF, ['encrypt']);
  const blob = await seal(dirKey, { gist: c.gist });
  const out = `${repoDir}/dir.json`;
  writeFileSync(out, JSON.stringify({ v: 1, kdf: DIR_KDF, salt: dirSalt, entries: [blob] }) + '\n');

  c.salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  c.kdf = KDF;
  delete c.code;          // the secret belongs in the code file, not here
  delete c.codeDisplay;
  delete c.old;
  c.repo = repoDir;
  saveConf(c);
  writeGist(c.gist, { v: 1, kdf: KDF, salt: c.salt, entries: [] });
  console.log(`code set; inbox cleared. commit and push ${out}`);
}

function cmdClear() {
  const c = conf();
  writeGist(c.gist, { v: 1, kdf: KDF, salt: c.salt, entries: [] });
  console.log('inbox cleared');
}

const USAGE = `usage:
  paste [-t TITLE] [-l LANG] [TEXT...]     post text (or pipe via stdin)
  paste -f FILE [-t TITLE]                 post a file
  paste --clear                            empty the inbox
  paste --set-code "four word code here"   set the one secret (wipes inbox)
  paste --init                             create the gist (once)
  paste --where                            print viewer URL and gist id`;

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === '--init') await cmdInit();
  else if (cmd === '--set-pin' || cmd === '--rotate-pin')
    die('superseded by a single secret - use: paste --set-code "word word word word"');
  else if (cmd === '--set-code') await cmdSetCode(rest.join(' '), conf().repo || '/config/claude-workspace/paste');
  else if (cmd === '--clear') cmdClear();
  else if (cmd === '--where') {
    const c = conf();
    // The fragment carries the gist id; it is never sent to the server and is
    // not in the public repo, so the full link is the thing worth bookmarking.
    if (!c.url) console.log(`(no url set) gist ${c.gist}`);
    else console.log(`${c.url}#${existsSync(PIN_FILE) ? codeRaw() : c.gist}`);
  }
  else if (cmd === '-h' || cmd === '--help') console.log(USAGE);
  else await cmdPush(process.argv.slice(2));
} catch (e) {
  die(e.stderr ? String(e.stderr).trim() : e.message);
}
