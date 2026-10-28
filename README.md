# Flow Automator

Make Google Flow video clips by asking Claude. You type what you want in the Claude chat; Flow Automator
does the clicking in Google Flow for you, on your own computer and your own Flow account, and saves the
finished clips to a folder.

## What you need

- Windows (Mac and Linux work too)
- [Google Chrome](https://www.google.com/chrome/)
- [Node.js](https://nodejs.org) (the LTS version)
- The [Claude desktop app](https://claude.ai/download) or Claude Code
- A Google account with Google Flow (a Google AI plan gives Flow credits)

## Set up (once)

1. Download this project: the green **Code** button → **Download ZIP**, then unzip it somewhere you'll keep it
   (for example `Documents\flow-automator`). Don't move the folder afterwards.
2. Double-click **`setup.cmd`** (Mac/Linux: run `sh setup.sh`). It installs everything and adds Flow Automator to Claude.
3. Quit and reopen Claude.
4. In a new chat, say: **"Set up Flow Automator"**. Claude opens a Chrome window on Google Flow.
5. In that Chrome window: sign in to your Google account, then open (or create) the Flow project you want to use.
   Tell Claude when you're done.

That window has its own separate Chrome profile, so it doesn't touch your normal Chrome.

## Use it

Just talk to Claude. For example:

- "Make a 6 second vertical clip of a woman laughing in a kitchen, using woman.jpg"
- "Make 3 clips from these prompts: …"
- "Use this video and change her shirt to red" (attach the video as a reference)
- "How are my clips doing?"
- "Turn the cooldown off" · "Set the daily limit to 30" · "Use 1080p"
- "Open my clips folder"

Claude tells you how many clips will run before it starts, and only starts when you say yes.

**References:** put photos (png, jpg, webp) and videos (mp4, mov, webm) in the **`references`** folder inside
this project, then use their names in the chat. Up to 3 per clip; at most one video. A video makes Flow
*edit* that video (the clip takes the video's length), so use one when you want to change or copy that exact shot.

**Finished clips** are saved in the **`downloads`** folder.

## Settings you control

Ask Claude to change any of these, or use the page at http://localhost:3777 (double-click `start.cmd`).

| Setting | Starting value | Meaning |
| --- | --- | --- |
| Model | Omni 1.1 Flash | Flow's video model, as Flow names it |
| Shape | 9:16 | vertical, or 16:9 wide |
| Length | 4 s | seconds per clip |
| Resolution | 720p | or 1080p |
| Max credits per clip | 20 | a clip is refused if Flow would charge more |
| Cooldown | 150 s + up to 90 s random | wait between clips (0 = none) |
| Daily limit | 15 | clips per day (0 = no limit); failed attempts count |
| Start by itself | off | start as soon as Claude adds clips |
| Stop on failure | on | stop the batch when a clip fails |
| Give up after | 10 min | stop waiting on a stuck clip |

## Good to know

- **Your account, your risk.** This automates Google Flow in your browser. Google's terms may not allow
  automated use, and accounts that run a lot of automated jobs can be limited. The cooldown and daily limit are
  there to keep usage closer to a person's; lowering them is your call.
- **Sign-in and "are you human" checks are always yours.** If Google asks you to sign in or shows a check,
  the queue pauses and you get a notification. Do it in the Chrome window, then tell Claude to carry on.
  Flow Automator never types your password and never tries to get past a check.
- Clips come with Flow's own sound and a small Flow watermark.
- Flow changes its website from time to time. If clips suddenly fail with "could not find…", the
  automation needs an update.
- Start and end frames ("Frames to video") aren't supported yet. Use references instead.

## Troubleshooting

- **Claude doesn't show the tools:** run `setup.cmd` again, then fully quit and reopen Claude.
- **"Chrome not found":** install Google Chrome, or set `CHROME_PATH` to your `chrome.exe`.
- **Stuck or confused:** ask Claude "check Flow Automator", or open http://localhost:3777 to see the queue.
- **Logs:** `data/server.log`.

## For developers

- `server.js`: the queue and web page (Express, port 3777; `PORT` to change).
- `flow.js`: drives Flow in Chrome over the DevTools protocol (port 9222; `FLOW_CDP_PORT` to change).
- `mcp/server.js`: the Claude tools (MCP over stdio, no dependencies). It starts `server.js` when needed.
- HTTP API: `POST /api/jobs/json` `{ prompt, name, batch, refs: [paths or URLs], aspect, model, duration, resolution, projectUrl, maxCredits }`,
  `GET /api/jobs/:id`, `GET /api/state`, `POST /api/settings`, `POST /api/run/start|stop|skip-wait`.
