// Dev helper: dumps the interactive elements of the open Flow tab so selectors can be tuned.
// Usage: node probe.js [urlSubstring]
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const pages = browser.contexts().flatMap(c => c.pages());
  const match = process.argv[2] || 'labs.google';
  const page = pages.find(p => p.url().includes(match)) || pages[0];
  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());
  const items = await page.evaluate(() => {
    const out = [];
    const els = document.querySelectorAll('button, a, input, textarea, [role=button], [role=combobox], [role=menuitem], [role=option], [role=tab], [contenteditable=true], video');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        aria: el.getAttribute('aria-label') || '',
        ph: el.getAttribute('placeholder') || '',
        id: el.id || '',
        text: (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        src: el.tagName === 'VIDEO' ? (el.currentSrc || el.src || '').slice(0, 120) : '',
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(','),
      });
    }
    return out;
  });
  for (const i of items) console.log(JSON.stringify(i));
  await browser.close(); // disconnects only; Chrome stays open
})().catch(e => { console.error(e); process.exit(1); });
