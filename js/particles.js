// js/particles.js — per-section ambient particle layer
//
// Each section maps to a "mood" with distinct particle count, colour, speed,
// wobble, and drift direction. The canvas sits as a fixed overlay (z-index 3)
// with pointer-events: none so it never interferes with scroll or clicks.
//
// Mood transitions are smooth: when IntersectionObserver detects a new active
// section, the current interpolated state is snapshotted as the new 'from' and
// a fresh lerp begins toward the new target (~2.5 s at the default rate).
//
// TO REMOVE: delete this file, remove <canvas id="particle-canvas"> from HTML,
// remove the #particle-canvas rule from style.css, and remove the import and
// initParticles() call from main.js.

// dir: -1 = rise (upward), +1 = fall (downward)
const MOODS = {
  hero:       { n: 35, r: 201, g: 168, b:  76, spd: 22, sMin: 0.8, sMax: 2.5, wob: 18, dir: -1 },
  'scene-1':  { n: 30, r: 201, g: 168, b:  76, spd: 18, sMin: 0.8, sMax: 2.2, wob: 15, dir: -1 },
  'scene-2':  { n: 30, r: 180, g: 150, b:  60, spd: 20, sMin: 0.8, sMax: 2.0, wob: 15, dir: -1 },
  'scene-3':  { n: 40, r: 201, g: 168, b:  76, spd: 24, sMin: 1.0, sMax: 2.5, wob: 18, dir: -1 },
  'scene-4':  { n: 20, r: 140, g: 130, b: 120, spd: 14, sMin: 0.8, sMax: 1.8, wob: 10, dir:  1 },
  'scene-5':  { n: 25, r: 130, g: 120, b: 110, spd: 16, sMin: 0.8, sMax: 1.8, wob: 12, dir:  1 },
  'scene-6':  { n: 30, r: 150, g: 120, b:  80, spd: 18, sMin: 1.0, sMax: 2.0, wob: 14, dir:  1 },
  'scene-7':  { n: 45, r: 160, g:  80, b:  30, spd: 28, sMin: 1.0, sMax: 2.5, wob: 28, dir: -1 },
  'scene-8':  { n: 60, r: 200, g:  70, b:  20, spd: 38, sMin: 1.0, sMax: 3.0, wob: 35, dir: -1 },
  'scene-9':  { n: 90, r: 220, g:  80, b:  15, spd: 55, sMin: 1.5, sMax: 3.5, wob: 50, dir: -1 },
  'scene-10': { n: 50, r: 120, g:  90, b:  60, spd: 22, sMin: 1.0, sMax: 2.5, wob: 18, dir:  1 },
  'scene-11': { n: 12, r: 140, g: 120, b: 100, spd:  8, sMin: 0.5, sMax: 1.5, wob:  6, dir:  1 },
  'scene-12': { n: 65, r: 201, g: 168, b:  76, spd: 32, sMin: 1.0, sMax: 3.0, wob: 24, dir: -1 },
  credits:    { n: 35, r: 201, g: 168, b:  76, spd: 20, sMin: 0.8, sMax: 2.5, wob: 15, dir: -1 },
};

const MAX = 100;
const LERP_RATE = 0.4; // mood transition speed — higher = faster (units: 1/s)

export function initParticles() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H;
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  // Lerp state — 'from' is always the current blended snapshot
  let from = { ...MOODS.hero };
  let to   = { ...MOODS.hero };
  let lerpT = 1;

  function lv(key) { return from[key] + (to[key] - from[key]) * lerpT; }

  function setMood(id) {
    const m = MOODS[id];
    if (!m) return;
    // Snapshot current blended values so the next lerp starts from here
    from = {
      n: lv('n'), r: lv('r'), g: lv('g'), b: lv('b'),
      spd: lv('spd'), sMin: lv('sMin'), sMax: lv('sMax'),
      wob: lv('wob'), dir: lv('dir'),
    };
    to   = { ...m };
    lerpT = 0;
  }

  // Observe all sections; switch to whichever has the highest intersectionRatio
  const io = new IntersectionObserver(entries => {
    let best = null, bestRatio = 0;
    entries.forEach(e => {
      if (e.isIntersecting && e.intersectionRatio > bestRatio) {
        bestRatio = e.intersectionRatio;
        best = e.target.id;
      }
    });
    if (best) setMood(best);
  }, { threshold: [0.1, 0.3, 0.5] });

  Object.keys(MOODS).forEach(id => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });

  // Particle factory
  function spawn(scatter) {
    const dir = lv('dir');
    return {
      x:      Math.random() * W,
      y:      scatter ? Math.random() * H
                      : (dir <= 0 ? H + Math.random() * 80 : -Math.random() * 80),
      phase:  Math.random() * Math.PI * 2,
      size:   lv('sMin') + Math.random() * (lv('sMax') - lv('sMin')),
      baseOp: 0.1 + Math.random() * 0.35,
      age:    scatter ? Math.random() * 8 : 0,
      life:   5 + Math.random() * 6,
    };
  }

  // Initialise pool — scatter across screen so it doesn't look like a spawn burst
  const ps = Array.from({ length: MAX }, () => spawn(true));

  // Animation loop
  let lastT = 0;

  function tick(now) {
    const dt = Math.min((now - lastT) * 0.001, 0.05);
    lastT = now;

    lerpT = Math.min(lerpT + dt * LERP_RATE, 1);

    const n    = Math.round(lv('n'));
    const r    = Math.round(lv('r'));
    const g    = Math.round(lv('g'));
    const b    = Math.round(lv('b'));
    const spd  = lv('spd');
    const sMin = lv('sMin');
    const sMax = lv('sMax');
    const wob  = lv('wob');
    const dir  = lv('dir');

    if (lerpT >= 1) from = { ...to };

    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < MAX; i++) {
      const p = ps[i];

      p.age += dt;
      if (p.age > p.life) {
        ps[i] = spawn(false);
        continue;
      }

      if (i >= n) continue; // above active count — age in silence, don't draw

      p.phase += dt * 0.55;
      p.y     += dir * spd * dt;
      p.x     += Math.sin(p.phase) * wob * dt;

      if (p.y >  H + 20) p.y = -20;
      if (p.y < -20)     p.y =  H + 20;
      if (p.x >  W + 10) p.x = -10;
      if (p.x < -10)     p.x =  W + 10;

      // Fade in over first 15% of life, hold, fade out over last 25%
      const f    = p.age / p.life;
      const fade = f < 0.15 ? f / 0.15 : f > 0.75 ? (1 - f) / 0.25 : 1;

      const sz = Math.max(sMin, Math.min(sMax, p.size));
      ctx.beginPath();
      ctx.arc(p.x, p.y, sz, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${p.baseOp * fade})`;
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(t => { lastT = t; requestAnimationFrame(tick); });
}
