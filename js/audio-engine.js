// audio-engine.js — config-driven Web Audio engine
// Creates AudioContext, manages stems, runs lookahead scheduler

export function createAudioEngine(config) {
  const { audio, stems: stemDefs } = config;
  const stemMap = {};
  stemDefs.forEach(s => { stemMap[s.id] = s; });

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
    const toLoad = ids.filter(id => !loadedStems.has(id) && !loadingStems.has(id));
    toLoad.forEach(id => loadingStems.add(id));

    await Promise.all(toLoad.map(async id => {
      buf[id] = await fetchStem(id, 1);
      loadingStems.delete(id);
      if (buf[id]) {
        loadedStems.add(id);
        // Create gain node if not already wired
        if (!gain[id]) {
          const g = actx.createGain();
          g.gain.value = 0;
          g.connect(mg);
          gain[id] = g;
        }
        scheduleImmediately(id);
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
      if (onProgress) onProgress(id);
    }));
  }

  function unloadStems(ids) {
    ids.forEach(id => {
      if (gain[id]) {
        gain[id].disconnect();
        delete gain[id];
      }
      delete buf[id];
      loadedStems.delete(id);
    });
  }

  // ── Scheduler ──
  function scheduleImmediately(id) {
    if (!schedRunning || !buf[id] || !gain[id]) return;
    const loopStart = schedNext - currentLoopDuration;
    const loopOffset = Math.max(0, actx.currentTime - loopStart);
    const n = actx.createBufferSource();
    n.buffer = buf[id];
    n.connect(gain[id]);
    n.start(actx.currentTime + 0.05, loopOffset % currentLoopDuration);
    activeSrc.push(n);
    n.onended = () => { const i = activeSrc.indexOf(n); if (i > -1) activeSrc.splice(i, 1); };
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
      const n = actx.createBufferSource();
      n.buffer = buf[id];
      n.connect(gain[id]);
      n.start(when);
      activeSrc.push(n);
      n.onended = () => { const i = activeSrc.indexOf(n); if (i > -1) activeSrc.splice(i, 1); };
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
  }

  function setRoom(idx) {
    if (idx === currentRoomIndex || idx < 0) return null;
    const room = config.rooms[idx];
    const target = new Set(room.stems);
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
    const toFetch = ids.filter(id => !prefetchedBuffers[id] && !loadedStems.has(id));
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
    await Promise.all(ids.map(async id => {
      if (!prefetchedBuffers[id] || loadedStems.has(id)) return;
      try {
        buf[id] = await actx.decodeAudioData(prefetchedBuffers[id]);
        delete prefetchedBuffers[id];
        if (buf[id]) {
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
