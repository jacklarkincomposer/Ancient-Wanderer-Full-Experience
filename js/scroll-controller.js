// scroll-controller.js — room detection, pace lock, outro gate, auto-scroll, impact weight

const FINALE_IMAGES = [
  // Chapter I — The Cursed Village (12 scenes)
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S1.png',  chapter: 'Chapter I',   title: 'The Rune in His Palm' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S2.png',  chapter: 'Chapter I',   title: 'From the Ridgeline' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S3.png',  chapter: 'Chapter I',   title: 'A Curse Doesn\'t Announce Itself' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S4.png',  chapter: 'Chapter I',   title: 'The First Sign Is Always the Silence' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S5.png',  chapter: 'Chapter I',   title: 'The Hollow Market' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S6.png',  chapter: 'Chapter I',   title: 'The Pull at the Centre' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S7.png',  chapter: 'Chapter I',   title: 'A Theory About Curses' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S8.png',  chapter: 'Chapter I',   title: 'The Thing at the Centre' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S9.png',  chapter: 'Chapter I',   title: 'The Fight' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S10.png', chapter: 'Chapter I',   title: 'The Fall' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S11.png', chapter: 'Chapter I',   title: 'The Quiet After' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch1/S12.png', chapter: 'Chapter I',   title: 'The Sun Returns' },
  // Chapter II — The Forge Village (10 scenes)
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch2/S1.png',  chapter: 'Chapter II',  title: 'He Doesn\'t Look Back' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch2/S2.png',  chapter: 'Chapter II',  title: 'Forge Smoke on the Ridge' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch2/S3.png',  chapter: 'Chapter II',  title: 'First Sight of the Forge Village' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch2/S4.png',  chapter: 'Chapter II',  title: 'A Place Too Busy to Worry' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch2/S5.png',  chapter: 'Chapter II',  title: 'An Hour' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch2/S6.png',  chapter: 'Chapter II',  title: 'The Rune on the Shelf' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch2/S7.png',  chapter: 'Chapter II',  title: 'He Is Not a Man Who Struggles With Decisions' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch2/S8.png',  chapter: 'Chapter II',  title: 'Two Seconds' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch2/S9.png',  chapter: 'Chapter II',  title: 'Not Dignified' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch2/S10.png', chapter: 'Chapter II',  title: 'He Opens His Hand' },
  // Chapter III — The Fishing Village (12 scenes)
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S1.png',  chapter: 'Chapter III', title: 'Still in the Forest' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S2.png',  chapter: 'Chapter III', title: 'Clifftops Above the Sea' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S3.png',  chapter: 'Chapter III', title: 'Into the Village' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S4.png',  chapter: 'Chapter III', title: 'The Harbour' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S5.png',  chapter: 'Chapter III', title: 'The Offerings' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S6.png',  chapter: 'Chapter III', title: 'What This Place Needs' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S7.png',  chapter: 'Chapter III', title: 'The Offering' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S8.png',  chapter: 'Chapter III', title: 'The Village Changing' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S9.png',  chapter: 'Chapter III', title: 'A Held Breath' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S10.png', chapter: 'Chapter III', title: 'The Boats Returning' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S11.png', chapter: 'Chapter III', title: 'The Satchel' },
  { src: 'https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Images/Ch3/S12.png', chapter: 'Chapter III', title: 'The Bag Reveal' },
];

export function createScrollController(config, engine, loader, ui) {
  const rooms = config.rooms;
  const impacts = config.impacts || [];
  const firedStingers = new Set(); // keyed as "roomId:stingerId" to allow same stinger in multiple rooms
  const outroRoom = rooms.find(r => r.isOutro) || null;
  const outroIdx = outroRoom ? rooms.indexOf(outroRoom) : -1;

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
  let outroHit = false, creditsDone = false, outroLock = false, finaleStarted = false;
  let finaleAutoTimer = null;

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
      const key = room.id + ':' + s.id;
      if (firedStingers.has(key)) return;
      const triggerY = sectionTop + sectionHeight * s.atScrollRatio;
      if (window.scrollY + window.innerHeight * 0.5 >= triggerY) {
        firedStingers.add(key);
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
        if (!unlk.has(i) && !outroHit) { firstUnvisited = i; break; }
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
    if (outroRoom) {
      const oe = document.getElementById(outroRoom.id);
      if (oe && !outroHit && oe.getBoundingClientRect().top < window.innerHeight * 0.5) {
        outroHit = true;
        outroLock = true;
        cancelLock();

        document.getElementById(outroRoom.id).classList.add('outro-in-view');

        const holdMs = (outroRoom.holdDuration || config.audio.defaultLoop.duration) * 1000;

        if (config.composition.finaleTrack) {
          // Ch.3 path: pacelock releases after ~10s. Finale only starts when user scrolls to page bottom.
          const paceLockMs = (outroRoom.paceLock || 10) * 1000;
          setTimeout(() => { outroLock = false; }, paceLockMs);
        } else {
          // Normal path: show button, fade audio at buttonRevealAt, release lock at holdDuration.
          const fadeMs = outroRoom.buttonRevealAt != null
            ? outroRoom.buttonRevealAt * 1000
            : holdMs;

          creditsDone = true;
          const btn = document.getElementById('chapter-btn');
          if (btn) {
            btn.href = config.composition.nextChapter;
            if (config.composition.nextChapterLabel) btn.textContent = config.composition.nextChapterLabel;
            btn.classList.remove('hidden');
            btn.classList.add('revealed');
          }
          const prompt = document.getElementById('chapter-prompt');
          if (prompt) {
            prompt.href = config.composition.nextChapter;
            const label = prompt.querySelector('.arrow-label');
            if (label && config.composition.nextChapterLabel) label.textContent = config.composition.nextChapterLabel;
            document.getElementById('scroll-arrow')?.classList.remove('show');
          }

          let fadeFired = false;
          setTimeout(() => {
            if (fadeFired) return;
            fadeFired = true;
            engine.fadeOutMaster();
            ui.stopVisualiser();
          }, fadeMs);

          setTimeout(() => { outroLock = false; }, holdMs);
        }
      }
    }

    if (idx >= 0) checkStingers(idx);
    checkImpactWeight();
  }

  // ── Finale / Credits sequence (Ch.3 only) ──

  function buildFinaleStrip() {
    const strip = document.getElementById('finale-strip');
    if (!strip) return;
    strip.innerHTML = '';
    FINALE_IMAGES.forEach(({ src, chapter, title }) => {
      const card = document.createElement('figure');
      card.className = 'finale-card';
      card.innerHTML = `
        <div class="finale-card-frame">
          <img src="${src}" class="finale-card-img" alt="${title}" loading="lazy">
        </div>
        <figcaption class="finale-card-info">
          <span class="fc-chapter">${chapter}</span>
          <span class="fc-title">${title}</span>
        </figcaption>`;
      strip.appendChild(card);
    });
  }

  function startFinaleScroll(finaleDuration) {
    const strip = document.getElementById('finale-strip');
    if (!strip || !finaleDuration) return;
    const scrollDist = strip.scrollHeight;
    if (scrollDist > 0) {
      strip.style.transition = `transform ${finaleDuration}s linear`;
      strip.style.transform = `translateY(-${scrollDist}px)`;
    }
  }

  // ── Finale skip button ──
  const finaleSkipBtn = document.getElementById('finale-skip');
  let finaleSkipped = false, creditsStarted = false;

  function showFinaleSkip() {
    if (!finaleSkipBtn) return;
    finaleSkipBtn.classList.add('finale-skip-show');
    finaleSkipBtn.addEventListener('click', () => {
      finaleSkipped = true;
      engine.stopOneShot();
      hideFinaleSkip();
      const finaleScreen = document.getElementById('finale-screen');
      const creditsScreen = document.getElementById('credits-screen');
      if (finaleScreen) { finaleScreen.style.transition = 'opacity 0.8s ease'; finaleScreen.style.opacity = '0'; setTimeout(() => finaleScreen.classList.remove('active'), 800); }
      if (creditsScreen) { creditsScreen.style.transition = 'opacity 0.8s ease'; creditsScreen.style.opacity = '0'; setTimeout(() => creditsScreen.classList.remove('active'), 800); }
      showEndScreen();
    }, { once: true });
  }

  function hideFinaleSkip() {
    if (!finaleSkipBtn) return;
    finaleSkipBtn.classList.remove('finale-skip-show');
  }

  async function startFinaleSequence() {
    if (finaleStarted) return;
    finaleStarted = true;
    clearTimeout(finaleAutoTimer);
    finaleAutoTimer = null;

    engine.fadeOutMaster(2.5);
    ui.stopVisualiser();
    document.body.classList.add('scroll-locked');
    showFinaleSkip();

    const finaleScreen = document.getElementById('finale-screen');
    if (!finaleScreen) return;

    // Build the image strip (off-screen below) before the overlay appears
    buildFinaleStrip();

    // Fade to black
    await new Promise(r => setTimeout(r, 400));
    finaleScreen.classList.add('active');

    // 2-second rest — silence and darkness
    await new Promise(r => setTimeout(r, 2200));

    // Show the greeting, then start fetching + playing the finale track
    const greeting = finaleScreen.querySelector('.finale-greeting');
    if (greeting) greeting.classList.add('visible');

    const base = config.audio.cdnBase;
    const finaleDuration = await engine.playOneShot(
      base + config.composition.finaleTrack,
      () => startCreditsSequence()
    );

    // 3 seconds after music starts: dismiss greeting and begin the image scroll
    setTimeout(() => {
      if (greeting) greeting.classList.add('dismissed');
      startFinaleScroll(finaleDuration - 8);
    }, 3000);
  }

  async function startCreditsSequence() {
    if (finaleSkipped || creditsStarted) return;
    creditsStarted = true;
    const finaleScreen = document.getElementById('finale-screen');
    if (finaleScreen) finaleScreen.classList.remove('active');

    await new Promise(r => setTimeout(r, 200));
    if (finaleSkipped) return;

    const creditsScreen = document.getElementById('credits-screen');
    if (!creditsScreen) return;
    creditsScreen.classList.add('active');

    const base = config.audio.cdnBase;
    const creditsDuration = await engine.playOneShot(
      base + config.composition.creditsTrack,
      () => showEndScreen()
    );

    const roll = document.getElementById('credits-roll');
    if (roll) {
      // Zero the top spacer so text starts at the bottom immediately
      const topSpacer = roll.querySelector('.credits-roll-spacer');
      if (topSpacer) topSpacer.style.height = '0';

      const rollHeight = roll.scrollHeight;

      // Find the bottom edge of the last actual content element (ignore the trailing spacer)
      const children = Array.from(roll.children);
      let lastContent = null;
      for (let i = children.length - 1; i >= 0; i--) {
        if (!children[i].classList.contains('credits-roll-spacer')) {
          lastContent = children[i];
          break;
        }
      }
      const contentEnd = lastContent
        ? lastContent.offsetTop + lastContent.offsetHeight
        : rollHeight;

      // Keep the same scroll speed as if we animated the full roll, but stop when
      // the last line exits the top — transitionend fires at exactly that moment.
      const fullTravel = window.innerHeight + rollHeight;
      const actualTravel = window.innerHeight + contentEnd;
      const duration = Math.max(1, (creditsDuration - 1) * (actualTravel / fullTravel));

      roll.style.transition = 'none';
      roll.style.transform = `translateY(${window.innerHeight}px)`;
      void roll.offsetHeight;

      setTimeout(() => {
        roll.style.transition = `transform ${duration}s linear`;
        roll.style.transform = `translateY(-${contentEnd}px)`;
        roll.addEventListener('transitionend', () => showEndScreen(), { once: true });
      }, 1000);
    }
  }

  let endShown = false;
  function showEndScreen() {
    if (endShown) return;
    endShown = true;
    hideFinaleSkip();
    engine.fadeOutOneShot(8);
    const creditsScreen = document.getElementById('credits-screen');
    const endScreen = document.getElementById('end-screen');
    if (!endScreen) return;

    // Fade credits out and bring end screen in simultaneously
    if (creditsScreen) {
      creditsScreen.style.transition = 'opacity 1.2s ease';
      creditsScreen.style.opacity = '0';
      setTimeout(() => creditsScreen.classList.remove('active'), 1200);
    }
    endScreen.classList.add('active');
    document.body.classList.remove('scroll-locked');
  }

  // ── Chapter handoff ──
  function navigateToNextChapter(cfg) {
    if (!cfg.composition || !cfg.composition.nextChapter) return;
    sessionStorage.setItem('aw_volume', document.getElementById('vol').value);
    window.location.href = cfg.composition.nextChapter;
  }

  // ── Auto scroll ──
  let asOn = false, asRaf = null, asLast = 0, asAccum = 0;
  const AS_SPEED = 22; // px per second

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
      asAccum = 0;
      asRaf = requestAnimationFrame(asStep);
    }
  }

  function asStep(now) {
    if (!asOn) return;
    if (outroHit) { cancelAS(); return; }
    if (locked) { asLast = now; asRaf = requestAnimationFrame(asStep); return; }
    const dt = (now - asLast) / 1000;
    asLast = now;
    asAccum += AS_SPEED * dt;
    const px = Math.floor(asAccum);
    if (px >= 1) {
      asAccum -= px;
      window.scrollBy({ top: px, behavior: 'instant' });
    }
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

      if (creditsDone) {
        const outroReveal = document.querySelector('.outro-reveal');
        const prompt = document.getElementById('chapter-prompt');
        if (outroReveal && prompt) {
          const revealBottom = outroReveal.getBoundingClientRect().bottom;
          const nearBottom = revealBottom > window.innerHeight - 80;
          prompt.classList.toggle('show', nearBottom);
        }
      }

      if (outroLock) {
        if (outroRoom) {
          const oe = document.getElementById(outroRoom.id);
          const minScroll = oe ? oe.offsetTop : 0;
          const maxScroll = getLockBot(outroIdx);
          if (window.scrollY < minScroll) window.scrollTo({ top: minScroll, behavior: 'instant' });
          else if (window.scrollY > maxScroll) window.scrollTo({ top: maxScroll, behavior: 'instant' });
        }
        return;
      }

      // Scroll-to-bottom trigger for finaleTrack compositions: user scrolls to the absolute page bottom
      if (outroHit && !finaleStarted && config.composition && config.composition.finaleTrack) {
        if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) {
          startFinaleSequence();
          return;
        }
      }

      if (locked && engine.ready && !engine.muted) {
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

    // Chapter button + prompt click — saves volume and navigates
    const chapterBtn = document.getElementById('chapter-btn');
    if (chapterBtn) {
      chapterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        navigateToNextChapter(config);
      });
    }
    const chapterPrompt = document.getElementById('chapter-prompt');
    if (chapterPrompt) {
      chapterPrompt.addEventListener('click', (e) => {
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
