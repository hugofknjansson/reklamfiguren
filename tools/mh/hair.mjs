// Hair cap, scalp strands and brows on the MakeHuman head.
import { Grid, surfaceVoxels, solidFromSurface, signedDistance, sampler, blur } from './field.mjs';

const { abs, min, max, sin, cos, sqrt, PI } = Math;
const clamp = (v, a, b) => max(a, min(b, v));
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hash = (x, y, z) => { const s = sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  let v = 0;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) v += hash(ix + i, iy + j, iz + k) * (i ? ux : 1 - ux) * (j ? uy : 1 - uy) * (k ? uz : 1 - uz);
  return v * 2 - 1;
}
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function buildHead(body, tris, eyeTris, log) {
  const skinIds = [...new Set(tris.flat())];
  const R = body.joints['head'].R;
  const ex = [], n = body.eyes.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += body.eyes[i * 3]; cy += body.eyes[i * 3 + 1]; cz += body.eyes[i * 3 + 2]; }
  const eyeMid = [cx / n, cy / n, cz / n];
  const ax = [R[0][0], R[1][0], R[2][0]], ay = [R[0][1], R[1][1], R[2][1]], az = [R[0][2], R[1][2], R[2][2]];
  const origin = add(add(eyeMid, mul(ay, 0.009)), mul(az, -0.0705));
  const toL = p => { const q = sub(p, origin); return [dot(q, ax), dot(q, ay), dot(q, az)]; };
  const toW = l => add(origin, add(add(mul(ax, l[0]), mul(ay, l[1])), mul(az, l[2])));
  const dirW = l => add(add(mul(ax, l[0]), mul(ay, l[1])), mul(az, l[2]));
  // eye centres and radius (each eye separately)
  const eyes = [1, -1].map(s => {
    let c = [0, 0, 0], k = 0;
    for (let i = 0; i < n; i++) if ((body.eyes[i * 3] - eyeMid[0]) * s > 0) { c = add(c, [body.eyes[i * 3], body.eyes[i * 3 + 1], body.eyes[i * 3 + 2]]); k++; }
    c = mul(c, 1 / k);
    let r = 0;
    for (let i = 0; i < n; i++) if ((body.eyes[i * 3] - eyeMid[0]) * s > 0) r = max(r, Math.hypot(body.eyes[i * 3] - c[0], body.eyes[i * 3 + 1] - c[1], body.eyes[i * 3 + 2] - c[2]));
    const ds = [];
    for (let i = 0; i < n; i++) if ((body.eyes[i * 3] - eyeMid[0]) * s > 0) ds.push(Math.hypot(body.eyes[i * 3] - c[0], body.eyes[i * 3 + 1] - c[1], body.eyes[i * 3 + 2] - c[2]));
    ds.sort((x, y) => x - y);
    return { c, r, rm: ds[ds.length >> 1], l: toL(c) };
  });

  const lo = sub(origin, [0.15, 0.2, 0.15]), hi = add(origin, [0.15, 0.17, 0.17]);
  const G = new Grid(lo, hi, 0.002);
  const S = surfaceVoxels(G, body.v, tris);
  const S2 = surfaceVoxels(G, body.eyes, eyeTris);
  for (let q = 0; q < G.size; q++) S[q] |= S2[q];
  // flood from everywhere except the bottom face, where the neck leaves the box
  const DIL = 2;
  for (let it = 0; it < DIL; it++) {
    const T = Uint8Array.from(S), [nx, ny] = G.n;
    for (let q = 0; q < G.size; q++) if (T[q]) for (const o of [1, -1, nx, -nx, nx * ny, -nx * ny]) { const r = q + o; if (r >= 0 && r < G.size) S[r] = 1; }
  }
  const sol = solidFromSurfaceTopOpen(G, S, Math.ceil((origin[1] - 0.075 - lo[1]) / G.h));
  const raw = blur(G, signedDistance(G, sol), 1);
  for (let q = 0; q < raw.length; q++) raw[q] += DIL * G.h;
  const sd = sampler(G, raw);
  log('head field');
  const headL = (a, b, c) => { const w = toW([a, b, c]); return sd(w[0], w[1], w[2]); };

  function hairline(a, b, c) {
    const A = abs(a);
    if (A > 0.064 && b > -0.055 && b < 0.03 && c > -0.045 && c < 0.026) return 99;
    const back = -0.072 + clamp((c + 0.1) / 0.13, 0, 1) * 0.05;
    let front = 0.056 + 0.016 * smoothstep(0.022, 0.052, A) - max(0, A - 0.058) * 3.2;
    front = max(front, -0.026);
    const t = smoothstep(0.0, 0.05, c);
    let line = back + (front - back) * t;
    if (A > 0.058 && c > -0.005 && c < 0.035) line = min(line, -0.026);
    return line;
  }
  const volume = (a, b, c) => 0.0045 + 0.008 * smoothstep(0.0, 0.075, b) + 0.004 * smoothstep(0.03, 0.08, c) * smoothstep(0.04, 0.08, b);
  const thickness = (a, b, c) => smoothstep(0, 0.02, b - hairline(a, b, c)) * volume(a, b, c);
  const capL = (a, b, c) => headL(a, b, c) - smoothstep(-0.004, 0.012, b - hairline(a, b, c)) * (volume(a, b, c) + 0.0035) + 0.004 - 0.0007 * vnoise(a * 400, b * 400, c * 400);
  const hairCap = (x, y, z) => { const [a, b, c] = toL([x, y, z]); return capL(a, b, c); };

  const grad = (f, p, e = 0.0006) => norm([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);
  const toSurface = (p, off) => { for (let i = 0; i < 6; i++) { const d = headL(...p) - off, g = grad(headL, p); p = sub(p, mul(g, d)); } return p; };
  const PART = 0.03;
  const growth = ([a, b, c]) => {
    const side = a > PART ? 1 : -1;
    if (b > 0.03) { const front = smoothstep(0.03, 0.085, c); return norm([side * (0.35 + 0.35 * front), 0.2 + 0.5 * front, -0.9 + 0.4 * front]); }
    return norm([side * 0.15, -0.8, -0.55]);
  };

  function strands() {
    const Rn = rng(11), out = { pos: [], nrm: [], uv: [], col: [], idx: [] };
    const card = (path, normals, width, shade, kind) => {
      const base = out.pos.length / 3, m = path.length;
      for (let i = 0; i < m; i++) {
        const t = i / (m - 1), dir = norm(sub(path[min(i + 1, m - 1)], path[max(i - 1, 0)]));
        const sd2 = norm(cross(dir, normals[i])), w = width * (1 - 0.65 * t);
        for (const sg of [-1, 1]) {
          out.pos.push(...toW(add(path[i], mul(sd2, sg * w / 2)))); out.nrm.push(...dirW(normals[i]));
          out.uv.push(sg < 0 ? kind : kind + 0.25, t);
          const cc = shade * (0.55 + 0.45 * t); out.col.push(cc, cc, cc);
        }
        if (i < m - 1) { const k = base + i * 2; out.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
    };
    let made = 0, tries = 0;
    while (made < 6500 && tries < 90000) {
      tries++;
      const th = Rn() * 2 * PI, ph = Math.acos(1 - 1.7 * Rn());
      let p = toSurface([sin(ph) * cos(th) * 0.1, cos(ph) * 0.1, sin(ph) * sin(th) * 0.1], 0);
      const [a, b, c] = p;
      if (b - hairline(a, b, c) < 0.002 || (abs(a - PART) < 0.0025 && b > 0.06)) continue;
      const top = smoothstep(-0.01, 0.05, b), L = (0.01 + 0.024 * top) * (0.8 + 0.4 * Rn());
      const segs = 5, path = [], nrms = [];
      let q = p, dir = growth(p);
      for (let i = 0; i < segs; i++) {
        const t = i / (segs - 1), off = 0.0012 + thickness(a, b, c) + 0.003 * t * top;
        q = toSurface(q, off);
        const nn = grad(headL, q);
        path.push(q); nrms.push(nn);
        dir = norm(sub(dir, mul(nn, dot(dir, nn))));
        dir = norm(add(dir, [0.15 * (Rn() - 0.5), -0.12 * t * (1 - top), 0.15 * (Rn() - 0.5)]));
        q = add(q, mul(dir, L / (segs - 1)));
      }
      card(path, nrms, 0.0045 + 0.002 * Rn(), 0.8 + 0.2 * Rn(), 0);
      made++;
    }
    for (const E of eyes) {
      const s = E.l[0] > 0 ? 1 : -1;
      for (let i = 0; i < 480; i++) {
        const t = Rn();
        const a = E.l[0] + s * (-0.019 + 0.043 * t), b = E.l[1] + 0.0215 + 0.0035 * sin(t * PI) - 0.005 * t * t + (Rn() - 0.5) * 0.0065 * (1 - 0.55 * t);
        const path = [], nrms = [];
        let q = toSurface([a, b, E.l[2] + 0.03], 0), dir = norm([s * (0.4 + 0.6 * t), 0.5 - 0.6 * t, -0.1]);
        for (let k = 0; k < 3; k++) {
          q = toSurface(q, 0.0016 + 0.0005 * k);
          const nn = grad(headL, q); path.push(q); nrms.push(nn);
          dir = norm(sub(dir, mul(nn, dot(dir, nn)))); q = add(q, mul(dir, 0.0045));
        }
        card(path, nrms, 0.0026, 0.5 + 0.2 * Rn(), 0);
      }
    }
    for (const E of eyes) {
      const s = E.l[0] > 0 ? 1 : -1, bins = new Map();
      for (const i of skinIds) {
        const l = toL([body.v[i * 3], body.v[i * 3 + 1], body.v[i * 3 + 2]]);
        const d = Math.hypot(l[0] - E.l[0], l[1] - E.l[1], l[2] - E.l[2]);
        if (d > E.rm + 0.0045 || l[2] < E.l[2] || l[1] < E.l[1] - 0.001) continue;
        const ang = Math.atan2(l[1] - E.l[1], (l[0] - E.l[0]) * s), k = Math.round(ang * 30);
        if (ang < 0.15 || ang > PI - 0.15) continue;
        const prev = bins.get(k);
        if (!prev || l[1] < prev[1]) bins.set(k, l);
      }
      const roots = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
      for (let r = 0; r + 1 < roots.length; r++) for (let j = 0; j < 3; j++) {
        const t = j / 3, root = add(roots[r], mul(sub(roots[r + 1], roots[r]), t)), u = (r + t) / roots.length;
        const outD = norm(add(mul(norm(sub(root, E.l)), 0.35), [s * (u - 0.5) * 0.3, 0.12, 1])), up = [0, 1, 0.1];
        const L = 0.0045 + 0.0035 * sin(u * PI);
        const path = [root, add(root, mul(outD, L * 0.5)), add(add(root, mul(outD, L * 0.8)), mul(up, L * 0.45))];
        const nn = norm(cross(norm(sub(path[2], path[0])), [s, 0, 0]));
        card(path, [nn, nn, nn], 0.0009, 0.22, 0);
      }
    }
    return out;
  }
  // ---------- skin colour ----------
  let noseTip = null, slit = null;
  for (const i of skinIds) {
    const l = toL([body.v[i * 3], body.v[i * 3 + 1], body.v[i * 3 + 2]]);
    if (abs(l[0]) < 0.006 && l[1] < eyes[0].l[1] && l[1] > eyes[0].l[1] - 0.07 && (!noseTip || l[2] > noseTip[2])) noseTip = l;
  }
  for (const i of skinIds) {
    const l = toL([body.v[i * 3], body.v[i * 3 + 1], body.v[i * 3 + 2]]);
    if (abs(l[0]) < 0.004 && l[1] < noseTip[1] - 0.025 && l[1] > noseTip[1] - 0.04 && l[2] > noseTip[2] - 0.04 && (!slit || l[2] < slit[2])) slit = l;
  }
  const toLin = c => (c / 255) ** 2.2, rgb = (r, g, b) => [r, g, b].map(toLin);
  const SKIN = rgb(198, 140, 108), SKIN2 = rgb(212, 158, 124), RED = rgb(196, 106, 92), LIP = rgb(170, 98, 90), STUB = rgb(118, 96, 90), UNDER = rgb(160, 112, 98);
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t, 0, 1));
  const g2 = (x, y, sx, sy) => Math.exp(-((x / sx) ** 2 + (y / sy) ** 2));
  function skinColor(x, y, z) {
    let col = mix(SKIN, SKIN2, 0.5 + 0.5 * vnoise(x * 35, y * 35, z * 35));
    col = mix(col, RED, 0.12 * (0.5 + 0.5 * vnoise(x * 120, y * 120, z * 120)));
    const [a, b, c] = toL([x, y, z]);
    if (Math.hypot(a, b, c) > 0.2) return col;
    col = mix(col, RED, 0.4 * g2(a, b - noseTip[1] + 0.004, 0.014, 0.014) * (c > noseTip[2] - 0.02 ? 1 : 0));
    for (const s of [1, -1]) col = mix(col, RED, 0.2 * g2(a - s * 0.042, b - (noseTip[1] - 0.006), 0.02, 0.016) * (c > 0.02 ? 1 : 0));
    if (abs(a) > 0.066 && c < 0.03 && b > -0.06 && b < 0.035) col = mix(col, RED, 0.3);
    const lip = ((a / 0.026) ** 2 + ((b - slit[1]) / (b > slit[1] ? 0.0095 : 0.012)) ** 2);
    if (c > slit[2] - 0.006) col = mix(col, LIP, 0.85 * smoothstep(1.15, 0.7, lip));
    for (const E of eyes) col = mix(col, UNDER, 0.3 * g2(a - E.l[0], b - E.l[1] + 0.016, 0.014, 0.006) * (c > E.l[2] - 0.01 ? 1 : 0));
    const beard = (b < slit[1] + 0.024 && b > slit[1] - 0.075 && c > -0.025) && !(lip < 1.25) && !(b > slit[1] + 0.004 && abs(a) > 0.03 && b > noseTip[1] - 0.03);
    if (beard) {
      const edge = smoothstep(-0.03, 0.0, c) * smoothstep(slit[1] + 0.024, slit[1] + 0.012, b);
      col = mix(col, STUB, 0.3 * edge * (0.6 + 0.4 * vnoise(a * 900, b * 900, c * 900)));
    }
    return col;
  }
  const box = { lo: toW([-0.12, -0.1, -0.13]).map((v, i) => min(v, toW([0.12, 0.13, 0.13])[i])), hi: toW([-0.12, -0.1, -0.13]).map((v, i) => max(v, toW([0.12, 0.13, 0.13])[i])) };
  box.lo = box.lo.map(v => v - 0.02); box.hi = box.hi.map(v => v + 0.02);
  return { hairCap, strands, headSD: sd, toL, toW, eyes, box, origin, skinColor };
}

function solidFromSurfaceTopOpen(G, S, j0) {
  const [nx, ny, nz] = G.n, out = new Uint8Array(G.size), stack = new Int32Array(G.size);
  let sp = 0;
  const push = (i, j, k) => { const q = G.id(i, j, k); if (!S[q] && !out[q]) { out[q] = 1; stack[sp++] = q; } };
  for (let k = 0; k < nz; k++) for (let j = j0; j < ny; j++) { push(0, j, k); push(nx - 1, j, k); }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) push(i, ny - 1, k);
  for (let j = j0; j < ny; j++) for (let i = 0; i < nx; i++) { push(i, j, 0); push(i, j, nz - 1); }
  while (sp) {
    const q = stack[--sp], i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0;
    if (i > 0) push(i - 1, j, k); if (i < nx - 1) push(i + 1, j, k);
    if (j > 1) push(i, j - 1, k); if (j < ny - 1) push(i, j + 1, k);
    if (k > 0) push(i, j, k - 1); if (k < nz - 1) push(i, j, k + 1);
  }
  const solid = new Uint8Array(G.size);
  for (let q = 0; q < G.size; q++) solid[q] = out[q] ? 0 : 1;
  return solid;
}
