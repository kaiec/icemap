// icemap.js: the ICE-Map Visualization (Eckert et al. 2007; Eckert 2012, chapter 2) in the browser; decisions 0001-0004.
// One ES module, no dependencies. Reads the static files of icemap.py and draws a zoomable treemap on a canvas:
// area = size of the subtree, colour = information content (IC) or the difference of two ICs.
//
//   import { IceMap } from './icemap.js';
//   const map = await IceMap.open(element, { src: 'data/', colour: { a: 'a', b: 'iic' } });

const HEADER = 15;     // height of the label strip of a node with children (px)
const PAD = 2;         // inner padding of a node with children (px)
const MIN_SIDE = 7;    // children are laid out only inside rectangles at least this wide and high (px)
const MAX_RECTS = 40000;

// ---------------------------------------------------------------- statistics (Eckert 2012, Eqs. 2.4-2.8)

// IC(c) = -log L(c) / log(ŵ⁺ + 1), with L(c) = (w⁺(c) + 1) / (ŵ⁺ + 1). 0 at the root, 1 for unused concepts.
export function ic(wp, root) {
  if (!(root > 0)) return NaN;
  return -Math.log((wp + 1) / (root + 1)) / Math.log(root + 1);
}

// The intrinsic IC: w = number of children (Eq. 2.3), so w⁺ = number of descendants = size - 1.
export function iic(size, rootSize) {
  return ic(size - 1, rootSize - 1);
}

// ---------------------------------------------------------------- squarified layout (Bruls et al. 2000)

function worst(sum, max, min, side) {
  const s2 = side * side, sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

// Lays out positive values (sorted in decreasing order) in the rectangle x, y, w, h.
// Returns one [x, y, w, h] per value, in the same order. Rows follow the shorter side.
export function squarify(values, x, y, w, h) {
  const out = [];
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0) || w <= 0 || h <= 0) return values.map(() => [x, y, 0, 0]);
  const scale = (w * h) / total;
  let i = 0;
  while (i < values.length) {
    const side = Math.min(w, h);
    let sum = values[i] * scale, max = sum, min = sum, j = i + 1;
    let best = worst(sum, max, min, side);
    while (j < values.length) {
      const a = values[j] * scale;
      const next = worst(sum + a, Math.max(max, a), Math.min(min, a), side);
      if (next > best) break;
      sum += a; max = Math.max(max, a); min = Math.min(min, a); best = next; j++;
    }
    if (w >= h) {
      const cw = sum / h;
      let yy = y;
      for (let k = i; k < j; k++) { const ch = (values[k] * scale) / cw; out.push([x, yy, cw, ch]); yy += ch; }
      x += cw; w -= cw;
    } else {
      const rh = sum / w;
      let xx = x;
      for (let k = i; k < j; k++) { const cw = (values[k] * scale) / rh; out.push([xx, y, cw, rh]); xx += cw; }
      y += rh; h -= rh;
    }
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------- data: manifest, chunks, sets (decision 0004)

class Store {
  constructor(base, manifest) {
    const n = manifest.nodes;
    this.base = base;
    this.m = manifest;
    this.n = n;
    this.ids = new Array(n);
    this.labels = new Array(n);
    this.size = new Int32Array(n);
    this.parent = new Int32Array(n).fill(-1);
    this.kids = new Uint8Array(n);      // 1: the children of this node are loaded
    this.also = new Map();
    this.index = new Map();             // id -> node
    this.chunks = new Map();            // root -> promise
    this.loaded = [];                   // roots of loaded chunks, with their nodes
    this.sets = new Map();              // set id -> Float32Array(2n): w, w⁺ per node
    this.setChunks = new Map();         // set id -> Map(root -> promise)
  }

  url(path) { return new URL(path, this.base).href; }

  hasChildren(i) { return this.size[i] > 1; }

  children(i) {
    const out = [];
    if (!this.kids[i]) return out;
    for (let j = i + 1, end = i + this.size[i]; j < end; j += this.size[j]) out.push(j);
    return out;
  }

  path(i) { const p = []; for (; i !== -1; i = this.parent[i]) p.unshift(i); return p; }

  chunk(r) {
    if (!this.chunks.has(r)) {
      this.chunks.set(r, fetch(this.url(`chunks/${r}.json`)).then(res => {
        if (!res.ok) throw new Error(`chunk ${r}: ${res.status}`);
        return res.json();
      }).then(c => this.parse(c)));
    }
    return this.chunks.get(r);
  }

  parse(c) {
    const stubs = new Set(c.stubs), nodes = [], stack = [];
    let idx = c.root;
    for (const rec of c.nodes) {
      const i = idx;
      nodes.push(i);
      this.ids[i] = rec[0]; this.labels[i] = rec[1]; this.size[i] = rec[2];
      if (rec[3]) this.also.set(i, rec[3]);
      if (rec[0] !== '' || i !== 0) this.index.set(rec[0], i);
      while (stack.length && i >= stack[stack.length - 1][1]) stack.pop();
      if (stack.length) this.parent[i] = stack[stack.length - 1][0];
      const stub = stubs.has(i) && i !== c.root;
      if (!stub && rec[2] > 1) { this.kids[i] = 1; stack.push([i, i + rec[2]]); }
      idx += stub ? rec[2] : 1;
    }
    this.loaded.push({ root: c.root, nodes });
    return Promise.all([...this.sets.keys()].map(s => this.setChunk(s, c.root, nodes)));
  }

  ensureSet(s) {
    if (s === 'iic') return Promise.resolve();
    if (!this.m.sets.some(x => x.id === s)) return Promise.reject(new Error(`no annotation set ${s}`));
    if (!this.sets.has(s)) { this.sets.set(s, new Float32Array(2 * this.n).fill(NaN)); this.setChunks.set(s, new Map()); }
    return Promise.all(this.loaded.map(c => this.setChunk(s, c.root, c.nodes)));
  }

  setChunk(s, root, nodes) {
    const done = this.setChunks.get(s);
    if (!done.has(root)) {
      done.set(root, fetch(this.url(`sets/${s}/${root}.f32`)).then(res => {
        if (!res.ok) throw new Error(`set ${s}, chunk ${root}: ${res.status}`);
        return res.arrayBuffer();
      }).then(buf => {
        const v = new DataView(buf), a = this.sets.get(s);
        nodes.forEach((i, k) => { a[2 * i] = v.getFloat32(8 * k, true); a[2 * i + 1] = v.getFloat32(8 * k + 4, true); });
      }));
    }
    return done.get(root);
  }

  // w (direct) and w⁺ (subtree) of node i in set s; for 'iic', the number of children and of descendants
  w(s, i) { return s === 'iic' ? this.children(i).length : this.sets.get(s)?.[2 * i]; }
  wp(s, i) { return s === 'iic' ? this.size[i] - 1 : this.sets.get(s)?.[2 * i + 1]; }
  ic(s, i) { return s === 'iic' ? iic(this.size[i], this.size[0]) : ic(this.wp(s, i), this.wp(s, 0)); }
}

// ---------------------------------------------------------------- colours

function hex(c) {
  c = c.trim();
  if (c.startsWith('#') && c.length === 4) c = '#' + [...c.slice(1)].map(x => x + x).join('');
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [v >> 16, (v >> 8) & 255, v & 255];
}
const mix = (a, b, t) => [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * t));
const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const light = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 140;

const STYLE = `
.icemap { --icemap-hot: #c0392b; --icemap-cold: #2e6db4; --icemap-neutral: #f4f4f1; --icemap-seq: #5b3f8c;
  --icemap-fg: #1f2329; --icemap-muted: #636b77; --icemap-line: #d9dce2; --icemap-panel: #ffffff;
  --icemap-accent: #f2b705; --icemap-hover: #eef0f4;
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 300px); grid-template-areas:
  "root root" "map side" "ctl side"; gap: 10px 14px; color: var(--icemap-fg); font: inherit; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .icemap {
  --icemap-hot: #e0574a; --icemap-cold: #4f8fdc; --icemap-neutral: #2a2d33; --icemap-seq: #b49be0;
  --icemap-fg: #e6e8ec; --icemap-muted: #a0a7b3; --icemap-line: #3a3f48; --icemap-panel: #1c1f24; --icemap-hover: #272b32; } }
:root[data-theme="dark"] .icemap {
  --icemap-hot: #e0574a; --icemap-cold: #4f8fdc; --icemap-neutral: #2a2d33; --icemap-seq: #b49be0;
  --icemap-fg: #e6e8ec; --icemap-muted: #a0a7b3; --icemap-line: #3a3f48; --icemap-panel: #1c1f24; --icemap-hover: #272b32; }
@media (max-width: 760px) { .icemap { grid-template-columns: minmax(0, 1fr); grid-template-areas: "root" "map" "ctl" "side"; } }
.icemap-root { grid-area: root; display: flex; flex-wrap: wrap; gap: 3px; align-items: center; min-width: 0; }
.icemap-root button { font: inherit; font-size: .82rem; border: 1px solid rgba(0,0,0,.25); border-radius: 3px;
  padding: 2px 7px; cursor: pointer; max-width: 22em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icemap-root span { color: var(--icemap-muted); font-size: .8rem; }
.icemap-map { grid-area: map; position: relative; min-width: 0; }
.icemap-canvas { display: block; width: 100%; height: clamp(320px, 66vh, 760px); border-radius: 3px; cursor: pointer; touch-action: manipulation; }
.icemap-canvas:focus-visible { outline: 2px solid var(--icemap-accent); outline-offset: 2px; }
.icemap-tip { position: absolute; pointer-events: none; background: var(--icemap-panel); color: var(--icemap-fg);
  border: 1px solid var(--icemap-line); border-radius: 4px; padding: 4px 8px; font-size: .8rem; max-width: 280px;
  box-shadow: 0 2px 8px rgba(0,0,0,.15); z-index: 2; }
.icemap-tip b { display: block; font-weight: 600; }
.icemap-ctl { grid-area: ctl; display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; font-size: .82rem; color: var(--icemap-muted); }
.icemap-ctl label { display: flex; gap: 6px; align-items: center; }
.icemap-ctl input[type=range] { width: 120px; }
.icemap-ctl button { font: inherit; border: 1px solid var(--icemap-line); background: var(--icemap-panel); color: var(--icemap-fg); border-radius: 4px; padding: 3px 9px; cursor: pointer; }
.icemap-ctl button:hover { background: var(--icemap-hover); }
.icemap-scale { display: grid; gap: 2px; min-width: 220px; }
.icemap-scale i { display: block; height: 10px; border-radius: 2px; border: 1px solid var(--icemap-line); }
.icemap-scale span { display: flex; justify-content: space-between; gap: 10px; }
.icemap-side { grid-area: side; display: grid; grid-template-rows: auto minmax(160px, 1fr) auto; gap: 10px; min-width: 0; min-height: 0; max-height: calc(clamp(320px, 66vh, 760px) + 60px); }
.icemap-search input { width: 100%; box-sizing: border-box; font: inherit; padding: 5px 8px; border: 1px solid var(--icemap-line); border-radius: 4px; background: var(--icemap-panel); color: var(--icemap-fg); }
.icemap-hits { list-style: none; margin: 4px 0 0; padding: 0; max-height: 180px; overflow: auto; border: 1px solid var(--icemap-line); border-radius: 4px; background: var(--icemap-panel); }
.icemap-hits button { all: unset; display: block; width: 100%; box-sizing: border-box; padding: 3px 8px; cursor: pointer; font-size: .85rem; }
.icemap-hits button:hover, .icemap-hits button:focus-visible { background: var(--icemap-hover); }
.icemap-hits small { color: var(--icemap-muted); }
.icemap-tree { overflow: auto; border: 1px solid var(--icemap-line); border-radius: 4px; background: var(--icemap-panel); padding: 4px 0; font-size: .85rem; min-height: 0; }
.icemap-tree ul { list-style: none; margin: 0; padding: 0 0 0 14px; }
.icemap-tree > ul { padding-left: 4px; }
.icemap-tree li > div { display: flex; gap: 4px; align-items: baseline; padding: 1px 6px 1px 0; }
.icemap-tree .tog { all: unset; width: 1.1em; text-align: center; cursor: pointer; color: var(--icemap-muted); flex: none; }
.icemap-tree .lbl { all: unset; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.icemap-tree .lbl:focus-visible { outline: 2px solid var(--icemap-accent); }
.icemap-tree .sw { width: .7em; height: .7em; border-radius: 2px; flex: none; border: 1px solid rgba(0,0,0,.25); align-self: center; }
.icemap-tree .num { color: var(--icemap-muted); font-variant-numeric: tabular-nums; font-size: .78rem; }
.icemap-tree .sel > div { background: var(--icemap-hover); }
.icemap-tree .sel > div .lbl { font-weight: 600; }
.icemap-details { border: 1px solid var(--icemap-line); border-radius: 4px; background: var(--icemap-panel); padding: 8px 10px; font-size: .84rem; overflow: auto; max-height: 300px; }
.icemap-details h3 { margin: 0 0 4px; font-size: .95rem; }
.icemap-details table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
.icemap-details th, .icemap-details td { text-align: right; padding: 1px 4px; border-bottom: 1px solid var(--icemap-line); }
.icemap-details th:first-child, .icemap-details td:first-child { text-align: left; }
.icemap-details p { margin: 4px 0; color: var(--icemap-muted); }
.icemap-details button.link { all: unset; cursor: pointer; text-decoration: underline; color: var(--icemap-fg); }
.icemap-details a { color: inherit; }
`;

function injectStyle() {
  if (document.getElementById('icemap-style')) return;
  const s = document.createElement('style');
  s.id = 'icemap-style';
  s.textContent = STYLE;
  document.head.prepend(s);
}

const fmt = new Intl.NumberFormat('en');
const num = v => (v === undefined || Number.isNaN(v)) ? '–' : fmt.format(Math.round(v));
const dec = v => (v === undefined || Number.isNaN(v)) ? '–' : v.toFixed(3);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- the component

export class IceMap {
  // options: src (directory of manifest.json), colour {a, b} (set ids or 'iic'; without b: IC of a alone),
  // focus, select (concept ids), link(id) -> URL or null, onChange({focus, select}), text (labels of the UI)
  static async open(el, options = {}) {
    const base = new URL(options.src || './', document.baseURI).href.replace(/\/?$/, '/');
    const res = await fetch(new URL('manifest.json', base));
    if (!res.ok) throw new Error(`manifest.json: ${res.status}`);
    const store = new Store(base, await res.json());
    await store.chunk(0);
    const map = new IceMap(el, store, options);
    await map.setColour(options.colour || { a: 'iic' });
    if (options.focus) await map.focus(options.focus, false);
    if (options.select) await map.select(options.select, false);
    return map;
  }

  constructor(el, store, options) {
    injectStyle();
    this.el = el;
    this.s = store;
    this.o = options;
    this.focusNode = 0;
    this.selected = -1;
    this.hover = -1;
    this.rects = [];
    this.contrast = 0;
    this.balance = 0;
    this.colour = { a: 'iic' };
    el.classList.add('icemap');
    el.innerHTML = `
      <nav class="icemap-root" aria-label="Path to the shown concept"></nav>
      <div class="icemap-map"><canvas class="icemap-canvas" tabindex="0" role="img"></canvas><div class="icemap-tip" hidden></div></div>
      <div class="icemap-ctl">
        <div class="icemap-scale"><i></i><span><span class="lo"></span><span class="hi"></span></span></div>
        <label>Contrast <input type="range" class="contrast" min="0" max="100" value="0"></label>
        <label>Balance <input type="range" class="balance" min="-100" max="100" value="0"></label>
        <button type="button" class="centre" title="Make the shown top concept the neutral colour">Centre on top</button>
        <button type="button" class="reset">Reset colours</button>
      </div>
      <div class="icemap-side">
        <div class="icemap-search"><input type="search" placeholder="Find a concept" aria-label="Find a concept" autocomplete="off"><ul class="icemap-hits" hidden></ul></div>
        <div class="icemap-tree" role="tree" aria-label="Hierarchy"></div>
        <div class="icemap-details" aria-live="polite"></div>
      </div>`;
    const q = sel => el.querySelector(sel);
    this.canvas = q('.icemap-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tip = q('.icemap-tip');
    this.rootline = q('.icemap-root');
    this.tree = q('.icemap-tree');
    this.details = q('.icemap-details');
    this.scale = q('.icemap-scale');
    this.wire(q);
    new ResizeObserver(() => this.relayout()).observe(this.canvas);
    for (const m of [matchMedia('(prefers-color-scheme: dark)')]) m.addEventListener('change', () => this.redraw());
    new MutationObserver(() => this.redraw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.renderTree();
  }

  get sets() { return this.s.m.sets; }
  get manifest() { return this.s.m; }

  // ------------------------------------------------ public API

  async setColour(colour) {
    await Promise.all([colour.a, colour.b].filter(Boolean).map(x => this.s.ensureSet(x)));
    this.colour = { a: colour.a, b: colour.b || null };
    this.redraw();
    this.updateTreeColours();
    this.showDetails();
  }

  async focus(id, notify = true) {
    const i = typeof id === 'number' ? id : this.s.index.get(id);
    if (i === undefined) return false;
    this.focusNode = i;
    this.relayout();
    if (notify) this.changed();
    return true;
  }

  async select(id, notify = true) {
    const i = typeof id === 'number' ? id : this.s.index.get(id);
    if (i === undefined) return false;
    this.selected = i;
    this.redraw();
    this.showDetails();
    await this.revealInTree(i);
    if (notify) this.changed();
    return true;
  }

  state() {
    return { focus: this.focusNode ? this.s.ids[this.focusNode] : null, select: this.selected >= 0 ? this.s.ids[this.selected] : null };
  }

  // ------------------------------------------------ colours

  palette() {
    const st = getComputedStyle(this.el), get = (k, d) => hex(st.getPropertyValue(k)) || d;
    return {
      hot: get('--icemap-hot', [192, 57, 43]), cold: get('--icemap-cold', [46, 109, 180]),
      neutral: get('--icemap-neutral', [244, 244, 241]), seq: get('--icemap-seq', [91, 63, 140]),
    };
  }

  // The analysis value of node i: D = IC(a) - IC(b) (Eq. 2.8), or IC(a) alone.
  value(i) {
    const { a, b } = this.colour;
    return b ? this.s.ic(a, i) - this.s.ic(b, i) : this.s.ic(a, i);
  }

  colourOf(i, p = this.pal || (this.pal = this.palette())) {
    const v = this.value(i);
    if (Number.isNaN(v)) return p.neutral;
    const range = Math.max(0.02, 1 - this.contrast);
    if (this.colour.b) {
      // negative D: lower IC than the reference, i.e. more used: red ("hot"); positive: blue
      const t = Math.max(-1, Math.min(1, (v - this.balance) / range));
      return t < 0 ? mix(p.neutral, p.hot, -t) : mix(p.neutral, p.cold, t);
    }
    // IC alone: 0 at the root, 1 for unused concepts; the lower, the darker
    const t = Math.max(0, Math.min(1, (1 - v - Math.max(0, this.balance)) / range));
    return mix(p.neutral, p.seq, t);
  }

  updateScale() {
    const p = this.pal || this.palette();
    const bar = this.scale.querySelector('i'), lo = this.scale.querySelector('.lo'), hi = this.scale.querySelector('.hi');
    const name = s => s === 'iic' ? 'structure (IIC)' : (this.sets.find(x => x.id === s)?.label || s);
    if (this.colour.b) {
      bar.style.background = `linear-gradient(to right, ${css(p.hot)}, ${css(p.neutral)}, ${css(p.cold)})`;
      lo.textContent = `${name(this.colour.a)}: more than ${name(this.colour.b)}`;
      hi.textContent = 'less';
    } else {
      bar.style.background = `linear-gradient(to right, ${css(p.seq)}, ${css(p.neutral)})`;
      lo.textContent = `low IC: much below (${name(this.colour.a)})`;
      hi.textContent = 'high IC: little or nothing';
    }
  }

  // ------------------------------------------------ layout and drawing

  relayout() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.dpr = dpr;
    const rects = [], pending = [];
    const visit = (i, x, y, rw, rh, depth) => {
      if (rects.length >= MAX_RECTS) return;
      const r = { i, x, y, w: rw, h: rh, depth, header: false };
      rects.push(r);
      if (!this.s.hasChildren(i) || rw < MIN_SIDE || rh < MIN_SIDE) return;
      if (!this.s.kids[i]) { pending.push(i); return; }
      r.header = rh >= HEADER * 2.5 && rw >= 36;
      const ix = x + PAD, iy = y + (r.header ? HEADER : PAD), iw = rw - 2 * PAD, ih = rh - (r.header ? HEADER : PAD) - PAD;
      if (iw < 2 || ih < 2) return;
      const kids = this.s.children(i).sort((p, q) => this.s.size[q] - this.s.size[p]);
      const boxes = squarify(kids.map(k => this.s.size[k]), ix, iy, iw, ih);
      kids.forEach((k, n) => { const [bx, by, bw, bh] = boxes[n]; if (bw > 0.3 && bh > 0.3) visit(k, bx, by, bw, bh, depth + 1); });
    };
    visit(this.focusNode, 0, 0, w, h, 0);
    this.rects = rects;
    this.canvas.setAttribute('aria-label', `Treemap of ${this.s.labels[this.focusNode]}; use the hierarchy beside it to navigate`);
    this.redraw();
    this.renderRootline();
    if (pending.length) Promise.all(pending.map(i => this.s.chunk(i))).then(() => this.relayout(), e => console.error(e));
  }

  redraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  draw() {
    const ctx = this.ctx, dpr = this.dpr || 1, pal = this.pal = this.palette();
    const st = getComputedStyle(this.el);
    const family = st.fontFamily || 'system-ui, sans-serif';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.textBaseline = 'middle';
    ctx.font = `600 11.5px ${family}`;
    const sel = [];
    for (const r of this.rects) {
      const c = this.colourOf(r.i, pal);
      ctx.fillStyle = css(c);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (r.w >= 3 && r.h >= 3) {
        ctx.strokeStyle = 'rgba(0,0,0,0.38)';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }
      const leafLabel = !r.header && r.w >= 44 && r.h >= 16 && (!this.s.hasChildren(r.i) || r.w < MIN_SIDE * 6 || r.h < HEADER * 2.5);
      if (r.header || leafLabel) {
        ctx.fillStyle = light(c) ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)';
        const text = this.fit(this.s.labels[r.i] || '', r.w - 8);
        if (text) ctx.fillText(text, r.x + 4, r.y + (r.header ? HEADER / 2 + 1 : Math.min(r.h / 2, 10)));
      }
      if (r.i === this.selected) sel.push(r);
    }
    const ring = (r, colour, width) => {
      ctx.strokeStyle = colour; ctx.lineWidth = width;
      ctx.strokeRect(r.x + width / 2, r.y + width / 2, Math.max(0, r.w - width), Math.max(0, r.h - width));
    };
    const hov = this.rects.find(r => r.i === this.hover);
    if (hov) ring(hov, 'rgba(0,0,0,0.75)', 2);
    const accent = st.getPropertyValue('--icemap-accent').trim() || '#f2b705';
    for (const r of sel) { ring(r, 'rgba(0,0,0,0.85)', 4); ring(r, accent, 2); }
    this.updateScale();
  }

  fit(text, width) {
    if (width < 14) return '';
    const ctx = this.ctx;
    if (ctx.measureText(text).width <= width) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, m) + '…').width <= width) lo = m; else hi = m - 1; }
    return lo ? text.slice(0, lo) + '…' : '';
  }

  hit(x, y) {
    for (let k = this.rects.length - 1; k >= 0; k--) {
      const r = this.rects[k];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.i;
    }
    return -1;
  }

  // ------------------------------------------------ root line, tree view, details

  renderRootline() {
    const p = this.pal || this.palette();
    const path = this.s.path(this.focusNode);
    this.rootline.innerHTML = '';
    path.forEach((i, k) => {
      if (k) { const s = document.createElement('span'); s.textContent = '›'; this.rootline.append(s); }
      const b = document.createElement('button');
      const c = this.colourOf(i, p);
      b.type = 'button';
      b.textContent = this.s.labels[i];
      b.title = this.s.labels[i];
      b.style.background = css(c);
      b.style.color = light(c) ? '#111' : '#fff';
      if (i === this.focusNode) b.setAttribute('aria-current', 'location');
      b.addEventListener('click', () => this.focus(i));
      this.rootline.append(b);
    });
  }

  treeItem(i) {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.dataset.i = i;
    const has = this.s.hasChildren(i);
    li.setAttribute('aria-expanded', 'false');
    li.innerHTML = `<div><button type="button" class="tog" aria-label="Expand" ${has ? '' : 'disabled'}>${has ? '▸' : '·'}</button>`
      + `<span class="sw"></span><button type="button" class="lbl" title="${esc(this.s.labels[i])}">${esc(this.s.labels[i])}</button>`
      + `<span class="num"></span></div>`;
    this.paintItem(li);
    return li;
  }

  paintItem(li) {
    const i = +li.dataset.i, a = this.colour.a;
    li.querySelector('.sw').style.background = css(this.colourOf(i));
    li.querySelector('.num').textContent = num(a === 'iic' ? this.s.size[i] : this.s.wp(a, i));
  }

  async expandItem(li, open) {
    const i = +li.dataset.i, tog = li.querySelector('.tog');
    if (tog.disabled) return;
    let ul = li.querySelector(':scope > ul');
    if (open && !ul) {
      if (!this.s.kids[i]) await this.s.chunk(i);
      ul = document.createElement('ul');
      ul.setAttribute('role', 'group');
      this.s.children(i).sort((p, q) => this.sortKey(q) - this.sortKey(p)).forEach(k => ul.append(this.treeItem(k)));
      li.append(ul);
    }
    if (ul) ul.hidden = !open;
    tog.textContent = open ? '▾' : '▸';
    li.setAttribute('aria-expanded', String(open));
  }

  sortKey(i) { const a = this.colour.a; return a === 'iic' ? this.s.size[i] : (this.s.wp(a, i) || 0); }

  renderTree() {
    this.tree.innerHTML = '';
    const ul = document.createElement('ul');
    const li = this.treeItem(0);
    ul.append(li);
    this.tree.append(ul);
    this.expandItem(li, true);
  }

  updateTreeColours() { this.tree.querySelectorAll('li').forEach(li => this.paintItem(li)); }

  async revealInTree(i) {
    let li = this.tree.querySelector('li');
    for (const j of this.s.path(i).slice(1)) {
      await this.expandItem(li, true);
      li = li.querySelector(`:scope > ul > li[data-i="${j}"]`);
      if (!li) return;
    }
    this.tree.querySelectorAll('li.sel').forEach(x => x.classList.remove('sel'));
    li.classList.add('sel');
    const row = li.firstElementChild, box = this.tree;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 24) box.scrollTop = top - box.clientHeight / 3;
  }

  showDetails() {
    const i = this.selected >= 0 ? this.selected : this.focusNode, s = this.s;
    const missing = this.sets.filter(x => !s.sets.has(x.id));
    if (missing.length) Promise.all(missing.map(x => s.ensureSet(x.id))).then(() => this.showDetails(), e => console.error(e));
    const label = s.labels[i], link = this.o.link && s.ids[i] ? this.o.link(s.ids[i]) : null;
    const rows = [['iic', 'Structure: children / descendants'], ...this.sets.map(x => [x.id, x.label])].map(([id, name]) => {
      const root = id === 'iic' ? s.size[0] - 1 : s.wp(id, 0), wp = s.wp(id, i);
      const share = root > 0 ? (100 * wp / root) : NaN;
      const loaded = id === 'iic' || s.sets.has(id);
      return `<tr><td>${esc(name)}</td><td>${loaded ? num(s.w(id, i)) : '…'}</td><td>${loaded ? num(wp) : '…'}</td>`
        + `<td>${loaded && !Number.isNaN(share) ? (share < 0.1 && share > 0 ? '<0.1' : share.toFixed(1)) + '%' : '–'}</td>`
        + `<td>${loaded ? dec(s.ic(id, i)) : '–'}</td></tr>`;
    }).join('');
    const also = (s.also.get(i) || []).map(id => {
      const j = s.index.get(id);
      return j === undefined ? esc(id) : `<button type="button" class="link" data-i="${j}">${esc(s.labels[j])}</button>`;
    });
    const { a, b } = this.colour, v = this.value(i);
    this.details.innerHTML = `<h3>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label)}</h3>`
      + `<p>${num(s.size[i])} concept${s.size[i] === 1 ? '' : 's'} in this subtree${s.ids[i] ? ` · id ${esc(s.ids[i])}` : ''}</p>`
      + `<table><thead><tr><th></th><th title="assigned directly (w)">w</th><th title="in the subtree (w⁺)">w⁺</th><th title="w⁺ as a share of the root">share</th><th>IC</th></tr></thead><tbody>${rows}</tbody></table>`
      + (b ? `<p>IC difference D = IC(${esc(a)}) − IC(${esc(b)}) = <b>${dec(v)}</b></p>` : '')
      + (also.length ? `<p>Also under: ${also.join(', ')}</p>` : '');
    this.details.querySelectorAll('button.link').forEach(btn => btn.addEventListener('click', () => this.select(+btn.dataset.i)));
  }

  changed() { this.o.onChange?.(this.state()); }

  // ------------------------------------------------ events

  wire(q) {
    const pos = e => { const b = this.canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    this.canvas.addEventListener('mousemove', e => {
      const [x, y] = pos(e), i = this.hit(x, y);
      if (i !== this.hover) { this.hover = i; this.redraw(); }
      if (i < 0) { this.tip.hidden = true; return; }
      const a = this.colour.a, v = this.value(i);
      this.tip.innerHTML = `<b>${esc(this.s.labels[i])}</b>`
        + (a === 'iic' ? `${num(this.s.size[i])} concepts` : `${num(this.s.wp(a, i))} · ${esc(this.sets.find(x => x.id === a)?.label || a)}`)
        + (this.colour.b ? ` · D ${dec(v)}` : ` · IC ${dec(v)}`);
      this.tip.hidden = false;
      const mw = this.canvas.clientWidth, tw = this.tip.offsetWidth;
      this.tip.style.left = `${Math.min(x + 14, mw - tw - 4)}px`;
      this.tip.style.top = `${y + 16}px`;
    });
    this.canvas.addEventListener('mouseleave', () => { this.hover = -1; this.tip.hidden = true; this.redraw(); });
    this.canvas.addEventListener('click', e => { const i = this.hit(...pos(e)); if (i >= 0) this.select(i); });
    this.canvas.addEventListener('dblclick', e => {
      const i = this.hit(...pos(e));
      if (i < 0) return;
      if (i === this.focusNode) { if (this.s.parent[i] >= 0) this.focus(this.s.parent[i]); return; }
      this.focus(this.s.hasChildren(i) ? i : this.s.parent[i]);
    });
    this.canvas.addEventListener('keydown', e => {
      if (e.key === 'Enter' && this.selected >= 0 && this.s.hasChildren(this.selected)) this.focus(this.selected);
      if ((e.key === 'Backspace' || e.key === 'Escape') && this.s.parent[this.focusNode] >= 0) this.focus(this.s.parent[this.focusNode]);
    });
    this.tree.addEventListener('click', e => {
      const li = e.target.closest('li');
      if (!li) return;
      if (e.target.closest('.tog')) this.expandItem(li, li.getAttribute('aria-expanded') !== 'true');
      else if (e.target.closest('.lbl')) this.select(+li.dataset.i);
    });
    this.tree.addEventListener('dblclick', e => {
      const li = e.target.closest('li');
      if (li && e.target.closest('.lbl')) { const i = +li.dataset.i; this.focus(this.s.hasChildren(i) ? i : this.s.parent[i]); }
    });
    const contrast = q('.contrast'), balance = q('.balance');
    contrast.addEventListener('input', () => { this.contrast = contrast.value / 100 * 0.97; this.recolour(); });
    balance.addEventListener('input', () => { this.balance = balance.value / 100; this.recolour(); });
    q('.centre').addEventListener('click', () => {
      const v = this.value(this.focusNode);
      if (!Number.isNaN(v)) { this.balance = this.colour.b ? v : Math.max(0, 1 - v); balance.value = Math.round(this.balance * 100); this.recolour(); }
    });
    q('.reset').addEventListener('click', () => { this.contrast = 0; this.balance = 0; contrast.value = 0; balance.value = 0; this.recolour(); });
    const input = q('.icemap-search input'), hits = q('.icemap-hits');
    input.addEventListener('input', () => {
      const t = input.value.trim().toLowerCase();
      if (t.length < 2) { hits.hidden = true; return; }
      const found = [];
      for (const c of this.s.loaded) for (const i of c.nodes) {
        if (found.length >= 50) break;
        if ((this.s.labels[i] || '').toLowerCase().includes(t) && !found.includes(i)) found.push(i);
      }
      found.sort((p, r) => this.sortKey(r) - this.sortKey(p));
      hits.innerHTML = found.length ? found.map(i => `<li><button type="button" data-i="${i}">${esc(this.s.labels[i])}`
        + ` <small>${esc(this.s.path(i).slice(1, -1).map(j => this.s.labels[j]).join(' › '))}</small></button></li>`).join('')
        : '<li><small>&nbsp;No concept found among the loaded ones.</small></li>';
      hits.hidden = false;
    });
    hits.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const i = +b.dataset.i, p = this.s.parent[i];
      hits.hidden = true;
      this.focus(p >= 0 ? p : i, false).then(() => this.select(i));
    });
  }

  recolour() { this.redraw(); this.renderRootline(); this.updateTreeColours(); }
}
