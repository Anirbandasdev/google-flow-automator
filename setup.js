// One-time setup: adds the Flow Automator tools to the Claude desktop app and to Claude Code.
// Run by setup.cmd (Windows) or setup.sh (Mac/Linux). Safe to run again.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const NAME = 'flow-automator';
const SERVER = path.join(__dirname, 'mcp', 'server.js');
const entry = { command: process.execPath, args: [SERVER] };
const done = [];

// Claude desktop app
const desktopDir = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Claude')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude')
    : path.join(os.homedir(), '.config', 'Claude');
const desktopCfg = path.join(desktopDir, 'claude_desktop_config.json');
try {
  let cfg = {};
  if (fs.existsSync(desktopCfg)) {
    const raw = fs.readFileSync(desktopCfg, 'utf8');
    cfg = raw.trim() ? JSON.parse(raw) : {};
    // keep the very first backup: running setup again must not overwrite it
    if (!fs.existsSync(`${desktopCfg}.before-flow-automator`)) fs.copyFileSync(desktopCfg, `${desktopCfg}.before-flow-automator`);
  } else fs.mkdirSync(desktopDir, { recursive: true });
  cfg.mcpServers = { ...(cfg.mcpServers || {}), [NAME]: entry };
  fs.writeFileSync(desktopCfg, JSON.stringify(cfg, null, 2));
  done.push(`Claude desktop app: added (restart Claude to see it)`);
} catch (e) {
  done.push(`Claude desktop app: could not update ${desktopCfg} (${e.message})`);
}

// Claude Code, if installed
try {
  // through the shell, so Windows finds claude.exe or claude.cmd, whichever the installer made
  const q = s => (/\s/.test(s) ? `"${s}"` : s);
  const run = args => execFileSync('claude', args.map(q), { stdio: 'pipe', shell: true });
  run(['--version']);
  try { run(['mcp', 'remove', '--scope', 'user', NAME]); } catch { /* wasn't there */ }
  run(['mcp', 'add', '--scope', 'user', NAME, '--', process.execPath, SERVER]);
  done.push('Claude Code: added');
} catch {
  done.push('Claude Code: not found (skip this if you only use the Claude desktop app)');
}

console.log('\nFlow Automator setup\n');
for (const d of done) console.log(`  - ${d}`);
fs.mkdirSync(path.join(__dirname, 'references'), { recursive: true });
console.log(`\nPut reference photos and videos in: ${path.join(__dirname, 'references')}`);
console.log('Next: restart Claude, then in a chat say: "Set up Flow Automator".\n');
