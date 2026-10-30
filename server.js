const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const SESSIONS_DIR = path.join(ROOT, 'sessions');
const DATA_DIR = path.join(ROOT, 'data');
const REGISTRY_FILE = path.join(SESSIONS_DIR, 'hosted-bots.json');
const WORKERS = new Map();
const PAIR_TIMEOUT_MS = 90000;
const MAX_BOTS = Math.max(1, Number(process.env.MAX_BOTS || 10));
const requestsByIp = new Map();

fs.mkdirSync(SESSIONS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors({
  origin: process.env.PAIR_SITE_ORIGIN ? process.env.PAIR_SITE_ORIGIN.split(',').map(v => v.trim()) : true,
  methods: ['GET', 'POST', 'OPTIONS']
}));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(ROOT, 'public')));

function readRegistry() {
  try {
    const value = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function writeRegistry() {
  const numbers = [...WORKERS.keys()];
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(numbers, null, 2));
}
function validNumber(raw) {
  const number = String(raw || '').replace(/\D/g, '');
  return number.length >= 8 && number.length <= 15 ? number : null;
}
function startWorker(number) {
  const existing = WORKERS.get(number);
  if (existing && existing.child.exitCode === null && !existing.child.killed) return existing;

  const sessionDir = path.join(SESSIONS_DIR, number);
  fs.mkdirSync(sessionDir, { recursive: true });
  const child = fork(path.join(ROOT, 'index.js'), [], {
    cwd: ROOT,
    env: {
      ...process.env,
      BOT_WORKER: '1',
      BOT_PHONE_NUMBER: number,
      BOT_SESSION_DIR: sessionDir,
      // Each user has a separate Baileys auth folder.
      // Keep the bot's command/data files in the project directory.
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  });
  const worker = { child, code: null, connected: false, startedAt: Date.now() };
  WORKERS.set(number, worker);
  child.on('message', message => {
    if (message?.type === 'pair-code') worker.code = message.code;
    if (message?.type === 'connected') worker.connected = true;
  });
  child.on('exit', (code, signal) => {
    console.log(`[worker ${number}] exited code=${code} signal=${signal}`);
    if (WORKERS.get(number)?.child === child) WORKERS.delete(number);
    writeRegistry();
  });
  child.on('error', error => console.error(`[worker ${number}]`, error));
  writeRegistry();
  return worker;
}

app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({
  ok: true,
  service: 'Knight Bot Pair + Engine',
  activeBots: WORKERS.size,
  uptime: Math.floor(process.uptime())
}));

async function pairHandler(req, res) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (requestsByIp.get(ip) || []).filter(time => now - time < 60000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Too many pairing requests. Wait one minute and try again.' });
  recent.push(now);
  requestsByIp.set(ip, recent);

  const number = validNumber(req.query.number || req.body?.number);
  if (!number) return res.status(400).json({ error: 'Enter a valid WhatsApp number with country code, digits only.' });

  const existing = WORKERS.get(number);
  if (existing?.connected) {
    return res.status(409).json({ error: 'This WhatsApp number is already connected on this server.' });
  }
  if (existing?.code) return res.json({ code: existing.code, status: 'pairing' });

  if (WORKERS.size >= MAX_BOTS) {
    return res.status(503).json({ error: `This server has reached its bot limit (${MAX_BOTS}). Increase MAX_BOTS only when your Render plan has enough memory.` });
  }

  const worker = startWorker(number);
  const started = Date.now();
  const poll = setInterval(() => {
    if (worker.code) {
      clearInterval(poll);
      return res.json({ code: worker.code, status: 'pairing' });
    }
    if (worker.connected) {
      clearInterval(poll);
      return res.status(409).json({ error: 'This number already has a saved WhatsApp session and is connected.' });
    }
    if (worker.child.exitCode !== null || Date.now() - started > PAIR_TIMEOUT_MS) {
      clearInterval(poll);
      return res.status(503).json({ error: 'The bot engine did not return a pairing code. Check Render logs and try again.' });
    }
  }, 300);
}
app.get('/pair', pairHandler);
app.post('/pair', pairHandler);

// Restore all previously hosted user bots after a server restart.
// Saved session folders are reused; no credentials are sent to WhatsApp chats.
for (const number of readRegistry()) {
  if (validNumber(number)) startWorker(number);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Knight Bot Pair + Engine listening on ${PORT}`);
});
