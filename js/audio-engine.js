// audio-engine.js — config-driven Web Audio engine
// Creates AudioContext, manages stems, runs lookahead scheduler

export function createAudioEngine(config) {
  const { audio, stems: stemDefs } = config;
  const stemMap = {};
  stemDefs.forEach(s => { stemMap[s.id] = s; });
  // Add stinger defs to stemMap so fetchStem can resolve their file paths
  (config.stingers || []).forEach(s => { stemMap[s.id] = s; });
  const stingerIds = new Set((config.stingers || []).map(s => s.id));
  // Drone stems loop continuously on their own source — they never enter the phase-locked scheduler
  const droneIds = new Set(stemDefs.filter(s => s.type === 'drone').map(s => s.id));
  // Room intro stems: play once on first room entry, not in loadedStems, not in scheduler
  const roomIntroIds = new Set(config.rooms.filter(r => r.roomIntro).map(r => r.roomIntro.id));
  const playedRoomIntros = new Set(); // room ids whose roomIntro has already fired
  const roomIntroTimers = {};         // roomId → setTimeout handle (cancelled on re-entry)
  const droneExitTimers = {};         // roomId → setTimeout handle for drone-to-loop transitions

  let actx = null, mg = null, analyser = null, analyserData = null, impactGain = null;
  let muted = false, ready = false, fadingOut = false;
  const activeStems = new Set();
  const buf = {};
  const gain = {};
  const activeSrc = [];
  const loadedStems = new Set();
  const loadingStems = new Set();
  const pendingFades = new Map();
  const stemLoadedCallbacks = [];
  const lastInstance = {}; // id → { source, instGain } — tracks the most recent BufferSource per stem for tail crossfade
  const introStemIds = new Set(); // stem IDs that serve as intro variants (referenced by another stem's .intro field)
  stemDefs.forEach(s => { if (s.intro) introStemIds.add(s.intro); });
  const playedIntros = new Set(); // loop stem IDs whose one-shot intro has already fired this page session
  const pendingIntroEnds = new Map(); // id → Web Audio timestamp when the intro finishes, so the scheduler waits for it
  const droneTimers = {}; // id → setTimeout handle for drone self-rescheduling

  const prefetchedBuffers = {}; // id → ArrayBuffer (raw, not decoded)

  let schedNext = 0;
  let schedTimer = null;
  let schedRunning = false;
  let currentRoomIndex = -1;
  let currentLoopDuration = audio.defaultLoop.duration;

  // ── Init ──
  async function init() {
    if (actx) return;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    mg = actx.createGain();
    mg.gain.value = audio.masterGain;
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyserData = new Uint8Array(analyser.frequencyBinCount);
    impactGain = actx.createGain();
    impactGain.gain.value = 1;
    const limiter = actx.createDynamicsCompressor();
    limiter.threshold.value = -2;  // start limiting 2 dB below 0 — transparent in normal use
    limiter.knee.value = 2;        // slight soft knee
    limiter.ratio.value = 20;      // 20:1 — effective brick wall
    limiter.attack.value = 0.001;  // 1 ms — catches transient peaks before they clip
    limiter.release.value = 0.15;  // 150 ms release
    mg.connect(analyser);
    analyser.connect(impactGain);
    impactGain.connect(limiter);
    limiter.connect(actx.destination);
  }

  // ── Stem loading ──
  async function fetchStem(id, retries) {
    const def = stemMap[id];
    if (!def) return null;
    try {
      const r = await fetch(audio.cdnBase + def.file, { mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await actx.decodeAudioData(await r.arrayBuffer());
    } catch (e) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 2000));
        return fetchStem(id, retries - 1);
      }
      console.warn('Stem failed after retries:', id, e);
      return null;
    }
  }

  async function loadStems(ids, onProgress) {
    // Auto-include intro variants alongside their loop partners
    const expanded = [...new Set(ids.flatMap(id => {
      const def = stemMap[id];
      return def && def.intro ? [id, def.intro] : [id];
    }))];
    const toLoad = expanded.filter(id => !loadedStems.has(id) && !loadingStems.has(id) && !buf[id]);
    toLoad.forEach(id => loadingStems.add(id));

    await Promise.all(toLoad.map(async id => {
      buf[id] = await fetchStem(id, 1);
      loadingStems.delete(id);
      if (buf[id]) {
        if (introStemIds.has(id) || stingerIds.has(id) || roomIntroIds.has(id)) {
          // One-shot stems (intros + stingers + room intros): buffer stored for playback, never enter the loop scheduler
          stemLoadedCallbacks.forEach(cb => cb(id));
        } else if (droneIds.has(id)) {
          // Drone: enters loadedStems so setRoom can call fadeIn, but loop scheduler ignores it
          loadedStems.add(id);
          if (!gain[id]) {
            const g = actx.createGain();
            g.gain.value = 0;
            g.connect(mg);
            gain[id] = g;
          }
          if (pendingFades.has(id)) {
            const roomIdx = pendingFades.get(id);
            pendingFades.delete(id);
            if (roomIdx === currentRoomIndex) {
              // setRoom added to activeStems directly (stem wasn't loaded yet) — undo so fadeIn can re-process
              activeStems.delete(id);
              fadeIn(id);
            }
          }
          stemLoadedCallbacks.forEach(cb => cb(id));
        } else {
          loadedStems.add(id);
          // Create gain node if not already wired
          if (!gain[id]) {
            const g = actx.createGain();
            g.gain.value = 0;
            g.connect(mg);
            gain[id] = g;
          }
          // Skip scheduleImmediately if a stem-level intro is mid-play, or if a roomIntro is blocking this stem
          if (!(playedIntros.has(id) && lastInstance[id]) && !pendingIntroEnds.has(id)) {
            scheduleImmediately(id);
          }
          // Check pending fades
          if (pendingFades.has(id)) {
            const roomIdx = pendingFades.get(id);
            pendingFades.delete(id);
            if (roomIdx === currentRoomIndex) {
              activeStems.delete(id);
              if (pendingIntroEnds.has(id)) {
                // roomIntro is still pending — stem arrived late; add silently, the lookahead timer handles it
                activeStems.add(id);
              } else {
                fadeIn(id);
              }
            }
          }
          stemLoadedCallbacks.forEach(cb => cb(id));
        }
      }
      if (onProgress) onProgress(id);
    }));
  }

  function unloadStems(ids) {
    ids.forEach(id => {
      // Cancel drone rescheduling and stop any running instance before evicting
      if (droneIds.has(id)) {
        if (droneTimers[id]) { clearTimeout(droneTimers[id]); delete droneTimers[id]; }
        if (lastInstance[id]) {
          try { lastInstance[id].source.stop(); } catch (e) {}
          try { lastInstance[id].instGain.disconnect(); } catch (e) {}
        }
      }
      if (gain[id]) {
        gain[id].disconnect();
        delete gain[id];
      }
      delete buf[id];
      loadedStems.delete(id);
      delete lastInstance[id];
      pendingIntroEnds.delete(id);
    });
  }

  // ── Scheduler ──
  // Each BufferSource gets its own instanceGain (source → instGain → gain[id] → master).
  // This lets us fade out the previous instance independently of the incoming one,
  // so reverb tails printed into the buffer decay cleanly instead of doubling with the new loop's attack.
  function createInstance(id, when, offset) {
    const src = actx.createBufferSource();
    src.buffer = buf[id];
    const instGain = actx.createGain();
    instGain.gain.value = 1;
    src.connect(instGain);
    instGain.connect(gain[id]);
    if (offset != null) {
      src.start(when, offset);
    } else {
      src.start(when);
    }
    activeSrc.push(src);

    // Fade out the previous instance of this stem — exponential decay matches natural reverb curve.
    const def = stemMap[id];
    const tailFade = def && def.tailFade != null ? def.tailFade : 3;
    const prev = lastInstance[id];
    if (prev) {
      const g = prev.instGain.gain;
      g.setValueAtTime(1, when);
      g.exponentialRampToValueAtTime(0.0001, when + tailFade);
      try { prev.source.stop(when + tailFade + 0.05); } catch (e) {}
    }

    const instance = { source: src, instGain };
    lastInstance[id] = instance;

    src.onended = () => {
      const i = activeSrc.indexOf(src);
      if (i > -1) activeSrc.splice(i, 1);
      try { instGain.disconnect(); } catch (e) {}
      if (lastInstance[id] === instance) lastInstance[id] = null;
    };
  }

  function scheduleImmediately(id) {
    if (!schedRunning || !buf[id] || !gain[id]) return;
    const loopStart = schedNext - currentLoopDuration;
    const loopOffset = Math.max(0, actx.currentTime - loopStart);
    createInstance(id, actx.currentTime + 0.05, loopOffset % currentLoopDuration);
  }

  function schedulerTick() {
    if (!schedRunning) return;
    while (schedNext < actx.currentTime + audio.scheduleAhead) {
      schedGeneration(schedNext);
      schedNext += currentLoopDuration;
    }
    schedTimer = setTimeout(schedulerTick, audio.scheduleInterval);
  }

  function schedGeneration(when) {
    loadedStems.forEach(id => {
      if (!buf[id] || !gain[id]) return;
      if (droneIds.has(id)) return; // drones manage their own looping source
      if (!activeStems.has(id)) return; // don't schedule inactive (exiting) stems
      // Skip this stem if its intro hasn't finished yet — the lookahead timer handles the first loop instance
      if (pendingIntroEnds.has(id) && when < pendingIntroEnds.get(id)) return;
      createInstance(id, when);
    });
  }

  function startScheduler() {
    if (schedRunning) return;
    schedRunning = true;
    schedNext = actx.currentTime + 0.1;
    schedulerTick();
  }

  function stopScheduler() {
    schedRunning = false;
    clearTimeout(schedTimer);
    schedTimer = null;
  }

  // ── Drone self-scheduling ──
  // Schedules the next drone instance to start (duration - tailFade) seconds after currentStartTime,
  // producing a crossfade at the loop boundary instead of a hard cut.
  // The crossfade duration is capped at half the file length so short files can still loop.
  function scheduleDroneNext(id, currentStartTime) {
    const def = stemMap[id];
    const tailFade = def && def.tailFade != null ? def.tailFade : 3;
    const duration = buf[id].duration;
    const crossfade = Math.min(tailFade, duration * 0.5);
    const nextStartTime = currentStartTime + duration - crossfade;
    const msUntilNext = Math.max(0, (nextStartTime - actx.currentTime) * 1000);
    droneTimers[id] = setTimeout(() => {
      delete droneTimers[id];
      if (!activeStems.has(id) || !buf[id] || !gain[id]) return;
      createInstance(id, nextStartTime);
      scheduleDroneNext(id, nextStartTime);
    }, msUntilNext);
  }

  // ── Stem activation ──
  function fadeIn(id, duration) {
    if (activeStems.has(id)) return;
    activeStems.add(id);

    if (droneIds.has(id)) {
      // Drone: play once then self-schedule with crossfade — same createInstance mechanism as loop stems,
      // but driven by a setTimeout chain rather than the phase-locked scheduler.
      // This avoids the MP3 encoder-delay gap that src.loop = true produces at the loop boundary.
      if (!buf[id] || !gain[id]) {
        pendingFades.set(id, currentRoomIndex);
        return;
      }
      if (droneTimers[id]) { clearTimeout(droneTimers[id]); delete droneTimers[id]; }
      const startTime = actx.currentTime + 0.05;
      createInstance(id, startTime);
      scheduleDroneNext(id, startTime);
    } else {
      // Loop stem: play intro variant once on first entry, routed through the loop stem's gain node.
      // The scheduler is blocked from creating loop instances until the intro finishes.
      // A lookahead timer fires just before introEndTime and schedules the first loop instance on the audio clock.
      const def = stemMap[id];
      if (def && def.intro && !playedIntros.has(id) && buf[def.intro]) {
        playedIntros.add(id);
        if (!gain[id]) {
          const g = actx.createGain();
          g.gain.value = 0;
          g.connect(mg);
          gain[id] = g;
        }
        const introStartTime = actx.currentTime + 0.05;
        const introEndTime = introStartTime + buf[def.intro].duration;
        const tailFade = def.tailFade != null ? def.tailFade : 3;
        // Start the loop tailFade seconds before the intro ends so the crossfade
        // mechanism bridges them — same behaviour as every loop-to-loop transition.
        const loopStartTime = introEndTime - tailFade;
        pendingIntroEnds.set(id, loopStartTime);

        const src = actx.createBufferSource();
        src.buffer = buf[def.intro];
        const instGain = actx.createGain();
        instGain.gain.value = 1;
        src.connect(instGain);
        instGain.connect(gain[id]);
        src.start(introStartTime);
        activeSrc.push(src);
        const introInst = { source: src, instGain };
        lastInstance[id] = introInst;
        src.onended = () => {
          const i = activeSrc.indexOf(src);
          if (i > -1) activeSrc.splice(i, 1);
          try { instGain.disconnect(); } catch (e) {}
          if (lastInstance[id] === introInst) lastInstance[id] = null;
        };

        // Fire a lookahead timer so the first loop instance is scheduled on the audio clock at introEndTime.
        // Mirrors the existing lookahead scheduler pattern: JS timer fires ~scheduleAhead seconds early,
        // then createInstance pins the exact start to the audio clock via BufferSource.start(introEndTime).
        const msUntilSchedule = Math.max(0, (loopStartTime - actx.currentTime - audio.scheduleAhead) * 1000);
        setTimeout(() => {
          if (!schedRunning || !buf[id] || !gain[id]) return;
          pendingIntroEnds.delete(id);
          createInstance(id, loopStartTime);
          // Re-anchor the global generation grid so the next scheduler tick falls one full loop after the
          // intro handoff, not at a stale boundary from before the intro started.
          schedNext = Math.max(schedNext, loopStartTime + currentLoopDuration);
        }, msUntilSchedule);
      }
    }

    const g = gain[id];
    if (!g) {
      // Not loaded yet — queue for later
      pendingFades.set(id, currentRoomIndex);
      return;
    }
    const dur = duration != null ? duration : audio.fadeIn;
    const now = actx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(1, now + dur);
  }

  function fadeOut(id, duration) {
    if (!activeStems.has(id)) return;
    activeStems.delete(id);
    const g = gain[id];
    if (!g) return;
    const dur = duration != null ? duration : audio.fadeOut;
    const now = actx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + dur);
    // Cancel drone's rescheduling timer — existing instances play out and end naturally
    if (droneIds.has(id) && droneTimers[id]) {
      clearTimeout(droneTimers[id]);
      delete droneTimers[id];
    }
  }

  function setRoom(idx) {
    if (idx === currentRoomIndex || idx < 0) return null;
    const prevRoom = config.rooms[currentRoomIndex];
    const room = config.rooms[idx];
    const target = new Set([...room.stems, ...(room.drones || [])]);
    const allStemIds = stemDefs.map(s => s.id);

    const entering = [];
    const exiting = [];
    const notReady = [];

    // Update loop duration if room has a custom loop
    if (room.loop) {
      currentLoopDuration = room.loop.duration;
    } else {
      currentLoopDuration = audio.defaultLoop.duration;
    }

    // Drone-to-loop transition: when leaving a drone-only room, loop stems start at full volume
    // from beat 1 after the drone finishes fading — no gain ramp, no scheduleImmediately.
    // pendingIntroEnds blocks the scheduler; a lookahead timer fires createInstance at loopStartTime.
    const prevWasDroneOnly = prevRoom && prevRoom.stems && prevRoom.stems.length === 0;
    // Don't run drone-exit if a roomIntro is about to fire — the roomIntro's lookahead timer
    // handles stem scheduling and gain, so the drone-exit timer would start loops too early.
    const willPlayRoomIntro = !!(room.roomIntro && !playedRoomIntros.has(room.id) && buf[room.roomIntro.id]);
    let droneExitActive = false;
    if (prevWasDroneOnly && room.stems && room.stems.length > 0 && !willPlayRoomIntro) {
      droneExitActive = true;
      const loopStartTime = actx.currentTime + audio.fadeOut;
      schedNext = loopStartTime + currentLoopDuration;

      room.stems.forEach(id => pendingIntroEnds.set(id, loopStartTime));

      if (droneExitTimers[room.id]) clearTimeout(droneExitTimers[room.id]);

      const msUntilSchedule = Math.max(0, (loopStartTime - actx.currentTime - audio.scheduleAhead) * 1000);
      droneExitTimers[room.id] = setTimeout(() => {
        delete droneExitTimers[room.id];
        if (!schedRunning) return;
        room.stems.forEach(id => {
          pendingIntroEnds.delete(id);
          if (!activeStems.has(id) || !buf[id] || !gain[id]) return;
          gain[id].gain.cancelScheduledValues(actx.currentTime);
          gain[id].gain.setValueAtTime(1, loopStartTime);
          createInstance(id, loopStartTime);
        });
        schedNext = Math.max(schedNext, loopStartTime + currentLoopDuration);
      }, msUntilSchedule);
    }

    // Room intro: play a one-shot once on first entry, block all room stems until intro + gap has passed.
    // The one-shot routes directly to mg (not through any stem's gain node) so it plays at full volume
    // regardless of the stems' fade state. stems are blocked via pendingIntroEnds and a lookahead timer
    // fires createInstance for each stem at exactly loopStartTime on the audio clock.
    let roomIntroActive = false;
    if (room.roomIntro && !playedRoomIntros.has(room.id) && buf[room.roomIntro.id]) {
      playedRoomIntros.add(room.id);
      roomIntroActive = true;

      const intro        = room.roomIntro;
      const introFadeIn  = intro.fadeIn    != null ? intro.fadeIn    : 0.05;
      const startDelay   = intro.startDelay != null ? intro.startDelay : 0;
      const gapAfter     = intro.gapAfter  != null ? intro.gapAfter  : 0;

      const introStartTime = actx.currentTime + 0.05 + startDelay;
      const loopStartTime  = intro.loopAt != null
        ? introStartTime + intro.loopAt
        : introStartTime + buf[intro.id].duration + gapAfter;

      // Play the one-shot through a dedicated source → g → mg path
      const src = actx.createBufferSource();
      src.buffer = buf[intro.id];
      const g = actx.createGain();
      g.gain.setValueAtTime(0, introStartTime);
      g.gain.linearRampToValueAtTime(1, introStartTime + introFadeIn);
      src.connect(g);
      g.connect(mg);
      src.start(introStartTime);
      activeSrc.push(src);
      src.onended = () => {
        const i = activeSrc.indexOf(src);
        if (i > -1) activeSrc.splice(i, 1);
        try { g.disconnect(); } catch (e) {}
      };

      // Block all room stems from the scheduler until loopStartTime
      room.stems.forEach(id => pendingIntroEnds.set(id, loopStartTime));

      // Push schedNext past the intro so the first generation falls one loop after the handoff
      schedNext = Math.max(schedNext, loopStartTime + currentLoopDuration);

      // Cancel any stale timer from a previous visit (user back-scrolled before it fired)
      if (roomIntroTimers[room.id]) clearTimeout(roomIntroTimers[room.id]);

      // Fire a lookahead timer to start all stems at the precise audio-clock moment
      const msUntilSchedule = Math.max(0, (loopStartTime - actx.currentTime - audio.scheduleAhead) * 1000);
      roomIntroTimers[room.id] = setTimeout(() => {
        delete roomIntroTimers[room.id];
        if (!schedRunning) return;
        room.stems.forEach(id => {
          pendingIntroEnds.delete(id);
          if (buf[id] && gain[id] && activeStems.has(id)) {
            gain[id].gain.cancelScheduledValues(actx.currentTime);
            gain[id].gain.setValueAtTime(1, loopStartTime);
            createInstance(id, loopStartTime);
          }
        });
        schedNext = Math.max(schedNext, loopStartTime + currentLoopDuration);
      }, msUntilSchedule);
    }

    // Fade in stems in target
    target.forEach(id => {
      if (!activeStems.has(id)) {
        entering.push(id);
        if (loadedStems.has(id)) {
          if ((droneExitActive || roomIntroActive) && !droneIds.has(id)) {
            // Drone exit / room intro: stem activates silently and waits for the lookahead timer.
            // No fadeIn ramp — gain jumps to 1 at loopStartTime on the audio clock.
            // No scheduleImmediately — the timer's createInstance handles source creation.
            activeStems.add(id);
            if (!gain[id]) {
              const g = actx.createGain();
              g.gain.value = 0;
              g.connect(mg);
              gain[id] = g;
            }
          } else {
            fadeIn(id);
            // For regular loop stems, ensure a source is live immediately.
            // fadeIn() only ramps the gain — it doesn't create a new source. The scheduler's
            // existing instance may have already ended (file shorter than prior loop interval),
            // so kick off a new one aligned to the current schedule grid.
            const def = stemMap[id];
            const hasUnplayedIntro = def && def.intro && !playedIntros.has(id);
            if (!droneIds.has(id) && !hasUnplayedIntro && !roomIntroActive) {
              scheduleImmediately(id);
            }
          }
        } else {
          // Mark as pending — will fade in when loaded
          activeStems.add(id);
          pendingFades.set(id, idx);
          notReady.push(id);
        }
      }
    });

    // Fade out stems not in target
    allStemIds.forEach(id => {
      if (!target.has(id) && activeStems.has(id)) {
        exiting.push(id);
        fadeOut(id);
      }
    });

    currentRoomIndex = idx;
    return { entering, exiting, notReady };
  }

  // ── Master volume ──
  function setMasterGain(v) {
    if (!mg) return;
    const now = actx.currentTime;
    mg.gain.cancelScheduledValues(now);
    mg.gain.setValueAtTime(mg.gain.value, now);
    mg.gain.linearRampToValueAtTime(parseFloat(v), now + 0.05);
    if (parseFloat(v) > 0 && muted) {
      muted = false;
    }
    return muted;
  }

  function toggleMute(sliderValue) {
    if (!actx) return muted;
    muted = !muted;
    const now = actx.currentTime;
    mg.gain.cancelScheduledValues(now);
    mg.gain.setValueAtTime(mg.gain.value, now);
    if (muted) {
      mg.gain.linearRampToValueAtTime(0, now + 0.5);
    } else {
      mg.gain.linearRampToValueAtTime(parseFloat(sliderValue), now + 0.5);
    }
    return muted;
  }

  function fadeOutMaster(duration) {
    if (!mg || !actx || fadingOut) return;
    fadingOut = true;
    const dur = duration != null ? duration : audio.masterFadeOut;
    const now = actx.currentTime;
    mg.gain.cancelScheduledValues(now);
    mg.gain.setValueAtTime(mg.gain.value, now);
    mg.gain.linearRampToValueAtTime(0, now + dur);
  }

  // ── Impact duck ──
  function setImpactDuck(active, params) {
    if (!impactGain || !actx) return;
    const now = actx.currentTime;
    impactGain.gain.cancelScheduledValues(now);
    impactGain.gain.setValueAtTime(impactGain.gain.value, now);
    if (active) {
      const duckTo = params ? params.duckTo : 0.4;
      const duckIn = params ? params.duckIn : 1.8;
      impactGain.gain.linearRampToValueAtTime(duckTo, now + duckIn);
    } else {
      const duckOut = params ? params.duckOut : 2.2;
      impactGain.gain.linearRampToValueAtTime(1, now + duckOut);
    }
  }

  // ── Stingers ──
  async function playStinger(stingerId) {
    const def = config.stingers.find(s => s.id === stingerId);
    if (!def) return;
    // Load on demand if not in buf
    if (!buf[stingerId]) {
      buf[stingerId] = await fetchStem(stingerId, 1);
    }
    if (!buf[stingerId]) return;
    const n = actx.createBufferSource();
    n.buffer = buf[stingerId];
    const g = actx.createGain();
    g.gain.value = def.gain != null ? def.gain : 1;
    n.connect(g);
    g.connect(mg);
    n.start();
  }

  // ── Prefetch / decode (background load before AudioContext) ──
  async function prefetchStems(ids, onProgress) {
    // Auto-include intro variants so they prefetch alongside their loop partners
    const expanded = [...new Set(ids.flatMap(id => {
      const def = stemMap[id];
      return def && def.intro ? [id, def.intro] : [id];
    }))];
    const toFetch = expanded.filter(id => !prefetchedBuffers[id] && !loadedStems.has(id) && !buf[id]);
    await Promise.all(toFetch.map(async id => {
      const def = stemMap[id];
      if (!def) return;
      try {
        const r = await fetch(audio.cdnBase + def.file, { mode: 'cors', credentials: 'omit' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        prefetchedBuffers[id] = await r.arrayBuffer();
      } catch (e) {
        console.warn('Prefetch failed:', id, e);
      }
      if (onProgress) onProgress(id);
    }));
  }

  async function decodePreFetched(ids) {
    // Auto-include intro variants alongside their loop partners
    const expanded = [...new Set(ids.flatMap(id => {
      const def = stemMap[id];
      return def && def.intro ? [id, def.intro] : [id];
    }))];
    // Decode in groups of 4 — decoding all at once freezes the UI thread on mobile
    const BATCH = 4;
    for (let i = 0; i < expanded.length; i += BATCH) {
      await Promise.all(expanded.slice(i, i + BATCH).map(async id => {
        if (!prefetchedBuffers[id] || loadedStems.has(id) || buf[id]) return;
        try {
          buf[id] = await actx.decodeAudioData(prefetchedBuffers[id]);
          delete prefetchedBuffers[id];
          if (buf[id]) {
            if (introStemIds.has(id) || stingerIds.has(id) || roomIntroIds.has(id)) {
              // One-shot stem: buffer ready for playback, not added to loop scheduler
              stemLoadedCallbacks.forEach(cb => cb(id));
              return;
            }
            // Warn if buffer duration differs from the configured loop duration by more than 100ms.
            // A mismatch causes the crossfade to fire at the wrong loop point — gaps or double-hits.
            if (!droneIds.has(id)) {
              const diff = Math.abs(buf[id].duration - audio.defaultLoop.duration);
              if (diff > 0.1) console.warn(`[audio] ${id}: buffer ${buf[id].duration.toFixed(3)}s vs defaultLoop ${audio.defaultLoop.duration}s (Δ${diff.toFixed(3)}s) — verify config loop.duration`);
            }
            if (droneIds.has(id)) {
              // Drone: enters loadedStems and gets a gain node, loop scheduler ignores it
              loadedStems.add(id);
              if (!gain[id]) {
                const g = actx.createGain();
                g.gain.value = 0;
                g.connect(mg);
                gain[id] = g;
              }
              stemLoadedCallbacks.forEach(cb => cb(id));
              return;
            }
            loadedStems.add(id);
            if (!gain[id]) {
              const g = actx.createGain();
              g.gain.value = 0;
              g.connect(mg);
              gain[id] = g;
            }
            scheduleImmediately(id);
            stemLoadedCallbacks.forEach(cb => cb(id));
          }
        } catch (e) {
          console.warn('Decode failed:', id, e);
        }
      }));
      // Yield to the UI thread between batches so the phone stays responsive
      if (i + BATCH < expanded.length) await new Promise(r => setTimeout(r, 0));
    }
  }

  // ── Event hooks ──
  function onStemLoaded(cb) {
    stemLoadedCallbacks.push(cb);
  }

  function resumeContext() {
    if (actx && actx.state === 'suspended') actx.resume();
  }

  function suspendContext() {
    if (actx && actx.state === 'running') actx.suspend();
  }

  return {
    init,
    loadStems,
    unloadStems,
    isReady: (id) => loadedStems.has(id),
    getLoadedStems: () => new Set(loadedStems),
    getLoadingStems: () => new Set(loadingStems),
    startScheduler,
    stopScheduler,
    setRoom,
    fadeIn,
    fadeOut,
    fadeOutMaster,
    setMasterGain,
    toggleMute,
    getAnalyser: () => analyser,
    getAnalyserData: () => analyserData,
    getContext: () => actx,
    playStinger,
    setImpactDuck,
    prefetchStems,
    decodePreFetched,
    onStemLoaded,
    resumeContext,
    suspendContext,
    get currentRoomIndex() { return currentRoomIndex; },
    get activeStems() { return new Set(activeStems); },
    get ready() { return ready; },
    set ready(v) { ready = v; },
    get muted() { return muted; },
    get fadingOut() { return fadingOut; },
    get schedRunning() { return schedRunning; },
  };
}
