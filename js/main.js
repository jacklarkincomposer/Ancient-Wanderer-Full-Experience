// main.js — entry point: fetch config, wire modules, handle intro

import { createAudioEngine } from './audio-engine.js';
import { createStemLoader } from './stem-loader.js';
import { createScrollController } from './scroll-controller.js';
import { initUI } from './ui.js';

const compositionId = new URLSearchParams(window.location.search).get('c') || 'ancient-wanderer';
const configUrl = `compositions/${compositionId}/config.json`;

async function boot() {
  const config = await fetch(configUrl).then(r => r.json());
  const engine = createAudioEngine(config);
  const loader = createStemLoader(engine, config);
  const ui = initUI(config, engine);
  const scroll = createScrollController(config, engine, loader, ui);

  // Wire controls
  document.getElementById('vol').addEventListener('input', e => {
    const wasMuted = engine.muted;
    const isMuted = engine.setMasterGain(e.target.value);
    if (wasMuted && !isMuted) {
      const b = document.getElementById('mute-btn');
      b.textContent = '\u266A'; b.style.color = 'var(--gold)'; b.setAttribute('aria-pressed', 'false');
    }
    ui.vis();
  });

  document.getElementById('mute-btn').addEventListener('click', () => {
    const isMuted = engine.toggleMute(document.getElementById('vol').value);
    const b = document.getElementById('mute-btn');
    if (isMuted) {
      b.textContent = '\u2715'; b.style.color = 'var(--text-dim)'; b.setAttribute('aria-pressed', 'true');
    } else {
      b.textContent = '\u266A'; b.style.color = 'var(--gold)'; b.setAttribute('aria-pressed', 'false');
    }
    ui.vis();
  });

  document.getElementById('as-btn').addEventListener('click', () => scroll.toggleAS());

  // ── Phase 1: fetch audio in background (no AudioContext needed) ──
  const initialStems = config.rooms[0].stems;
  const nextStems = config.rooms.length > 1 ? config.rooms[1].stems : [];
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
  document.getElementById('intro-modal').classList.remove('pre-show');

  // ── Phase 2: user clicks → AudioContext + decode + start ──
  const introBtn = document.getElementById('intro-btn');
  introBtn.addEventListener('click', async () => {
    introBtn.disabled = true;
    const loadingBarWrap = document.querySelector('.loading-bar-wrap');
    const loadingBar = document.getElementById('loading-bar');
    loadingBarWrap.classList.add('active');
    loadingBar.style.width = '30%';

    await engine.init();
    await engine.decodePreFetched(allInitial);

    loadingBar.style.width = '100%';
    await new Promise(r => setTimeout(r, 300));

    engine.ready = true;
    ui.closeModal();
    engine.setRoom(0);
    ui.updateStemIndicators(engine);
    engine.startScheduler();
    scroll.startLock(0);
    scroll.start();
    document.body.classList.remove('scroll-locked');
    ui.note('Journey begins');
  });
}

boot();
