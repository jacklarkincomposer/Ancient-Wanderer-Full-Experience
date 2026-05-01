// main.js — entry point: fetch config, wire modules, handle intro

import { createAudioEngine } from './audio-engine.js';
import { createStemLoader } from './stem-loader.js';
import { createScrollController } from './scroll-controller.js';
import { initUI } from './ui.js';
import { initParticles } from './particles.js';

initParticles();

const compositionId = document.body.dataset.composition || 'cursed-village';
const configUrl = `/compositions/${compositionId}/config.json`;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runCinematic(engine, introSfx) {
  const overlay = document.getElementById('cinematic-intro');
  const lore    = overlay.querySelector('.cin-lore');
  const reveal  = overlay.querySelector('.cin-reveal');
  const hints   = overlay.querySelectorAll('.cin-hint-flash');
  const skipBtn = document.getElementById('cin-skip');

  let skipped = false;
  let skipResolve;
  const skipPromise = new Promise(r => { skipResolve = r; });
  const go = ms => Promise.race([delay(ms), skipPromise]);

  skipBtn.classList.add('cin-skip-show');
  skipBtn.addEventListener('click', () => { skipped = true; if (introSfx) { introSfx.pause(); introSfx.currentTime = 0; } skipResolve(); }, { once: true });

  await go(1200);

  // Beat 1: lore paragraph — long hold for comfortable reading (~90% of text time)
  lore.classList.add('cin-visible');
  await go(18000);

  // Beat 2: "He is known" drifts in briefly beneath
  reveal.classList.add('cin-visible');
  await go(4000);

  // Fade both out together
  const fadeOut = 'opacity 2.5s ease, transform 2.5s ease';
  lore.style.transition = fadeOut;
  reveal.style.transition = fadeOut;
  lore.classList.remove('cin-visible');
  reveal.classList.remove('cin-visible');
  await go(3500);

  // Hint flashes — one at a time
  for (const hint of hints) {
    hint.classList.add('cin-visible');
    await go(2500);
    hint.style.transition = 'opacity 0.9s ease, transform 0.9s ease';
    hint.classList.remove('cin-visible');
    await go(1000);
  }
  await go(600);

  // Reveal hero — music starts as overlay dissolves
  skipBtn.classList.remove('cin-skip-show');
  engine.setRoom(0);
  engine.startScheduler();
  overlay.style.transition = skipped ? 'opacity 1s ease' : 'opacity 4s ease';
  overlay.classList.remove('cin-active');
  await delay(skipped ? 1000 : 4500);

  document.getElementById('controls').classList.remove('cin-ui-hidden');
}

async function boot() {
  const config = await fetch(configUrl).then(r => r.json());
  const engine = createAudioEngine(config);
  const loader = createStemLoader(engine, config);
  const ui = initUI(config, engine);
  const scroll = createScrollController(config, engine, loader, ui);

  // Wire controls
  document.getElementById('vol').addEventListener('input', e => {
    engine.setMasterGain(e.target.value);
    ui.vis();
  });

  document.getElementById('mute-btn').addEventListener('click', () => {
    const isMuted = engine.toggleMute();
    const b = document.getElementById('mute-btn');
    if (isMuted) {
      b.textContent = 'Music Off'; b.style.color = 'var(--text-dim)'; b.setAttribute('aria-pressed', 'true');
    } else {
      b.textContent = 'Music On'; b.style.color = 'var(--gold)'; b.setAttribute('aria-pressed', 'false');
    }
    ui.vis();
  });

  document.getElementById('as-btn').addEventListener('click', () => scroll.toggleAS());

  document.getElementById('amb-btn').addEventListener('click', () => {
    const isMuted = engine.toggleAmbienceMute();
    const b = document.getElementById('amb-btn');
    if (isMuted) {
      b.textContent = 'SFX Off'; b.style.color = 'var(--text-dim)'; b.setAttribute('aria-pressed', 'true');
    } else {
      b.textContent = 'SFX On'; b.style.color = 'var(--gold)'; b.setAttribute('aria-pressed', 'false');
    }
  });

  // ── Phase 1: fetch audio in background (no AudioContext needed) ──
  const r0 = config.rooms[0];
  const r1 = config.rooms.length > 1 ? config.rooms[1] : null;
  const initialStems = [...r0.stems, ...(r0.drones || [])];
  const nextStems = r1 ? [...r1.stems, ...(r1.drones || [])] : [];
  const allInitial = [...new Set([...initialStems, ...nextStems])];
  const total = allInitial.length;

  const fetchBarWrap = document.getElementById('fetch-bar-wrap');
  const fetchBar = document.getElementById('fetch-bar');
  fetchBarWrap.classList.add('active');

  let fetched = 0;
  await engine.prefetchStems(allInitial, () => {
    fetched++;
    fetchBar.style.width = (fetched / total * 100) + '%';
  });

  // Fetch done — hide fetch bar, reveal modal
  fetchBarWrap.classList.remove('active');
  const introModal = document.getElementById('intro-modal');
  introModal.classList.remove('pre-show');
  introModal.classList.add('is-revealed');

  // ── Phase 2: user clicks → AudioContext + decode + start ──
  const introBtn = document.getElementById('intro-btn');
  introBtn.addEventListener('click', async () => {
    introBtn.disabled = true;
    const loadingBarWrap = document.querySelector('.loading-bar-wrap');
    const loadingBar = document.getElementById('loading-bar');
    loadingBarWrap.classList.add('active');
    await engine.init();

    // Restore volume carried over from the previous chapter
    const savedVol = sessionStorage.getItem('aw_volume');
    if (savedVol) {
      sessionStorage.removeItem('aw_volume');
      document.getElementById('vol').value = savedVol;
      engine.setMasterGain(savedVol);
    }

    // Chunky progress animation runs in parallel with decode
    const chunks = [
      { to: 18, pause: 320 },
      { to: 38, pause: 480 },
      { to: 57, pause: 400 },
      { to: 72, pause: 440 },
    ];
    async function animateChunks() {
      for (const { to, pause } of chunks) {
        loadingBar.style.transition = 'width 0.7s cubic-bezier(0.25, 1, 0.5, 1)';
        loadingBar.style.width = to + '%';
        await delay(pause);
      }
    }

    await Promise.all([engine.decodePreFetched(allInitial), animateChunks(), delay(2000)]);

    loadingBar.style.transition = 'width 0.4s ease';
    loadingBar.style.width = '100%';
    await delay(600);

    engine.ready = true;
    ui.closeModal();

    if (compositionId === 'cursed-village') {
      const introSfx = new Audio('https://cdn.jacklarkincomposer.co.uk/Ancient-Wanderer-Full-Experience-Stems/Sound_Design/Ch1/Intro_Sound_Design.mp3');
      introSfx.play().catch(() => {});
      await runCinematic(engine, introSfx);
    } else {
      engine.setRoom(0);
      engine.startScheduler();
    }

    ui.updateStemIndicators(engine);
    scroll.startLock(0);
    scroll.start();
    document.body.classList.remove('scroll-locked');
    ui.note('Journey begins');
  });
}

boot();
