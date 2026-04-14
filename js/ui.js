// ui.js — cursor, visualiser, notifications, stem indicators, scroll arrow

export function initUI(config, engine) {
  // ── Custom cursor ──
  const cur = document.getElementById('cursor');
  const ring = document.getElementById('cursor-ring');
  if (!window.matchMedia('(hover: none)').matches) {
    let mx = 0, my = 0, rx = 0, ry = 0;
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; cur.style.left = mx + 'px'; cur.style.top = my + 'px'; });
    (function tick() { rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12; ring.style.left = rx + 'px'; ring.style.top = ry + 'px'; requestAnimationFrame(tick); })();
    document.querySelectorAll('button,.begin-btn,.intro-enter').forEach(el => {
      el.addEventListener('mouseenter', () => { ring.style.width = '48px'; ring.style.height = '48px'; ring.style.borderColor = 'var(--gold)'; });
      el.addEventListener('mouseleave', () => { ring.style.width = '34px'; ring.style.height = '34px'; ring.style.borderColor = 'rgba(201,168,76,0.4)'; });
    });
  }

  // ── Stem indicators — generated from config ──
  const indicatorContainer = document.querySelector('.stem-indicators');
  if (indicatorContainer) {
    indicatorContainer.innerHTML = '';
    config.stems.forEach(stem => {
      const div = document.createElement('div');
      div.className = 'stem-dot';
      div.id = 'stem-' + stem.id;
      div.innerHTML = '<span>' + stem.label + '</span><div class="dot"></div>';
      indicatorContainer.appendChild(div);
    });
  }

  // ── Visualiser ──
  const ve = document.getElementById('visualiser');
  const VIS_BARS = 220;
  const vb = [];
  for (let i = 0; i < VIS_BARS; i++) {
    const b = document.createElement('div');
    b.className = 'vb'; b.style.height = '2px';
    ve.appendChild(b); vb.push(b);
  }

  let visRaf = null;
  function visLoop() {
    const analyser = engine.getAnalyser();
    const analyserData = engine.getAnalyserData();
    const actx = engine.getContext();
    if (!analyser || engine.activeStems.size === 0 || engine.muted) {
      ve.classList.remove('active');
      vb.forEach(b => { b.style.height = '2px'; });
      visRaf = null;
      return;
    }
    ve.classList.add('active');
    analyser.getByteFrequencyData(analyserData);
    const bins = analyserData.length;
    const nyquist = actx.sampleRate / 2;
    const minF = 20, maxF = 20000;
    for (let i = 0; i < VIS_BARS; i++) {
      const t = i / (VIS_BARS - 1);
      const freq = minF * Math.pow(maxF / minF, t);
      const bin = Math.min(Math.round(freq / nyquist * bins), bins - 1);
      const raw = analyserData[bin] / 255;
      const bassRolloff = Math.pow(t, 0.4);
      const emphasis = (0.3 + 1.1 * t) * (0.4 + 0.6 * bassRolloff);
      const bellEnv = 0.3 + 0.7 * Math.sin(t * Math.PI);
      vb[i].style.height = Math.max(2, Math.min(raw * emphasis, 1) * 36 * bellEnv) + 'px';
    }
    visRaf = requestAnimationFrame(visLoop);
  }

  function vis() {
    if (engine.activeStems.size > 0 && !engine.muted && !visRaf) {
      visRaf = requestAnimationFrame(visLoop);
    } else if ((engine.activeStems.size === 0 || engine.muted) && visRaf) {
      cancelAnimationFrame(visRaf);
      visRaf = null;
      ve.classList.remove('active');
      vb.forEach(b => { b.style.height = '2px'; });
    }
  }

  function stopVisualiser() {
    if (ve) ve.classList.remove('active');
    if (visRaf) { cancelAnimationFrame(visRaf); visRaf = null; }
  }

  // ── Notifications ──
  let nt;
  const nf = document.getElementById('notification');
  function note(m) { nf.textContent = m; nf.classList.add('show'); clearTimeout(nt); nt = setTimeout(() => nf.classList.remove('show'), 2200); }

  // ── Scroll arrow ──
  const arrowEl = document.getElementById('scroll-arrow');
  let arrowVisible = false, arrowHideTimer = null;

  function showArrow() {
    clearTimeout(arrowHideTimer);
    arrowVisible = true;
    arrowEl.classList.remove('hide');
    arrowEl.classList.add('show');
    arrowHideTimer = setTimeout(() => hideArrow(), 3500);
  }

  function hideArrow() {
    if (!arrowVisible) return;
    arrowVisible = false;
    arrowEl.classList.remove('show');
    arrowEl.classList.add('hide');
    clearTimeout(arrowHideTimer);
    arrowHideTimer = setTimeout(() => arrowEl.classList.remove('hide'), 700);
  }

  // ── Stem indicator update ──
  function updateStemIndicators(eng) {
    const active = eng.activeStems;
    config.stems.forEach(stem => {
      const d = document.getElementById('stem-' + stem.id);
      if (!d) return;
      if (active.has(stem.id)) {
        if (!d.classList.contains('active')) {
          d.classList.add('active');
          note('+ ' + stem.label.toUpperCase());
        }
      } else {
        d.classList.remove('active');
      }
    });
    vis();
  }

  function closeModal() {
    document.getElementById('intro-modal').classList.add('hidden');
  }

  return {
    note,
    vis,
    showArrow,
    hideArrow,
    updateStemIndicators,
    closeModal,
    stopVisualiser,
  };
}
