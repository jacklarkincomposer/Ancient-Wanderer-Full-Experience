# Audio Engine — Confirmed Working

*Chapter I build · April 2026*

---

## What Is Working

| Feature | Status |
|---------|--------|
| Phase-locked lookahead scheduler | ✓ Confirmed |
| Per-instance gain (tail crossfade) | ✓ Confirmed |
| Exponential ramp on tail fade | ✓ Confirmed |
| Room-to-room stem transitions (fade in / fade out) | ✓ Confirmed |
| Drone self-scheduler (independent loop, no phase lock) | ✓ Confirmed |
| Intro / loop pairs (one-shot → looping stem) | ✓ Confirmed |
| Room intro (one-shot → all stems start together, full volume) | ✓ Implemented |
| Room intro `loopAt` field (exact loop entry time, overrides buffer duration) | ✓ Implemented (scene-5) |
| Drone-to-loop transition (full volume, beat 1, after drone fade) | ✓ Implemented — pending first test |
| Drone → room-with-roomIntro (roomIntro takes priority, drone-exit skipped) | ✓ Fixed |
| Per-room loop durations (3 BPM groups) | ✓ BPM-derived values locked |
| Stinger (one-shot at scroll ratio) | ✓ Confirmed |
| Pace lock | ✓ Confirmed |
| Outro scroll lock (within-room, not fixed point) | ✓ Implemented |
| 4-room stem sliding window (load / evict) | ✓ Confirmed |
| Outro hold + chapter button reveal | ✓ Implemented — pending first test |
| Loop duration diagnostic (console warning on mismatch) | ✓ Implemented |

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

### 1. Per-instance gain — tail crossfade

Each `BufferSource` gets its own `instGain` node. When the next loop instance starts, the previous one is faded out on its own `instGain`, not the shared stem `GainNode`. Reverb tails decay naturally instead of cutting.

```
source → instGain → gain[id] → master
```

```js
// Fade out previous instance's instGain — exponential matches reverb curve
const prev = lastInstance[id];
if (prev) {
  prev.instGain.gain.setValueAtTime(1, when);
  prev.instGain.gain.exponentialRampToValueAtTime(0.0001, when + tailFade);
  prev.source.stop(when + tailFade + 0.05);
}
lastInstance[id] = { source, instGain };
```

**Rules:**
- Always use `exponentialRampToValueAtTime`, never linear — linear sounds like a splice
- Target `0.0001`, never `0` — the API rejects 0 on an exponential ramp
- `tailFade` is per-stem in config (e.g. `"tailFade": 3.5`)

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

One-shot plays first through the loop stem's own `gain[id]`. The scheduler is blocked for that stem until the intro finishes. A lookahead timer schedules the first loop instance on the audio clock at `introEndTime - tailFade`, then re-anchors `schedNext`.

```js
// In fadeIn() when def.intro exists and hasn't played yet:
const introEndTime  = actx.currentTime + 0.05 + buf[def.intro].duration;
const loopStartTime = introEndTime - tailFade;
pendingIntroEnds.set(id, loopStartTime);

setTimeout(() => {
  pendingIntroEnds.delete(id);
  createInstance(id, loopStartTime);
  schedNext = Math.max(schedNext, loopStartTime + currentLoopDuration);
}, (loopStartTime - actx.currentTime - scheduleAhead) * 1000);
```

Config: `"intro": "l9_oneshot"` on the loop stem def. The intro stem ID is in `introStemIds` and skips the scheduler entirely.

---

### 4. Room intro (`roomIntro`)

A one-shot plays once on first room entry. All room stems are blocked from the scheduler until the intro finishes. A lookahead timer fires `createInstance` for every stem simultaneously at `loopStartTime`, and jumps gain from 0 → 1 on the audio clock (no ramp). Fires through a dedicated `src → g → mg` path, bypassing stem gain nodes.

Config:
```jsonc
"roomIntro": {
  "id": "l4_intro",      // stem ID of the one-shot (must be in stems array, no tailFade)
  "fadeIn": 0.05,        // gain ramp at intro start (keep short)
  "startDelay": 0,       // seconds after room entry before intro plays
  "gapAfter": 0,         // silence after intro ends, before loops start (optional)
  "loopAt": 20           // if set, overrides buf.duration + gapAfter — loops start exactly this many
                         // seconds after introStartTime, regardless of audio file length
}
```

**`loopAt` field**: added April 2026 for scene-5. When present, `loopStartTime = introStartTime + loopAt`. When absent, falls back to `introStartTime + buf.duration + gapAfter` (original behaviour, used by scene-11).

**Stem must be in the `stems` array** but has no `tailFade` (it's a one-shot). The engine auto-includes it in `roomIntroIds` and never adds it to `loadedStems` or the loop scheduler.

---

### 5. Drone-to-loop transition — full volume, beat 1, after fade

When leaving a drone-only room and entering a loop room, stems start at **full volume from bar 1** after the drone finishes fading. The delay is `audio.fadeOut` seconds (4s), matching the drone's gain ramp to silence.

- `fadeIn()` is NOT called for loop stems — gain jumps to 1 at `loopStartTime` on the audio clock
- `scheduleImmediately()` is NOT called — the lookahead timer fires `createInstance(id, loopStartTime)` for each stem
- `pendingIntroEnds` blocks the scheduler from creating instances during the delay window
- `droneExitTimers[room.id]` is cancelled on re-entry to prevent duplicate instances

```js
const loopStartTime = actx.currentTime + audio.fadeOut;
schedNext = loopStartTime + currentLoopDuration;
room.stems.forEach(id => pendingIntroEnds.set(id, loopStartTime));
// ... lookahead timer fires at loopStartTime - scheduleAhead:
gain[id].gain.setValueAtTime(1, loopStartTime);
createInstance(id, loopStartTime);
```

---

### 6. Drone → room-with-roomIntro priority rule

**Problem discovered April 2026**: scene-4 (drone) → scene-5 (roomIntro). Both `droneExitActive` and `roomIntroActive` were true simultaneously. The drone-exit timer fired at `audio.fadeOut` (~3s) and called `createInstance` directly, starting loops during the intro.

**Fix**: `willPlayRoomIntro` is computed before the drone-exit block. If a roomIntro is about to fire on first entry, the drone-exit block is skipped entirely. The roomIntro lookahead timer handles stem scheduling and gain for both cases.

```js
const willPlayRoomIntro = !!(room.roomIntro && !playedRoomIntros.has(room.id) && buf[room.roomIntro.id]);
if (prevWasDroneOnly && room.stems.length > 0 && !willPlayRoomIntro) {
  // drone-exit path
}
```

On second visit (roomIntro already played), `willPlayRoomIntro = false` so drone-exit runs normally. This is correct — second-visit stems should hard-hit after the drone, with no intro.

---

### 7. Late-loading stems during a roomIntro (race condition)

**Problem**: if a stem is still loading when `setRoom` is called, it goes into `pendingFades` instead of the silent roomIntroActive path. When it finishes loading, `loadStems` calls `scheduleImmediately` then `fadeIn`, starting the gain ramp immediately — ignoring `pendingIntroEnds` entirely. Stem becomes audible ~1s after load.

**Fix**: `loadStems` now checks `pendingIntroEnds` before both `scheduleImmediately` and `fadeIn`:

```js
// Skip scheduleImmediately if blocked by roomIntro
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

The lookahead timer's `room.stems.forEach` loop already handles late-arrived stems: it checks `activeStems.has(id)` before creating instances, so the stem is picked up correctly at the 20s mark.

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

The stem joins phase-locked with stems that were already playing. It starts at the correct position in the loop (not bar 1) — this is intentional sync behaviour.

---

## Config Fields That Matter

```jsonc
{
  "audio": {
    "defaultLoop": { "duration": 27.170 },   // used when room has no loop property
    "fadeIn": 3,                              // stem fade-in duration (seconds)
    "fadeOut": 4,                             // stem fade-out duration
    "masterFadeOut": 8,                       // outro master fade
    "scheduleAhead": 1.5,                     // lookahead window (seconds)
    "scheduleInterval": 200                   // scheduler poll rate (ms)
  },
  "stems": [
    {
      "id": "l3_drone",
      "file": "l3_Drone_1.mp3",
      "type": "drone",        // → self-scheduling, skips phase-locked scheduler
      "tailFade": 5           // seconds of crossfade at loop boundary
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
      "holdDuration": 28.8    // seconds before master fade + chapter navigation
    }
  ],
  "stingers": [
    { "id": "boom", "file": "Boom_Stinger.mp3", "gain": 0.9 }
  ]
}
```

---

## Still Needs First Listen

- **`l3_drone` and `l6_drone` tailFade = 5s** — actual reverb tail length unknown until heard. Increase if crossfade sounds abrupt.
- **Drone-to-loop transition** — implemented, not yet tested end-to-end with real tracks (scene 7→8). Scene 4→5 now uses a roomIntro instead of a bare drone-exit.
- **Room intro timing (scene-11)** — `startDelay: 4`, `gapAfter: 3.6`. These are estimates; tune in config after first listen.
- **Boom stinger `atScrollRatio: 0.15`** — verify the musical moment lands at the right scroll position in scene 4.
- **Loop crossfade** — if `[audio]` warnings appear in the browser console, the config `loop.duration` values don't match actual buffer lengths. Correct the config durations to match what the diagnostic reports.
- **Chapter button appearance** — check timing and aesthetics of the `#chapter-btn` reveal after scene-12 holdDuration.
