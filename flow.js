// Drives Google Flow in the dedicated Chrome window over CDP (port 9222).
// Mirrors what a person does in Flow's composer: set the options, attach ingredients, type the prompt,
// press generate, wait for the clip, then download it through the clip's own menu. Human-like pacing
// throughout; any sign-in or verification check stops the run for the person.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');

const CDP_PORT = Number(process.env.FLOW_CDP_PORT || 9222);
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const FLOW_URL = 'https://flow.google.com/';

let browser = null;
let last = { chrome: false, signedIn: false, url: '', checkedAt: 0 };

class NeedsUser extends Error { constructor(m) { super(m); this.code = 'NEEDS_USER'; } }

async function chromeUp() {
  try { const r = await fetch(`${CDP}/json/version`); return r.ok; } catch { return false; }
}

async function connect() {
  if (browser && browser.isConnected()) return browser;
  if (!(await chromeUp())) throw new NeedsUser('Chrome is not open. Click "Open Chrome" and sign in to Flow.');
  browser = await chromium.connectOverCDP(CDP);
  browser.on('disconnected', () => { browser = null; });
  return browser;
}

// The Flow tab, opening one if needed.
async function flowPage() {
  const b = await connect();
  const ctx = b.contexts()[0];
  let page = ctx.pages().find(p => /flow\.google\.com|labs\.google/.test(p.url()));
  if (!page) { page = await ctx.newPage(); await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded' }); }
  return page;
}

// Stops the run when Google wants a human: sign-in, CAPTCHA, unusual-traffic checks.
async function assertNoHumanCheck(page) {
  const url = page.url();
  if (/accounts\.google\.com/.test(url)) throw new NeedsUser('Google is asking you to sign in. Sign in in the Chrome window, then press Start again.');
  // Flow always carries a hidden reCAPTCHA Enterprise frame; only a visible challenge means a human is needed.
  const blocked = await page.evaluate(() => [...document.querySelectorAll('iframe[src*="recaptcha"]')].some(f => {
    const r = f.getBoundingClientRect(), cs = getComputedStyle(f);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  })).catch(() => false);
  const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  if (blocked || /unusual traffic|verify (it's|you are) (you|human)|are you a robot/i.test(text)) {
    throw new NeedsUser('Google is showing a verification check. Complete it yourself in Chrome, then press Start again.');
  }
}

async function refreshStatus() {
  const up = await chromeUp();
  if (!up) { last = { chrome: false, signedIn: false, url: '', checkedAt: Date.now() }; return last; }
  const page = await flowPage();
  const url = page.url();
  const signInLink = await page.locator('a[aria-label="Sign in"]').count().catch(() => 0);
  last = { chrome: true, signedIn: !signInLink && !/accounts\.google\.com/.test(url), url, checkedAt: Date.now() };
  return last;
}

function status() { return last; }

// ---------- generation ----------

const pause = (page, a, z) => page.waitForTimeout(a + Math.random() * (z - a));
const overlay = page => page.locator('.cdk-overlay-container');

async function dismissPopups(page) {
  for (const name of ['Get started', 'Got it', 'Dismiss']) {
    const b = page.getByRole('button', { name, exact: true });
    if (await b.first().isVisible().catch(() => false)) { await b.first().click(); await pause(page, 600, 1000); }
  }
  // Google's account panel (opened from the avatar) sits over the composer and swallows clicks; close it, never touch it
  const acct = page.frameLocator('iframe[name="account"], iframe[src*="accounts.google.com"], iframe[src*="ogs.google.com"]');
  for (let i = 0; i < 2; i++) {
    const open = await page.locator('iframe[src*="ogs.google.com"], iframe[name="account"]').first().isVisible().catch(() => false);
    if (!open) break;
    await page.keyboard.press('Escape'); await pause(page, 500, 800);
    if (await page.locator('iframe[src*="ogs.google.com"], iframe[name="account"]').first().isVisible().catch(() => false)) {
      await page.mouse.click(960, 600); await pause(page, 500, 800);   // click empty page area to dismiss
    }
  }
  void acct;
}

async function clickToggle(page, text) {
  const t = overlay(page).locator('button[role=radio]').filter({ hasText: new RegExp(`(^|\\s)${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
  if (await t.count()) { await t.first().click(); await pause(page, 300, 700); return true; }
  return false;
}

// Sets video, ingredients/frames, aspect, model, resolution, length and one output; returns Flow's own cost line.
async function applySettings(page, o, log) {
  await page.locator('button[aria-label="Settings trigger"]').first().click();
  await pause(page, 700, 1100);
  await clickToggle(page, 'Video');
  await clickToggle(page, o.frames ? 'Frames' : 'Ingredients');
  await clickToggle(page, o.aspect === '16:9' ? '16:9' : '9:16');
  const trig = overlay(page).locator('.model-select-trigger-content').first();
  if (!(await trig.innerText()).includes(o.model)) {
    await trig.click(); await pause(page, 600, 900);
    const opt = page.getByRole('option', { name: o.model, exact: true });
    if (!(await opt.count())) throw new Error(`Flow has no model called "${o.model}"`);
    await opt.first().click(); await pause(page, 600, 900);
  }
  if (o.resolution) await clickToggle(page, o.resolution);
  if (o.duration) await clickToggle(page, `${String(o.duration).replace(/s$/, '')}s`);
  await clickToggle(page, 'x1');
  const cost = (await overlay(page).locator('.settings-credit-cost').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  const n = Number((cost.match(/(\d+)\s*credits?/) || [])[1]);
  await page.keyboard.press('Escape'); await pause(page, 500, 900);
  if (o.maxCredits && n > o.maxCredits) throw new Error(`Flow would charge ${n} credits, above the ${o.maxCredits} allowed for this job`);
  log && log(`Settings: ${o.model}, ${o.resolution || ''} ${o.duration || ''}s, ${o.aspect || '9:16'} · ${cost}`);
  return n;
}

// Empties the prompt box: text and any ingredients left from before.
async function clearComposer(page) {
  const box = page.locator('[role=textbox][aria-label="What do you want to create?"]').first();
  await box.click(); await pause(page, 200, 400);
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
  for (let i = 0; i < 6; i++) {
    const x = page.locator('button').filter({ hasText: /^close$/ }).filter({ has: page.locator('mat-icon') });
    const vis = [];
    for (const b of await x.all()) { const bb = await b.boundingBox(); if (bb && bb.y > 600) vis.push(b); }
    if (!vis.length) break;
    await vis[0].click(); await pause(page, 400, 700);
  }
}

// Attaches one reference image: uses the copy already in the project, uploads it first if it isn't there.
// Flow finds an uploaded ingredient by its file name, so two different photos both called "a-man.png" (one per ad) would
// make it reuse the old one. Each reference is uploaded under its name plus a hash of its content: the same file is
// reused, a different file with the same name is a new upload.
function uniqueRef(file, uploadsDir) {
  const src = path.isAbsolute(file) ? file : path.join(uploadsDir, file);
  const h = crypto.createHash('sha1').update(fs.readFileSync(src)).digest('hex').slice(0, 8);
  const ext = path.extname(src), stem = path.basename(src, ext);
  if (stem.endsWith('-' + h)) return src;
  const dest = path.join(uploadsDir, `${stem}-${h}${ext}`);
  if (!fs.existsSync(dest)) { fs.mkdirSync(uploadsDir, { recursive: true }); fs.copyFileSync(src, dest); }
  return dest;
}

async function addIngredient(page, file, first, uploadsDir) {
  // Flow lists uploaded images by file name ("x.jpg") but uploaded videos without the extension ("x")
  const name = /\.(mp4|mov|webm|m4v)$/i.test(file) ? path.basename(file).replace(/\.[^.]+$/, '') : path.basename(file);
  await page.locator('button[aria-label="Add ingredients to the prompt box"]').first().click();
  await pause(page, 900, 1400);
  let item = overlay(page).getByText(name, { exact: true });
  if (!(await item.count())) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), overlay(page).getByText('Upload media', { exact: true }).first().click()]);
    await chooser.setFiles(path.isAbsolute(file) ? file : path.join(uploadsDir, file));
    for (let i = 0; i < 60 && !(await item.count()); i++) await page.waitForTimeout(1000); // videos take longer to process
    await page.waitForTimeout(6000); // let the upload finish processing
    item = overlay(page).getByText(name, { exact: true });
    if (!(await item.count())) { await page.keyboard.press('Escape'); throw new Error(`Upload of ${name} did not appear in Flow`); }
  }
  await item.first().click(); await pause(page, 700, 1100);
  const add = overlay(page).getByText('Add to prompt', { exact: true });
  if (await add.first().isVisible().catch(() => false)) {
    const btn = add.first().locator('xpath=ancestor-or-self::button[1]');
    // Flow greys this out when it won't take the asset. Seen with a video next to an image: an attached video puts
    // Omni into "edit this video" mode (output takes the video's length), so a video is not a voice/style reference.
    let enabled = false;
    // a freshly uploaded image stays greyed out while Flow processes it (seen: 20+ s on a 7 MB PNG), so wait up to a minute
    for (let i = 0; i < 60 && !(enabled = await btn.isEnabled().catch(() => false)); i++) await page.waitForTimeout(1000);
    if (!enabled) {
      await page.keyboard.press('Escape');
      throw new Error(`Flow would not accept ${name} as an ingredient ("Add to prompt" stayed greyed out). An attached video makes Flow edit that video, so use it alone (as the clip to restyle), not next to images.`);
    }
    await add.first().click(); await pause(page, 900, 1300);
  }
  if (await overlay(page).locator('input[aria-label="Search assets"]').isVisible().catch(() => false)) { await page.keyboard.press('Escape'); await pause(page, 400, 700); }
}

// A finished video tile is a flow-tile-container showing a "play_circle" icon. Flow has used two layouts: the icon text
// at the start of the title button (older projects) and the icon as its own element (newer projects), so the tile itself
// is checked, not the button. Each tile's thumbnail URL holds its own id; a new clip is a finished tile whose id was not
// on the page before Start. Uploaded reference files have tiles too (named after the file) and are left out by name.
const FINISHED_TILES = skip => [...document.querySelectorAll('flow-tile-container')]
  .filter(t => t.getBoundingClientRect().width > 0 && /play_circle/.test(t.innerText || ''))
  .map(t => {
    const btn = [...t.querySelectorAll('flow-tile-hover-footer button, button')].map(x => ((x.innerText || '').trim() || x.getAttribute('aria-label') || '').replace(/^play_circle\s*/, '').trim())
      .find(x => x && !/^(favorite|reuse prompt|more options|more_vert|play_circle)$/i.test(x)) || '';
    // fresh clips carry flow-content.google/(image|video)/<uuid>; older tiles use changing /asb/ links and get no key,
    // so they can never be mistaken for the new clip (worst case is a timeout, never a wrong download)
    const srcs = [...t.querySelectorAll('img,video,source')].map(m => m.getAttribute('src') || '');
    const m = srcs.map(x => /flow-content\.google\/(?:image|video)\/([0-9a-f-]{36})/i.exec(x)).find(Boolean);
    return { key: m ? m[1] : '', title: btn };
  })
  .filter(t => t.key && !skip.includes(t.title));
const finishedTiles = (page, skip = []) => page.evaluate(FINISHED_TILES, skip);
const FAILED_TILES = () => { const f = [...document.querySelectorAll('flow-tile-container')]
  .filter(t => t.getBoundingClientRect().width > 0 && /^\s*(warning\s*)?Failed/i.test(t.innerText || ''));
  return { count: f.length, text: f.length ? f[0].innerText.replace(/\s+/g, ' ').slice(0, 160) : '' }; };
const refStems = refs => (refs || []).map(r => path.basename(r).replace(/\.[^.]+$/, ''));

// Waits for one finished tile that was not there before Start and returns its id.
async function waitForClip(page, beforeKeys, timeoutMs, onProgress, skip = [], beforeFailed = 0) {
  const t0 = Date.now();
  const before = new Set(beforeKeys);
  while (Date.now() - t0 < timeoutMs) {
    await assertNoHumanCheck(page);
    const txt = await page.evaluate(() => document.body.innerText);
    // a failed generation shows as a tile reading "Failed ... might violate our policies"; old failed tiles stay on the
    // page, so only a failed-tile count above the one taken at Start counts as this job failing
    const failed = await page.evaluate(FAILED_TILES);
    if (failed.count > beforeFailed) throw new Error(`Flow: ${failed.text || 'generation failed'}`);
    const fresh = (await finishedTiles(page, skip)).filter(t => !before.has(t.key));
    if (fresh.length > 1) throw new Error(`Flow made ${fresh.length} new clips for one job; stopped so nothing more is spent. Check Flow.`);
    if (fresh.length === 1) return fresh[0].key;
    const pct = (txt.match(/\b\d{1,3}%/) || [''])[0];
    onProgress && onProgress(`Generating in Flow${pct ? ` ${pct}` : ''} (${Math.round((Date.now() - t0) / 1000)}s)`);
    await page.waitForTimeout(15000);
  }
  throw new Error(`No clip after ${Math.round(timeoutMs / 60000)} minutes`);
}

// Downloads the newest clip through its tile menu, original size.
// The clip is already paid for by now, so a flaky download must not fail the job: try the menu download twice,
// then fetch the tile's own video link (fresh clips have one on flow-content.google).
async function downloadNewest(page, outPath, skip = [], key = '') {
  // fastest: the finished tile's own video link (Flow's menu download can hang for minutes)
  if (key && await fetchTileVideo(page, outPath, key)) return outPath;
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return await downloadOnce(page, outPath, skip, key); }
    catch (e) { lastErr = e; await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(3000); }
    if (key && await fetchTileVideo(page, outPath, key)) return outPath;
  }
  throw lastErr;
}

async function fetchTileVideo(page, outPath, key) {
  try {
    const src = await page.evaluate(k => [...document.querySelectorAll('video,source')].map(x => x.getAttribute('src') || '')
      .find(s => s.includes(`/video/${k}`)) || '', key);
    if (!src) return false;
    const res = await page.context().request.get(src);
    if (!res.ok()) return false;
    fs.writeFileSync(outPath, await res.body());
    return fs.statSync(outPath).size > 10000;
  } catch { return false; }
}

async function downloadOnce(page, outPath, skip = [], key = '') {
  // given a tile id, download exactly that tile; otherwise the newest finished one
  const keys = (await finishedTiles(page, skip)).map(t => t.key);
  const want = key || keys[0];
  if (!want || (key && !keys.includes(key))) throw new Error('No finished clip tile found');
  const tile = page.locator('flow-tile-container').filter({ has: page.locator(`img[src*="${want}"], video[src*="${want}"]`) }).first();
  const tb = await tile.boundingBox();
  if (!tb) throw new Error('No finished clip tile found');
  // hover the tile so Flow shows its buttons, then use the menu inside that same tile
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
  await pause(page, 700, 1100);
  const more = tile.locator('button[aria-label="More options"]').first();
  if (!(await more.count())) throw new Error('Could not find the menu on the new clip');
  await more.click(); await pause(page, 700, 1000);
  await page.getByRole('menuitem', { name: /Download/ }).first().click(); await pause(page, 700, 1000);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 45000 }), page.getByRole('menuitem', { name: /Original size/ }).first().click()]);
  // Playwright's own copy can land in a temp folder owned by another connection, so fall back to fetching
  // the same file with the page's session.
  try {
    await dl.saveAs(outPath);
  } catch {
    const url = dl.url();
    if (url.startsWith('blob:')) {
      // a blob link only lives inside the page, so read it there
      const b64 = await page.evaluate(async u => {
        const buf = new Uint8Array(await (await fetch(u)).arrayBuffer());
        let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      }, url);
      fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    } else {
      const res = await page.context().request.get(url);
      if (!res.ok()) throw new Error(`Download failed (${res.status()})`);
      fs.writeFileSync(outPath, await res.body());
    }
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 10000) throw new Error('Downloaded file is missing or empty');
  return outPath;
}

async function generate(job, settings, ctx) {
  const page = await flowPage();
  await assertNoHumanCheck(page);
  const st = await refreshStatus();
  if (!st.signedIn) throw new NeedsUser('Flow is signed out. Sign in in the Chrome window, then press Start.');
  if (job.kind !== 'video') throw new Error('This driver makes video only; make stills on kie.ai');
  if (job.frames && job.frames.length) throw new Error('Frames mode is not wired yet; use ingredients (reference images)');
  const project = job.projectUrl || settings.projectUrl;
  if (!project) throw new Error('No Flow project set. Open the Flow project to use and set it as the project in settings.');
  // must be the project grid itself: a scene page (/scene/...) shares the prefix but its prompt box edits that scene
  const onGrid = page.url().split(/[?#]/)[0].replace(/\/$/, '') === project.split(/[?#]/)[0].replace(/\/$/, '');
  if (!onGrid) { await page.goto(project, { waitUntil: 'domcontentloaded' }); await pause(page, 3000, 4500); }
  await assertNoHumanCheck(page);
  await dismissPopups(page);

  ctx.onProgress('Setting up the composer');
  await clearComposer(page);
  const credits = await applySettings(page, {
    model: job.model || settings.model || 'Omni 1.1 Flash', aspect: job.aspect || settings.aspect,
    resolution: job.resolution || settings.resolution || '720p', duration: job.duration || settings.duration || 4,
    maxCredits: job.maxCredits || settings.maxCreditsPerJob || 20,
  }, ctx.log);
  const refs = (job.refs || []).map(r => uniqueRef(r, ctx.uploadsDir));
  for (const [i, ref] of refs.entries()) {
    ctx.onProgress(`Adding ingredient ${i + 1}`);
    await addIngredient(page, ref, i === 0, ctx.uploadsDir);
  }
  ctx.onProgress('Typing the prompt');
  const box = page.locator('[role=textbox][aria-label="What do you want to create?"]').first();
  await box.click(); await pause(page, 300, 600);
  // Enter in Flow's prompt box submits, so a line break typed here would start an extra (paid) generation.
  const promptText = String(job.prompt).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  await page.keyboard.type(promptText, { delay: 14 + Math.random() * 12 });
  await pause(page, 1200, 2200);

  const skip = refStems(refs);
  const before = (await finishedTiles(page, skip)).map(t => t.key);
  const beforeFailed = (await page.evaluate(FAILED_TILES)).count;
  await page.locator('button[aria-label="Start generation"]').first().click();
  ctx.log && ctx.log(`#${job.id} submitted to Flow (${credits} credits)`);
  await pause(page, 4000, 6000);
  const newKey = await waitForClip(page, before, (settings.timeoutMinutes || 10) * 60000, ctx.onProgress, skip, beforeFailed);
  await pause(page, 2500, 4000);
  const out = path.join(ctx.downloadsDir, `${(job.name || `job-${job.id}`).replace(/[^\w.-]+/g, '_')}.mp4`);
  ctx.onProgress('Downloading');
  await downloadNewest(page, out, skip, newKey);
  return [path.basename(out)];
}

module.exports = { FLOW_URL, CDP_PORT, chromeUp, refreshStatus, status, generate, flowPage, assertNoHumanCheck, NeedsUser,
  _steps: { uniqueRef, applySettings, clearComposer, addIngredient, dismissPopups, downloadNewest, finishedTiles, fetchTileVideo, FAILED_TILES } }; // _steps: for dry runs
