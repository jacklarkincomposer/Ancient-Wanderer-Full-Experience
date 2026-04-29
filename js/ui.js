// ui.js — cursor, visualiser, notifications, stem indicators, scroll arrow

export function initUI(config, engine) {
  // ── Custom cursor ──
  const cur = document.getElementById('cursor');
  if (!window.matchMedia('(hover: none)').matches) {
    let mx = 0, my = 0, lastTrail = 0;

    function spawnTrail(x, y) {
      const t = document.createElement('div');
      t.className = 'cursor-trail';
      t.style.left = x + 'px';
      t.style.top = y + 'px';
      document.body.appendChild(t);
      requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('fade')));
      setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 550);
    }

    document.addEventListener('mousemove', e => {
      mx = e.clientX; my = e.clientY;
      cur.style.left = mx + 'px'; cur.style.top = my + 'px';
      const now = Date.now();
      if (now - lastTrail > 50) { spawnTrail(mx, my); lastTrail = now; }
    });

    document.addEventListener('mousedown', e => {
      const c = document.createElement('div');
      c.className = 'cursor-click';
      c.style.left = e.clientX + 'px';
      c.style.top = e.clientY + 'px';
      document.body.appendChild(c);
      requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('pop')));
      setTimeout(() => { if (c.parentNode) c.parentNode.removeChild(c); }, 450);
    });

    document.querySelectorAll('button,.begin-btn,.intro-enter').forEach(el => {
      el.addEventListener('mouseenter', () => {
        cur.style.filter = 'drop-shadow(0 0 10px rgba(201,168,76,1)) drop-shadow(0 0 22px rgba(201,168,76,0.5))';
      });
      el.addEventListener('mouseleave', () => {
        cur.style.filter = '';
      });
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

  // ── Stem chart rows — generated from config, one row per musical stem ──
  const stemMap = Object.fromEntries(config.stems.map(s => [s.id, s]));
  config.rooms.forEach(room => {
    const chart = document.querySelector('#' + room.id + ' .stem-chart');
    if (!chart) return;
    chart.querySelectorAll('.sc-row').forEach(r => r.remove());
    room.stems.forEach(id => {
      const stem = stemMap[id];
      if (!stem) return;
      const row = document.createElement('div');
      row.className = 'sc-row';
      row.dataset.stemId = id;
      row.innerHTML = `<span class="sc-lbl">${stem.label}</span><div class="sc-track"><div class="sc-fill"></div></div><div class="sc-pip"></div>`;
      chart.appendChild(row);
    });
    if (room.stems.length === 0 && room.drones && room.drones.length > 0) {
      const row = document.createElement('div');
      row.className = 'sc-row';
      row.innerHTML = '<span class="sc-lbl">Drone</span><div class="sc-track"><div class="sc-fill sc-fill--drone"></div></div><div class="sc-pip"></div>';
      chart.appendChild(row);
    }
  });

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
      const shaped = Math.pow(Math.min(raw * emphasis, 1), 1.7);
      vb[i].style.height = Math.max(2, shaped * 44 * bellEnv) + 'px';
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
    if (meterRaf) { cancelAnimationFrame(meterRaf); meterRaf = null; }
  }

  // ── Per-stem gain meter ──
  let meterRaf = null;
  const meterRows = document.querySelectorAll('.sc-row[data-stem-id]');
  const meterSmoothed = new Map();

  function meterLoop() {
    meterRows.forEach(row => {
      const fill = row.querySelector('.sc-fill');
      if (!fill) return;
      const id = row.dataset.stemId;
      const raw = engine.getStemLevel(id);
      const prev = meterSmoothed.get(id) || 0;
      // Fast attack, slow decay — avoids jitter while keeping peaks responsive
      const alpha = raw > prev ? 0.55 : 0.90;
      const s = prev * alpha + raw * (1 - alpha);
      meterSmoothed.set(id, s);
      const curved = Math.pow(Math.min(s * 4, 1), 0.4);
      fill.style.width = (curved * 100) + '%';
    });
    meterRaf = requestAnimationFrame(meterLoop);
  }

  function startMeter() {
    if (!meterRaf) meterRaf = requestAnimationFrame(meterLoop);
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
    startMeter();
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
    startMeter,
  };
}
