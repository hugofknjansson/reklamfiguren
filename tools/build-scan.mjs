// Builds figure.bin.gz from a prepared body scan. Run: node tools/build-scan.mjs <dir>
// <dir> holds body-final.json, body-rigged.json, head-final.json and rig.json from tools/scan/*.py.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { surfaceNets, bakeAO } from './mh/mesher.mjs';

const dir = process.argv[2];
const load = n => JSON.parse(readFileSync(`${dir}/${n}`, 'utf8'));
const cut = load('body-final.json'), body = { ...load('body-rigged.json'), legCut: cut.legCut, legs: cut.legs };
const head = load('head-final.json'), rig = load('rig.json');
const t0 = Date.now(), log = m => console.log(`${m} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
const { max, min, abs, hypot, sin, cos } = Math;
const clamp = (v, a, b) => max(a, min(b, v));
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

// ---------- output ----------
const header = { layers: [], bones: rig.bones.map(b => ({ n: b.n, p: b.p, h: b.h })) };
const boneIdx = Object.fromEntries(rig.bones.map((b, i) => [b.n, i]));
const chunks = [];
let offset = 0;
const pushChunk = arr => { const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - (buf.length % 4)) % 4; chunks.push(buf, Buffer.alloc(pad)); const o = offset; offset += buf.length + pad; return o; };
function emit(name, pos, nrm, col, uv, tris, si, sw) {
  const n = pos.length / 3, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) { lo[a] = min(lo[a], pos[v * 3 + a]); hi[a] = max(hi[a], pos[v * 3 + a]); }
  const qpos = new Uint16Array(n * 3), qn = new Int8Array(n * 3), qc = new Uint8Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const a = i % 3;
    qpos[i] = Math.round((pos[i] - lo[a]) / ((hi[a] - lo[a]) || 1) * 65535);
    qn[i] = Math.round(nrm[i] * 127);
    qc[i] = Math.round(clamp(col ? col[i] : 1, 0, 1) ** (1 / 2.2) * 255);
  }
  const e = { name, vcount: n, icount: tris.length, lo, hi };
  e.pos = pushChunk(qpos); e.nrm = pushChunk(qn); e.col = pushChunk(qc);
  if (uv) e.uvq = pushChunk(Uint16Array.from(uv, v => Math.round(clamp(v, 0, 1) * 65535)));
  e.si = pushChunk(si); e.sw = pushChunk(sw);
  const dl = new Int32Array(tris.length);
  for (let i = 0; i < tris.length; i++) dl[i] = tris[i] - (i ? tris[i - 1] : 0);
  e.idx = pushChunk(dl); e.delta = true;
  header.layers.push(e);
  log(`${name}: ${n} verts, ${tris.length / 3} tris`);
}
function packWeights(perVertex) {
  const n = perVertex.length, si = new Uint8Array(n * 4), sw = new Uint8Array(n * 4);
  perVertex.forEach((ws, v) => {
    const top = ws.filter(w => w[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), tot = top.reduce((a, x) => a + x[1], 0) || 1;
    const q = top.map(([, w]) => Math.floor(w / tot * 255));
    q[0] += 255 - q.reduce((a, x) => a + x, 0);
    top.forEach(([b], j) => { si[v * 4 + j] = b; sw[v * 4 + j] = q[j]; });
  });
  return { si, sw };
}
// Smooth normals that ignore texture seams: vertices sharing a position share a normal.
function seamlessNormals(pos, idx) {
  const n = pos.length / 3, weld = new Int32Array(n), map = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
    if (!map.has(k)) map.set(k, map.size);
    weld[i] = map.get(k);
  }
  const acc = new Float64Array(map.size * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const f = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) acc[weld[v] * 3 + k] += f[k];
  }
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = weld[i] * 3, l = hypot(acc[w], acc[w + 1], acc[w + 2]) || 1;
    out[i * 3] = acc[w] / l; out[i * 3 + 1] = acc[w + 1] / l; out[i * 3 + 2] = acc[w + 2] / l;
  }
  return out;
}

// ---------- scanned body and head ----------
{
  const n = body.pos.length / 3, ws = [];
  for (let v = 0; v < n; v++) ws.push([0, 1, 2, 3].map(j => [rig.si[v * 4 + j], rig.sw[v * 4 + j]]));
  const { si, sw } = packWeights(ws);
  emit('body', body.pos, seamlessNormals(body.pos, body.idx), null, body.uv, body.idx, si, sw);
}
{
  const n = head.pos.length / 3, { si, sw } = packWeights(Array.from({ length: n }, () => [[boneIdx['neck01'], 1]]));
  emit('head', head.pos, seamlessNormals(head.pos, head.idx), null, head.uv, head.idx, si, sw);
}

// ---------- generated socks and sneakers (the scanned feet were fused with the floor) ----------
const seg = (p, a, b) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], t = clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2), 0, 1);
  return { d: hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t), t };
};
const E = (c, r) => (x, y, z) => {
  const qx = (x - c[0]) / r[0], qy = (y - c[1]) / r[1], qz = (z - c[2]) / r[2];
  const k0 = hypot(qx, qy, qz), k1 = hypot(qx / r[0], qy / r[1], qz / r[2]);
  return k1 === 0 ? -min(...r) : k0 * (k0 - 1) / k1;
};
const LEN = 0.295, WID = 0.108, CUT = body.legCut;
const feet = body.legs.map(L => {
  const yaw = L.side * 0.2, f = [sin(yaw), 0, cos(yaw)], sd = [f[2], 0, -f[0]];
  const o = [L.cx - f[0] * 0.075, 0, L.cz - f[2] * 0.075];
  return { s: L.side, o, f, sd, leg: L, ankle: [o[0] + f[0] * 0.07, 0.085, o[2] + f[2] * 0.07] };
});
const toFoot = (F, x, y, z) => { const qx = x - F.o[0], qz = z - F.o[2]; return [(qx * F.sd[0] + qz * F.sd[2]) * F.s * (0.09 / WID), y, (qx * F.f[0] + qz * F.f[2]) * (0.27 / LEN)]; };
const soleOutline = (x, z) => smin(smin(hypot(x, z - 0.045) - 0.037, hypot(x - 0.004, z - 0.19) - 0.046, 0.08), hypot(x + 0.002, z - 0.235) - 0.036, 0.03);
const upper = [E([0, 0.064, 0.052], [0.038, 0.052, 0.05]), E([0.002, 0.052, 0.165], [0.044, 0.038, 0.088]), E([0, 0.042, 0.228], [0.037, 0.028, 0.04])];
const laceZ = [0.095, 0.115, 0.135, 0.155];
const laces = laceZ.map(zz => { const yy = 0.094 - (zz - 0.095) * 0.42; return p => seg(p, [-0.018, yy, zz - 0.004], [0.018, yy, zz + 0.006]).d - 0.0024; });
const tongue = E([0, 0.093, 0.112], [0.026, 0.013, 0.052]);
const shoeLocal = (x, y, z) => {
  let u = smin(smin(upper[0](x, y, z), upper[1](x, y, z), 0.04), upper[2](x, y, z), 0.04);
  u = max(smin(u, tongue(x, y, z), 0.01), 0.028 - y);
  u = smax(u, -max(hypot(x, z - 0.06) - 0.034, 0.09 - y), 0.006);
  let lc = Infinity;
  for (const l of laces) lc = min(lc, l([x, y, z]));
  return min(u, lc);
};
const soleLocal = (x, y, z) => smax(soleOutline(x, z) - 0.002, abs(y - smoothstep(0.2, 0.27, z) * 0.012 - 0.016) - 0.016, 0.008);
const each = f => (x, y, z) => min(...feet.map(F => f(F, x, y, z)));
const shoes = each((F, x, y, z) => { const p = toFoot(F, x, y, z); return shoeLocal(p[0], p[1], p[2]); });
const soles = each((F, x, y, z) => { const p = toFoot(F, x, y, z); return soleLocal(p[0], p[1], p[2]); });
const socks = each((F, x, y, z) => {
  const top = [F.leg.cx, CUT + 0.012, F.leg.cz], r = seg([x, y, z], top, F.ankle), rad = F.leg.r + 0.006 + (0.045 - F.leg.r - 0.006) * r.t;
  let d = r.d - rad - 0.0012 * Math.exp(-(((y - CUT - 0.006) / 0.004) ** 2));
  return smax(smax(d, y - (CUT + 0.016), 0.004), 0.04 - y, 0.004);
});
const lin = c => c.map(v => v ** 2.2);
const shoeColor = (x, y, z) => {
  const p = toFoot(feet[x >= 0 ? 0 : 1], x, y, z);
  let lc = Infinity;
  for (const l of laces) lc = min(lc, l(p));
  if (lc < 0.0015) return [0.92, 0.92, 0.9];
  if (laceZ.some(zz => abs(abs(p[0]) - 0.021) < 0.0035 && abs(p[2] - zz) < 0.0035)) return [0.75, 0.75, 0.75];
  if ((p[2] > 0.205 && p[1] < 0.062) || (p[2] < 0.025 && p[1] > 0.065)) return [0.2, 0.21, 0.24];
  return [0.11, 0.12, 0.14];
};
const soleColor = (x, y, z) => {
  const p = toFoot(feet[x >= 0 ? 0 : 1], x, y, z);
  return p[1] < 0.005 ? [0.35, 0.35, 0.36] : abs(p[1] - 0.021) < 0.0025 ? [0.62, 0.63, 0.65] : [0.93, 0.93, 0.91];
};
const xs = feet.map(F => F.o[0]), zs = feet.map(F => F.o[2]);
const box = { lo: [min(...xs) - 0.14, -0.004, min(...zs) - 0.06], hi: [max(...xs) + 0.14, CUT + 0.04, max(...zs) + LEN + 0.08] };
const scene = (x, y, z) => min(shoes(x, y, z), soles(x, y, z), socks(x, y, z));
const side = x => (x >= (feet[0].o[0] + feet[1].o[0]) / 2 ? '.L' : '.R');
for (const g of [
  { name: 'socks', f: socks, h: 0.003, color: () => [1, 1, 1], w: (x, y) => { const k = smoothstep(0.075, 0.15, y); return [[boneIdx['lowerleg01' + side(x)], k], [boneIdx['foot' + side(x)], 1 - k]]; } },
  { name: 'shoes', f: shoes, h: 0.0032, color: (x, y, z) => lin(shoeColor(x, y, z)), w: x => [[boneIdx['foot' + side(x)], 1]] },
  { name: 'soles', f: soles, h: 0.004, color: (x, y, z) => lin(soleColor(x, y, z)), w: x => [[boneIdx['foot' + side(x)], 1]] },
]) {
  const m = surfaceNets(g.f, box.lo, box.hi, g.h), ao = bakeAO(m.pos, m.nrm, scene), n = m.pos.length / 3;
  const col = new Float64Array(n * 3), ws = [];
  for (let v = 0; v < n; v++) {
    const x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2], c = g.color(x, y, z);
    for (let a = 0; a < 3; a++) col[v * 3 + a] = c[a] * ao[v];
    ws.push(g.w(x, y, z));
  }
  const { si, sw } = packWeights(ws);
  emit(g.name, m.pos, m.nrm, col, null, m.tris.flat(), si, sw);
}

const hjson = Buffer.from(JSON.stringify(header)), hpad = (4 - ((hjson.length + 4) % 4)) % 4;
const hlen = Buffer.alloc(4); hlen.writeUInt32LE(hjson.length + hpad);
const out = Buffer.concat([hlen, hjson, Buffer.alloc(hpad, 32), ...chunks]), gz = gzipSync(out, { level: 9 });
writeFileSync(new URL('../figure.bin.gz', import.meta.url), gz);
log(`figure.bin ${(out.length / 1048576).toFixed(2)} MB, gzip ${(gz.length / 1048576).toFixed(2)} MB`);
