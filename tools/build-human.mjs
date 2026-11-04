// Builds figure.bin from the MakeHuman body plus generated clothes and hair. Run: node tools/build-human.mjs
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { buildBody, triangulate } from './mh/body.mjs';
import { buildGarments } from './mh/garments.mjs';
import { surfaceNets, bakeAO } from './mh/mesher.mjs';
import { buildHead } from './mh/hair.mjs';
import { applySmile } from './mh/expression.mjs';

const t0 = Date.now();
const log = m => console.log(`${m} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function smoothNormals(pos, tris) {
  const n = new Float64Array(pos.length);
  for (const [a, b, c] of tris) {
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i * 3] += fx; n[i * 3 + 1] += fy; n[i * 3 + 2] += fz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}
// Compact a triangle list over a big vertex array; optionally split by uv.
export function compact(srcPos, tris, uvTris, vt) {
  const map = new Map(), pos = [], uv = [], out = [], src = [];
  tris.forEach((t, k) => {
    const tri = t.map((vi, j) => {
      const ti = uvTris ? uvTris[k][j] : -1, key = uvTris ? vi * 100000 + ti : vi;
      let id = map.get(key);
      if (id === undefined) {
        id = pos.length / 3; map.set(key, id); src.push(vi);
        pos.push(srcPos[vi * 3], srcPos[vi * 3 + 1], srcPos[vi * 3 + 2]);
        if (uvTris) uv.push(vt[ti * 2], vt[ti * 2 + 1]);
      }
      return id;
    });
    out.push(tri);
  });
  return { pos: Float64Array.from(pos), tris: out, uv: uvTris ? Float64Array.from(uv) : null, src };
}

const header = { layers: [] };
const chunks = [];
let offset = 0;
const pushChunk = arr => { const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (buf.length % 4)) % 4; chunks.push(buf, Buffer.alloc(pad)); const o = offset; offset += buf.length + pad; return o; };
export function emit(name, pos, nrm, col, uv, triList) {
  const tris = triList.flat ? triList.flat() : triList;
  const n = pos.length / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[v * 3 + a]); hi[a] = Math.max(hi[a], pos[v * 3 + a]); }
  const qpos = new Uint16Array(n * 3), qn = new Int8Array(n * 3), qc = new Uint8Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const a = i % 3;
    qpos[i] = Math.round((pos[i] - lo[a]) / ((hi[a] - lo[a]) || 1) * 65535);
    qn[i] = Math.round(nrm[i] * 127);
    qc[i] = Math.round(clamp(col ? col[i] : 1, 0, 1) ** (1 / 2.2) * 255);
  }
  const entry = { name, vcount: n, icount: tris.length, lo, hi, idx32: n > 65535 };
  entry.pos = pushChunk(qpos); entry.nrm = pushChunk(qn); entry.col = pushChunk(qc);
  if (uv) entry.uv = pushChunk(Int16Array.from(uv, v => Math.round(v * 1000)));
  const dl = new Int32Array(tris.length);
  for (let i = 0; i < tris.length; i++) dl[i] = tris[i] - (i ? tris[i - 1] : 0);
  entry.idx = pushChunk(dl); entry.delta = true;
  header.layers.push(entry);
  log(`${name}: ${n} verts, ${tris.length / 3} tris`);
}
export function write() {
  const hjson = Buffer.from(JSON.stringify(header));
  const hpad = (4 - ((hjson.length + 4) % 4)) % 4;
  const head = Buffer.alloc(4); head.writeUInt32LE(hjson.length + hpad);
  const out = Buffer.concat([head, hjson, Buffer.alloc(hpad, 32), ...chunks]);
  const gz = gzipSync(out, { level: 9 });
  writeFileSync(new URL('../figure.bin.gz', import.meta.url), gz);
  log(`figure.bin ${(out.length / 1024 / 1024).toFixed(2)} MB, gzip ${(gz.length / 1024 / 1024).toFixed(2)} MB`);
}

const body = buildBody();
log('body posed');
const { tris } = triangulate(body.bodyFaces);
const smile = applySmile(body, tris, 1.7);
console.log('mouth corners', smile.corner.map(c => c.map(v => v.toFixed(3)).join(',')).join(' | '));
const et0 = triangulate(body.eyeObj.faces);
const GM = buildGarments(body, tris, log, [{ pos: body.eyes, tris: et0.tris }]);
const GH = buildHead(body, tris, et0.tris, log);
console.log('head SD at skull centre', GH.headSD(...GH.origin).toFixed(3));

const lin = c => c.map(v => v ** 2.2);
const garments = [
  { name: 'shirt', f: GM.shirt, h: 0.0048, lo: [-0.36, GM.hemY - 0.02, -0.2], hi: [0.36, GM.neckY + 0.06, 0.22], uv: GM.shirtUV },
  { name: 'pants', f: GM.pants, h: 0.0048, lo: [-0.3, GM.shortsHem - 0.02, -0.2], hi: [0.3, GM.waistY + 0.02, 0.24], uv: GM.pantsUV },
  { name: 'socks', f: GM.socks, h: 0.003, lo: [-0.32, 0.03, -0.16], hi: [0.32, 0.15, 0.22], uv: (x, y, z) => [Math.atan2(x, z) * 0.06, y] },
  { name: 'shoes', f: GM.shoes, h: 0.0032, lo: GM.shoeBox.lo, hi: GM.shoeBox.hi, color: (x, y, z) => lin(GM.shoeColor(x, y, z)) },
  { name: 'hair', f: GH.hairCap, h: 0.003, lo: GH.box.lo, hi: GH.box.hi, uv: (x, y, z) => { const [a, b, c] = GH.toL([x, y, z]); return [Math.atan2(a, c) * 0.09, b]; } },
  { name: 'soles', f: GM.soles, h: 0.004, lo: [GM.shoeBox.lo[0], -0.004, GM.shoeBox.lo[2]], hi: [GM.shoeBox.hi[0], 0.05, GM.shoeBox.hi[2]], color: (x, y, z) => lin(GM.soleColor(x, y, z)) },
];
const scene = (x, y, z) => { let d = Math.min(GM.bodySD(x, y, z), GH.headSD(x, y, z)); for (const g of garments) d = Math.min(d, g.f(x, y, z)); return d; };

for (const g of garments) {
  const m = surfaceNets(g.f, g.lo, g.hi, g.h);
  const ao = bakeAO(m.pos, m.nrm, scene);
  const n = m.pos.length / 3, col = new Float64Array(n * 3), uv = g.uv ? new Float64Array(n * 2) : null;
  for (let v = 0; v < n; v++) {
    const x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2], c = g.color ? g.color(x, y, z) : [1, 1, 1];
    for (let a = 0; a < 3; a++) col[v * 3 + a] = c[a] * ao[v];
    if (uv) { const [u, w] = g.uv(x, y, z); uv[v * 2] = u; uv[v * 2 + 1] = w; }
  }
  emit(g.name, m.pos, m.nrm, col, uv, m.tris);
}

const covered = i => { const x = body.v[i * 3], y = body.v[i * 3 + 1], z = body.v[i * 3 + 2]; return garments.some(g => g.f(x, y, z) < -0.003); };
const cov = new Map();
const isCov = i => { if (!cov.has(i)) cov.set(i, covered(i)); return cov.get(i); };
const visible = tris.filter(t => !(isCov(t[0]) && isCov(t[1]) && isCov(t[2])));
const skin = compact(body.v, visible);
const skinN = smoothNormals(skin.pos, skin.tris);
const skinAO = bakeAO(skin.pos, skinN, scene, 0.007);
const skinCol = new Float64Array(skin.pos.length);
const SK = lin([204, 146, 114].map(c => c / 255));
for (let v = 0; v < skin.pos.length / 3; v++) { const c = GH.skinColor(skin.pos[v * 3], skin.pos[v * 3 + 1], skin.pos[v * 3 + 2]); for (let a = 0; a < 3; a++) skinCol[v * 3 + a] = c[a] * skinAO[v]; }
emit('skin', skin.pos, skinN, skinCol, null, skin.tris);

{ const S = GH.strands(); emit('strands', S.pos, S.nrm, S.col, S.uv, S.idx); }
const et = triangulate(body.eyeObj.faces), vt = body.eyeObj.vt;
const isCornea = k => { const u = et.uvs[k].reduce((a, t) => a + vt[t * 2], 0) / 3, w = et.uvs[k].reduce((a, t) => a + vt[t * 2 + 1], 0) / 3; return u > 0.84 && w < 0.16; };
for (const [name, keep] of [['eyes', k => !isCornea(k)], ['cornea', isCornea]]) {
  const ks = et.tris.map((_, k) => k).filter(keep);
  const m = compact(body.eyes, ks.map(k => et.tris[k]), ks.map(k => et.uvs[k]), vt);
  emit(name, m.pos, smoothNormals(m.pos, m.tris), null, m.uv, m.tris);
}
write();
