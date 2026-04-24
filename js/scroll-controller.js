// scroll-controller.js — room detection, pace lock, outro gate, auto-scroll, impact weight

export function createScrollController(config, engine, loader, ui) {
  const rooms = config.rooms;
  const impacts = config.impacts || [];
  const firedStingers = new Set();

  // ── Pace lock ──
  const pl = document.getElementById('pace-lock');
  const pw = document.getElementById('pace-warning');
  let locked = false, lockBot = 0, lt = null, wt = null, enfRaf = null;
  const unlk = new Set();

  function getLockBot(idx) {
    const el = document.getElementById(rooms[idx].id);
    return el ? el.offsetTop + el.offsetHeight - window.innerHeight : 0;
  }

  function enforceLoop() {
    if (!locked) return;
    if (window.scrollY > lockBot) {
      window.scrollTo({ top: lockBot, behavior: 'instant' });
    }
    enfRaf = requestAnimationFrame(enforceLoop);
  }

  window.addEventListener('resize', () => { if (locked) lockBot = getLockBot(engine.currentRoomIndex); });

  function startLock(idx) {
    unlk.add(idx);
    const room = rooms[idx];
    const lockDuration = (room.paceLock != null ? room.paceLock : 10) * 1000;
    locked = true;
    lockBot = getLockBot(idx);
    if (window.scrollY > lockBot) window.scrollTo({ top: lockBot, behavior: 'instant' });
    cancelAnimationFrame(enfRaf);
    enfRaf = requestAnimationFrame(enforceLoop);
    pl.classList.remove('show');
    clearTimeout(lt);
    lt = setTimeout(() => {
      locked = false;
      cancelAnimationFrame(enfRaf);
      pl.classList.add('show');
      if (!outroHit) ui.showArrow();
      setTimeout(() => pl.classList.remove('show'), 4000);
    }, lockDuration);
  }

  function cancelLock() {
    locked = false;
    cancelAnimationFrame(enfRaf);
    clearTimeout(lt);
    lt = null;
    pl.classList.remove('show');
  }

  function warn() {
    pw.classList.add('show');
    clearTimeout(wt);
    wt = setTimeout(() => pw.classList.remove('show'), 1200);
  }

  // ── Outro gate ──
  let outroHit = false, creditsDone = false, outroLock = false;

  // ── IntersectionObserver for in-view reveals ──
  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in-view'); revealObs.unobserve(e.target); } });
  }, { threshold: 0, rootMargin: '0px 0px -15% 0px' });
  document.querySelectorAll('.scene,.impact').forEach(el => revealObs.observe(el));

  // ── Stinger firing ──
  function checkStingers(roomIdx) {
    if (roomIdx < 0 || roomIdx >= rooms.length) return;
    const room = rooms[roomIdx];
    if (!room.stingers || !room.stingers.length) return;
    const el = document.getElementById(room.id);
    if (!el) return;
    const sectionTop = el.offsetTop;
    const sectionHeight = el.offsetHeight;
    room.stingers.forEach(s => {
      if (firedStingers.has(s.id)) return;
      const triggerY = sectionTop + sectionHeight * s.atScrollRatio;
      if (window.scrollY + window.innerHeight * 0.5 >= triggerY) {
        firedStingers.add(s.id);
        engine.playStinger(s.id);
      }
    });
  }

  // ── Impact weight ──
  let impactThinned = false;
  const impactIds = impacts.map(imp => imp.id);

  function checkImpactWeight() {
    if (outroHit) return;
    const vc = window.innerHeight * 0.5;
    let nearImpact = false;
    let nearParams = null;
    impactIds.forEach((id, i) => {
      const el = document.getElementById(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const elCenter = r.top + r.height * 0.5;
      if (Math.abs(elCenter - vc) < window.innerHeight * 0.28) {
        nearImpact = true;
        nearParams = impacts[i];
      }
    });
    if (nearImpact === impactThinned) return;
    impactThinned = nearImpact;
    if (nearImpact && nearParams) {
      engine.setImpactDuck(true, nearParams);
    } else {
      engine.setImpactDuck(false);
    }
  }

  // ── Progress bar ──
  const pb = document.getElementById('progress-bar');

  // ── Main scroll handler ──
  function onScroll() {
    const sy = window.scrollY;
    const dh = document.documentElement.scrollHeight - window.innerHeight;
    pb.style.width = (sy / dh * 100) + '%';

    if (!engine.ready) return;

    // Determine active room index
    let idx = -1;
    rooms.forEach(({ id }, i) => {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top < window.innerHeight * 0.5) idx = i;
    });

    const ai = engine.currentRoomIndex;
    const goingForward = idx > ai;

    if (goingForward) {
      const lastScene = rooms.length - 2;
      let firstUnvisited = -1;
      for (let i = ai + 1; i <= Math.min(idx, lastScene); i++) {
        if (!unlk.has(i) && !asOn && !outroHit) { firstUnvisited = i; break; }
      }
      if (firstUnvisited !== -1) {
        const result = engine.setRoom(firstUnvisited);
        if (result) ui.updateStemIndicators(engine);
        startLock(firstUnvisited);
        loader.prepareForRoom(firstUnvisited);
        checkImpactWeight();
        return;
      }
      const result = engine.setRoom(idx);
      if (result) ui.updateStemIndicators(engine);
      loader.prepareForRoom(idx);
    } else {
      if (idx >= 0 && idx < ai) cancelLock();
      const result = engine.setRoom(idx);
      if (result) ui.updateStemIndicators(engine);
      if (idx >= 0) loader.prepareForRoom(idx);
    }

    // Outro gate
    const outroRoom = rooms.find(r => r.isOutro);
    if (outroRoom) {
      const oe = document.getElementById(outroRoom.id);
      if (oe && !outroHit && oe.getBoundingClientRect().top < window.innerHeight * 0.5) {
        outroHit = true;
        outroLock = true;
        cancelLock();

        window.scrollTo({ top: oe.offsetTop, behavior: 'smooth' });
        document.querySelector('.outro-title').classList.add('revealed');
        document.querySelector('.outro-sub').classList.add('revealed');
        document.getElementById(outroRoom.id).classList.add('outro-in-view');

        const holdMs = (outroRoom.holdDuration || config.audio.defaultLoop.duration) * 1000;
        const ct = outroRoom.creditsTransition;

        setTimeout(() => {
          if (creditsDone) return;
          creditsDone = true;
          outroLock = false;

          if (ct) {
            (ct.stemsOff || []).forEach(id => engine.fadeOut(id));
            (ct.stemsOn || []).forEach(id => engine.fadeIn(id));
            ui.updateStemIndicators(engine);

            pl.classList.add('show');
            setTimeout(() => {
              pl.classList.remove('show');
              const c = document.getElementById('credits');
              c.classList.add('revealed');
              c.scrollIntoView({ behavior: 'smooth', block: 'start' });
              const fadeDelay = (ct.finalFadeAfterLoops || 3) * config.audio.defaultLoop.duration * 1000;
              setTimeout(() => {
                engine.fadeOutMaster();
                setTimeout(() => {
                  ui.stopVisualiser();
                  navigateToNextChapter(config);
                }, config.audio.masterFadeOut * 1000);
              }, fadeDelay);
            }, 2000);
          } else if (config.composition && config.composition.nextChapter) {
            // No credits — fade out audio and reveal the chapter button. User navigates manually.
            engine.fadeOutMaster();
            ui.stopVisualiser();
            const btn = document.getElementById('chapter-btn');
            if (btn) {
              btn.href = config.composition.nextChapter;
              btn.classList.remove('hidden');
              btn.classList.add('revealed');
            }
          }
        }, holdMs);
      }
    }

    if (idx >= 0) checkStingers(idx);
    checkImpactWeight();
  }

  // ── Chapter handoff ──
  function navigateToNextChapter(cfg) {
    if (!cfg.composition || !cfg.composition.nextChapter) return;
    sessionStorage.setItem('aw_volume', document.getElementById('vol').value);
    window.location.href = cfg.composition.nextChapter;
  }

  // ── Auto scroll ──
  let asOn = false, asRaf = null, asLast = 0;
  const AS_SPEED = 40; // px per second

  function toggleAS() {
    const b = document.getElementById('as-btn');
    if (asOn) {
      asOn = false;
      cancelAnimationFrame(asRaf);
      b.textContent = 'Auto Scroll'; b.classList.remove('on'); b.setAttribute('aria-pressed', 'false');
    } else {
      asOn = true;
      cancelLock();
      b.textContent = 'Stop'; b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
      asLast = performance.now();
      asRaf = requestAnimationFrame(asStep);
    }
  }

  function asStep(now) {
    if (!asOn) return;
    if (outroHit) { cancelAS(); return; }
    const dt = (now - asLast) / 1000;
    asLast = now;
    window.scrollBy({ top: AS_SPEED * dt, behavior: 'instant' });
    onScroll();
    asRaf = requestAnimationFrame(asStep);
  }

  function cancelAS(e) {
    if (!asOn) return;
    if (e && e.target && e.target.closest('#as-btn')) return;
    asOn = false;
    cancelAnimationFrame(asRaf);
    const b = document.getElementById('as-btn');
    b.textContent = 'Auto Scroll'; b.classList.remove('on'); b.setAttribute('aria-pressed', 'false');
  }

  // ── Scroll event wiring ──
  function start() {
    window.addEventListener('scroll', () => {
      engine.resumeContext();
      ui.hideArrow();
      if (outroLock) {
        const outroRoom = rooms.find(r => r.isOutro);
        if (outroRoom) {
          const oe = document.getElementById(outroRoom.id);
          const outroIdx = rooms.indexOf(outroRoom);
          const minScroll = oe ? oe.offsetTop : 0;
          const maxScroll = getLockBot(outroIdx);
          if (window.scrollY < minScroll) window.scrollTo({ top: minScroll, behavior: 'instant' });
          else if (window.scrollY > maxScroll) window.scrollTo({ top: maxScroll, behavior: 'instant' });
        }
        return;
      }
      if (locked && engine.ready && !engine.muted && !asOn) {
        if (window.scrollY > lockBot) {
          window.scrollTo({ top: lockBot, behavior: 'instant' });
          warn();
          return;
        }
      }
      onScroll();
    }, { passive: true });

    // Cancel auto-scroll on manual input
    window.addEventListener('wheel', cancelAS, { passive: true });
    window.addEventListener('touchstart', (e) => { engine.resumeContext(); cancelAS(e); }, { passive: true });
    window.addEventListener('pointerdown', cancelAS, { passive: true });

    // Suspend audio when tab is hidden, resume when visible — saves battery and handles Safari suspension
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        engine.suspendContext();
      } else {
        engine.resumeContext();
      }
    });

    // Chapter button click — saves volume and navigates
    const chapterBtn = document.getElementById('chapter-btn');
    if (chapterBtn) {
      chapterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        navigateToNextChapter(config);
      });
    }

    // Run initial scroll check
    onScroll();
  }

  return {
    start,
    startLock,
    toggleAS,
    get outroHit() { return outroHit; },
    get asOn() { return asOn; },
  };
}
