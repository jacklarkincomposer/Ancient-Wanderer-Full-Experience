# Audio Engine — Confirmed Working

*Chapter I build · April 2026*

---

## What Is Working

| Feature | Status |
|---------|--------|
| Phase-locked lookahead scheduler | ✓ Confirmed |
| Per-instance gain (two-path: drones crossfade, loop stems click-prevent) | ✓ Confirmed |
| Room-to-room stem transitions (fade in / fade out) | ✓ Confirmed |
| Drone self-scheduler (independent loop, no phase lock) | ✓ Confirmed |
| Intro / loop pairs (one-shot → looping stem, full volume) | ✓ Confirmed |
| Room intro (one-shot → all stems start together, full volume) | ✓ Confirmed |
| Room intro `loopAt` field (exact loop entry time, overrides buffer duration) | ✓ Confirmed (scene-5) |
| Drone-to-loop transition (full volume, beat 1, after drone fade) | ✓ Implemented — pending first test (scene 7→8) |
| Drone → room-with-roomIntro (roomIntro takes priority, drone-exit skipped) | ✓ Confirmed |
| Per-room loop durations (3 BPM groups) | ✓ BPM-derived values locked |
| Stinger (one-shot at scroll ratio, per-room fire-once) | ✓ Confirmed |
| Pace lock | ✓ Confirmed |
| Outro scroll lock (within-room, not fixed point) | ✓ Confirmed |
| 3-room stem sliding window (load / evict against still-needed set) | ✓ Confirmed |
| Outro hold + chapter button reveal (text from config) | ✓ Implemented — pending first test |
| Loop duration diagnostic (per-room expected duration, not defaultLoop) | ✓ Confirmed |
| Multi-chapter: absolute paths + data-composition routing | ✓ Confirmed |

---

## BPM-Derived Loop Durations

These are objective, bar-aligned values. All stems in the same BPM group share the same duration. `tailFade` per stem handles reverb tail differences — the loop boundary does not change.

| Group | BPM | Time sig | Bars | Duration |
|-------|-----|----------|------|----------|
| Scenes 1–3 | 53 | 3/4 | 8 | **27.170 s** |
| Scenes 5–10 | 76 | 3/4 | 8 | **18.947 s** |
| Scenes 11–12 | 50 | 3/4 | 8 | **28.800 s** |

Formula: `(60 / BPM) × beatsPerBar × bars`

---

## Key Code Patterns

### 1. Per-instance gain — two-path design

Each `BufferSource` gets its own `instGain` node so consecutive instances can be faded independently without touching the shared `gain[id]`.

```
source → instGain → gain[id] → impactGain → limiter → destination
```

Behaviour differs by stem type:

**Loop stems** — the baked reverb tail plays out to its natural buffer boundary. A 50 ms linear ramp at the very end prevents a click at the hard sample boundary. No overlap between consecutive instances.

```js
const fadeLen = 0.05;
g.setValueAtTime(1, prev.naturalEnd - fadeLen);
g.linearRampToValueAtTime(0, prev.naturalEnd);
```

**Drones** — the next instance starts while the current one is still playing, producing an intentional overlap crossfade that covers the MP3 encoder-delay gap that `src.loop = true` would produce.

```js
g.setValueAtTime(1, when);
g.exponentialRampToValueAtTime(0.0001, when + tailFade);
prev.source.stop(when + tailFade + 0.05);
```

**Rules — never change these:**
- Drones: always use `exponentialRampToValueAtTime`; target `0.0001`, never `0` (API rejects `0` on an exponential ramp)
- Loop stems: 50 ms linear ramp only — do not add a real crossfade, the baked tail should play out naturally
- `tailFade` is per-stem in config, defaulting to `3` if absent
- `lastInstance[id]` must be updated before `onended` fires; the handler checks `if (lastInstance[id] === instance)` to prevent a stale event from clobbering a newer one

---

### 2. Drone self-scheduler

Drones loop on their own `setTimeout` chain, crossfading at `duration - tailFade`. They never enter the phase-locked scheduler. `buf[id].duration` (decoded buffer length) is used — not `config.loop.duration`.

```js
function scheduleDroneNext(id, currentStartTime) {
  const tailFade = stemMap[id].tailFade ?? 3;
  const duration  = buf[id].duration;
  const crossfade = Math.min(tailFade, duration * 0.5);
  const nextStart = currentStartTime + duration - crossfade;
  droneTimers[id] = setTimeout(() => {
    createInstance(id, nextStart);
    scheduleDroneNext(id, nextStart);
  }, (nextStart - actx.currentTime) * 1000);
}
```

Config: `"type": "drone"` on the stem def. Drone rooms have `"stems": []` and a `"drones": [...]` array.

---

### 3. Intro / loop pairs

One-shot plays first through the loop stem's own `gain[id]` at full volume. The scheduler is blocked for that stem until the intro finishes. A lookahead timer schedules the first loop instance on the audio clock at `introEndTime`, then re-anchors `schedNext`.

```js
// In fadeIn() when def.intro exists and hasn't played yet:
gain[id].gain.setValueAtTime(1, introStartTime);   // full volume, no ramp
const introEndTime  = introStartTime + buf[def.intro].duration;
const loopStartTime = introEndTime;
pendingIntroEnds.set(id, loopStartTime);

setTimeout(() => {
  pendingIntroEnds.delete(id);
  createInstance(id, loopStartTime);
  schedNext = Math.max(schedNext, loopStartTime + currentLoopDuration);
}, (loopStartTime - actx.currentTime - scheduleAhead) * 1000);
return; // skip trailing linearRamp — gain is already set
```

Config: `"intro": "stem-id"` on the loop stem def. The intro stem ID is in `introStemIds` and skips the scheduler entirely. `playedIntros` is session-persistent — the intro fires once, not on re-entry.

---

### 4. Room intro (`roomIntro`)

A one-shot plays once on first room entry, routed `src → g → mg` (bypassing `impactGain`). All room stems are blocked from the scheduler until the intro finishes. A lookahead timer fires `createInstance` for every stem simultaneously at `loopStartTime`, jumping gain from `0 → 1` on the audio clock — no ramp.

Config:
```jsonc
"roomIntro": {
  "id": "l4_intro",      // stem ID of the one-shot (must be in stems array, no tailFade)
  "fadeIn": 0.05,        // gain ramp at intro start (keep short)
  "startDelay": 0,       // seconds after room entry before intro plays
  "gapAfter": 0,         // silence after intro ends, before loops start (optional)
  "loopAt": 20           // if set, overrides buf.duration + gapAfter — loops start exactly
                         // this many seconds after introStartTime
}
```

`loopAt` was added for scene-5: the audio file is longer than the musical intro, so `loopAt` pins the exact handoff moment. When absent, falls back to `introStartTime + buf.duration + gapAfter` (scene-11 behaviour).

**Preload dependency**: the roomIntro buffer must be loaded before the user enters the room or `willPlayRoomIntro` evaluates false and the intro is silently skipped. The pace lock on the preceding room provides the load window — ensure `paceLock` on the room before a `roomIntro` room is at least 5 s (more on slow connections).

---

### 5. Drone-to-loop transition — full volume, beat 1, after fade

When leaving a drone-only room and entering a loop room, stems start at **full volume from bar 1** after the drone finishes fading. The delay is `audio.fadeOut` seconds (4 s), matching the drone's gain ramp to silence.

- `fadeIn()` is NOT called — gain jumps to 1 at `loopStartTime` on the audio clock
- `scheduleImmediately()` is NOT called — the lookahead timer fires `createInstance(id, loopStartTime)` for each stem
- `pendingIntroEnds` blocks the scheduler during the delay window
- `droneExitTimers[room.id]` is cancelled on re-entry to prevent duplicate instances

```js
const loopStartTime = actx.currentTime + audio.fadeOut;
schedNext = loopStartTime + currentLoopDuration;
room.stems.forEach(id => pendingIntroEnds.set(id, loopStartTime));
// lookahead timer fires at loopStartTime - scheduleAhead:
gain[id].gain.setValueAtTime(1, loopStartTime);
createInstance(id, loopStartTime);
```

---

### 6. Drone → room-with-roomIntro priority rule

When leaving a drone room and entering a room that has an unplayed `roomIntro`, the drone-exit path is skipped entirely. The roomIntro lookahead timer handles stem scheduling and gain for both cases.

```js
const willPlayRoomIntro = !!(room.roomIntro && !playedRoomIntros.has(room.id) && buf[room.roomIntro.id]);
if (prevWasDroneOnly && room.stems.length > 0 && !willPlayRoomIntro) {
  // drone-exit path
}
```

On second visit (`willPlayRoomIntro = false`), drone-exit runs normally — stems hard-hit after the drone.

---

### 7. Late-loading stems during a roomIntro (race condition)

If a stem is still loading when `setRoom` is called, it enters `pendingFades`. When it finishes loading, `loadStems` checks `pendingIntroEnds` before calling `scheduleImmediately` or `fadeIn` — so a late-arrived stem waits silently for the lookahead timer rather than starting immediately.

```js
if (!(playedIntros.has(id) && lastInstance[id]) && !pendingIntroEnds.has(id)) {
  scheduleImmediately(id);
}
if (pendingFades.has(id) && pendingFades.get(id) === currentRoomIndex) {
  activeStems.delete(id);
  if (pendingIntroEnds.has(id)) {
    activeStems.add(id); // wait silently — lookahead timer handles it
  } else {
    fadeIn(id);
  }
}
```

---

### 8. Pending stems (loaded after setRoom)

If a stem isn't in `loadedStems` when `setRoom` is called, it is queued in `pendingFades` with the room index. When `loadStems` resolves it:

```js
scheduleImmediately(id);            // join at current loop offset
if (pendingFades.get(id) === currentRoomIndex) {
  activeStems.delete(id);
  fadeIn(id);                       // ramp gain
}
```

The stem joins phase-locked with stems already playing. It starts at the correct loop offset (not bar 1).

---

## Config Fields Reference

```jsonc
{
  "composition": {
    "id": "cursed-village",           // must match compositions/ folder name
    "nextChapter": "https://...",     // chapter button href
    "nextChapterLabel": "Begin Chapter II →"  // chapter button text
  },
  "audio": {
    "defaultLoop": { "duration": 27.170 },   // used when room has no loop property
    "fadeIn": 3,                              // stem fade-in duration (seconds)
    "fadeOut": 4,                             // stem fade-out and drone-exit delay
    "masterFadeOut": 8,                       // outro master fade
    "scheduleAhead": 1.5,                     // lookahead window (seconds)
    "scheduleInterval": 200                   // scheduler poll rate (ms)
  },
  "stems": [
    {
      "id": "l3_drone",
      "file": "l3_Drone_1.mp3",
      "type": "drone",        // → self-scheduling, skips phase-locked scheduler
      "tailFade": 5           // seconds of crossfade at drone loop boundary
    },
    {
      "id": "l10_dulcimer_lutes",
      "file": "l10_Dulclimer_Lutes_2.mp3",
      "intro": "l9_oneshot",  // → one-shot plays first, then this stem loops
      "tailFade": 3
    }
  ],
  "rooms": [
    {
      "id": "scene-4",
      "stems": [],                              // empty = drone-only room
      "drones": ["l3_drone"],
      "paceLock": 15,
      "stingers": [{ "id": "boom", "atScrollRatio": 0.15 }]
    },
    {
      "id": "scene-12",
      "stems": ["l11_choir"],
      "loop": { "duration": 28.8, "bars": 8, "bpm": 50, "timeSignature": [3, 4] },
      "paceLock": 30,
      "isOutro": true,
      "holdDuration": 28.8    // seconds before master fade + chapter button reveal
    }
  ],
  "stingers": [
    { "id": "boom", "file": "Boom_Stinger.mp3", "gain": 0.9 }
  ]
}
```

---

## Particle System

Added April 2026. File: `js/particles.js`.

A `<canvas id="particle-canvas">` sits fixed over the page (`z-index: 3`, `pointer-events: none`). `initParticles()` is called at module load in `main.js` before `boot()`, so particles are running before the intro modal is dismissed.

**How it works:**
- A pool of 100 particles is maintained at all times. Only the first `n` (mood-dependent, max 90) are drawn; the rest age silently and respawn with the current mood when their lifetime expires. This avoids spawn bursts when count increases.
- Each particle has a random lifetime (5–11 s) and fades in over the first 15% of its life and out over the last 25%.
- `IntersectionObserver` watches all section elements. Whichever section has the highest `intersectionRatio` sets the active mood target.
- Mood transitions lerp all parameters (colour, count, speed, wobble, direction) over ~2.5 s. When a new section is detected mid-transition, the current blended state is snapshotted as the new `from`, preventing jumps.
- `prefers-reduced-motion: reduce` → `initParticles()` returns immediately, nothing runs.

**Mood map:**

| Section | Particles | Colour | Direction | Character |
|---------|-----------|--------|-----------|-----------|
| Hero | 35 | Gold | Rise | Sparse gold motes |
| Scene 1–2 | 30 | Gold/amber | Rise | Searching dust |
| Scene 3 | 40 | Gold | Rise | Full folk warmth |
| Scene 4–6 | 20–30 | Grey ash | Fall | Cursed village stillness |
| Scene 7 | 45 | Amber-orange | Rise | Ominous embers |
| Scene 8 | 60 | Orange-red | Rise | Dark emergence |
| Scene 9 | 90 | Hot orange | Rise | Battle chaos |
| Scene 10 | 50 | Warm grey | Fall | Heavy aftermath |
| Scene 11 | 12 | Muted grey | Fall | Quiet after |
| Scene 12 | 65 | Gold | Rise | Sun returns |
| Credits | 35 | Gold | Rise | Resolution |

**To remove entirely:**
1. Delete `js/particles.js`
2. Remove `<canvas id="particle-canvas" aria-hidden="true">` from `index.html`
3. Remove the `#particle-canvas` rule from `style.css`
4. Remove `import { initParticles } from './particles.js';` and `initParticles();` from `main.js`

**To adjust a mood** — edit the relevant entry in the `MOODS` object at the top of `particles.js`:
- `n` — particle count (max 100)
- `r/g/b` — RGB colour
- `spd` — vertical speed (px/s)
- `sMin/sMax` — particle radius range (px)
- `wob` — horizontal wobble amplitude (px/s)
- `dir` — `-1` rises, `+1` falls

**To adjust transition speed** — change `LERP_RATE` in `particles.js` (default `0.4`; higher = faster).

---

## Still Needs First Listen

- **`l3_drone` and `l6_drone` tailFade = 5 s** — actual reverb tail length unknown until heard. Increase if crossfade sounds abrupt.
- **Drone-to-loop transition (scene 7→8)** — implemented and code-reviewed but not yet tested end-to-end with real tracks.
- **Room intro timing (scene-11)** — `startDelay: 4`, `gapAfter: 3.6` are estimates from the score; tune in config after first listen.
- **Boom stinger scroll ratios** — scene-4 at `0.15`, scene-10 at `0.5`. Verify both fire at the intended musical moment. (Both will now fire — the per-room stinger key fix means scene-10 is no longer blocked by scene-4.)
- **Chapter button appearance** — check timing and aesthetics of `#chapter-btn` reveal after scene-12 holdDuration.
