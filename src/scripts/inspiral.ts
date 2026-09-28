// ============================================================================
//  Interactive inspiral renderer (Canvas 2D)
//
//  What is data and what is illustration:
//   • DATA: the secondary's recorded position (r, θ, z) at every recorded row,
//     the path followed so far (every 6th recorded position), and every value
//     in the readouts, plots and jet-power legend.
//   • DECLARED MAPPING: jet brightness ∝ log10 P, clamped to 36–46 erg/s.
//     Exactly zero power draws no jet and an explicit "P = 0" mark.
//   • ILLUSTRATION: host light, accretion-disk glyphs, jet length/direction
//     (drawn along the orbital-plane normal), the flowing texture in the jets.
//  Positions between consecutive rows are interpolated in (r, θ, z) only so the
//  marker moves smoothly; readouts always show the recorded row at the marker.
// ============================================================================
import { sci, fmtR } from '../lib/format';

type Field = { name: string; dtype: string };
type ChunkInfo = { file: string; first_row: number; rows: number; t0_Gyr: number; t1_Gyr: number };
type Meta = {
  rows: number;
  chunk_rows: number;
  chunks: ChunkInfo[];
  fields: Field[];
  trail: { file: string; every_nth_row: number; points: number };
  final_saved_time_Gyr: number;
  final_saved_radius_pc: number;
};
type Chunk = Record<string, Float64Array | Float32Array>;

const ELEV = (28 * Math.PI) / 180; // inclined view: camera 28° above the orbital plane
const LEVELS = [1800, 900, 450, 225, 112.5, 56.25, 28.125]; // field half-width, pc
const P_MIN = 36, P_MAX = 46; // jet brightness mapping, log10 erg/s
const TRAIL_ROWS = 150; // recent trail ≈ 1.5 orbits of recorded rows
const COL = {
  bg: '#090d12',
  primary: [255, 135, 101],
  primaryHot: [255, 214, 186],
  secondary: [131, 197, 223],
  secondaryHot: [214, 242, 255],
  text: '#c9d2ca',
  dim: '#8c98a3',
};

const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const niceStep = (x: number) => {
  const e = 10 ** Math.floor(Math.log10(x));
  const m = x / e;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
};
const fmtPc = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(2)} kpc` : `${+v.toFixed(v < 10 ? 1 : 0)} pc`);

export function initInspiral(fig: HTMLElement) {
  const $ = <T extends Element>(sel: string) => fig.querySelector<T>(sel)!;
  const base = fig.dataset.base!;
  const N = Number(fig.dataset.rows);
  const TMAX = Number(fig.dataset.tmax);

  const stage = $<HTMLDivElement>('[data-stage]');
  const canvas = $<HTMLCanvasElement>('[data-canvas]');
  const ctx = canvas.getContext('2d')!;
  const statusEl = $<HTMLElement>('[data-status]');
  const playBtn = $<HTMLButtonElement>('[data-play]');
  const slider = $<HTMLInputElement>('[data-timeline]');
  const speedSel = $<HTMLSelectElement>('[data-speed]');
  const viewSel = $<HTMLSelectElement>('[data-view]');
  const fieldSel = $<HTMLSelectElement>('[data-field]');
  const rateEl = $<HTMLElement>('[data-rate]');
  const liveEl = $<HTMLElement>('[data-live]');
  const cursors = Array.from(fig.querySelectorAll<SVGPathElement>('[data-cursor]'));
  const charts = Array.from(fig.querySelectorAll<SVGSVGElement>('[data-chart]'));
  const out = (k: string) => fig.querySelector<HTMLElement>(`[data-out="${k}"]`)!;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------------------------------------------------------------- state
  let meta: Meta | null = null;
  let trail: Float32Array | null = null; // x, y, z per point (pc)
  const chunks = new Map<number, Chunk>();
  const pending = new Map<number, Promise<Chunk>>();
  let rowPos = Number(fig.dataset.defaultRow); // fractional row index
  let playing = false;
  let lastFrame = 0;
  let view: 'inclined' | 'faceon' = 'inclined';
  let fieldMode: 'auto' | 'full' = 'auto';
  let level = 0; // index into LEVELS
  let H = LEVELS[0]; // current (animated) field half-width
  let zoomAnim: { from: number; to: number; start: number } | null = null;
  let zoomFlash = 0; // timestamp of last zoom change
  let lastShownRow = -1;
  let loadingStarted = false;
  let wantPlay = false;
  let W = 0, Hpx = 0, dpr = 1;

  // offscreen layers
  const bgLayer = document.createElement('canvas');
  const expLayer = document.createElement('canvas');
  const maskLayer = document.createElement('canvas'); // soft elliptical edge at the field radius
  const tmpLayer = document.createElement('canvas');
  let maskKey = '';
  let bgKey = '';
  let expKey = '';
  let expDrawn = 0; // number of trail points already accumulated

  // ---------------------------------------------------------------- data
  function loadChunk(ci: number): Promise<Chunk> {
    if (chunks.has(ci)) return Promise.resolve(chunks.get(ci)!);
    if (pending.has(ci)) return pending.get(ci)!;
    const info = meta!.chunks[ci];
    const p = fetch(base + info.file)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const c: Chunk = {};
        let off = 0;
        for (const f of meta!.fields) {
          const f64 = f.dtype.endsWith('8');
          c[f.name] = f64 ? new Float64Array(buf, off, info.rows) : new Float32Array(buf, off, info.rows);
          off += (f64 ? 8 : 4) * info.rows;
        }
        chunks.set(ci, c);
        pending.delete(ci);
        // keep memory bounded: drop far-away chunks
        if (chunks.size > 8) {
          const here = Math.floor(rowPos / meta!.chunk_rows);
          for (const k of chunks.keys()) if (Math.abs(k - here) > 3) chunks.delete(k);
        }
        return c;
      });
    pending.set(ci, p);
    return p;
  }

  function ensureChunks(row: number) {
    if (!meta) return;
    const ci = Math.floor(row / meta.chunk_rows);
    const need = [ci];
    const k = row - ci * meta.chunk_rows;
    if (k < TRAIL_ROWS + 2 && ci > 0) need.push(ci - 1);
    if (k > meta.chunk_rows - 2500 && ci < meta.chunks.length - 1) need.push(ci + 1); // prefetch ahead
    for (const c of need)
      if (!chunks.has(c) && !pending.has(c))
        loadChunk(c)
          .then(() => requestDraw())
          .catch(() => setStatus('Could not load recorded rows'));
  }

  function get(name: string, row: number): number | null {
    if (!meta) return null;
    const ci = Math.floor(row / meta.chunk_rows);
    const c = chunks.get(ci);
    if (!c) return null;
    return c[name][row - ci * meta.chunk_rows];
  }

  /** Position at a fractional row: interpolated between recorded rows k and k+1. */
  function position(pos: number): [number, number, number] | null {
    const k = Math.floor(pos);
    const u = pos - k;
    const r0 = get('r_pc', k), th0 = get('theta_rad', k), z0 = get('z_pc', k);
    if (r0 === null || th0 === null || z0 === null) return null;
    let r = r0, th = th0, z = z0;
    if (u > 0 && k + 1 < N) {
      const r1 = get('r_pc', k + 1), th1 = get('theta_rad', k + 1), z1 = get('z_pc', k + 1);
      if (r1 !== null && th1 !== null && z1 !== null) {
        let dth = th1 - th0;
        if (dth > Math.PI) dth -= 2 * Math.PI;
        if (dth < -Math.PI) dth += 2 * Math.PI;
        r = r0 + (r1 - r0) * u;
        th = th0 + dth * u;
        z = z0 + (z1 - z0) * u;
      }
    }
    return [r * Math.cos(th), r * Math.sin(th), z];
  }

  /** Nearest recorded trail point as a stand-in while a chunk is loading. */
  function approxPosition(pos: number): [number, number, number] | null {
    if (!trail || !meta) return null;
    const i = clamp(Math.round(pos / meta.trail.every_nth_row), 0, meta.trail.points - 1);
    return [trail[i * 3], trail[i * 3 + 1], trail[i * 3 + 2]];
  }

  function rowAtTime(t: number): number {
    // exact search inside the loaded chunk; chunk chosen from the index
    const m = meta!;
    let ci = m.chunks.findIndex((c) => c.t1_Gyr >= t);
    if (ci < 0) ci = m.chunks.length - 1;
    const c = chunks.get(ci);
    const info = m.chunks[ci];
    if (!c) {
      const f = info.t1_Gyr > info.t0_Gyr ? (t - info.t0_Gyr) / (info.t1_Gyr - info.t0_Gyr) : 0;
      return info.first_row + Math.round(clamp(f, 0, 1) * (info.rows - 1));
    }
    const ts = c.t_Gyr;
    let lo = 0, hi = info.rows - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return info.first_row + lo;
  }

  // ---------------------------------------------------------------- geometry
  const sinE = () => (view === 'inclined' ? Math.sin(ELEV) : 1);
  const cosE = () => (view === 'inclined' ? Math.cos(ELEV) : 0);
  function scaleFor(h: number) {
    const vert = view === 'inclined' ? 2 * h * Math.sin(ELEV) : 2 * h;
    return Math.min((W * 0.94) / (2 * h), (Hpx * (view === 'inclined' ? 0.74 : 0.9)) / vert);
  }
  const center = () => [W * 0.5, Hpx * (view === 'inclined' ? 0.54 : 0.5)] as const;
  function project(x: number, y: number, z: number, s: number, cx: number, cy: number) {
    return [cx + s * x, cy - s * (y * sinE() + z * cosE()), view === 'inclined' ? -y * Math.cos(ELEV) + z * Math.sin(ELEV) : z] as const;
  }

  function chooseLevel(pos: number) {
    if (fieldMode === 'full' || !trail || !meta) return 0;
    // largest radius over the last ~30 orbits and the next ~3 (recorded trail points)
    const step = meta.trail.every_nth_row;
    const i1 = Math.min(meta.trail.points - 1, Math.floor((pos + 300) / step));
    const i0 = Math.max(0, Math.floor((pos - 3000) / step));
    let rmax = 0;
    for (let i = i0; i <= i1; i++) {
      const x = trail[i * 3], y = trail[i * 3 + 1];
      rmax = Math.max(rmax, Math.hypot(x, y));
    }
    let L = 0;
    while (L + 1 < LEVELS.length && rmax <= 0.86 * LEVELS[L + 1]) L++;
    return L;
  }

  // ---------------------------------------------------------------- layers
  function sizeCanvas() {
    const rect = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    Hpx = rect.height;
    for (const c of [canvas, bgLayer, expLayer, maskLayer, tmpLayer]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(Hpx * dpr);
    }
    bgKey = expKey = maskKey = '';
  }

  /** Background, illustrative host light and the orbital-plane grid (cached per view/field). */
  function renderBackground(h: number) {
    const key = `${W}x${Hpx}|${view}|${h.toFixed(3)}`;
    if (key === bgKey) return;
    bgKey = key;
    const g = bgLayer.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = COL.bg;
    g.fillRect(0, 0, W, Hpx);
    const s = scaleFor(h);
    const [cx, cy] = center();

    // Illustrative host light: a smooth, featureless radial profile (a bright
    // nuclear concentration plus an exponential disk, ~1.2 kpc scale length).
    // It is NOT a density map from the simulation.
    const lw = Math.max(64, Math.round(W / 5)), lh = Math.max(40, Math.round(Hpx / 5));
    const off = document.createElement('canvas');
    off.width = lw;
    off.height = lh;
    const og = off.getContext('2d')!;
    const img = og.createImageData(lw, lh);
    for (let j = 0; j < lh; j++) {
      for (let i = 0; i < lw; i++) {
        const X = ((i + 0.5) / lw) * W, Y = ((j + 0.5) / lh) * Hpx;
        const x = (X - cx) / s;
        const y = -(Y - cy) / (s * sinE());
        const R = Math.hypot(x, y);
        const sigma = 0.55 * Math.exp(-R / 1200) + 0.45 / (1 + (R / 90) ** 1.4);
        const a = clamp(sigma, 0, 1);
        const p = (j * lw + i) * 4;
        // warm core fading to a cool outer disk
        img.data[p] = 96 + 92 * a;
        img.data[p + 1] = 98 + 52 * a;
        img.data[p + 2] = 120 + 4 * a;
        img.data[p + 3] = 255 * (0.03 + 0.15 * a ** 1.3);
      }
    }
    og.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(off, 0, 0, W, Hpx);

    // vignette for depth
    const vg = g.createRadialGradient(cx, cy, Math.min(W, Hpx) * 0.25, cx, cy, Math.max(W, Hpx) * 0.75);
    vg.addColorStop(0, 'rgba(9,13,18,0)');
    vg.addColorStop(1, 'rgba(4,6,9,0.75)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, Hpx);

    // orbital-plane grid: rings at round radii, far side dimmer (depth cue)
    const step = niceStep(h / 3);
    g.lineWidth = 1;
    g.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    for (let R = step; R <= h * 1.001; R += step) {
      const rx = R * s, ry = R * s * sinE();
      g.strokeStyle = 'rgba(160,184,205,0.10)';
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, Math.PI, 2 * Math.PI); // far half
      g.stroke();
      g.strokeStyle = 'rgba(160,184,205,0.2)';
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI); // near half
      g.stroke();
      g.fillStyle = 'rgba(190,205,215,0.6)';
      const lbl = fmtPc(R);
      const outermost = R + step > h * 1.001;
      // on narrow screens label only the outermost ring so labels never collide
      if ((W >= 600 || outermost) && cx + rx + 8 + g.measureText(lbl).width < W - 6) g.fillText(lbl, cx + rx + 5, cy - 4);
    }
    // x and y axes of the simulation's coordinate system
    const Rm = Math.floor(h / step) * step;
    g.strokeStyle = 'rgba(160,184,205,0.14)';
    g.setLineDash([2, 5]);
    g.beginPath();
    g.moveTo(cx - Rm * s, cy);
    g.lineTo(cx + Rm * s, cy);
    g.moveTo(cx, cy - Rm * s * sinE());
    g.lineTo(cx, cy + Rm * s * sinE());
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(190,205,215,0.55)';
    g.fillText('+x', cx + Rm * s - 14, cy + 14);
    g.fillText('+y', cx + 6, cy - Rm * s * sinE() + 4);
  }

  /**
   * Path followed so far, drawn like a long exposure: every 6th recorded position,
   * joined in short groups (about one orbit each) that add light where the orbit
   * lingers. Between samples the line follows r and θ linearly (one midpoint),
   * which keeps the ~0.37 rad steps from turning into visible chords.
   */
  let trR: Float32Array | null = null, trT: Float32Array | null = null;
  let expAlpha = 0.11;
  function renderExposure(h: number, row: number) {
    if (!trail || !meta) return;
    const n = meta.trail.points;
    if (!trR || !trT) {
      trR = new Float32Array(n);
      trT = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        trR[i] = Math.hypot(trail[i * 3], trail[i * 3 + 1]);
        trT[i] = Math.atan2(trail[i * 3 + 1], trail[i * 3]);
      }
    }
    const key = `${W}x${Hpx}|${view}|${h.toFixed(3)}`;
    const target = Math.min(n, Math.floor(row / meta.trail.every_nth_row) + 1);
    const g = expLayer.getContext('2d')!;
    if (key !== expKey || target < expDrawn) {
      expKey = key;
      expDrawn = 0;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, expLayer.width, expLayer.height);
    }
    if (target <= expDrawn + 1 && expDrawn > 0) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.lineJoin = 'round';
    const s = scaleFor(h);
    const [cx, cy] = center();
    const sE = sinE(), cE = cosE();
    const lim = h * 1.08;
    const GROUP = 17; // ≈ one orbit per stroke
    // Exposure control: the more recorded orbits fall inside the field, the fainter
    // each stroke, so dense late orbits read as a glow rather than a white-out.
    if (expDrawn === 0) {
      let inField = 0;
      for (let i = 0; i < target; i += 4) if (trR![i] < h) inField++;
      expAlpha = clamp(0.1 * Math.sqrt(1000 / Math.max(1, inField)), 0.016, 0.1);
    }
    const alpha = expAlpha;
    g.lineWidth = 0.9;
    const P = (x: number, y: number, z: number) => [cx + s * x, cy - s * (y * sE + z * cE)];
    const start = Math.max(0, expDrawn - 1);
    for (let a = start; a < target - 1; a += GROUP) {
      const b = Math.min(target - 1, a + GROUP);
      const f = a / n;
      g.strokeStyle = `rgba(${Math.round(58 + 70 * f)},${Math.round(104 + 90 * f)},${Math.round(168 + 62 * f)},${alpha})`;
      g.beginPath();
      let pen = false;
      for (let i = a; i < b; i++) {
        const x0 = trail[i * 3], y0 = trail[i * 3 + 1], z0 = trail[i * 3 + 2];
        const x1 = trail[i * 3 + 3], y1 = trail[i * 3 + 4], z1 = trail[i * 3 + 5];
        if (trR![i] > lim && trR![i + 1] > lim) { pen = false; continue; }
        let dt = trT[i + 1] - trT[i];
        if (dt > Math.PI) dt -= 2 * Math.PI;
        if (dt < -Math.PI) dt += 2 * Math.PI;
        const rm = (trR[i] + trR[i + 1]) / 2, tm = trT[i] + dt / 2;
        const p0 = P(x0, y0, z0), pm = P(rm * Math.cos(tm), rm * Math.sin(tm), (z0 + z1) / 2), p1 = P(x1, y1, z1);
        if (!pen) { g.moveTo(p0[0], p0[1]); pen = true; }
        g.lineTo(pm[0], pm[1]);
        g.lineTo(p1[0], p1[1]);
      }
      g.stroke();
    }
    expDrawn = target;
  }

  // ---------------------------------------------------------------- glyphs
  function glow(x: number, y: number, r: number, c: number[], a: number) {
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(c, a));
    gr.addColorStop(0.35, rgba(c, a * 0.35));
    gr.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }

  /** Illustrative two-sided jet along the orbital-plane normal; brightness = mapped power. */
  function jetHalf(x: number, y: number, dir: 1 | -1, len: number, I: number, c: number[], hot: number[], t: number, flow: boolean) {
    if (len < 2) return;
    const ex = x, ey = y - dir * len;
    // sheath: a slowly widening cone
    const w0 = 2.6, w1 = len * 0.11 + 4;
    // broad diffuse envelope
    const og = ctx.createLinearGradient(x, y, ex, ey);
    og.addColorStop(0, rgba(c, 0.16 * I));
    og.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = og;
    ctx.beginPath();
    ctx.moveTo(x - w0 * 2, y);
    ctx.lineTo(ex - w1 * 2.2, ey);
    ctx.lineTo(ex + w1 * 2.2, ey);
    ctx.lineTo(x + w0 * 2, y);
    ctx.closePath();
    ctx.fill();
    const sg = ctx.createLinearGradient(x, y, ex, ey);
    sg.addColorStop(0, rgba(c, 0.34 * I));
    sg.addColorStop(0.55, rgba(c, 0.12 * I));
    sg.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(x - w0, y);
    ctx.quadraticCurveTo(x - w1 * 0.7, y - dir * len * 0.55, ex - w1, ey);
    ctx.lineTo(ex + w1, ey);
    ctx.quadraticCurveTo(x + w1 * 0.7, y - dir * len * 0.55, x + w0, y);
    ctx.closePath();
    ctx.fill();
    // spine
    const lg = ctx.createLinearGradient(x, y, ex, ey);
    lg.addColorStop(0, rgba(hot, 0.95 * I));
    lg.addColorStop(0.4, rgba(c, 0.55 * I));
    lg.addColorStop(1, rgba(c, 0));
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // bright base where the jet leaves the nucleus
    glow(x, y - dir * 10, 16, hot, 0.35 * I);
    // flowing texture (illustrative), only while playing
    if (flow) {
      ctx.setLineDash([3, 13]);
      ctx.lineDashOffset = -((t * 0.045) % 16);
      ctx.strokeStyle = lg;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  function jetEndOn(x: number, y: number, I: number, c: number[], hot: number[], big: boolean) {
    // face-on: jets point at / away from the viewer; show only a bloom
    glow(x, y, (big ? 34 : 24) * (0.5 + 0.5 * I), c, 0.45 * I);
    glow(x, y, (big ? 10 : 7), hot, 0.6 * I);
  }

  function nucleus(x: number, y: number, big: boolean, c: number[], hot: number[], powerOn: boolean) {
    const rx = big ? 12 : 9;
    if (!big) {
      // a soft dark halo separates the secondary from the bright path behind it
      ctx.globalCompositeOperation = 'source-over';
      const hg = ctx.createRadialGradient(x, y, 0, x, y, 22);
      hg.addColorStop(0, 'rgba(6,9,13,0.85)');
      hg.addColorStop(1, 'rgba(6,9,13,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(x - 22, y - 22, 44, 44);
      ctx.globalCompositeOperation = 'lighter';
    }
    const ry = rx * sinE();
    glow(x, y, big ? 30 : 20, c, powerOn ? 0.5 : 0.22);
    // accretion-disk glyph in the orbital plane (illustrative, not to scale)
    const dg = ctx.createLinearGradient(x - rx, y, x + rx, y);
    dg.addColorStop(0, rgba(c, 0.25));
    dg.addColorStop(0.5, rgba(hot, 0.95));
    dg.addColorStop(1, rgba(c, 0.25));
    ctx.strokeStyle = dg;
    ctx.lineWidth = big ? 2.2 : 1.7;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, Math.max(ry, 1.2), 0, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#050608';
    ctx.beginPath();
    ctx.arc(x, y, big ? 3.4 : 2.4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = rgba(hot, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
  }

  const intensity = (P: number) => (P > 0 ? clamp((Math.log10(P) - P_MIN) / (P_MAX - P_MIN), 0.05, 1) : 0);

  // ---------------------------------------------------------------- HUD
  function hudText(txt: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left') {
    ctx.textAlign = align;
    ctx.save();
    ctx.shadowColor = 'rgba(5,8,12,0.95)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = color;
    ctx.fillText(txt, x, y);
    ctx.restore();
  }

  function drawHud(now: number, P1: number | null, P2: number | null) {
    ctx.globalCompositeOperation = 'source-over';
    const small = W < 520;
    ctx.font = `${small ? 9 : 10}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    const pad = small ? 10 : 16;
    const viewTxt = view === 'inclined' ? 'INCLINED VIEW · 28° ABOVE ORBITAL PLANE · ORTHOGRAPHIC' : 'FACE-ON VIEW · x–y ORBITAL PLANE';
    hudText(small && view === 'inclined' ? 'INCLINED 28° · ORTHOGRAPHIC' : viewTxt, pad, pad + 8, COL.dim);

    // zoom badge — flashes when the field changes
    const zoom = LEVELS[0] / LEVELS[level];
    const badge = `FIELD ±${fmtPc(LEVELS[level])} · ${fieldMode === 'full' ? 'FIXED' : `ZOOM ×${zoom}`}`;
    const flash = clamp(1 - (now - zoomFlash) / 2200, 0, 1);
    ctx.font = `${small ? 9 : 10}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    const bw = ctx.measureText(badge).width + 14;
    ctx.fillStyle = `rgba(215,53,39,${0.15 + 0.7 * flash})`;
    ctx.fillRect(pad, pad + 16, bw, 18);
    hudText(badge, pad + 7, pad + 29, flash > 0.05 ? '#ffffff' : '#e3e7e2');

    // scale bar (valid along the horizontal axis)
    const s = scaleFor(H);
    const barPc = niceStep(H / 3.5);
    const bx = pad, by = Hpx - pad - 18;
    ctx.strokeStyle = '#d7dde0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + barPc * s, by);
    ctx.lineTo(bx + barPc * s, by - 4);
    ctx.stroke();
    hudText(fmtPc(barPc) + (view === 'inclined' ? ' (horizontal)' : ''), bx, by + 14, '#d7dde0');

    if (!small) hudText('Recorded positions · illustrative light, disks and jets', W - pad, Hpx - pad, COL.dim, 'right');

    // jet-brightness legend: the declared mapping, with current values marked
    const lw = small ? 110 : 150, lx = W - pad - lw, ly = pad + 8;
    hudText('JET BRIGHTNESS ∝ log₁₀ P', W - pad, ly, COL.dim, 'right');
    const lg = ctx.createLinearGradient(lx, 0, lx + lw, 0);
    lg.addColorStop(0, 'rgba(240,240,230,0.08)');
    lg.addColorStop(1, 'rgba(240,240,230,0.95)');
    ctx.fillStyle = lg;
    ctx.fillRect(lx, ly + 10, lw, 5);
    hudText(`${P_MIN}`, lx, ly + 29, COL.dim);
    hudText(`${P_MAX} erg s⁻¹`, lx + lw, ly + 29, COL.dim, 'right');
    const mark = (P: number | null, c: number[], label: string, row: number) => {
      if (P === null) return;
      const yy = ly + 42 + row * 13;
      if (P === 0) {
        hudText(`${label} · jet off (P = 0)`, W - pad, yy, rgba(c, 1), 'right');
        return;
      }
      const lp = Math.log10(P);
      const f = clamp((lp - P_MIN) / (P_MAX - P_MIN), 0, 1);
      ctx.fillStyle = rgba(c, 1);
      ctx.fillRect(lx + f * lw - 1, ly + 6, 2, 13);
      hudText(`${label} ${lp.toFixed(1)}${lp < P_MIN ? ' (below scale)' : lp > P_MAX ? ' (above scale)' : ''}`, W - pad, yy, rgba(c, 1), 'right');
    };
    mark(P1, COL.primary, 'primary', 0);
    mark(P2, COL.secondary, 'secondary', 1);
  }

  // ---------------------------------------------------------------- frame
  function draw(now = performance.now()) {
    if (!W || !Hpx) return;
    // animated zoom (log-space)
    if (zoomAnim) {
      const dur = reduceMotion.matches ? 0 : 900;
      const f = dur ? clamp((now - zoomAnim.start) / dur, 0, 1) : 1;
      const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      H = Math.exp(Math.log(zoomAnim.from) + (Math.log(zoomAnim.to) - Math.log(zoomAnim.from)) * e);
      if (f >= 1) {
        H = zoomAnim.to;
        zoomAnim = null;
      }
    }
    const row = Math.min(N - 1, Math.floor(rowPos));
    const settled = !zoomAnim;
    renderBackground(H);
    if (settled) renderExposure(H, row);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(bgLayer, 0, 0, W, Hpx);
    if (settled) {
      // the path-so-far fades out at the edge of the field (radius = field half-width)
      const mk = `${W}x${Hpx}|${view}|${H.toFixed(3)}`;
      if (mk !== maskKey) {
        maskKey = mk;
        const m = maskLayer.getContext('2d')!;
        m.setTransform(dpr, 0, 0, dpr, 0, 0);
        m.clearRect(0, 0, W, Hpx);
        const [mcx, mcy] = center();
        const R = H * scaleFor(H);
        m.translate(mcx, mcy);
        m.scale(1, sinE());
        const mg = m.createRadialGradient(0, 0, R * 0.8, 0, 0, R);
        mg.addColorStop(0, 'rgba(0,0,0,1)');
        mg.addColorStop(1, 'rgba(0,0,0,0)');
        m.fillStyle = mg;
        m.beginPath();
        m.arc(0, 0, R, 0, 2 * Math.PI);
        m.fill();
      }
      const t2 = tmpLayer.getContext('2d')!;
      t2.setTransform(1, 0, 0, 1, 0, 0);
      t2.globalCompositeOperation = 'copy';
      t2.drawImage(expLayer, 0, 0);
      t2.globalCompositeOperation = 'destination-in';
      t2.drawImage(maskLayer, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(tmpLayer, 0, 0, W, Hpx);
    }

    const s = scaleFor(H);
    const [cx, cy] = center();
    const pos = position(rowPos) ?? approxPosition(rowPos);
    const exact = position(rowPos) !== null;
    const P1raw = get('P1_1e30erg_s', row), P2raw = get('P2_1e30erg_s', row);
    const P1 = P1raw === null ? null : P1raw * 1e30;
    const P2 = P2raw === null ? null : P2raw * 1e30;
    const flow = playing && !reduceMotion.matches;

    ctx.globalCompositeOperation = 'lighter';
    // recent trail (every recorded row), split by depth so it passes behind/in front of the primary
    const segs: { x0: number; y0: number; x1: number; y1: number; a: number; d: number }[] = [];
    if (exact) {
      const k0 = Math.max(0, row - TRAIL_ROWS);
      let prev: readonly number[] | null = null;
      for (let k = k0; k <= row + 1; k++) {
        const p = k <= row ? position(k) : pos;
        if (!p) {
          prev = null;
          continue;
        }
        const q = project(p[0], p[1], p[2], s, cx, cy);
        if (prev) segs.push({ x0: prev[0], y0: prev[1], x1: q[0], y1: q[1], a: (k - k0) / (TRAIL_ROWS + 1), d: q[2] });
        prev = q;
      }
    }
    const drawSegs = (front: boolean) => {
      ctx.lineCap = 'round';
      // dark underlay so the current orbit reads against the accumulated path
      ctx.globalCompositeOperation = 'source-over';
      for (const sg of segs) {
        if (sg.d >= 0 !== front) continue;
        ctx.strokeStyle = `rgba(6,9,13,${0.55 * sg.a ** 1.2})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(sg.x0, sg.y0);
        ctx.lineTo(sg.x1, sg.y1);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const sg of segs) {
        if (sg.d >= 0 !== front) continue;
        const a = sg.a ** 1.6;
        ctx.strokeStyle = rgba(COL.secondary, 0.1 * a);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(sg.x0, sg.y0);
        ctx.lineTo(sg.x1, sg.y1);
        ctx.stroke();
        ctx.strokeStyle = rgba(COL.secondaryHot, 0.85 * a);
        ctx.lineWidth = 0.6 + 1.3 * a;
        ctx.beginPath();
        ctx.moveTo(sg.x0, sg.y0);
        ctx.lineTo(sg.x1, sg.y1);
        ctx.stroke();
      }
    };

    const jetLen = Math.min(Hpx * 0.34, 200) * cosE();
    const I1 = P1 === null ? 0 : intensity(P1);
    const I2 = P2 === null ? 0 : intensity(P2);
    const bodies = [
      { x: cx, y: cy, d: 0, big: true, c: COL.primary, hot: COL.primaryHot, I: I1, P: P1, len: jetLen },
    ];
    if (pos) {
      const q = project(pos[0], pos[1], pos[2], s, cx, cy);
      bodies.push({ x: q[0], y: q[1], d: q[2], big: false, c: COL.secondary, hot: COL.secondaryHot, I: I2, P: P2, len: jetLen * 0.72 });
    }
    // Draw order approximates depth: back jets → trail behind the primary → bodies
    // (secondary before the primary when it is farther away) → trail in front → front jets.
    const [prim, sec] = bodies;
    if (view === 'inclined') for (const b of bodies) if (b.I > 0) jetHalf(b.x, b.y, -1, b.len, b.I * 0.8, b.c, b.hot, now, flow);
    drawSegs(false);
    const drawBody = (b: (typeof bodies)[number]) => {
      if (view === 'faceon' && b.I > 0) jetEndOn(b.x, b.y, b.I, b.c, b.hot, b.big);
      nucleus(b.x, b.y, b.big, b.c, b.hot, (b.P ?? 0) > 0);
    };
    if (sec && sec.d < 0) drawBody(sec);
    drawBody(prim);
    drawSegs(true);
    if (sec && sec.d >= 0) drawBody(sec);
    if (view === 'inclined') for (const b of bodies) if (b.I > 0) jetHalf(b.x, b.y, 1, b.len, b.I, b.c, b.hot, now, flow);

    // labels and zero-power marks
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `600 11px Arial, Helvetica, sans-serif`;
    for (const b of bodies) {
      const lbl = b.big ? 'PRIMARY' : 'SECONDARY';
      const dx = b.big ? 16 : b.x > cx ? 14 : -14;
      hudText(lbl, b.x + dx, b.y + (b.big ? 18 : -10), '#e6ebe8', b.big || b.x > cx ? 'left' : 'right');
      if (b.P === 0) {
        ctx.strokeStyle = '#f0f1e9';
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.big ? 18 : 13, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        hudText('jet off · P = 0', b.x + dx, b.y + (b.big ? 31 : 4), '#f0f1e9', b.big || b.x > cx ? 'left' : 'right');
        ctx.font = `600 11px Arial, Helvetica, sans-serif`;
      }
    }
    if (row >= N - 1) {
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      hudText(`END OF RECORD · ${meta ? meta.final_saved_radius_pc.toFixed(2) : ''} pc · NO MERGER SHOWN`, W / 2, Hpx - 44, '#ffcd9e', 'center');
    }
    drawHud(now, P1, P2);
    updateReadouts(row);
  }

  // ---------------------------------------------------------------- readouts
  let liveTimer = 0;
  function updateReadouts(row: number) {
    if (row === lastShownRow) return;
    const t = get('t_Gyr', row);
    if (t === null) return;
    lastShownRow = row;
    const r = get('r_pc', row)!, z = get('z_pc', row)!;
    const M1 = get('M1_Msun', row)!, M2 = get('M2_Msun', row)!;
    const P1 = get('P1_1e30erg_s', row)! * 1e30, P2 = get('P2_1e30erg_s', row)! * 1e30;
    out('time').textContent = t.toFixed(4);
    out('row').textContent = `row ${(row + 1).toLocaleString('en-US')} of ${N.toLocaleString('en-US')}`;
    out('radius').textContent = fmtR(r);
    out('z').textContent = `z = ${(Math.abs(z) < 0.005 ? 0 : z).toFixed(2)} pc`;
    out('mass').textContent = sci(M2);
    out('mass1').textContent = `primary ${sci(M1)} M☉`;
    out('power').textContent = sci(P2);
    out('power1').textContent = `primary ${sci(P1)} erg s⁻¹`;
    const frac = t / TMAX;
    for (const c of cursors) {
      const d = c.getAttribute('d')!;
      c.setAttribute('d', d.replace(/^M[\d.]+/, `M${(44 + frac * (388 - 44)).toFixed(2)}`));
    }
    if (!sliderActive) slider.value = String(Math.round(t * 10000));
    slider.setAttribute('aria-valuetext', `${t.toFixed(3)} billion years, radius ${fmtR(r)} parsecs`);
    // simulated time per second of playback at this point in the run
    const k0 = Math.max(0, row - 50), k1 = Math.min(N - 1, row + 50);
    const ta = get('t_Gyr', k0), tb = get('t_Gyr', k1);
    if (ta !== null && tb !== null && k1 > k0) {
      const myrPerRow = ((tb - ta) / (k1 - k0)) * 1000;
      const sp = Number(speedSel.value);
      const rate = myrPerRow * sp;
      rateEl.textContent = `Playback here ≈ ${rate >= 1 ? rate.toFixed(2) : (rate * 1000).toFixed(0) + ' k'}${rate >= 1 ? ' Myr' : 'yr'} per second · ${(sp / 100).toFixed(2)} orbit/s`;
    }
    clearTimeout(liveTimer);
    if (!playing)
      liveTimer = window.setTimeout(() => {
        liveEl.textContent = `${t.toFixed(3)} billion years. Radius ${fmtR(r)} parsecs. Secondary jet power ${P2 === 0 ? 'zero' : sci(P2).replace('×10', ' times ten to the ')} erg per second.`;
      }, 500);
  }

  // ---------------------------------------------------------------- loop
  let rafPending = false;
  function requestDraw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame((now) => {
      rafPending = false;
      draw(now);
      if (zoomAnim || playing || now - zoomFlash < 2300) requestDraw();
    });
  }

  function setLevel(L: number, animate: boolean) {
    if (L === level && !zoomAnim) return;
    const from = H;
    level = L;
    zoomFlash = performance.now();
    if (animate && !reduceMotion.matches) zoomAnim = { from, to: LEVELS[L], start: performance.now() };
    else {
      H = LEVELS[L];
      zoomAnim = null;
    }
  }

  function goToRow(r: number, animateZoom = false) {
    rowPos = clamp(r, 0, N - 1);
    ensureChunks(Math.floor(rowPos));
    setLevel(chooseLevel(rowPos), animateZoom);
    requestDraw();
  }

  function tick(now: number) {
    if (!playing) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const ci = Math.floor(rowPos / meta!.chunk_rows);
    if (chunks.has(ci)) {
      rowPos = Math.min(N - 1, rowPos + Number(speedSel.value) * dt);
      setStatus('');
    } else setStatus('Loading recorded rows…');
    ensureChunks(Math.floor(rowPos));
    const L = chooseLevel(rowPos);
    if (L !== level && !zoomAnim) setLevel(L, true);
    draw(now);
    if (rowPos >= N - 1) stop();
    else requestAnimationFrame(tick);
  }

  function play() {
    if (!meta) {
      wantPlay = true;
      startLoading();
      setStatus('Loading recorded rows…');
      return;
    }
    if (rowPos >= N - 1) goToRow(0);
    playing = true;
    playBtn.textContent = 'Ⅱ Pause';
    playBtn.setAttribute('aria-pressed', 'true');
    lastFrame = performance.now();
    requestAnimationFrame(tick);
  }
  function stop() {
    playing = false;
    playBtn.textContent = '▶ Play';
    playBtn.setAttribute('aria-pressed', 'false');
    lastShownRow = -1;
    requestDraw();
  }

  function setStatus(s: string) {
    statusEl.textContent = s;
  }

  // ---------------------------------------------------------------- controls
  let sliderActive = false;
  playBtn.addEventListener('click', () => (playing ? stop() : play()));
  slider.addEventListener('input', () => {
    sliderActive = true;
    if (playing) stop();
    const t = Number(slider.value) / 10000;
    if (slider.value === slider.max) {
      // the slider's last step is the final saved row itself
      goToRow(N - 1);
      return;
    }
    goToRow(rowAtTime(t));
    // refine once the chunk for this time is loaded
    const ci = meta!.chunks.findIndex((c) => c.t1_Gyr >= t);
    loadChunk(ci < 0 ? meta!.chunks.length - 1 : ci).then(() => {
      if (Math.abs(Number(slider.value) / 10000 - t) < 1e-9) goToRow(rowAtTime(t));
    });
  });
  slider.addEventListener('change', () => (sliderActive = false));
  slider.addEventListener('blur', () => (sliderActive = false));
  speedSel.addEventListener('change', () => {
    lastShownRow = -1;
    requestDraw();
  });
  viewSel.addEventListener('change', () => {
    view = viewSel.value as typeof view;
    bgKey = expKey = maskKey = '';
    requestDraw();
  });
  fieldSel.addEventListener('change', () => {
    fieldMode = fieldSel.value as typeof fieldMode;
    setLevel(chooseLevel(rowPos), true);
    requestDraw();
  });
  fig.querySelectorAll<HTMLButtonElement>('[data-jump-t],[data-jump-row]').forEach((b) =>
    b.addEventListener('click', () => {
      if (playing) stop();
      if (b.dataset.jumpRow) {
        goToRow(Number(b.dataset.jumpRow), true);
        return;
      }
      const t = Number(b.dataset.jumpT);
      const ci = Math.max(0, meta!.chunks.findIndex((c) => c.t1_Gyr >= t));
      loadChunk(ci).then(() => goToRow(rowAtTime(t), true));
    }),
  );
  // click / drag on the history plots to jump in time
  for (const svg of charts) {
    const pick = (e: PointerEvent) => {
      if (!meta) return;
      const rect = svg.getBoundingClientRect();
      const xv = ((e.clientX - rect.left) / rect.width) * 400;
      const t = clamp((xv - 44) / (388 - 44), 0, 1) * TMAX;
      if (playing) stop();
      const ci = Math.max(0, meta.chunks.findIndex((c) => c.t1_Gyr >= t));
      loadChunk(ci).then(() => goToRow(rowAtTime(t)));
      goToRow(rowAtTime(t));
    };
    svg.addEventListener('pointerdown', (e) => {
      pick(e);
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (svg.hasPointerCapture(e.pointerId)) pick(e);
    });
  }
  // keyboard shortcut on the scene: space toggles playback when the slider has focus
  slider.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      playing ? stop() : play();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) stop();
  });

  // ---------------------------------------------------------------- boot
  new ResizeObserver(() => {
    sizeCanvas();
    requestDraw();
  }).observe(stage);

  function startLoading() {
    if (loadingStarted) return;
    loadingStarted = true;
    setStatus('Loading recorded data…');
    fetch(base + 'meta.json')
      .then((r) => r.json())
      .then(async (m: Meta) => {
        meta = m;
        const tb = await fetch(base + m.trail.file).then((r) => r.arrayBuffer());
        trail = new Float32Array(tb);
        await loadChunk(Math.floor(rowPos / m.chunk_rows));
        if (rowPos % m.chunk_rows < TRAIL_ROWS + 2 && rowPos >= m.chunk_rows) await loadChunk(Math.floor(rowPos / m.chunk_rows) - 1);
        level = chooseLevel(rowPos);
        H = LEVELS[level];
        for (const el of fig.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('[disabled]')) el.disabled = false;
        sizeCanvas();
        stage.classList.add('is-live');
        setStatus('');
        lastShownRow = -1;
        requestDraw();
        if (wantPlay) play();
      })
      .catch(() => setStatus('Interactive data unavailable — showing the still frame'));
  }

  playBtn.disabled = false; // Play can be pressed before data arrives; it starts loading
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          startLoading();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(fig);
  } else startLoading();
}
