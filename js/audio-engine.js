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
    mg.connect(analyser);
    analyser.connect(impactGain);
    impactGain.connect(actx.destination);
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
        if (introStemIds.has(id) || stingerIds.has(id)) {
          // One-shot stems (intros + stingers): buffer stored for playback, never enter the loop scheduler
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
            if (roomIdx === currentRoomIndex) fadeIn(id);
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
          // Skip scheduleImmediately if an intro is currently mid-play — scheduler picks it up at schedNext
          if (!(playedIntros.has(id) && lastInstance[id])) {
            scheduleImmediately(id);
          }
          // Check pending fades
          if (pendingFades.has(id)) {
            const roomIdx = pendingFades.get(id);
            pendingFades.delete(id);
            if (roomIdx === currentRoomIndex) {
              fadeIn(id);
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
      // Force-stop drone sources before evicting — they loop indefinitely otherwise
      if (droneIds.has(id) && lastInstance[id]) {
        try { lastInstance[id].source.stop(); } catch (e) {}
        try { lastInstance[id].instGain.disconnect(); } catch (e) {}
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

  // ── Stem activation ──
  function fadeIn(id, duration) {
    if (activeStems.has(id)) return;
    activeStems.add(id);

    if (droneIds.has(id)) {
      // Drone: start a continuously looping source — no scheduler involvement
      if (!buf[id] || !gain[id]) {
        pendingFades.set(id, currentRoomIndex);
        return;
      }
      const prev = lastInstance[id];
      if (prev) {
        try { prev.source.stop(); } catch (e) {}
        try { prev.instGain.disconnect(); } catch (e) {}
        lastInstance[id] = null;
      }
      const src = actx.createBufferSource();
      src.buffer = buf[id];
      src.loop = true;
      const instGain = actx.createGain();
      instGain.gain.value = 1;
      src.connect(instGain);
      instGain.connect(gain[id]);
      src.start(actx.currentTime + 0.05);
      activeSrc.push(src);
      const instance = { source: src, instGain };
      lastInstance[id] = instance;
      src.onended = () => {
        const i = activeSrc.indexOf(src);
        if (i > -1) activeSrc.splice(i, 1);
        try { instGain.disconnect(); } catch (e) {}
        if (lastInstance[id] === instance) lastInstance[id] = null;
      };
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
    // Stop drone's looping source after it fades — it loops indefinitely otherwise
    if (droneIds.has(id)) {
      const inst = lastInstance[id];
      if (inst) {
        setTimeout(() => {
          try { inst.source.stop(); } catch (e) {}
        }, (dur + 0.1) * 1000);
      }
    }
  }

  function setRoom(idx) {
    if (idx === currentRoomIndex || idx < 0) return null;
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

    // Fade in stems in target
    target.forEach(id => {
      if (!activeStems.has(id)) {
        entering.push(id);
        if (loadedStems.has(id)) {
          fadeIn(id);
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
    await Promise.all(expanded.map(async id => {
      if (!prefetchedBuffers[id] || loadedStems.has(id) || buf[id]) return;
      try {
        buf[id] = await actx.decodeAudioData(prefetchedBuffers[id]);
        delete prefetchedBuffers[id];
        if (buf[id]) {
          if (introStemIds.has(id) || stingerIds.has(id)) {
            // One-shot stem: buffer ready for playback, not added to loop scheduler
            stemLoadedCallbacks.forEach(cb => cb(id));
            return;
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
  }

  // ── Event hooks ──
  function onStemLoaded(cb) {
    stemLoadedCallbacks.push(cb);
  }

  function resumeContext() {
    if (actx && actx.state === 'suspended') actx.resume();
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
    get currentRoomIndex() { return currentRoomIndex; },
    get activeStems() { return new Set(activeStems); },
    get ready() { return ready; },
    set ready(v) { ready = v; },
    get muted() { return muted; },
    get fadingOut() { return fadingOut; },
    get schedRunning() { return schedRunning; },
  };
}
