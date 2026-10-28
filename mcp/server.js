#!/usr/bin/env node
// Flow Automator tools for Claude (MCP over stdio, no dependencies).
// Talks to the Flow Automator server on http://127.0.0.1:3777 and starts it in the background when it isn't running,
// so a person can do everything from the Claude chat.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3777);
const BASE = `http://127.0.0.1:${PORT}`;
const REFS = path.join(ROOT, 'references');
const LOG = path.join(ROOT, 'data', 'server.log');
fs.mkdirSync(REFS, { recursive: true });
fs.mkdirSync(path.dirname(LOG), { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MEDIA = /\.(png|jpe?g|webp|mp4|mov|webm|m4v)$/i;
const VIDEO = /\.(mp4|mov|webm|m4v)$/i;

async function api(p, body, method) {
  const r = await fetch(`${BASE}${p}`, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || (data.rejected && `Not accepted: ${data.rejected.join(', ')}`) || `Flow Automator returned ${r.status}`);
  return data;
}

// Starts the server hidden in the background if it isn't up yet (once, even when several calls arrive together).
let starting = null;
async function ensureServer() {
  try { return await api('/api/state'); } catch { /* not running */ }
  if (!starting) starting = startServer().finally(() => { starting = null; });
  return starting;
}
async function startServer() {
  const out = fs.openSync(LOG, 'a');
  spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { return await api('/api/state'); } catch { /* still starting */ }
  }
  throw new Error(`The Flow Automator did not start. Its log is at ${LOG}. Is "npm install" done in ${ROOT}?`);
}

// A reference (photo or video) can be a full path, a web link, or just a file name inside the references folder.
function resolveRef(p) {
  const s = String(p).trim().replace(/^"|"$/g, '');
  if (/^https?:/i.test(s)) return s;
  if (path.isAbsolute(s) && fs.existsSync(s)) return s;
  const inFolder = path.join(REFS, s);
  if (fs.existsSync(inFolder)) return inFolder;
  const loose = fs.readdirSync(REFS).find(f => f.toLowerCase() === s.toLowerCase() || f.toLowerCase().replace(/\.[^.]+$/, '') === s.toLowerCase());
  if (loose) return path.join(REFS, loose);
  throw new Error(`Reference "${s}" not found. Give its full path, or put it in the references folder: ${REFS}`);
}

const summary = j => ({
  id: j.id, name: j.name || null, batch: j.batch, status: j.status, note: j.note || null,
  prompt: j.prompt.length > 140 ? `${j.prompt.slice(0, 140)}…` : j.prompt,
  references: (j.refs || []).map(r => path.basename(r)),
  files: (j.files || []).map(f => path.join(j.downloadsDir || '', f)),
});

function nextSteps(st) {
  const steps = [];
  if (!st.chromeFound) steps.push('Google Chrome is not installed (or not found). Install Chrome first.');
  else if (!st.flow.chrome) steps.push('Call open_flow_chrome, then ask the person to sign in to Google Flow in the Chrome window that opens.');
  else if (!st.flow.signedIn) steps.push('Ask the person to sign in to Google Flow in the Flow Automator Chrome window (they type their own password; never do it for them).');
  if (!st.settings.projectUrl) steps.push('No Flow project is chosen. Ask the person to open (or create) a project in that Chrome window, then call use_open_project.');
  if (st.haltReason) steps.push(`The queue is paused: ${st.haltReason}`);
  return steps.length ? steps : ['Ready. Use make_clips to queue clips.'];
}

const str = description => ({ type: 'string', description });
const num = description => ({ type: 'number', description });
const bool = description => ({ type: 'boolean', description });
const IDS = { type: 'array', items: { type: 'number' }, description: 'Job ids. Leave out for all jobs in the queue.' };

const tools = {
  setup_status: {
    description: 'Check that everything is ready (Automator running, Chrome open, signed in to Flow, project chosen) and see the queue, today\'s job count and limit, and the settings. Call this first in every conversation. It returns plain next steps to follow.',
    schema: { type: 'object', properties: {} },
    run: async () => {
      const st = await ensureServer();
      const count = s => st.jobs.filter(j => j.status === s).length;
      return {
        ready: st.flow.chrome && st.flow.signedIn && !!st.settings.projectUrl && !st.haltReason,
        nextSteps: nextSteps(st),
        chrome: st.flow.chrome ? 'open' : (st.chromeFound ? 'closed' : 'not installed'),
        signedInToFlow: st.flow.signedIn, project: st.settings.projectUrl || null,
        queue: { queued: count('queued'), running: count('running'), done: count('done'), failed: count('failed'), isRunning: st.running,
          cooldownEndsInSeconds: st.waitingUntil ? Math.max(0, Math.round((st.waitingUntil - Date.now()) / 1000)) : 0 },
        paused: st.haltReason || null,
        today: { jobsStarted: st.today.started, dailyLimit: st.today.limit || 'no limit' },
        settings: st.settings, referencesFolder: REFS, clipsFolder: st.downloadsDir, webPage: `http://localhost:${PORT}`,
      };
    },
  },

  open_flow_chrome: {
    description: 'Open the Flow Automator\'s own Chrome window on Google Flow. The first time, the person signs in to their Google account there themselves. Nothing is generated.',
    schema: { type: 'object', properties: {} },
    run: async () => {
      await ensureServer();
      const r = await api('/api/chrome/launch', {});
      return { ok: true, alreadyOpen: !!r.already, tell: 'A Chrome window with Google Flow is open. Sign in there if asked, then open (or create) the Flow project to use, and tell me when that is done.' };
    },
  },

  use_open_project: {
    description: 'Make the Flow project that is open in the Flow Automator Chrome window the one clips go into.',
    schema: { type: 'object', properties: {} },
    run: async () => { await ensureServer(); return api('/api/settings/use-open-project', {}); },
  },

  get_settings: {
    description: 'Read the current settings and what each one means.',
    schema: { type: 'object', properties: {} },
    run: async () => {
      const st = await ensureServer();
      return { settings: st.settings, startingValues: st.defaults, meaning: SETTING_HELP };
    },
  },

  change_settings: {
    description: 'Change settings. Only change what the person asked for. Every setting is theirs to decide: cooldown can be 0, dailyLimit 0 means no limit.',
    schema: {
      type: 'object', properties: {
        projectUrl: str('Flow project link (https://flow.google.com/project/...)'),
        model: str('Flow video model, exactly as Flow names it, e.g. "Omni 1.1 Flash"'),
        aspect: { type: 'string', enum: ['9:16', '16:9'], description: 'Clip shape' },
        resolution: { type: 'string', enum: ['720p', '1080p'], description: 'Clip resolution' },
        duration: num('Clip length in seconds, one of the lengths Flow offers for the model (e.g. 4, 6, 8, 10)'),
        maxCreditsPerJob: num('Refuse a clip if Flow would charge more than this many credits'),
        gapSeconds: num('Cooldown between clips in seconds (0 = none)'),
        gapJitterSeconds: num('Extra random cooldown, up to this many seconds (0 = none)'),
        dailyLimit: num('Most clips to start per day (0 = no limit). Failed attempts count too.'),
        autoStart: bool('Start the queue by itself as soon as clips are added'),
        stopOnFailure: bool('Stop the whole batch when one clip fails'),
        timeoutMinutes: num('Give up waiting on a clip after this many minutes'),
        resetToStartingValues: bool('Put every setting except the project back to the starting values'),
      },
    },
    run: async args => {
      await ensureServer();
      if (args.resetToStartingValues) await api('/api/settings/reset', {});
      const { resetToStartingValues, ...rest } = args;
      if (!Object.keys(rest).length) return (await api('/api/state')).settings;
      return (await api('/api/settings', rest)).settings;
    },
  },

  make_clips: {
    description: 'Queue one or more video clips in Google Flow. Each clip has a prompt and up to 3 references (Flow "ingredients"): photos (png, jpg, webp) of the person, product or place, and at most one video (mp4, mov, webm). A video makes Flow EDIT that video (the clip takes the video length and Flow charges its edit price, about 20 credits), so use a video only to restyle or copy that exact shot; it is put first automatically. References can be full paths, web links, or file names in the references folder. Clips are queued only; they cost Flow credits when the queue runs. Before starting, tell the person how many clips will run and the credit cap per clip (maxCreditsPerJob), and start only after they say yes: pass start=true here, or call start_queue.',
    schema: {
      type: 'object', properties: {
        clips: {
          type: 'array', description: 'The clips to make',
          items: {
            type: 'object', properties: {
              prompt: str('What the clip shows. One paragraph; line breaks are joined.'),
              references: { type: 'array', items: { type: 'string' }, description: 'Up to 3 references: photos, plus at most one video' },
              name: str('Short file name for the clip, e.g. "hook-1" (saved as hook-1.mp4)'),
              duration: num('Seconds, overrides the setting for this clip'),
              aspect: { type: 'string', enum: ['9:16', '16:9'] },
              model: str('Overrides the model setting for this clip'),
            },
            required: ['prompt'],
          },
        },
        references: { type: 'array', items: { type: 'string' }, description: 'References to use for every clip that does not list its own' },
        batch: str('A name for this group of clips, e.g. the ad name'),
        start: bool('Start the queue now. Only when the person already said yes to running these clips.'),
      },
      required: ['clips'],
    },
    run: async ({ clips, references, batch, start }) => {
      const st = await ensureServer();
      if (!Array.isArray(clips) || !clips.length) throw new Error('Give at least one clip');
      const shared = (references || []).map(resolveRef);
      const ids = [];
      for (const c of clips) {
        const refs = c.references && c.references.length ? c.references.map(resolveRef) : shared;
        const label = c.name || c.prompt.slice(0, 30);
        if (refs.length > 3) throw new Error(`Flow takes at most 3 references per clip ("${label}" has ${refs.length})`);
        if (refs.filter(r => VIDEO.test(r)).length > 1) throw new Error(`Flow takes one video per clip ("${label}" has more)`);
        const r = await api('/api/jobs/json', { prompt: c.prompt, refs, name: c.name, batch, duration: c.duration, aspect: c.aspect, model: c.model });
        ids.push(r.id);
      }
      let started = false;
      if (start) { const r = await api('/api/run/start', {}); started = r.ok; }
      const after = await api('/api/state');
      const s = after.settings;
      return {
        queued: ids, started: started || after.running,
        perClip: { model: s.model, seconds: s.duration, resolution: s.resolution, aspect: s.aspect, maxCredits: s.maxCreditsPerJob },
        cooldownSeconds: `${s.gapSeconds}${s.gapJitterSeconds ? ` + up to ${s.gapJitterSeconds} random` : ''}`,
        today: { jobsStarted: after.today.started, dailyLimit: after.today.limit || 'no limit' },
        warnings: nextSteps(after).filter(x => !x.startsWith('Ready')),
        next: started || after.running ? 'Running. Call check_clips to wait for them.' : 'Queued, not started. Confirm with the person, then call start_queue.',
      };
    },
  },

  start_queue: {
    description: 'Start running the queued clips in Flow. This spends Flow credits: only call it after the person agreed to run them. Also use it to carry on after a pause once the person has fixed the reason (signed in, cleared a check in Chrome).',
    schema: { type: 'object', properties: {} },
    run: async () => { await ensureServer(); return api('/api/run/start', {}); },
  },

  stop_queue: {
    description: 'Stop the queue after the clip that is generating now (that one finishes; nothing new starts).',
    schema: { type: 'object', properties: {} },
    run: async () => { await ensureServer(); return api('/api/run/stop', {}); },
  },

  skip_cooldown: {
    description: 'End the current cooldown so the next clip starts now.',
    schema: { type: 'object', properties: {} },
    run: async () => { await ensureServer(); return api('/api/run/skip-wait', {}); },
  },

  check_clips: {
    description: 'See how clips are doing and get the finished files. Waits up to wait_seconds for them to finish (max 50; call again if they are still running). Optionally copies finished clips to a folder.',
    schema: {
      type: 'object', properties: {
        ids: IDS,
        wait_seconds: num('How long to wait for the clips to finish, 0-50 (default 45)'),
        copy_to: str('Folder to copy finished clips into (optional)'),
      },
    },
    run: async ({ ids, wait_seconds, copy_to }) => {
      await ensureServer();
      const wait = Math.max(0, Math.min(50, wait_seconds === undefined ? 45 : Number(wait_seconds)));
      const t0 = Date.now();
      let st, jobs;
      for (;;) {
        st = await api('/api/state');
        jobs = st.jobs.filter(j => (ids && ids.length ? ids.includes(j.id) : j.status !== 'done' || Date.now() - (j.finishedAt || 0) < 3600e3));
        const pending = jobs.some(j => j.status === 'queued' || j.status === 'running');
        if (!pending || !st.running || Date.now() - t0 >= wait * 1000) break;
        await sleep(5000);
      }
      const out = jobs.map(j => summary({ ...j, downloadsDir: st.downloadsDir }));
      if (copy_to) {
        fs.mkdirSync(copy_to, { recursive: true });
        for (const j of out) j.files = j.files.map(f => { const d = path.join(copy_to, path.basename(f)); fs.copyFileSync(f, d); return d; });
      }
      const pending = out.filter(j => j.status === 'queued' || j.status === 'running').length;
      return {
        clips: out, stillWorking: pending,
        queueRunning: st.running, paused: st.haltReason || null,
        cooldownEndsInSeconds: st.waitingUntil ? Math.max(0, Math.round((st.waitingUntil - Date.now()) / 1000)) : 0,
        next: st.haltReason ? 'Paused: tell the person why, and call start_queue after they fix it.'
          : pending && st.running ? 'Still working: call check_clips again.'
          : pending ? 'Some clips are queued but the queue is not running: call start_queue once the person agrees.' : 'All done.',
      };
    },
  },

  list_queue: {
    description: 'List every clip in the queue with its status (queued, running, done, failed).',
    schema: { type: 'object', properties: { status: { type: 'string', enum: ['queued', 'running', 'done', 'failed'], description: 'Only this status' } } },
    run: async ({ status }) => {
      const st = await ensureServer();
      return st.jobs.filter(j => !status || j.status === status).map(j => summary({ ...j, downloadsDir: st.downloadsDir }));
    },
  },

  retry_clips: {
    description: 'Put failed (or finished) clips back in the queue to run again. Running them again spends credits again.',
    schema: { type: 'object', properties: { ids: { ...IDS, description: 'Job ids to retry' } }, required: ['ids'] },
    run: async ({ ids }) => { await ensureServer(); for (const id of ids) await api(`/api/jobs/${id}/retry`, {}); return { requeued: ids }; },
  },

  remove_clips: {
    description: 'Remove clips from the queue (not the one generating right now). Finished files on disk are kept.',
    schema: { type: 'object', properties: { ids: { ...IDS, description: 'Job ids to remove' }, all_finished: bool('Remove every done clip from the list instead') } },
    run: async ({ ids, all_finished }) => {
      await ensureServer();
      if (all_finished) { await api('/api/jobs/clear', { which: 'done' }); return { removed: 'all done clips' }; }
      for (const id of ids || []) await api(`/api/jobs/${id}`, undefined, 'DELETE');
      return { removed: ids || [] };
    },
  },

  list_references: {
    description: 'List the photos and videos in the references folder (use their names in make_clips).',
    schema: { type: 'object', properties: {} },
    run: async () => {
      const files = fs.readdirSync(REFS).filter(f => MEDIA.test(f));
      return { folder: REFS, photos: files.filter(f => !VIDEO.test(f)), videos: files.filter(f => VIDEO.test(f)) };
    },
  },

  open_folder: {
    description: 'Open the references folder (to add reference photos and videos) or the clips folder (finished videos) on the person\'s computer.',
    schema: { type: 'object', properties: { which: { type: 'string', enum: ['references', 'clips'] } }, required: ['which'] },
    run: async ({ which }) => {
      const st = await ensureServer();
      const dir = which === 'references' ? REFS : st.downloadsDir;
      const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(opener, [dir], { detached: true, stdio: 'ignore' }).unref();
      return { opened: dir };
    },
  },
};

const SETTING_HELP = {
  projectUrl: 'The Flow project clips go into',
  model: 'Flow video model, as Flow names it',
  aspect: 'Clip shape: 9:16 (vertical) or 16:9',
  resolution: '720p or 1080p',
  duration: 'Clip length in seconds',
  maxCreditsPerJob: 'A clip is refused if Flow would charge more credits than this',
  gapSeconds: 'Cooldown between clips, seconds (0 = none)',
  gapJitterSeconds: 'Extra random cooldown, up to this many seconds',
  dailyLimit: 'Most clips started per day (0 = no limit); failed attempts count',
  autoStart: 'Start by itself when clips are added',
  stopOnFailure: 'Stop the batch when a clip fails',
  timeoutMinutes: 'Give up on a clip after this long',
};

const INSTRUCTIONS = `Flow Automator makes video clips in Google Flow using the person's own signed-in Flow account (it drives a Chrome window on their computer).
- Start every conversation with setup_status and follow its nextSteps in plain, friendly words. The people using this are not technical.
- Sign-in and Google verification checks (CAPTCHA, "unusual traffic") are always done by the person in the Chrome window. Never type their password and never try to get past a check.
- Clips spend the person's Flow credits. Before running, say how many clips and the credit cap per clip, and run only after they say yes.
- Settings (cooldown, daily limit, model, length, and the rest) are the person's choice: change them when asked, and do not change them on your own.
- References: photos (png, jpg, webp) and at most one video (mp4, mov, webm) per clip, up to 3 in all. Give full paths, links, or names of files in the references folder (open_folder references opens it). A video makes Flow edit that video (the clip takes its length, about 20 credits): say so before using one. Start/end frames are not supported yet.
- After starting, call check_clips until everything is done, then give the person the paths of the finished clips.
- Clips come with Flow's own sound and a small Flow watermark.`;

// ---------------------------------------------------------------- JSON-RPC over stdio

const send = msg => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({ id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} },
      serverInfo: { name: 'flow-automator', version: require('../package.json').version }, instructions: INSTRUCTIONS } });
  }
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') {
    return send({ id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema })) } });
  }
  if (method === 'tools/call') {
    const tool = tools[params?.name];
    if (!tool) return send({ id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
    try {
      const result = await tool.run(params.arguments || {});
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] } });
    } catch (e) {
      return send({ id, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } });
    }
  }
  if (id !== undefined) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
  handle(msg).catch(e => send({ id: msg.id, error: { code: -32603, message: e.message } }));
});
