// Builds figure.bin from the distance fields in sdf.mjs. Run: node tools/build-figure.mjs
import { writeFileSync } from 'node:fs';
import * as F from './sdf.mjs';

const { abs, sqrt, max, min, round, atan2, exp } = Math;

const LAYERS = [
  { name: 'skin',  f: F.skin,  h: 0.0032, lo: [-0.36, 0.68, -0.14], hi: [0.36, 1.82, 0.16] },
  { name: 'shirt', f: F.shirt, h: 0.0055, lo: [-0.32, 0.86, -0.17], hi: [0.32, 1.48, 0.17], uv: 'shirt' },
  { name: 'pants', f: F.pants, h: 0.0055, lo: [-0.25, 0.05, -0.17], hi: [0.25, 1.0, 0.16], uv: 'pants' },
  { name: 'shoes', f: F.shoes, h: 0.004,  lo: [-0.18, 0.0, -0.1],   hi: [0.18, 0.12, 0.23], uv: 'planar' },
  { name: 'soles', f: F.soles, h: 0.004,  lo: [-0.18, -0.006, -0.1], hi: [0.18, 0.035, 0.23] },
  { name: 'hair',  f: F.hair,  h: 0.0032, lo: [-0.1, 1.58, -0.13],  hi: [0.1, 1.8, 0.13], uv: 'hair' },
];
const scene = (x, y, z) => {
  let d = Infinity;
  for (const L of LAYERS) d = min(d, L.f(x, y, z));
  for (const e of F.eyes) d = min(d, F.len(x - e[0], y - e[1], z - e[2]) - F.EYE_R);
  return d;
};

const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

function surfaceNets(f, lo, hi, h) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const vals = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);
  const B = 6, skip = 3 * sqrt(3) * B * h / 2 + 3 * h;
  for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
    const fc = f(lo[0] + (bi + B / 2) * h, lo[1] + (bj + B / 2) * h, lo[2] + (bk + B / 2) * h);
    const far = abs(fc) > skip;
    for (let k = bk; k < min(bk + B, nz); k++) for (let j = bj; j < min(bj + B, ny); j++) for (let i = bi; i < min(bi + B, nx); i++)
      vals[id(i, j, k)] = far ? fc : f(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  }
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = new Int32Array(cx * cy * cz).fill(-1);
  const cid = (i, j, k) => i + cx * (j + cy * k);
  const pos = [];
  const c = new Float64Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let n = 0; n < 8; n++) { c[n] = vals[id(i + (n & 1), j + ((n >> 1) & 1), k + ((n >> 2) & 1))]; if (c[n] < 0) mask |= 1 << n; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of EDGES) {
      if ((c[a] < 0) === (c[b] < 0)) continue;
      const t = c[a] / (c[a] - c[b]);
      sx += (a & 1) + t * ((b & 1) - (a & 1));
      sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
      sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
      cnt++;
    }
    cell[cid(i, j, k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / cnt) * h, lo[1] + (j + sy / cnt) * h, lo[2] + (k + sz / cnt) * h);
  }
  const quads = [];
  for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) {
    const v0 = vals[id(i, j, k)] < 0;
    if (v0 !== (vals[id(i + 1, j, k)] < 0)) quads.push([cid(i, j - 1, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i, j - 1, k)]);
    if (v0 !== (vals[id(i, j + 1, k)] < 0)) quads.push([cid(i - 1, j, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i - 1, j, k)]);
    if (v0 !== (vals[id(i, j, k + 1)] < 0)) quads.push([cid(i - 1, j - 1, k), cid(i, j - 1, k), cid(i, j, k), cid(i - 1, j, k)]);
  }
  for (let q = 0; q < quads.length; q++) quads[q] = quads[q].map(x => cell[x]);
  return { pos, quads: quads.filter(q => q.every(v => v >= 0)) };
}

function grad(f, x, y, z, e) {
  return [f(x + e, y, z) - f(x - e, y, z), f(x, y + e, z) - f(x, y - e, z), f(x, y, z + e) - f(x, y, z - e)];
}
const toLin = c => (c / 255) ** 2.2;
const SKIN = [206, 148, 114].map(toLin), LIP = [186, 116, 106].map(toLin), BLUSH = [214, 134, 112].map(toLin), LASH = [70, 48, 38].map(toLin);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function uvFor(kind, x, y, z) {
  if (kind === 'shirt') {
    for (const s of [1, -1]) {
      const t = F.inSleeve(s, x, y, z), a = F.arm[s];
      if (t > 0.02 && abs(x) > 0.18) return [atan2(z - a.S0[2], s * (x - (a.S0[0] + a.u[0] * t))) * 0.06, t];
    }
    return [atan2(x, z) * 0.18, y];
  }
  if (kind === 'pants') return [atan2(x - F.legCenterX(x >= 0 ? 1 : -1), z) * 0.085, y];
  if (kind === 'hair') return [atan2(x, z) * 0.09, y];
  return [z, y + x];
}

const t0 = Date.now();
const header = { layers: [], eyes: F.eyes, eyeR: F.EYE_R };
const chunks = [];
let offset = 0;
const pushChunk = arr => { const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (buf.length % 4)) % 4; chunks.push(buf, Buffer.alloc(pad)); const o = offset; offset += buf.length + pad; return o; };

for (const L of LAYERS) {
  const { pos, quads } = surfaceNets(L.f, L.lo, L.hi, L.h);
  const n = pos.length / 3, nrm = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const x0 = x, y0 = y, z0 = z;
    for (let it = 0; it < 3; it++) {
      const d = L.f(x, y, z), g = grad(L.f, x, y, z, L.h * 0.25), gg = g[0] ** 2 + g[1] ** 2 + g[2] ** 2;
      if (gg < 1e-12) break;
      const s = d * (2 * L.h * 0.25) / gg;
      x -= g[0] * s; y -= g[1] * s; z -= g[2] * s;
    }
    if (F.len(x - x0, y - y0, z - z0) > L.h) { x = x0; y = y0; z = z0; }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    const g = grad(L.f, x, y, z, L.h * 0.5), gl = F.len(...g) || 1;
    nrm[v * 3] = g[0] / gl; nrm[v * 3 + 1] = g[1] / gl; nrm[v * 3 + 2] = g[2] / gl;
  }
  const tris = [];
  const P = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const d2 = (a, b) => { const p = P(a), q = P(b); return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; };
  for (const [a, b, c2, d] of quads) {
    const t = d2(a, c2) < d2(b, d) ? [[a, b, c2], [a, c2, d]] : [[a, b, d], [b, c2, d]];
    for (const tri of t) {
      const p0 = P(tri[0]), p1 = P(tri[1]), p2 = P(tri[2]);
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const nx = nrm[tri[0] * 3] + nrm[tri[1] * 3] + nrm[tri[2] * 3], ny = nrm[tri[0] * 3 + 1] + nrm[tri[1] * 3 + 1] + nrm[tri[2] * 3 + 1], nz = nrm[tri[0] * 3 + 2] + nrm[tri[1] * 3 + 2] + nrm[tri[2] * 3 + 2];
      if (fx * nx + fy * ny + fz * nz < 0) tris.push(tri[0], tri[2], tri[1]); else tris.push(...tri);
    }
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) { lo[a] = min(lo[a], pos[v * 3 + a]); hi[a] = max(hi[a], pos[v * 3 + a]); }
  const qpos = new Uint16Array(n * 3), qn = new Int8Array(n * 3), col = new Uint8Array(n * 3), uv = L.uv ? new Int16Array(n * 2) : null;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
    for (let a = 0; a < 3; a++) { qpos[v * 3 + a] = round((pos[v * 3 + a] - lo[a]) / ((hi[a] - lo[a]) || 1) * 65535); qn[v * 3 + a] = round(nrm[v * 3 + a] * 127); }
    let occ = 0;
    for (let i = 1; i <= 5; i++) { const dd = i * 0.009; occ += (dd - scene(x + nx * dd, y + ny * dd, z + nz * dd)) / (1 << i); }
    const ao = max(0.32, min(1, 1 - 3.2 * occ));
    let base = [1, 1, 1];
    if (L.name === 'skin') {
      base = SKIN;
      base = mix(base, BLUSH, 0.15 * (exp(-(((x - 0.045) ** 2 + (y - 1.645) ** 2) / 0.0006)) + exp(-(((x + 0.045) ** 2 + (y - 1.645) ** 2) / 0.0006))) * (z > 0.04 ? 1 : 0));
      base = mix(base, BLUSH, 0.25 * exp(-(((y - 1.648) ** 2 + (z - 0.104) ** 2 + x * x) / 0.0002)));
      base = mix(base, LIP, 0.8 * max(0, min(1, 1 - F.lipDist(x, y, z) / 0.003)));
      for (const e of F.eyes) {
        const r = F.len(x - e[0], y - e[1], z - e[2]);
        if (z > e[2] && r < F.EYE_R + 0.004) base = mix(base, LASH, 0.75 * exp(-(((y - (e[1] + 0.0022)) / 0.0016) ** 2)) * exp(-(((x - e[0]) / 0.012) ** 4)));
      }
    }
    for (let a = 0; a < 3; a++) col[v * 3 + a] = round(min(1, base[a] * ao) ** (1 / 2.2) * 255);
    if (uv) { const [u, w] = uvFor(L.uv, x, y, z); uv[v * 2] = round(u * 1000); uv[v * 2 + 1] = round(w * 1000); }
  }
  const idx = n > 65535 ? new Uint32Array(tris) : new Uint16Array(tris);
  const entry = { name: L.name, vcount: n, icount: tris.length, lo, hi, idx32: n > 65535 };
  entry.pos = pushChunk(qpos); entry.nrm = pushChunk(qn); entry.col = pushChunk(col);
  if (uv) entry.uv = pushChunk(uv);
  entry.idx = pushChunk(idx);
  header.layers.push(entry);
  console.log(`${L.name}: ${n} verts, ${tris.length / 3} tris (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
const hjson = Buffer.from(JSON.stringify(header));
const hpad = (4 - ((hjson.length + 4) % 4)) % 4;
const head = Buffer.alloc(4); head.writeUInt32LE(hjson.length + hpad);
const out = Buffer.concat([head, hjson, Buffer.alloc(hpad, 32), ...chunks]);
writeFileSync(new URL('../figure.bin', import.meta.url), out);
console.log(`figure.bin ${(out.length / 1024 / 1024).toFixed(2)} MB`);
