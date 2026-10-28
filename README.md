# Flow Automator

Make **Google Flow** video clips just by asking Claude.

You type what you want in Claude ("make a 6 second clip of a woman laughing in a kitchen, use woman.jpg").
Flow Automator does the clicking in Google Flow for you: it sets up the clip, attaches your reference
photos or video, presses generate, waits, and saves the finished clip to a folder on your computer.
It runs on your own computer, with your own Google account and your own Flow credits.

- [Before you start](#before-you-start)
- [1. Set it up in Claude Code](#1-set-it-up-in-claude-code)
- [2. Sign in to Google Flow](#2-sign-in-to-google-flow)
- [3. Make clips](#3-make-clips)
- [Settings](#settings)
- [Credits and limits](#credits-and-limits)
- [When it pauses](#when-it-pauses)
- [Troubleshooting](#troubleshooting)
- [Update or uninstall](#update-or-uninstall)
- [Good to know](#good-to-know)

---

## Before you start

You need:

| | |
| --- | --- |
| **Google Chrome** | [google.com/chrome](https://www.google.com/chrome/) |
| **Node.js** (LTS version) | [nodejs.org](https://nodejs.org). Restart your computer after installing it. |
| **Claude Code** (or the Claude desktop app) | [claude.com/claude-code](https://claude.com/claude-code) |
| **A Google account with Google Flow** | A Google AI plan gives you Flow credits. Check that you can open [flow.google.com](https://flow.google.com) and make a clip by hand first. |

Windows is what it's built and tested on. Mac and Linux work too.

---

## 1. Set it up in Claude Code

### The easy way: let Claude do it

Open Claude Code in any folder and paste this prompt:

```text
Please install Flow Automator for me from https://github.com/Anirbandasdev/google-flow-automator

1. Check that Node.js (version 18 or newer) and Google Chrome are installed. If either is missing,
   stop and tell me what to install and where to get it.
2. Download the project into a folder called "flow-automator" in my home folder (use git clone if git
   is installed; otherwise download and unzip
   https://github.com/Anirbandasdev/google-flow-automator/archive/refs/heads/main.zip).
   If that folder already exists, update it instead of downloading again.
3. In that folder, run: npm install --omit=dev
4. Then run: node setup.js
   This adds the "flow-automator" tools to Claude Code and the Claude desktop app.
5. Run "claude mcp list" and check that flow-automator shows as connected.
6. Tell me the full path of the folder, and tell me to close and reopen Claude Code.

Do not sign in to anything for me and never ask for my Google password.
```

When Claude says it's done, **close Claude Code and open it again**. New tools only appear in a fresh session.

### The manual way

1. Download the project: on the GitHub page click **Code → Download ZIP**, and unzip it somewhere you'll
   keep it, for example `Documents\flow-automator`. (Or `git clone https://github.com/Anirbandasdev/google-flow-automator.git flow-automator`.)
   Don't move the folder afterwards: Claude remembers where it is.
2. **Windows:** double-click **`setup.cmd`**. **Mac/Linux:** open a terminal in the folder and run `sh setup.sh`.
   It installs what's needed and adds the tools to Claude Code and the Claude desktop app.
3. Close and reopen Claude Code (and the Claude desktop app, if you use it).

### Check it worked

In a terminal, run:

```bash
claude mcp list
```

You should see a line like `flow-automator: ... - ✓ Connected`.

> **Already have the folder and just need to add it to Claude Code?** Run this, with your own folder path:
> `claude mcp add --scope user flow-automator -- node "C:\path\to\flow-automator\mcp\server.js"`

---

## 2. Sign in to Google Flow

You do this once. Flow Automator uses **its own Chrome window** with its own profile, separate from your
normal Chrome, and it remembers your sign-in after that.

1. In Claude Code, say:

   ```text
   Set up Flow Automator
   ```

2. Claude checks everything and opens a Chrome window on Google Flow.
3. **In that Chrome window**, sign in to your Google account yourself. Claude never types your password.
4. Still in that window, open Flow and **open the project** you want your clips in (or create a new one).
   The address bar should show `flow.google.com/project/...`.
5. Go back to Claude and say:

   ```text
   I'm signed in and the project is open. Use it.
   ```

   Claude saves that project. All new clips go into it.

That's it. You stay signed in. If the window isn't open next time, Claude opens it for you.

**Changing project later:** open the other project in that same Chrome window and say *"use the project that's open now"*.

**Claude Code asks permission for each tool the first time.** Choose *"Yes, and don't ask again"* for the
flow-automator tools so you're not asked every time.

---

## 3. Make clips

Just talk to Claude in plain words.

### Your first clip

```text
Make one 4 second vertical clip: a woman in her 50s laughing in a sunny kitchen, handheld phone video, realistic.
```

Claude adds the clip to the queue and tells you what it will cost, for example *"1 clip, up to 20 credits.
Shall I start?"*. Nothing runs until you say **yes**.

Claude then waits and checks on it. When it's finished, you get the file's location, for example
`...\flow-automator\downloads\clip-1.mp4`. A clip usually takes 1 to 3 minutes.

### Using reference photos and videos

References tell Flow who or what to show: the person, the product, the place.

1. Put your files in the **`references`** folder inside the Flow Automator folder.
   Say *"open my references folder"* and Claude opens it for you.
2. Mention them by name:

   ```text
   Make a clip of the woman in woman.jpg holding the bottle in bottle.png, sitting on a sofa, talking to the camera.
   ```

| | |
| --- | --- |
| Photos | png, jpg, webp |
| Videos | mp4, mov, webm |
| Per clip | up to 3 references, at most 1 video |

You can also give a full file path, or a web link to an image.

> **A video is different from a photo.** When you attach a video, Flow **edits that video** (the result has
> the video's length) instead of using it as inspiration. Use a video when you want to restyle or copy that
> exact shot, for example *"use dance.mp4 and change her dress to red"*.

### Many clips at once

```text
Make these 3 clips, 6 seconds each, using man.jpg for all of them. Name them hook-1, hook-2, hook-3:
1. He wakes up at night holding his leg in pain.
2. He rubs oil on his calf, relieved.
3. He sleeps peacefully, morning light.
```

### Things you can say

| You say | What happens |
| --- | --- |
| "How are my clips doing?" | Shows progress and finished files |
| "Start" / "Yes, go ahead" | Starts the queued clips |
| "Stop after this one" | Lets the current clip finish, starts nothing new |
| "Skip the cooldown" | Starts the next clip right away |
| "Show my queue" | Lists every clip and its status |
| "Retry clip 12" | Runs a failed clip again (costs credits again) |
| "Remove the finished clips from the list" | Tidies the queue (files on disk are kept) |
| "Open my clips folder" | Opens the folder with finished videos |
| "What are my settings?" | Shows all settings |
| "Turn the cooldown off" / "Use 1080p" / "Make clips 8 seconds" | Changes a setting |

Finished clips are saved in the **`downloads`** folder inside the Flow Automator folder.

---

## Settings

Every setting is yours to choose. Change them by asking Claude (*"set the daily limit to 30"*), or on the
web page (see below).

| Setting | Default | What it means |
| --- | --- | --- |
| Model | Omni 1.1 Flash | Flow's video model, written exactly as Flow shows it |
| Shape | 9:16 | 9:16 vertical, or 16:9 wide |
| Length | 4 seconds | Must be a length Flow offers for the model (e.g. 4, 6, 8, 10) |
| Resolution | 720p | 720p or 1080p |
| Max credits per clip | 20 | A clip is refused (not made) if Flow would charge more |
| Cooldown | 150 s + up to 90 s random | Wait between clips. 0 = no wait |
| Daily limit | 15 | Most clips started per day. 0 = no limit. Failed attempts count |
| Start by itself | off | Start as soon as Claude adds clips, without asking |
| Stop on failure | on | Stop the batch when one clip fails, so you can check |
| Give up after | 10 minutes | Stop waiting on a clip that's stuck |

Say *"reset my settings to the defaults"* to go back to these (your Flow project is kept).

### The web page (optional)

You don't need it, but you can watch the queue and change settings at **http://localhost:3777**
(Windows: double-click `start.cmd`, or ask Claude to start Flow Automator first). It works in a narrow
window too, such as Claude Code's built-in browser.

---

## Credits and limits

Each clip spends credits from your Google Flow plan. Flow shows the exact cost before each clip, and
Flow Automator refuses any clip that costs more than your **max credits per clip**.

What Omni 1.1 Flash cost at 720p when this was written (October 2026; check Flow for current prices):

| Length | Credits |
| --- | --- |
| 4 s | 7 |
| 6 s | 10 |
| 8 s | 12 |
| 10 s | 15 |
| Editing a video you attached | about 20 |

Image references cost nothing extra.

---

## When it pauses

The queue stops by itself, and Claude tells you why, in these cases:

| Why | What to do |
| --- | --- |
| **Google asks you to sign in** | Sign in yourself in the Flow Automator Chrome window, then tell Claude *"carry on"* |
| **Google shows a check** ("are you a robot", CAPTCHA, "unusual traffic") | Complete it yourself in that Chrome window, then tell Claude *"carry on"*. Flow Automator never tries to get past a check |
| **Daily limit reached** | Wait until tomorrow, or raise the limit: *"set the daily limit to 30"* |
| **A clip failed** (and *stop on failure* is on) | Ask *"why did it fail?"*. Often Flow refused the prompt; reword it and retry |

On Windows you also get a notification in the corner of the screen.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Claude doesn't know about Flow Automator | Close and reopen Claude Code. Then run `claude mcp list`; if flow-automator is missing, run the setup again |
| "Node.js is not installed" | Install the LTS version from [nodejs.org](https://nodejs.org), restart your computer, run setup again |
| "Google Chrome was not found" | Install Chrome. If it's in an unusual place, set the `CHROME_PATH` environment variable to `chrome.exe` |
| Chrome window closed by accident | The queue pauses. Say *"open the Flow Chrome window"*, then *"carry on"* |
| "Flow has no model called ..." | The model name must match Flow exactly. Look at the model menu in Flow, then say *"set the model to ..."* with that exact name |
| Clips fail with "could not find ..." | Flow changed its website. Update Flow Automator (below); if it still fails, the automation needs a fix |
| "Reference ... not found" | Put the file in the `references` folder, or give its full path |
| Stuck or confused | Ask Claude *"check Flow Automator"*, or open http://localhost:3777 |
| Want the details | The log is in `data/server.log` |

While clips are running, leave the Flow Automator Chrome window alone (don't click in it or close it).

---

## Update or uninstall

**Update:** paste this into Claude Code:

```text
Update Flow Automator: in my flow-automator folder, run git pull (or download the latest ZIP from
https://github.com/Anirbandasdev/google-flow-automator and copy it over, keeping the data, downloads,
references and chrome-profile folders), then run npm install --omit=dev and node setup.js.
```

Your queue, settings, clips, references and sign-in are kept.

**Uninstall:**

1. Run `claude mcp remove --scope user flow-automator`.
2. Claude desktop app: remove the `flow-automator` entry from `claude_desktop_config.json`
   (setup saved the original next to it as `claude_desktop_config.json.before-flow-automator`).
3. Delete the Flow Automator folder. This also deletes its saved sign-in.

---

## Good to know

- **Your account, your call.** This automates Google Flow in your browser. Google's terms may not allow
  automated use, and accounts that run a lot of automated jobs can be limited. The cooldown and daily limit
  help keep your usage closer to a person's; lowering them is up to you. Consider using a Google account
  you don't depend on for anything else.
- **Your sign-in stays on your computer**, in the `chrome-profile` folder. Don't share that folder.
- Clips come with Flow's own sound and a small Flow watermark in the corner.
- Not supported yet: start/end frames ("Frames to video") and image generation. Use references instead.

---

## For developers

| File | What it does |
| --- | --- |
| `mcp/server.js` | The Claude tools (MCP over stdio, no dependencies). Starts `server.js` in the background when needed |
| `server.js` | The queue and web page (Express, port 3777; set `PORT` to change) |
| `flow.js` | Drives Flow in Chrome over the DevTools protocol (port 9222; set `FLOW_CDP_PORT` to change) |
| `setup.js` | Registers the tools with Claude Code and the Claude desktop app |

Claude tools: `setup_status`, `open_flow_chrome`, `use_open_project`, `get_settings`, `change_settings`,
`make_clips`, `start_queue`, `stop_queue`, `skip_cooldown`, `check_clips`, `list_queue`, `retry_clips`,
`remove_clips`, `list_references`, `open_folder`.

HTTP API (local only): `POST /api/jobs/json` with
`{ prompt, name, batch, refs: [paths or URLs], aspect, model, duration, resolution, projectUrl, maxCredits }`,
`GET /api/jobs/:id`, `GET /api/state`, `POST /api/settings`, `POST /api/run/start | stop | skip-wait`.
