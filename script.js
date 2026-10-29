/* ============================================================
   Luc Alfonsi — portfolio
   1. Horloge (performance.now, ou animation pilotable avec ?rec=1)
   2. Anneau vortex (canvas, redessiné à chaque frame)
   3. Machine à écrire (fonction pure du temps)
   4. Recherche dans la page
   ============================================================ */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const $ = (sel, root = document) => root.querySelector(sel);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- 1. Horloge ---------- */
  let recAnim = null;
  if (new URLSearchParams(location.search).get('rec') === '1') {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(probe);
    recAnim = probe.animate(
      [{ transform: 'translateX(0px)' }, { transform: 'translateX(100000px)' }],
      { duration: 100000, easing: 'linear', fill: 'both' }
    );
    recAnim.pause();
    window.__heroClock = recAnim; // un enregistreur image par image règle currentTime
  }
  const now = () => (recAnim ? (Number(recAnim.currentTime) || 0) / 1000 : performance.now() / 1000);

  /* ---------- 2. Anneau ---------- */
  const frame = $('#frame');
  const canvas = $('#ring');
  const bloomCanvas = $('#ring-bloom');
  const ctx = canvas && canvas.getContext('2d');
  const bctx = bloomCanvas && bloomCanvas.getContext('2d');

  const N = 196;          // brins
  const M = 41;           // points par brin
  const STEP = TAU / N;
  const BLOOM = 0.32;     // échelle du canvas de bloom

  const CURL = new Float64Array(M);  // (1 - q)^4.2
  const QQ = new Float64Array(M);    // q²
  const SQ = new Float64Array(M);    // sin(πq)
  const HW = new Float64Array(M);    // demi-largeur (en u)
  const QR = new Float64Array(M);    // q
  for (let j = 0; j < M; j++) {
    const q = j / (M - 1);
    const x = Math.min(1, q / 0.28);
    const s = x * x * (3 - 2 * x);
    QR[j] = q;
    CURL[j] = Math.pow(1 - q, 4.2);
    QQ[j] = q * q;
    SQ[j] = Math.sin(Math.PI * q);
    HW[j] = 0.15 + 3.3 * s * (1 - 0.25 * q);
  }
  const PX = new Float64Array(M), PY = new Float64Array(M);
  const NX = new Float64Array(M), NY = new Float64Array(M);
  const EX = new Float64Array(M), EY = new Float64Array(M);

  const BODY = [[0, '#b01e50'], [.12, '#9c1236'], [.40, '#860c18'], [.70, '#9c1a0a'], [.90, '#c63c0e'], [1, '#e85a18']];
  const EDGE = [[0, 'rgba(255,130,185,.85)'], [.08, 'rgba(255,84,138,.95)'], [.28, 'rgba(255,56,80,.95)'],
                [.55, 'rgba(255,58,44,.95)'], [.80, 'rgb(255,92,36)'], [.94, 'rgb(255,122,44)'], [1, 'rgb(255,150,70)']];

  let W = 0, H = 0, u = 1, dpr = 1, shift = 0, ri = 0, ro = 0;
  let gBody, gEdge, gEdgeB, gAmb, gHalo, gInner;
  let ox = 0, oy = 0, tilt = 0, tox = 0, toy = 0, ttilt = 0;

  const radial = (c, r0, r1, stops) => {
    const g = c.createRadialGradient(0, 0, Math.max(0, r0), 0, 0, r1);
    for (const [o, col] of stops) g.addColorStop(clamp(o, 0, 1), col);
    return g;
  };

  function measure() {
    const r = frame.getBoundingClientRect();
    W = r.width; H = r.height;
    const phone = window.innerWidth < 768;
    u = phone ? W / 600 : Math.min(W / 1052, H / 754);
    shift = phone ? Math.max(0, (H - 754 * u) / 2) : 0;
    frame.style.setProperty('--u', u.toFixed(5));
    frame.style.setProperty('--shift', shift.toFixed(2) + 'px');
    if (!ctx) return;

    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    bloomCanvas.width = Math.max(1, Math.round(W * BLOOM));
    bloomCanvas.height = Math.max(1, Math.round(H * BLOOM));

    ri = 435 * u;
    ro = 652 * u;
    gBody = radial(ctx, ri, ro, BODY);
    gEdge = radial(ctx, ri, ro, EDGE);
    gEdgeB = radial(bctx, ri, ro, EDGE);
    gAmb = radial(ctx, ri, ro, [[0, 'rgba(170,14,50,.35)'], [.5, 'rgba(120,8,14,.45)'], [1, 'rgba(170,40,6,.4)']]);

    const h0 = ro - 16 * u, h1 = ro + 70 * u, hp = (ro - h0) / (h1 - h0);
    gHalo = radial(ctx, h0, h1, [[0, 'rgba(255,104,34,0)'], [hp, 'rgba(255,104,34,.42)'],
                                 [hp + (1 - hp) * .35, 'rgba(255,88,30,.13)'], [1, 'rgba(255,80,30,0)']]);
    const i0 = ri - 64 * u, i1 = ri + 18 * u, ip = (ri - i0) / (i1 - i0);
    gInner = radial(ctx, i0, i1, [[0, 'rgba(255,92,160,0)'], [ip, 'rgba(255,92,160,.09)'], [1, 'rgba(255,92,160,0)']]);
  }

  function drawRing(t, ease) {
    if (!ctx || !W) return;
    if (ease) {
      ox += (tox - ox) * 0.05;
      oy += (toy - oy) * 0.05;
      tilt += (ttilt - tilt) * 0.05;
    }
    const spin = 0.06 * t;
    const k = 0.42 * (1 + 0.12 * Math.sin(0.55 * t));
    const wt = 0.4 * t;
    const cx = W / 2 + 34 * u + ox;
    const cy = -212 * u + shift + oy;
    const sy = 1.03 * (1 + 0.035 * tilt);
    const span = ro - ri;

    // canvas principal
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr * sy, dpr * cx, dpr * cy);

    // canvas de bloom
    const bs = bloomCanvas.width / W;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalCompositeOperation = 'source-over';
    bctx.globalAlpha = 1;
    bctx.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);
    bctx.setTransform(bs, 0, 0, bs * sy, bs * cx, bs * cy);

    // lumière ambiante dans l'anneau
    ctx.beginPath();
    ctx.arc(0, 0, ro, 0, TAU);
    ctx.arc(0, 0, ri, 0, TAU, true);
    ctx.fillStyle = gAmb;
    ctx.fill();

    ctx.lineWidth = 1.45 * u;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fillStyle = gBody;
    ctx.strokeStyle = gEdge;
    bctx.lineWidth = 5.3 * u;
    bctx.lineJoin = 'round';
    bctx.lineCap = 'round';
    bctx.globalAlpha = 0.7;
    bctx.strokeStyle = gEdgeB;

    // limites de visibilité en coordonnées locales
    const yCut = (-8 * u - cy) / sy;
    const yMax = (H + 8 * u - cy) / sy;
    const xLo = -cx - 12 * u, xHi = W - cx + 12 * u;

    // ordre angulaire depuis le haut de l'anneau (hors cadre) : pas de couture visible
    const base = (((-(spin + Math.PI / 2)) % TAU) + TAU) % TAU;
    const first = Math.ceil(base / STEP - 1e-9) % N;

    for (let n = 0; n < N; n++) {
      const i = (first + n) % N;
      const ui = i * STEP + spin;
      const wob = Math.sin(3 * ui + wt);
      let maxY = -Infinity, minY = Infinity, minX = Infinity, maxX = -Infinity;

      for (let j = 0; j < M; j++) {
        const r = ri + span * QR[j];
        const th = ui + k * CURL[j] + 0.05 * k * QQ[j] + 0.02 * SQ[j] * wob;
        const x = r * Math.cos(th), y = r * Math.sin(th);
        PX[j] = x; PY[j] = y;
        if (y > maxY) maxY = y;
        if (y < minY) minY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
      if (maxY < yCut || minY > yMax || maxX < xLo || minX > xHi) continue;

      for (let j = 0; j < M; j++) {
        const a = j > 0 ? j - 1 : 0, b = j < M - 1 ? j + 1 : M - 1;
        const tx = PX[b] - PX[a], ty = PY[b] - PY[a];
        const len = Math.hypot(tx, ty) || 1;
        NX[j] = -ty / len; NY[j] = tx / len;
      }
      // bord d'attaque : côté du sens de rotation
      const te = ui + k * CURL[M - 1] + 0.05 * k * QQ[M - 1] + 0.02 * SQ[M - 1] * wob;
      const sg = (NX[M - 1] * -Math.sin(te) + NY[M - 1] * Math.cos(te)) >= 0 ? 1 : -1;

      // corps opaque
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      for (let j = 0; j < M; j++) {
        const w = HW[j] * u * sg;
        const ex = PX[j] + NX[j] * w, ey = PY[j] + NY[j] * w;
        EX[j] = ex; EY[j] = ey;
        if (j === 0) ctx.moveTo(ex, ey); else ctx.lineTo(ex, ey);
      }
      for (let j = M - 1; j >= 0; j--) {
        const w = HW[j] * u * sg;
        ctx.lineTo(PX[j] - NX[j] * w, PY[j] - NY[j] * w);
      }
      ctx.closePath();
      ctx.fill();

      // bord lumineux
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      bctx.beginPath();
      ctx.moveTo(EX[0], EY[0]);
      bctx.moveTo(EX[0], EY[0]);
      for (let j = 1; j < M; j++) {
        ctx.lineTo(EX[j], EY[j]);
        bctx.lineTo(EX[j], EY[j]);
      }
      ctx.stroke();
      bctx.stroke();
    }

    // halos et liseré
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.arc(0, 0, ro + 70 * u, 0, TAU);
    ctx.arc(0, 0, ro - 16 * u, 0, TAU, true);
    ctx.fillStyle = gHalo;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, ri + 18 * u, 0, TAU);
    ctx.arc(0, 0, Math.max(0, ri - 64 * u), 0, TAU, true);
    ctx.fillStyle = gInner;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, ro, 0, TAU);
    ctx.lineWidth = 1.6 * u;
    ctx.strokeStyle = 'rgba(255,128,52,.85)';
    ctx.stroke();

    // anneaux de bloom
    bctx.globalAlpha = 1;
    bctx.beginPath();
    bctx.arc(0, 0, ro, 0, TAU);
    bctx.lineWidth = 9 * u;
    bctx.strokeStyle = 'rgba(255,108,40,.6)';
    bctx.stroke();
    bctx.beginPath();
    bctx.arc(0, 0, ri, 0, TAU);
    bctx.lineWidth = 5 * u;
    bctx.strokeStyle = 'rgba(255,92,160,.42)';
    bctx.stroke();
  }

  /* ---------- 3. Machine à écrire ---------- */
  const wordEl = $('#word');
  const caretEl = $('#caret');
  const WORDS = ['Écouter', 'Cadrer', 'Bâtir'].map((w) => Array.from(w));
  const T = { hold: 2.6, del: 0.07, gap: 0.25, type: 0.1, post: 0.15, blink: 0.55 };
  let CYCLE = 0;
  WORDS.forEach((w, i) => {
    const next = WORDS[(i + 1) % WORDS.length];
    CYCLE += T.hold + w.length * T.del + T.gap + next.length * T.type + T.post;
  });

  function typeAt(t) {
    let x = ((t % CYCLE) + CYCLE) % CYCLE;
    for (let i = 0; i < WORDS.length; i++) {
      const w = WORDS[i], next = WORDS[(i + 1) % WORDS.length];
      if (x < T.hold) return [w.join(''), Math.floor(x / T.blink) % 2 === 1];
      x -= T.hold;
      const d = w.length * T.del;
      if (x < d) return [w.slice(0, w.length - (Math.floor(x / T.del) + 1)).join(''), false];
      x -= d;
      if (x < T.gap) return ['', false];
      x -= T.gap;
      const ty = next.length * T.type;
      if (x < ty) return [next.slice(0, Math.floor(x / T.type) + 1).join(''), false];
      x -= ty;
      if (x < T.post) return [next.join(''), false];
      x -= T.post;
    }
    return [WORDS[0].join(''), false];
  }

  let lastWord = null, lastOff = null;
  function drawType(t, still) {
    if (!wordEl) return;
    const [txt, off] = still ? [WORDS[0].join(''), false] : typeAt(t);
    if (txt !== lastWord) { wordEl.textContent = txt; lastWord = txt; }
    if (off !== lastOff) { caretEl.classList.toggle('is-off', off); lastOff = off; }
  }

  /* ---------- Boucle ---------- */
  let raf = 0;
  let pageVisible = !document.hidden;
  let heroVisible = true;

  const animated = () => !reduceMQ.matches;

  function tick() {
    raf = 0;
    const t = now();
    drawRing(t, true);
    drawType(t, false);
    schedule();
  }
  function schedule() {
    if (!raf && animated() && pageVisible && heroVisible) raf = requestAnimationFrame(tick);
  }
  function renderStill() {
    drawRing(0, false);
    drawType(0, true);
  }
  function refresh() {
    measure();
    if (animated()) { drawRing(now(), false); drawType(now(), false); schedule(); }
    else renderStill();
  }

  if (frame) {
    refresh();
    if ('ResizeObserver' in window) new ResizeObserver(() => refresh()).observe(frame);
    else window.addEventListener('resize', refresh);

    document.addEventListener('visibilitychange', () => {
      pageVisible = !document.hidden;
      schedule();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        heroVisible = entries[0].isIntersecting;
        schedule();
      }).observe(frame);
    }
    const onMotionChange = () => refresh();
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onMotionChange);

    window.addEventListener('pointermove', (e) => {
      if (!animated()) return;
      const r = frame.getBoundingClientRect();
      const nx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
      const ny = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
      tox = nx * 14 * u;
      toy = ny * 10 * u;
      ttilt = ny;
    }, { passive: true });

    // police chargée : la taille du mot peut changer
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => refresh());
  }

  /* ---------- 4. Recherche ---------- */
  const form = $('#search-form');
  const input = $('#search-input');
  const statusEl = $('#search-status');
  const hitbar = $('#hitbar');
  const hitLabel = $('#hitbar-label');
  const scopes = Array.from(document.querySelectorAll('[data-search-scope]'));

  // alias : ce que tape un recruteur → ce qui est écrit dans la page
  const ALIASES = {
    'ai': ['ia'], 'intelligence artificielle': ['ia'], 'llm': ['ia'], 'gen ai': ['ia'], 'genai': ['ia'],
    'javascript': ['js'], 'js': ['javascript'],
    'scrum': ['agile', 'sprint'], 'sprints': ['sprint'],
    'ab': ['a/b'], 'ab test': ['a/b'], 'ab testing': ['a/b'], 'a/b testing': ['a/b'], 'a/b test': ['a/b'],
    'ux': ['ui/ux'], 'ui': ['ui/ux'], 'design': ['figma', 'ui/ux'],
    'postgres': ['supabase'], 'postgresql': ['supabase'], 'database': ['supabase'], 'base de donnees': ['supabase', 'postgres'],
    'automation': ['automatis'], 'automatisation': ['automatis', 'workflow'],
    'no code': ['n8n', 'zapier'], 'no-code': ['n8n', 'zapier'], 'nocode': ['n8n', 'zapier'], 'low code': ['n8n'],
    'english': ['anglais'], 'user research': ['entretien'], 'interviews': ['entretien'], 'interview': ['entretien'],
    'discovery': ['entretien'], 'product manager': ['product'], 'product owner': ['product'], 'pm': ['product'], 'po': ['product'],
    'monday': ['monday.com'], 'bluetooth': ['bluetooth'], 'saas': ['saas']
  };

  function normMap(str) {
    let out = '';
    const map = [];
    for (let i = 0; i < str.length; i++) {
      let c = str[i];
      if (c === '’' || c === '‘') c = "'";
      else if (c === ' ' || c === ' ') c = ' ';
      else if (c === '−') c = '-';
      const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      for (let k = 0; k < n.length; k++) { out += n[k]; map.push(i); }
    }
    return { out, map };
  }
  const normQ = (s) => normMap(s).out.replace(/\s+/g, ' ').trim();
  const isWordChar = (c) => !!c && /[a-z0-9æœ]/.test(c);

  function findAll(text, q) {
    const res = [];
    const short = q.length <= 3;
    let from = 0;
    while (from <= text.length) {
      const i = text.indexOf(q, from);
      if (i < 0) break;
      let end = i + q.length;
      let ok = !(isWordChar(q[0]) && isWordChar(text[i - 1]));
      if (ok && short && isWordChar(q[q.length - 1])) {
        if (text[end] === 's' && !isWordChar(text[end + 1])) end += 1;
        ok = !isWordChar(text[end]);
      }
      if (ok) res.push([i, end]);
      from = i + 1;
    }
    return res;
  }

  function collectTextNodes() {
    const nodes = [];
    for (const scope of scopes) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = node.parentElement;
          if (!p || p.closest('svg, script, style, [aria-hidden="true"], .sr-only')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
    }
    return nodes;
  }

  function wrapRanges(node, ranges) {
    for (let r = ranges.length - 1; r >= 0; r--) {
      const [s, e] = ranges[r];
      if (e < node.nodeValue.length) node.splitText(e);
      const mid = s > 0 ? node.splitText(s) : node;
      const mark = document.createElement('mark');
      mark.className = 'hit';
      mid.parentNode.insertBefore(mark, mid);
      mark.appendChild(mid);
    }
  }

  let marks = [];
  let current = -1;
  let lastQuery = '';

  function clearMarks() {
    for (const m of marks) {
      const p = m.parentNode;
      if (!p) continue;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    }
    marks = [];
    current = -1;
    document.querySelectorAll('.hit-block').forEach((el) => el.classList.remove('hit-block'));
  }

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function flash(el) {
    if (!el) return;
    el.classList.remove('hit-block');
    void el.offsetWidth;
    el.classList.add('hit-block');
  }

  function focusHit(i) {
    if (!marks.length) return;
    if (marks[current]) marks[current].classList.remove('is-current');
    current = (i + marks.length) % marks.length;
    const m = marks[current];
    m.classList.add('is-current');
    m.scrollIntoView({ behavior: reduceMQ.matches ? 'auto' : 'smooth', block: 'center' });
    flash(m.closest('li, tr, .stat, .case-col, .case-head, figure, .earlier-item, p'));
    const where = m.closest('[data-title]');
    hitLabel.textContent = `${current + 1} sur ${marks.length}${where ? ', ' + where.dataset.title : ''}`;
    hitbar.hidden = false;
  }

  function resetSearch() {
    clearMarks();
    lastQuery = '';
    statusEl.innerHTML = '';
    hitbar.hidden = true;
  }

  function runSearch(raw) {
    const q = normQ(raw);
    clearMarks();
    hitbar.hidden = true;
    lastQuery = q;
    if (q.length < 2) {
      statusEl.innerHTML = '<p class="status-found">Tapez au moins deux caractères.</p>';
      return;
    }
    const variants = new Set([q, ...(ALIASES[q] || [])]);
    for (const node of collectTextNodes()) {
      const { out, map } = normMap(node.nodeValue);
      let found = [];
      for (const v of variants) found = found.concat(findAll(out, v));
      if (!found.length) continue;
      found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
      const merged = [];
      for (const r of found) {
        const last = merged[merged.length - 1];
        if (last && r[0] < last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
      }
      wrapRanges(node, merged.map(([s, e]) => [map[s], map[e - 1] + 1]));
    }
    marks = Array.from(document.querySelectorAll('mark.hit'));

    if (!marks.length) {
      statusEl.innerHTML =
        '<div class="learning" role="status"><span class="learning-dot" aria-hidden="true"></span>' +
        '<span class="learning-text">En cours d’apprentissage</span></div>' +
        `<p class="status-sub">«&#8239;${esc(raw.trim())}&#8239;» n’apparaît pas encore sur cette page.</p>`;
      return;
    }

    const titles = [];
    for (const m of marks) {
      const t = m.closest('[data-title]');
      if (t && !titles.includes(t.dataset.title)) titles.push(t.dataset.title);
    }
    const n = marks.length;
    statusEl.innerHTML =
      `<p class="status-found"><strong>${n} résultat${n > 1 ? 's' : ''}</strong> pour «&#8239;${esc(raw.trim())}&#8239;»` +
      (titles.length ? `&#8239;: ${esc(titles.join(', '))}.` : '.') + '</p>';
    focusHit(0);
  }

  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = normQ(input.value);
      if (!q) { resetSearch(); input.focus(); return; }
      if (q === lastQuery && marks.length) { focusHit(current + 1); return; }
      runSearch(input.value);
    });
    input.addEventListener('input', () => { if (!input.value.trim()) resetSearch(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; resetSearch(); } });

    document.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        input.value = chip.dataset.q;
        runSearch(input.value);
      });
    });

    $('#hit-prev').addEventListener('click', () => focusHit(current - 1));
    $('#hit-next').addEventListener('click', () => focusHit(current + 1));
    $('#hit-close').addEventListener('click', () => {
      input.value = '';
      resetSearch();
      $('#recherche').scrollIntoView({ behavior: reduceMQ.matches ? 'auto' : 'smooth', block: 'start' });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !hitbar.hidden && document.activeElement !== input) { input.value = ''; resetSearch(); }
    });
  }
})();
