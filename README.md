# The Ancient Wanderer

**Composer:** Jack Larkin  
**Portfolio:** [jacklarkincomposer.co.uk](https://jacklarkincomposer.co.uk)  
**Contact:** jacklarkincomposer@gmail.com  
**Live:** [ancientwanderer.jacklarkincomposer.co.uk](https://ancientwanderer.jacklarkincomposer.co.uk)

An interactive audiovisual experience — a fictional ancient world told entirely through music. As you scroll, new layers of a live composition enter and dissolve with the landscape: solo strings give way to harp, percussion, choir, and full orchestra, building toward a climax and fading to silence.

---

## Concept

The piece treats scrolling as a performance gesture. Each section of the page corresponds to a movement of the composition — the user's pace through the world becomes the conductor's tempo. A pace lock holds the listener inside each section long enough to hear the musical transition before releasing them to continue.

The audio is not pre-mixed. It is assembled live in the browser from individual stem tracks, mixed in real time by the Web Audio API as the listener moves through the experience.

---

## The Composition

*The Ancient Wanderer* is an original work written and produced by Jack Larkin, structured as three chapters each corresponding to a distinct location and narrative arc.

| Chapter | Title | URL |
|---------|-------|-----|
| I | The Cursed Village | `/` |
| II | The Forge Village | `/chapter2/` |
| III | The Coastal Village | `/chapter3/` |

Each chapter has 12 scenes with a full stem set. Scene composition, stem IDs, and musical character are defined in each chapter's `config.json` — see `compositions/cursed-village/config.json` for the complete Chapter I reference.

---

## Scene Images

Each chapter HTML page has scene `<div class="scene-frame">` containers. Six of the twelve scenes in Chapter I carry a full-bleed image; the drone/bridge scenes (2, 4, 6, 7, 9, 10) are left empty.

### CDN path

Images live on Cloudflare R2, served via:

```
https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/<filename>
```

### Chapter I image map

| Scene | Scene title | Image filename |
|-------|-------------|----------------|
| 1 | The Rune in His Palm | `the_run_in_his_palm.png` |
| 2 | A Curse Doesn't Announce Itself | `A_Curse_Doesn't_Announce_Itself.png` |
| 3 | From the Ridgeline | `from_the_ridgeline.png` |
| 4 | The First Sign Is Always the Silence | `The_first_sign_is_always _the_silence.png` |
| 5 | The Hollow Market | `the_hollow_market.png` |
| 8 | The Thing at the Centre | `the_thing_at_the_centre.png` |
| 11 | The Quiet After | `the_quiet_after.png` |
| 12 | The Sun Returns | `the_sun_returns.png` |

### Replacing an image

1. Upload the new file to R2 at `Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/<filename>`.
2. In `index.html`, find the target scene's `<div class="scene-frame">` and update the `src` on the `<img>` inside it. If the scene currently has no image, add one:

```html
<div class="scene-frame"><img src="https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/your_image.png" alt="Scene Title"></div>
```

The CSS already handles the scale-in-on-scroll animation for any `img` inside `.scene-frame` — no JS or CSS changes needed.

---

## File Structure

```
ancient-wanderer-full-experience/
│
├── index.html                        # Chapter I page
├── chapter2/
│   └── index.html                    # Chapter II page (data-composition="forge-village")
├── chapter3/
│   └── index.html                    # Chapter III page (data-composition="coastal-village")
│
├── css/
│   └── style.css                     # Shared styles — all chapters
│
├── js/
│   ├── main.js                       # Entry point — boots the experience
│   ├── audio-engine.js               # Web Audio engine (scheduler, fades, stems)
│   ├── stem-loader.js                # Lazy loader — 3-room sliding window
│   ├── scroll-controller.js          # Scroll → room detection, pace lock, auto-scroll
│   ├── ui.js                         # Cursor, visualiser, notifications, indicators
│   └── particles.js                  # Ambient canvas particle layer — per-section moods
│
└── compositions/
    ├── cursed-village/
    │   └── config.json               # Chapter I — all composition data
    ├── forge-village/
    │   └── config.json               # Chapter II — all composition data
    └── coastal-village/
        └── config.json               # Chapter III — all composition data
```

### Multi-chapter architecture

All chapters share the same `js/` and `css/` assets via **site-root absolute paths** (`/js/main.js`, `/css/style.css`). This works because the site is on its own subdomain — there is no `/repo-name/` prefix on GitHub Pages.

Each chapter page identifies itself via `data-composition` on `<body>`:

```html
<!-- index.html -->
<body class="scroll-locked" data-composition="cursed-village">

<!-- chapter2/index.html -->
<body class="scroll-locked" data-composition="forge-village">
```

`main.js` reads this attribute and fetches `/compositions/${id}/config.json`. No URL parameters, no per-chapter JS. A new chapter requires only a new `config.json` and a new HTML page — no engine changes.

### Module roles

| File | Responsibility |
|------|---------------|
| `main.js` | Fetches config, creates all modules, wires DOM controls, runs two-phase boot (prefetch → decode) |
| `audio-engine.js` | AudioContext lifecycle, lookahead scheduler, GainNode fades, stem loading/eviction |
| `stem-loader.js` | Decides which stems to load/evict based on current room; 3-room sliding window |
| `scroll-controller.js` | Maps scroll position to rooms, fires `engine.setRoom()`, enforces pace locks, drives auto-scroll |
| `ui.js` | Custom cursor, frequency visualiser, stem indicator dots, notifications, scroll arrow |
| `particles.js` | Fixed canvas overlay — per-section ambient particles with smooth mood transitions |
| `config.json` | Single source of truth for all composition data — one file per chapter |

---

## Config-Driven Architecture

All composition data lives in `compositions/{id}/config.json`. The engine contains no hardcoded stem names, room counts, or durations — everything is data-driven.

### Adding a new stem

1. Upload the MP3 to the CDN at the path matching `cdnBase` in config.
2. Add an entry to the `stems` array:
```json
{
  "id": "flute",
  "file": "Flute_Melody.mp3",
  "label": "Flute",
  "group": "woodwind",
  "tailFade": 3
}
```
For a drone stem add `"type": "drone"`. For a stem with an intro one-shot add `"intro": "<intro-stem-id>"`.

3. Reference the `id` in any room's `stems` array (or `drones` array for drones).

No engine code changes required.

### Config schema

```jsonc
{
  "composition": {
    "id": "cursed-village",           // must match the compositions/ folder name
    "title": "The Ancient Wanderer",
    "subtitle": "Chapter I — The Cursed Village",
    "composer": "Jack Larkin",
    "nextChapter": "https://ancientwanderer.jacklarkincomposer.co.uk/chapter2",
    "nextChapterLabel": "Begin Chapter II →"   // button text revealed at outro
  },
  "audio": {
    "cdnBase": "https://cdn.jacklarkincomposer.co.uk/Stems/Ch1/",
    "defaultLoop": { "duration": 27.170, "bars": 8, "bpm": 53, "timeSignature": [3, 4] },
    "fadeIn": 3,
    "fadeOut": 4,
    "masterGain": 0.8,
    "masterFadeOut": 8,
    "scheduleAhead": 1.5,
    "scheduleInterval": 200
  },
  "stems": [
    { "id": "...", "file": "...", "label": "...", "group": "...", "tailFade": 3 },
    { "id": "...", "file": "...", "type": "drone", "tailFade": 5 },
    { "id": "...", "file": "...", "intro": "<intro-stem-id>", "tailFade": 3 }
  ],
  "rooms": [
    { "id": "scene-1", "stems": ["..."], "paceLock": 10 },
    {
      "id": "scene-4",
      "stems": [],
      "drones": ["drone-id"],
      "paceLock": 15,
      "stingers": [{ "id": "boom", "atScrollRatio": 0.15 }]
    },
    {
      "id": "scene-5",
      "stems": ["..."],
      "loop": { "duration": 18.947, "bars": 8, "bpm": 76, "timeSignature": [3, 4] },
      "roomIntro": { "id": "intro-stem-id", "fadeIn": 0.05, "startDelay": 0, "loopAt": 20 }
    },
    {
      "id": "scene-12",
      "stems": ["..."],
      "loop": { "duration": 28.8, "bars": 8, "bpm": 50, "timeSignature": [3, 4] },
      "paceLock": 30,
      "isOutro": true,
      "holdDuration": 28.8
    }
  ],
  "stingers": [
    { "id": "boom", "file": "Boom_Stinger.mp3", "gain": 0.9 }
  ],
  "impacts": []
}
```

**Required fields:** `composition`, `audio.cdnBase`, `audio.defaultLoop.duration`, `stems`, `rooms`.  
**Optional per-room:** `loop` (falls back to `audio.defaultLoop`), `paceLock` (defaults to 10s), `drones`, `stingers`, `roomIntro`, `isOutro`, `holdDuration`.

---

## Audio Engine

### Lookahead scheduler

The Web Audio API's clock is sample-accurate but JavaScript timers are not. The engine uses a lookahead scheduler to bridge the two:

- A `setTimeout` loop fires every `scheduleInterval` ms (200 ms by default)
- Each tick checks whether the next loop generation needs scheduling within the next `scheduleAhead` seconds (1.5 s)
- `schedGeneration(when)` is called with the precise Web Audio timestamp for that generation's start
- `BufferSource.start(when)` hands the exact start time to the audio hardware — no JavaScript jitter

All stems in a generation start at an identical `when` timestamp, ensuring perfect phase coherence regardless of CPU load.

### Per-instance gain

Each `BufferSource` gets its own `instGain` node so consecutive loop instances can be handled independently.

Signal path: `source → instGain → gain[id] → impactGain → limiter → destination`

Behaviour differs by stem type:

**Loop stems** — the baked reverb tail plays out naturally to its buffer boundary. A 50 ms linear ramp at the end prevents a click at the hard sample boundary. There is no overlap between consecutive instances.

**Drones** — the next instance starts while the current one is still playing, producing an intentional overlap crossfade. An exponential ramp (`exponentialRampToValueAtTime(0.0001, when + tailFade)`) fades out the previous instance. Target is `0.0001`, never `0` — the Web Audio API rejects `0` as the endpoint of an exponential ramp.

`tailFade` is configured per stem in seconds and defaults to `3` if absent.

### Drone self-scheduler

Drones loop on their own `setTimeout` chain, crossfading at `duration - tailFade`. They never enter the phase-locked scheduler — their loop length is the decoded buffer duration, not the composition's bar-aligned loop duration. Drone rooms have `"stems": []` and a separate `"drones": [...]` array.

### Room intro

A room can have a `roomIntro`: a one-shot that plays on first entry, after which all room stems start simultaneously at full volume. Config: `"roomIntro": { "id": "...", "fadeIn": 0.05, "startDelay": 0, "loopAt": 20 }`.

`loopAt` overrides buffer duration — use it when the audio file is longer than the musical moment you want to loop from.

### Stingers

One-shot audio events fired at a specific scroll ratio within a room. Each room-stinger pair fires once per session. Config: `"stingers": [{ "id": "boom", "atScrollRatio": 0.15 }]` on the room, with the stinger file defined in the top-level `stingers` array.

### Lazy loader — 3-room sliding window

- **Previous room** — kept in memory for instant back-scroll
- **Current room** — loaded first (highest priority, awaited before other loads)
- **Next room** — loaded in the background immediately after current
- **Two or more rooms behind** — evicted, but only stems not shared with the current window

### Outro gate

When the room marked `"isOutro": true` enters the viewport, scroll is locked within that room for `holdDuration` seconds. After that, the master fades out and the chapter button (`#chapter-btn`) is revealed with the text and href from `composition.nextChapterLabel` and `composition.nextChapter`. The user clicks to navigate — there is no auto-navigation.

Volume is saved to `sessionStorage` before navigation so the next chapter can restore it.

---

## Local Development

ES modules require an HTTP server — they will not work over `file://` due to CORS restrictions. Because the JS and CSS use **site-root absolute paths** (`/js/main.js`, `/css/style.css`), the server must be run from the project root:

```bash
# From the project root:
python3 -m http.server 8080

# Then open:
# http://localhost:8080           ← Chapter I
# http://localhost:8080/chapter2/ ← Chapter II
```

Any static HTTP server works. There is no build step, no bundler, and no `node_modules`.

Stem audio is fetched from the Cloudflare R2 CDN. CORS headers are configured for the production domain and `localhost`.

---

## Known Limitations

**Load time on mobile** — Stems are MP3 files, typically 5–15 MB each. On slow connections the initial fetch can take 10–20 seconds. The fetch progress bar indicates loading status.

**Compression** — Stems are currently MP3. OGG/Opus compression would reduce file sizes further but is not yet implemented.

**Browser autoplay policy** — All browsers block `AudioContext` creation until a user gesture. The enter button serves as the required gesture.

**Safari AudioContext** — Safari creates `AudioContext` in a suspended state even after a user gesture. A `resume()` call on first scroll interaction handles this. Tab visibility changes also trigger suspend/resume to save battery.

**No mobile optimisation** — Designed for desktop. Touch scrolling works but the experience is optimised for pointer devices.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Vanilla JavaScript (ES2020, ES modules) |
| Audio | Web Audio API — `AudioContext`, `GainNode`, `AnalyserNode`, `DynamicsCompressorNode`, `AudioBufferSourceNode` |
| Styling | Plain CSS (custom properties, `@keyframes`, `IntersectionObserver`) |
| Fonts | Google Fonts — Cinzel, Cormorant Garamond |
| Hosting | GitHub Pages + Cloudflare R2 (audio CDN) |
| Build | None — no bundler, no transpiler, no `node_modules` |

---

## Academic Context

Submitted as part of a final-year composition portfolio at the University of Huddersfield. This project explores the intersection of interactive web technology and scored music — specifically, whether a listener's physical navigation of a web page can function as a form of musical performance.

The composition *The Ancient Wanderer* is an original work written and produced by Jack Larkin. The web experience is a purpose-built platform for presenting the piece — the technology serves the music, not the reverse.

The stem architecture (individual instrument tracks mixed live in the browser) is designed to make the listener's scroll behaviour audible: a fast scroll collapses the transition; a slow, attentive scroll hears the full fade as intended by the composer.

---

*© Jack Larkin 2025 · [jacklarkincomposer.co.uk](https://jacklarkincomposer.co.uk)*
