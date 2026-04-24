# Core Behaviour Spec

This document describes exactly how the system is supposed to work. Before editing any of the five core JS files, read the relevant section. If a change would violate an invariant listed here, it needs explicit composer sign-off — it is not a refactor, it is a behaviour change.

---

## Signal Path

```
BufferSource → instGain → gain[id] → impactGain → limiter → destination
                                           ↑
                                        analyser (tapped here for visualiser)
```

- `gain[id]` — one per stem, controls room presence (fade in / fade out). This is the "is this stem audible" switch.
- `instGain` — one per BufferSource instance, controls reverb tail crossfade between loop iterations.
- `impactGain` — one shared node, ducks everything when near an impact element.
- `limiter` — brickwall DynamicsCompressor, transparent in normal use, prevents clipping from overlapping crossfades.

**Never bypass any node in this chain.** Do not connect BufferSources directly to `mg` or `destination`. Stingers connect `source → g → mg` (their own gain, into master) — this is intentional because stingers are one-shots that must not be ducked by impactGain.

---

## 1. Lookahead Scheduler (`audio-engine.js`)

### What it does
A `setTimeout` loop fires every `scheduleInterval` ms (200ms). Each tick advances `schedNext` until it is at least `scheduleAhead` seconds (1.5s) ahead of `actx.currentTime`. For each generation, `schedGeneration(when)` calls `createInstance(id, when)` on every loaded loop stem with the same `when` timestamp.

### Invariants — do not break
- All stems in a generation receive the **identical `when` value**. Phase coherence depends on this. Never stagger `when` per stem.
- `schedNext` advances by exactly `currentLoopDuration` each generation. Never add jitter or fractional adjustments.
- Drones are excluded from `schedGeneration` — they have `if (droneIds.has(id)) return` explicitly. Do not remove this guard.
- Stems with a pending intro are excluded — `if (pendingIntroEnds.has(id) && when < pendingIntroEnds.get(id)) return`. Do not remove this guard or the scheduler will create loop instances that overlap the intro.

### scheduleImmediately
Called when a stem joins a room mid-loop (either because it just loaded, or because `setRoom` needs it live now). It calculates the current loop offset from `schedNext - currentLoopDuration` so the new stem starts in phase with what's already playing.

```js
const loopStart = schedNext - currentLoopDuration;
const loopOffset = Math.max(0, actx.currentTime - loopStart);
createInstance(id, actx.currentTime + 0.05, loopOffset % currentLoopDuration);
```

**Do not simplify this to `createInstance(id, actx.currentTime + 0.05)` with no offset.** That starts the stem from bar 1 mid-phrase, which is audibly wrong.

---

## 2. Per-Instance Gain and Tail Crossfade (`audio-engine.js → createInstance`)

### What it does
Every `BufferSource` gets its own `instGain` node. When the next loop instance starts (`when`), the previous instance's `instGain` is faded out with an exponential ramp over `tailFade` seconds. The new source starts at `when`. The two sources overlap during the crossfade — this is intentional, it lets the reverb tail of the old loop decay naturally under the attack of the new one.

### Rules — never change these

1. **Always use `exponentialRampToValueAtTime`, never `linearRampToValueAtTime` for instGain crossfades.**
   Linear sounds like a splice on a reverberant tail. Exponential matches the physics of room decay.

2. **Target `0.0001`, never `0`.** The Web Audio API rejects `0` as the endpoint of an exponential ramp and throws a `RangeError`. `0.0001` is inaudible.

3. **Stop the old source at `when + tailFade + 0.05`**, not at `when`. Stopping it at `when` cuts the tail immediately. The `+ 0.05` safety margin prevents an edge case where the stop fires fractionally before the ramp completes.

4. **`tailFade` is read from `stemMap[id].tailFade`, defaulting to `3`** if not set. Do not hardcode a global crossfade value. Different stems have different reverb tails.

5. **`lastInstance[id]` must be updated to the new instance before `onended` fires.** The `onended` handler checks `if (lastInstance[id] === instance)` before nulling — this prevents a late-arriving `onended` from a previous instance from clobbering a newer one.

---

## 3. Drone Self-Scheduler (`audio-engine.js → scheduleDroneNext`)

### What it does
Drones loop independently. When a drone starts (`fadeIn`), it calls `createInstance` then `scheduleDroneNext`. That function calculates when the next instance should start (`currentStartTime + duration - crossfade`), sets a `setTimeout`, and on firing, calls `createInstance` again and recurses.

Drones use `buf[id].duration` (the decoded buffer's actual length) — not `config.audio.defaultLoop.duration` or the room's loop duration. Their loop length is the file length.

### Invariants

- **Drones never enter `schedGeneration`.** The `if (droneIds.has(id)) return` guard in `schedGeneration` must stay.
- **`droneTimers[id]` must be cleared before starting a new chain** (`fadeIn` does `clearTimeout` before `createInstance`). Without this, two chains run in parallel and the stem doubles.
- **On `fadeOut`, the drone timer is cancelled** — existing instances play out and the `instGain` crossfade handles the tail. The source is not force-stopped.
- **On `unloadStems`, both the timer and any live instance are stopped** and `lastInstance[id]` is cleared. Skipping either leaks audio.

---

## 4. Intro / Loop Pairs (`audio-engine.js → fadeIn`)

### What it does
A stem with `"intro": "<id>"` plays the intro as a one-shot on first entry, routed through the loop stem's own `gain[id]`. The scheduler is blocked from scheduling loop instances while the intro is playing (`pendingIntroEnds` map). A `setTimeout` fires `scheduleAhead` seconds before the intro ends and calls `createInstance` for the loop stem at the exact audio-clock moment of handoff (`loopStartTime = introEndTime - tailFade`). The scheduler's `schedNext` is re-anchored so subsequent generations are one loop after that handoff.

---

## 4b. Room Intro (`audio-engine.js → setRoom`)

### What it does
A room can have a `"roomIntro"` object. On first entry, a one-shot plays **once**, routed directly to `mg` (not through any stem's gain node), then all room stems start together after `introEndTime + gapAfter`. The one-shot never plays again on re-entry.

Config fields:
```jsonc
"roomIntro": {
  "id": "l9_oneshot",   // stem ID — must be in stems array, loaded as buffer-only (never enters scheduler)
  "fadeIn": 0.05,        // seconds to ramp from 0 to 1 on the one-shot (0.05 = essentially instant)
  "startDelay": 4,       // seconds after room entry before the one-shot starts (lets prior room fade out)
  "gapAfter": 3.6        // seconds of silence between one-shot end and first loop instance (1 bar at 50 BPM 3/4)
}
```

### Invariants

- **Room intro IDs (`roomIntroIds`) are treated like `introStemIds`**: buffer loaded, never added to `loadedStems`, never entered into the scheduler.
- **The one-shot routes `source → g → mg` directly**, bypassing `impactGain`. This is intentional — room intros should play at full volume regardless of impact ducking state.
- **`pendingIntroEnds` is set for all room stems** before any `fadeIn` or `scheduleImmediately` call. The scheduler respects this and skips those stems until `loopStartTime`.
- **`scheduleImmediately` is skipped for all room stems** while `roomIntroActive` is true (first entry only). On re-entry, `roomIntroActive` is false and stems join the scheduler normally.
- **`roomIntroTimers[room.id]`** stores the lookahead timer handle. It is cancelled on re-entry to prevent a stale timer from creating duplicate sources.
- **`playedRoomIntros`** is a session-persistent Set. Once a room's intro fires, it never fires again — even if the user back-scrolls and re-enters.
- **Do not share a `roomIntro` ID with a per-stem `"intro"` field.** A stem ID can only be in one of `introStemIds` or `roomIntroIds`.

---

### Invariants (per-stem intro — original section 4)

- **`pendingIntroEnds.set(id, loopStartTime)` must be set before the lookahead timer fires.** The scheduler reads this map on every tick. If it is not set, the scheduler creates loop instances during the intro.
- **The lookahead timer uses `loopStartTime` (= `introEndTime - tailFade`), not `introEndTime`.** The loop instance starts `tailFade` seconds before the intro finishes so `createInstance` can fade out the intro's `instGain` while the loop is already playing — the same crossfade mechanism used at every loop boundary.
- **`pendingIntroEnds.delete(id)` happens inside the lookahead timer**, not in `onended`. By the time `onended` fires, the loop is already running.
- **`playedIntros` is session-persistent.** Once the intro fires for a stem, it does not fire again if the user back-scrolls and re-enters that room.
- **Intro stem IDs are in `introStemIds`.** They are never added to `loadedStems` or scheduled by `schedGeneration`. They exist only in `buf[id]` for one-shot playback.

---

## 5. setRoom (`audio-engine.js`)

### What it does
Computes the entering and exiting stem sets, calls `fadeIn` on entering stems and `fadeOut` on exiting ones, and updates `currentRoomIndex`. Also calls `scheduleImmediately` for entering loop stems so a live source exists immediately rather than waiting for the next scheduler tick.

### Invariants

- **`fadeIn` + `scheduleImmediately` are both called for entering loop stems** — unless the stem is entering via a drone exit or room intro, in which case both are suppressed and the lookahead timer handles source creation.
- **`scheduleImmediately` is skipped for stems with an unplayed intro** (`hasUnplayedIntro`), a room intro active (`roomIntroActive`), or a drone exit active (`droneExitActive`).
- **Drones are skipped in `scheduleImmediately`** — their source is created inside `fadeIn` for drones.
- **Drone-only → loop room: see section 5b.** The old simple `schedNext` re-anchor has been replaced with the full drone-exit mechanism.
- **`currentLoopDuration` is updated before any stem scheduling** in `setRoom`. Room-specific `loop.duration` takes precedence over `audio.defaultLoop.duration`.
- **Pending stems** (not yet loaded when `setRoom` is called) are added to `activeStems` and `pendingFades`. When they finish loading, `loadStems` calls `activeStems.delete(id)` then `fadeIn(id)` — this undo is needed because `fadeIn` has an early-return guard on `activeStems.has(id)`.

---

## 6. Fade In / Fade Out (`audio-engine.js`)

- **`fadeIn` and `fadeOut` operate on `gain[id]`** — the stem's shared GainNode. They use `linearRampToValueAtTime`. This is correct for musical fades where a linear ramp on the gain parameter sounds natural. (The exponential ramp is used only for `instGain` tail crossfades — a different purpose.)
- **Both functions cancel any in-progress ramp** with `cancelScheduledValues` then `setValueAtTime` before scheduling a new ramp. Without this, a new ramp starts from the scheduled endpoint of the previous one rather than the current value, causing jumps.
- **`activeStems` is the authority on whether a stem is "on".** `fadeIn` adds the id; `fadeOut` removes it. Guards check `activeStems.has(id)` before doing anything. Do not call `gain[id].gain.linearRampToValueAtTime` directly without going through `fadeIn`/`fadeOut` — you will desync `activeStems`.

---

## 7. Pace Lock (`scroll-controller.js`)

### What it does
On room entry, `startLock(idx)` records the room's `paceLock` duration, clamps `window.scrollY` to `lockBot` (bottom of the room), starts an `enforceLoop` rAF, and sets a `setTimeout`. When the timeout fires, `locked` is set to false and the unlock indicator appears.

### Invariants

- **`enforceLoop` runs as a `requestAnimationFrame` loop, not on the scroll event.** The scroll event is passive; it cannot call `preventDefault`. The rAF loop continuously corrects position before the frame paints, preventing scroll from visually advancing past `lockBot`.
- **Back-scroll cancels the lock** (`cancelLock`). A user can always scroll backward freely. Only forward scroll is blocked.
- **Auto-scroll bypasses the lock** (it calls `cancelLock` before starting). Auto-scroll is the intended way to move forward during a lock if the user triggers it.
- **`unlk` tracks which rooms have been visited.** A room's lock is only applied on first visit; subsequent passes do not re-lock.

---

---

## 5b. Drone-to-Loop Transition (`audio-engine.js → setRoom`)

### What it does
When leaving a drone-only room (`stems: []`) and entering a loop room, stems start at **full volume from beat 1** after the drone has fully faded out. No gain ramp, no `fadeIn` call. A `droneExitTimers` handle prevents stale timers from a prior visit.

Delay = `audio.fadeOut` (same duration as the drone's `fadeOut` ramp). The loop starts the instant the drone reaches silence.

### Invariants

- **Do not call `fadeIn` for loop stems entering from a drone room.** `fadeIn` would ramp `gain[id]` 0→1 over 3 seconds, producing an audible swell when the intent is a full-volume hit.
- **Do not call `scheduleImmediately` during a drone exit** (`droneExitActive` flag). The lookahead timer calls `createInstance(id, loopStartTime)` and sets `gain[id]` to 1 at `loopStartTime` on the audio clock.
- **`activeStems.add(id)` is called directly** (bypassing `fadeIn`) so `activeStems` stays in sync. If the user back-scrolls, `fadeOut` sees the stem as active and handles cleanup correctly.
- **`droneExitTimers[room.id]`** is cancelled on re-entry to prevent a stale timer from creating duplicate sources.
- **Drones in the drone room fade out via the normal `fadeOut` path** — no special handling needed on the exit side.

---

## 8. Outro Gate (`scroll-controller.js`)

### What it does
When the outro room's top edge crosses 50% of the viewport, `outroHit` is set permanently (never unset). The page scrolls to the outro room top, `outroLock` is set, and a `holdDuration` timer begins. On expiry, the master fades out, the visualiser stops, and a chapter button is revealed. The user clicks to navigate — there is no auto-navigation.

### Invariants

- **`outroLock` constrains scroll to within the outro room** — not to a single fixed position. The handler enforces `minScroll = oe.offsetTop` and `maxScroll = getLockBot(outroIdx)`. The user can read all content within the room but cannot exit it.
- **`outroHit` is a one-way latch** — once true, it stays true. The outro sequence cannot be retriggered by back-scrolling.
- **`holdDuration` comes from `outroRoom.holdDuration`**, falling back to `config.audio.defaultLoop.duration`. It should be set to a bar-aligned value in config.
- **After `holdDuration`, a chapter button is revealed — there is no auto-navigation.** `engine.fadeOutMaster()` and `ui.stopVisualiser()` run, then `#chapter-btn` becomes visible. The user clicks to navigate.
- **`navigateToNextChapter` is called only from the button click handler.** It saves volume to `sessionStorage` before navigating so the next chapter can restore it.

---

## 9. Stem Loader Sliding Window (`stem-loader.js`)

### What it does
`prepareForRoom(idx)` loads: current room stems (highest priority, awaited), next room stems, previous room stems, and any credits-transition stems if near the outro. Stems from rooms 3 or more behind are evicted.

### Invariants

- **Only `getUniqueStemsForRoom` stems are evicted** — stems shared with an adjacent room are not touched. Evicting a shared stem would silence a currently-playing room.
- **Eviction threshold is `idx >= 3` → evict rooms `0` to `idx - 3`.** This keeps a 3-room buffer (prev, current, next). Tightening to 2 rooms risks evicting the previous room before a back-scroll can reload it.
- **Current room stems are awaited before the rest.** Next/prev loads are fire-and-forget so they don't block room entry.
- **Stinger files are included in `getStemsForRoom`** via `rooms[idx].stingers.map(s => s.id)`. They load alongside room stems so `playStinger` never has to cold-fetch in real time.

---

## 10. Boot Sequence (`main.js`)

Two phases, separated by the user gesture (intro button click):

**Phase 1 — before gesture (no AudioContext)**
- Fetch config
- `prefetchStems` — downloads raw `ArrayBuffer` for room 0 and room 1 stems
- Reveal intro modal

**Phase 2 — after gesture**
- `engine.init()` — creates `AudioContext` and audio graph
- Restore volume from `sessionStorage` if present
- `decodePreFetched` — decodes buffered `ArrayBuffer`s (batched 4 at a time to avoid UI freeze)
- `engine.setRoom(0)` — activates room 0 stems
- `engine.startScheduler()` — begins the phase-locked scheduling loop
- `scroll.startLock(0)` — applies first room's pace lock
- `scroll.start()` — attaches scroll event listener

### Invariants

- **`engine.setRoom(0)` must be called before `engine.startScheduler()`.** `setRoom` populates `activeStems`; the scheduler uses that set. If called in the wrong order, the scheduler fires a generation with no active stems.
- **`engine.ready = true` gates the scroll handler.** `onScroll` returns immediately if `!engine.ready`. Do not set `ready` before decode is complete.
- **The fetch bar and loading bar are separate UI elements.** The fetch bar shows Phase 1 progress (network). The loading bar shows Phase 2 progress (decode). Do not merge them.

---

## What Is Safe to Change Without This Spec

- Visual styles (`ui.js`, `style.css`)
- Config values (`config.json`) — durations, stem file names, paceLock values, room definitions
- Console log messages and error strings
- The `AS_SPEED` constant in `scroll-controller.js`
- `masterGain`, `fadeIn`, `fadeOut` default values in config
- Adding new stems or rooms to config

## What Requires Careful Review Against This Spec

- Any change to `createInstance`
- Any change to `schedulerTick`, `schedGeneration`, `scheduleImmediately`
- Any change to `fadeIn` / `fadeOut`
- Any change to `setRoom`
- Any change to `scheduleDroneNext`
- The order of operations in `main.js boot()`
- Eviction logic in `stem-loader.js`
