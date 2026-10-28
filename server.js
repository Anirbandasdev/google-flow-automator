// Flow Automator: local web page + queue that drives a signed-in Google Flow tab.
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const flow = require('./flow');

const PORT = Number(process.env.PORT || 3777);
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const DOWNLOADS = process.env.FLOW_DOWNLOADS || path.join(ROOT, 'downloads');
const UPLOADS = path.join(ROOT, 'uploads');
const PROFILE = path.join(ROOT, 'chrome-profile');
for (const d of [DATA, DOWNLOADS, UPLOADS]) fs.mkdirSync(d, { recursive: true });

// Finds Chrome on Windows, macOS or Linux; CHROME_PATH overrides.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const c of candidates) {
    if (path.isAbsolute(c) ? fs.existsSync(c) : (() => { try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch { return false; } })()) return c;
  }
  return null;
}

// ---------- state ----------
const STATE_FILE = path.join(DATA, 'state.json');
// Starting values for a new install. Every one of them is the person's to change on the page or through Claude.
const DEFAULT_SETTINGS = {
  projectUrl: '',            // the Flow project new clips go into
  model: 'Omni 1.1 Flash',   // as Flow names it
  aspect: '9:16',
  resolution: '720p',
  duration: 4,               // seconds
  maxCreditsPerJob: 20,      // refuse a job Flow would charge more for
  gapSeconds: 150,           // cooldown between jobs (0 = none)
  gapJitterSeconds: 90,      // plus up to this many random seconds
  dailyLimit: 15,            // jobs per day (0 = no limit)
  autoStart: false,          // start the queue by itself when jobs are added from Claude
  stopOnFailure: true,       // stop the whole batch when one job fails
  timeoutMinutes: 10,        // give up on a clip after this long
};
const defaults = { jobs: [], settings: DEFAULT_SETTINGS, nextId: 1 };
let state = fs.existsSync(STATE_FILE) ? { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } : defaults;
state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
delete state.settings.mode; delete state.settings.outputs; // old fields: the driver always makes one video from ingredients

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const startedToday = () => state.jobs.filter(j => j.startedAt && j.startedAt >= startOfToday()).length;
// A job cut off by a restart may already have been generated (and paid for) in Flow, so it is never re-run by itself.
for (const j of state.jobs) if (j.status === 'running') { j.status = 'failed'; j.note = 'Interrupted by a restart: check Flow, it may have finished there. Retry only if it did not.'; }
let running = false;
let haltReason = '';
let skipWait = null; // resolves the current between-jobs wait early
let waitingUntil = 0;
let log = [];

function save() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function addLog(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  log.push(line); if (log.length > 300) log = log.slice(-300);
  console.log(line); broadcast();
}

// ---------- server-sent events ----------
const clients = new Set();
function snapshot() {
  return { jobs: state.jobs, settings: state.settings, defaults: DEFAULT_SETTINGS, running, haltReason, waitingUntil,
    today: { started: startedToday(), limit: state.settings.dailyLimit }, chromeFound: !!findChrome(),
    downloadsDir: DOWNLOADS, log: log.slice(-80), flow: flow.status() };
}
function broadcast() {
  const data = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(data);
}

// ---------- queue runner ----------
async function runQueue() {
  if (running) return;
  running = true; haltReason = ''; broadcast();
  addLog('Queue started');
  try {
    while (running) {
      const job = state.jobs.find(j => j.status === 'queued');
      if (!job) { addLog('Queue finished: nothing left to run'); break; }
      const s = state.settings;
      if (s.dailyLimit > 0 && startedToday() >= s.dailyLimit) {
        haltReason = `Daily limit of ${s.dailyLimit} jobs reached. The rest wait until tomorrow, or raise the limit in Settings.`;
        addLog(`Paused: ${haltReason}`); break;
      }
      job.status = 'running'; job.note = 'Submitting to Flow'; job.startedAt = Date.now(); save(); broadcast();
      try {
        const files = await flow.generate(job, s, {
          downloadsDir: DOWNLOADS,
          uploadsDir: UPLOADS,
          onProgress: note => { job.note = note; broadcast(); },
          log: addLog,
        });
        job.status = 'done'; job.files = files; job.note = `${files.length} clip(s) saved`;
        addLog(`#${job.id} done → ${files.join(', ')}`);
      } catch (e) {
        if (e.code === 'NEEDS_USER') {
          // Sign-in or a verification check: stop and wait for the person. Never resumes by itself;
          // the person clears it in Chrome and presses Start.
          job.status = 'queued'; job.note = 'Waiting for you in Chrome';
          haltReason = `${e.message} Then press Start.`; running = false;
          addLog(`Paused: ${e.message}`);
          notify('Flow Automator needs you', e.message);
        } else {
          job.status = 'failed'; job.note = e.message.slice(0, 300);
          addLog(`#${job.id} failed: ${e.message}`);
          if (s.stopOnFailure) {
            haltReason = `Stopped after #${job.id} failed. Check it, then press Start to carry on.`; running = false;
          }
        }
      }
      job.finishedAt = Date.now(); save(); broadcast();
      const more = state.jobs.some(j => j.status === 'queued');
      if (running && more) {
        const wait = Math.max(0, Number(s.gapSeconds) || 0) + Math.random() * Math.max(0, Number(s.gapJitterSeconds) || 0);
        if (wait >= 1) {
          addLog(`Cooldown: next job in ${Math.round(wait)}s`);
          waitingUntil = Date.now() + wait * 1000; broadcast();
          await new Promise(r => { skipWait = r; setTimeout(r, wait * 1000); });
          skipWait = null; waitingUntil = 0; broadcast();
        }
      }
    }
  } finally {
    running = false; waitingUntil = 0; save(); broadcast();
  }
}

// Desktop notification (Windows), so a paused queue isn't missed while you're in another window.
function notify(title, text) {
  if (process.platform !== 'win32') return;
  const q = s => String(s).replace(/'/g, "''");
  const ps = `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; ` +
    `$n.Icon = [System.Drawing.SystemIcons]::Warning; $n.Visible = $true; ` +
    `$n.ShowBalloonTip(15000, '${q(title)}', '${q(text)}', 'Warning'); Start-Sleep 16; $n.Dispose()`;
  spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
}

// Reference types Flow takes as ingredients.
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const isVideo = f => VIDEO_EXT.test(f);

// Pulls a reference (photo or video; any http URL or a local path) into uploads/ and returns its local path.
async function localRef(src) {
  if (!src) return null;
  if (!/^https?:/i.test(src)) {
    if (!fs.existsSync(src)) throw new Error(`File not found: ${src}`);
    if (!IMAGE_EXT.test(src) && !isVideo(src)) throw new Error(`${path.basename(src)}: Flow takes photos (png, jpg, webp) and videos (mp4, mov, webm) as references`);
    const dest = path.join(UPLOADS, path.basename(src).replace(/[^\w.-]+/g, '_'));
    if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
    return dest;
  }
  const r = await fetch(src);
  if (!r.ok) throw new Error(`Could not download ${src} (${r.status})`);
  const type = r.headers.get('content-type') || '';
  const ext = path.extname(new URL(src).pathname).slice(0, 6) || (type.includes('video') ? '.mp4' : type.includes('jpeg') ? '.jpg' : '.png');
  const dest = path.join(UPLOADS, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}

// Flow takes at most one video, and only before any photo (photo first, then a video, is refused),
// so a video always goes first. A video makes Flow edit that video rather than use it as a look reference.
function orderRefs(refs) {
  const videos = refs.filter(isVideo), photos = refs.filter(r => !isVideo(r));
  if (videos.length > 1) throw new Error('Flow takes one video per clip. Use one video, plus photos if needed.');
  if (refs.length > 3) throw new Error('Flow takes at most 3 references per clip.');
  return [...videos, ...photos];
}

// One line only: Enter in Flow's prompt box starts a generation, so a line break would cost an extra job.
const oneLine = s => String(s).replace(/\s*[\r\n]+\s*/g, ' ').trim();
const cleanBatch = b => String(b || '').trim().replace(/[^\w-]+/g, '_');

function addJob(b, refs) {
  const job = {
    id: state.nextId++, batch: cleanBatch(b.batch) || 'batch', name: String(b.name || '').replace(/[^\w.-]+/g, '_'),
    kind: 'video', prompt: oneLine(b.prompt), refs,
    aspect: b.aspect || null, model: b.model || null, duration: b.duration ? Number(b.duration) : null,
    resolution: b.resolution || null, projectUrl: b.projectUrl || null, maxCredits: b.maxCredits ? Number(b.maxCredits) : null,
    image: refs[0] || null, status: 'queued', note: '', files: [], createdAt: Date.now(),
  };
  state.jobs.push(job);
  return job;
}

// Checks and applies a settings change; returns the names it rejected.
function applySettings(s) {
  const out = { ...state.settings }, bad = [];
  const num = (k, min, max) => {
    if (s[k] === undefined || s[k] === '') return;
    const n = Number(s[k]);
    if (!Number.isFinite(n) || n < min || (max !== undefined && n > max)) bad.push(k); else out[k] = n;
  };
  const pick = (k, allowed) => { if (s[k] === undefined) return; if (allowed.includes(String(s[k]))) out[k] = String(s[k]); else bad.push(k); };
  const bool = k => { if (s[k] !== undefined) out[k] = s[k] === true || s[k] === 'true' || s[k] === 1 || s[k] === '1'; };
  if (s.projectUrl !== undefined) {
    const u = String(s.projectUrl).trim();
    if (u === '' || /^https:\/\/(flow\.google\.com|labs\.google)\//.test(u)) out.projectUrl = u.split(/[?#]/)[0]; else bad.push('projectUrl');
  }
  if (s.model !== undefined && String(s.model).trim()) out.model = String(s.model).trim();
  pick('aspect', ['9:16', '16:9']);
  pick('resolution', ['720p', '1080p']);
  num('duration', 1, 30);
  num('maxCreditsPerJob', 1);
  num('gapSeconds', 0);
  num('gapJitterSeconds', 0);
  num('dailyLimit', 0);
  num('timeoutMinutes', 1, 120);
  bool('autoStart'); bool('stopOnFailure');
  state.settings = out; save(); broadcast();
  return bad;
}

// ---------- http ----------
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/downloads', express.static(DOWNLOADS));
app.use('/uploads', express.static(UPLOADS));
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (_, f, cb) => cb(null, f.originalname.replace(/[^\w.-]+/g, '_')),
  }),
});

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  clients.add(res);
  res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  req.on('close', () => clients.delete(res));
});
app.get('/api/state', (_, res) => res.json(snapshot()));

// From the page: prompts separated by a line with only "---" (or one per line), plus reference photos
// that go with every prompt in this batch.
app.post('/api/jobs', upload.array('images'), (req, res) => {
  const raw = String(req.body.prompts || '');
  const prompts = (req.body.splitLines === '1' ? raw.split(/\r?\n/) : raw.split(/^\s*---\s*$/m)).map(s => s.trim()).filter(Boolean);
  let refs;
  try { refs = orderRefs((req.files || []).map(f => f.path)); } catch (e) { return res.status(400).json({ error: e.message }); }
  for (const prompt of prompts) addJob({ prompt, batch: req.body.batch }, refs);
  save(); broadcast();
  if (prompts.length) addLog(`Added ${prompts.length} prompt(s)${refs.length ? ` with ${refs.length} reference(s)` : ''}`);
  res.json({ added: prompts.length });
});
// From Claude (MCP) or scripts: { prompt, name, batch, refs: [paths or URLs], aspect, model, duration, resolution, projectUrl, maxCredits }
app.post('/api/jobs/json', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.prompt || !String(b.prompt).trim()) return res.status(400).json({ error: 'prompt is required' });
    if (b.kind === 'image') return res.status(400).json({ error: 'Flow Automator makes video clips only' });
    if ((b.frames || []).length) return res.status(400).json({ error: 'Start/end frames are not supported yet; pass the images as refs (ingredients)' });
    const refs = [];
    for (const f of (b.refs || [])) refs.push(await localRef(f));
    const job = addJob(b, orderRefs(refs)); save(); broadcast();
    addLog(`#${job.id} added from Claude${job.name ? ` (${job.name})` : ''}`);
    if (state.settings.autoStart && !haltReason) runQueue();
    res.json({ id: job.id, autoStarted: state.settings.autoStart && !haltReason });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/jobs/:id', (req, res) => {
  const j = state.jobs.find(x => x.id === Number(req.params.id));
  if (!j) return res.status(404).json({ error: 'no such job' });
  res.json({ ...j, paths: (j.files || []).map(f => path.join(DOWNLOADS, f)), haltReason, running, downloadsDir: DOWNLOADS });
});
app.post('/api/jobs/:id/retry', (req, res) => {
  const j = state.jobs.find(x => x.id === Number(req.params.id));
  if (j && j.status !== 'running') { j.status = 'queued'; j.note = ''; save(); broadcast(); }
  res.json({ ok: !!j });
});
app.delete('/api/jobs/:id', (req, res) => {
  const before = state.jobs.length;
  state.jobs = state.jobs.filter(x => x.id !== Number(req.params.id) || x.status === 'running');
  save(); broadcast(); res.json({ ok: state.jobs.length < before });
});
app.post('/api/jobs/clear', (req, res) => {
  const which = (req.body || {}).which || 'done';
  state.jobs = state.jobs.filter(j => j.status === 'running' || (which === 'all' ? false : j.status !== which));
  save(); broadcast(); res.json({ ok: true });
});
app.post('/api/settings', (req, res) => {
  const bad = applySettings(req.body || {});
  res.status(bad.length ? 400 : 200).json({ settings: state.settings, rejected: bad });
});
app.post('/api/settings/reset', (_, res) => {
  state.settings = { ...DEFAULT_SETTINGS, projectUrl: state.settings.projectUrl }; save(); broadcast();
  res.json(state.settings);
});
// Uses the Flow project that is open in the Chrome window right now.
app.post('/api/settings/use-open-project', async (_, res) => {
  try {
    const page = await flow.flowPage();
    const m = page.url().match(/^https:\/\/flow\.google\.com\/project\/[0-9a-f-]+/i);
    if (!m) return res.status(400).json({ error: 'Open the Flow project you want in the Chrome window first (its address has /project/ in it).' });
    applySettings({ projectUrl: m[0] });
    addLog(`Flow project set to ${m[0]}`);
    res.json({ projectUrl: m[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/run/skip-wait', (_, res) => {
  const had = !!skipWait;
  if (had) { addLog('Cooldown skipped'); skipWait(); }
  res.json({ ok: true, skipped: had });
});
app.post('/api/run/start', (_, res) => {
  if (!state.jobs.some(j => j.status === 'queued')) return res.json({ ok: false, error: 'Nothing is queued' });
  haltReason = ''; runQueue(); res.json({ ok: true });
});
app.post('/api/run/stop', (_, res) => {
  if (running) { running = false; addLog('Stopping after the current job'); if (skipWait) skipWait(); }
  res.json({ ok: true });
});

// Opens the dedicated Chrome window (its own profile) on Flow.
app.post('/api/chrome/launch', async (_, res) => {
  if (await flow.chromeUp()) return res.json({ ok: true, already: true });
  const chrome = findChrome();
  if (!chrome) return res.status(400).json({ error: 'Google Chrome was not found. Install Chrome, or set CHROME_PATH to chrome.exe.' });
  const args = [`--remote-debugging-port=${flow.CDP_PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
    state.settings.projectUrl || flow.FLOW_URL];
  // Started through "cmd /c start" on Windows so Chrome is not a child of this server and survives its restarts.
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', chrome, ...args], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(chrome, args, { detached: true, stdio: 'ignore' }).unref();
  addLog('Opened Chrome on Flow: sign in there if asked');
  res.json({ ok: true });
});
app.post('/api/flow/check', async (_, res) => {
  await flow.refreshStatus().catch(e => addLog(`Check failed: ${e.message}`));
  broadcast(); res.json(flow.status());
});
app.post('/api/open-downloads', (_, res) => {
  const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [DOWNLOADS], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
});

// Keep the Flow connection badge fresh.
setInterval(() => { if (!running) flow.refreshStatus().then(broadcast).catch(() => {}); }, 15000);

const URL_SELF = `http://localhost:${PORT}`;
function openPage() {
  if (!process.argv.includes('--open')) return;
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', URL_SELF]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [URL_SELF]];
  spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
}
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Flow Automator is running → ${URL_SELF}`);
  console.log('Keep this window open while you use it. Close it to stop.');
  flow.refreshStatus().then(broadcast).catch(() => {});
  openPage();
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log(`Flow Automator is already running → ${URL_SELF}`); openPage(); setTimeout(() => process.exit(0), 500); return; }
  throw e;
});
