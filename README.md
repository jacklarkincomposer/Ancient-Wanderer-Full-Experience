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

*The Ancient Wanderer* is an original work for strings, percussion, harp, and choir written and produced by Jack Larkin. The piece is structured as five movements, each corresponding to a location in a fictional ancient world.

| Scene | Title | Musical Character |
|-------|-------|------------------|
| 1 | The Summit at the Edge of Memory | Solo string and harp — sparse, searching |
| 2 | The Valley of Forgotten Names | Light percussion enters — warmth, recognition |
| 3 | The World Revealed | Full orchestral swell — cello, light orchestra |
| 4 | Where the Sea Holds Its Dead | Double bass, choir, cello — weight, stillness |
| 5 | The Road That Leads to Itself | Full strings, choir, medium percussion — resolution |
| Outro | — | Full strings, full orchestra, heavy percussion — climax |

### Stems

| ID | Label | Group |
|----|-------|-------|
| `solo` | Solo String | Strings |
| `harp` | Harp | Strings |
| `lightperc` | Light Perc | Percussion |
| `cello` | Cello | Strings |
| `lightorc` | Light Orc | Orchestra |
| `doublebass` | Double Bass | Strings |
| `choir` | Choir | Vocals |
| `medperc` | Med Perc | Percussion |
| `fullstring` | Full Strings | Strings |
| `fullorc` | Full Orc | Orchestra |
| `heavyperc` | Heavy Perc | Percussion |

---

## File Structure
```
ancient-wanderer/
│
├── index.html                        # Shell HTML — no inline JS or CSS
├── css/
│   └── style.css                     # All visual styles
│
├── js/
│   ├── main.js                       # Entry point — boots the experience
│   ├── audio-engine.js               # Web Audio engine (scheduler, fades, stems)
│   ├── stem-loader.js                # Lazy loader — 4-room sliding window
│   ├── scroll-controller.js          # Scroll → room detection, pace lock, auto-scroll
│   └── ui.js                         # Cursor, visualiser, notifications, indicators
│
└── compositions/
    └── ancient-wanderer/
        └── config.json               # All composition data — stems, rooms, audio settings
```

### Module roles

| File | Responsibility |
|------|---------------|
| `main.js` | Fetches config, creates all modules, wires DOM controls, runs two-phase boot (prefetch → decode) |
| `audio-engine.js` | AudioContext lifecycle, lookahead scheduler, GainNode fades, stem loading/eviction |
| `stem-loader.js` | Decides which stems to load/evict based on current room position; 4-room window |
| `scroll-controller.js` | Maps scroll position to rooms, fires `engine.setRoom()`, enforces pace locks, drives auto-scroll |
| `ui.js` | Custom cursor, frequency visualiser, stem indicator dots, notifications, scroll arrow |
| `config.json` | Single source of truth for all composition data |

---

## Config-Driven Architecture

All composition data lives in `compositions/ancient-wanderer/config.json`. The engine contains no hardcoded stem names, room counts, or durations — everything is data-driven.

### Adding a new stem

1. Upload the MP3 file to the R2 CDN at the `cdnBase` path in config.
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

### Adding a new room

Add an entry to the `rooms` array:
```json
{
  "id": "scene-6",
  "stems": ["flute", "harp", "choir"],
  "paceLock": 10
}
```

- `id` must match the HTML element's `id` attribute for that section
- `stems` is the set of stem IDs active in this room
- `paceLock` is the minimum listening duration in seconds before forward scroll is allowed
- Rooms without `paceLock` default to a 10-second hold

### Config schema overview
```json
{
  "audio": {
    "cdnBase": "https://cdn.jacklarkincomposer.co.uk/Stems/",
    "defaultLoop": { "duration": 27.529, "bars": 13, "bpm": 85, "timeSignature": [3,4] },
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
    { "id": "...", "stems": [...], "paceLock": 10 },
    { "id": "...", "stems": [], "drones": ["..."], "paceLock": 15,
      "stingers": [{ "id": "boom", "atScrollRatio": 0.15 }] },
    { "id": "...", "stems": [...],
      "loop": { "duration": 28.8, "bars": 8, "bpm": 50, "timeSignature": [3,4] },
      "paceLock": 30, "isOutro": true, "holdDuration": 28.8 }
  ],
  "stingers": [
    { "id": "boom", "file": "Boom_Stinger.mp3", "gain": 0.9 }
  ]
}
```

---

## Audio Engine

### Lookahead scheduler

The Web Audio API's clock is sample-accurate but JavaScript timers are not. The engine uses a lookahead scheduler to bridge the two:

- A `setTimeout` loop fires every `scheduleInterval` ms (200ms by default)
- Each tick checks whether the next loop generation needs scheduling within the next `scheduleAhead` seconds (1.5s)
- `schedGeneration(when)` is called with the precise Web Audio timestamp for that generation's start
- `BufferSource.start(when)` hands the exact start time to the audio hardware — no JavaScript jitter

All stems in a generation start at an identical `when` timestamp, ensuring perfect phase coherence regardless of CPU load.

### Per-instance gain and tail crossfades

Each `BufferSource` gets its own `instGain` node. When the next loop instance starts, the previous one fades out on its own `instGain` using an exponential ramp — not a linear one, which would sound like a splice. Reverb tails decay naturally rather than cutting.

Signal path: `source → instGain → gain[id] → master`

The `tailFade` value is configured per stem in seconds. The exponential ramp targets `0.0001` (never `0`, which the Web Audio API rejects on an exponential ramp).

### Drone self-scheduler

Drones loop on their own `setTimeout` chain, crossfading at `duration - tailFade`. They never enter the phase-locked scheduler — their loop length is the decoded buffer duration, not the composition's bar-aligned loop duration. Drone rooms have `"stems": []` and a separate `"drones": [...]` array.

### Intro / loop pairs

A stem can have an intro: a one-shot that plays first, after which the stem loops. The scheduler is blocked for that stem until the intro finishes. A lookahead timer schedules the first loop instance on the audio clock at `introEndTime - tailFade`, then re-anchors `schedNext`. Config: `"intro": "<intro-stem-id>"` on the looping stem.

### Stingers

One-shot audio events fired at a specific scroll ratio within a room. Config: `"stingers": [{ "id": "boom", "atScrollRatio": 0.15 }]` on the room, with the stinger file defined in the top-level `stingers` array.

### Lazy loader

The loader maintains a 4-room sliding window:

- **Current room** — loaded and decoded first (highest priority)
- **Next room** — loaded in the background immediately after current
- **Previous room** — kept in memory to allow instant back-scroll
- **Two rooms back** — also retained in memory
- **Rooms 4+ behind** — evicted to free memory

---

## Local Development

ES modules require an HTTP server — they will not work over `file://` due to CORS restrictions.
```bash
# From the project root:
python3 -m http.server 8080

# Then open:
# http://localhost:8080
```

Any static HTTP server works. There is no build step, no bundler, and no `node_modules`.

Stem audio is fetched from the Cloudflare R2 CDN. CORS headers are configured for the production domain and local development origins.

---

## Known Limitations

**Load time on mobile** — Stems are MP3 files, typically 5–15 MB each. On slow connections the initial fetch can take 10–20 seconds. The fetch progress bar indicates loading status.

**Compression** — Stems are currently MP3. OGG/Opus compression would reduce file sizes further but is not yet implemented.

**Browser autoplay policy** — All browsers block `AudioContext` creation until a user gesture. The enter button serves as the required gesture.

**Safari AudioContext** — Safari creates `AudioContext` in a suspended state even after a user gesture. A `resume()` call on first scroll interaction handles this.

**No mobile optimisation** — Designed for desktop. Touch scrolling works but the experience is optimised for pointer devices.

---

## Roadmap

- **OGG/Opus compression** — Reduce stem sizes by ~90%
- **Video integration** — Replace static scene images with looping video clips
- **30+ stem orchestral template** — Full orchestral group system with per-section pre-mixed stems

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Vanilla JavaScript (ES2020, ES modules) |
| Audio | Web Audio API — `AudioContext`, `GainNode`, `AnalyserNode`, `AudioBufferSourceNode` |
| Styling | Plain CSS (custom properties, `@keyframes`, `IntersectionObserver`) |
| Fonts | Google Fonts — Cinzel, Cormorant Garamond |
| Hosting | GitHub Pages + Cloudflare R2 (audio CDN) |
| Build | None — no bundler, no transpiler, no `node_modules` |

---

## Academic Context

Submitted as part of a final-year composition portfolio at the University of Huddersfield. This project explores the intersection of interactive web technology and scored music — specifically, whether a listener's physical navigation of a web page can function as a form of musical performance.

The composition *The Ancient Wanderer* is an original work written and produced by Jack Larkin. The web experience is a purpose-built platform for presenting the piece — the technology serves the music, not the reverse.

The stem architecture (individual instrument tracks mixed live in the browser) is designed to make the listener's scroll behaviour audible: a fast scroll collapses the transition; a slow, attentive scroll hears the full 3-second fade as intended by the composer.

---

*© Jack Larkin 2025 · [jacklarkincomposer.co.uk](https://jacklarkincomposer.co.uk)*