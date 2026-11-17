// Removes the floor from a body scan, keeps the largest connected piece, and scales it to HEIGHT metres.
// Usage: node tools/scan/clean.mjs <mesh.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

const HEIGHT = 1.8;
const [src, out] = process.argv.slice(2);
const m = JSON.parse(readFileSync(src, 'utf8'));
const P = m.pos, n = P.length / 3, T = m.idx;

// ankle centres from a slice just above the feet
const ankles = [1, -1].map(s => {
  let sx = 0, sz = 0, k = 0;
  for (let i = 0; i < n; i++) if (Math.abs(P[i * 3 + 1] - 0.16) < 0.012 && P[i * 3] * s > -0.02 && Math.abs(P[i * 3]) < 0.3) { sx += P[i * 3]; sz += P[i * 3 + 2]; k++; }
  return [sx / k, sz / k];
});
const footDist = (x, z) => Math.min(...ankles.map(([ax, az]) => {
  const t = Math.max(0, Math.min(1, (z - (az - 0.05)) / 0.3));
  return Math.hypot(x - ax, z - (az - 0.05 + 0.3 * t));
}));
// fit the floor plane y = a x + b z + c to low points away from the feet, then measure height above it
let Sxx = 0, Sxz = 0, Szz = 0, Sx = 0, Sz = 0, S1 = 0, Sxy = 0, Szy = 0, Sy = 0;
for (let i = 0; i < n; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  if (y > 0.05 || footDist(x, z) < 0.13) continue;
  Sxx += x * x; Sxz += x * z; Szz += z * z; Sx += x; Sz += z; S1++; Sxy += x * y; Szy += z * y; Sy += y;
}
const solve3 = (A, r) => {
  const M = A.map((row, i) => [...row, r[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < 3; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) { let v = M[i][3]; for (let j = i + 1; j < 3; j++) v -= M[i][j] * x[j]; x[i] = v / M[i][i]; }
  return x;
};
const [pa, pb, pc] = S1 > 50 ? solve3([[Sxx, Sxz, Sx], [Sxz, Szz, Sz], [Sx, Sz, S1]], [Sxy, Szy, Sy]) : [0, 0, 0];
const hgt = i => P[i * 3 + 1] - (pa * P[i * 3] + pb * P[i * 3 + 2] + pc);
for (let i = 0; i < n; i++) P[i * 3 + 1] = hgt(i);
console.log(`floor plane tilt x ${(pa * 100).toFixed(1)} cm/m, z ${(pb * 100).toFixed(1)} cm/m, offset ${pc.toFixed(3)} from ${S1} points`);

const keep = new Uint8Array(n);
for (let i = 0; i < n; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], d = footDist(x, z);
  keep[i] = y > 0.14 || (y > 0.04 && d < 0.075 + (y - 0.04) * 0.25) || (y > 0.007 && d < 0.058);
}
let tris = [];
for (let t = 0; t < T.length; t += 3) {
  const a = T[t], b = T[t + 1], c = T[t + 2];
  if (!(keep[a] && keep[b] && keep[c])) continue;
  if (Math.max(P[a * 3 + 1], P[b * 3 + 1], P[c * 3 + 1]) < 0.016) continue;
  tris.push([a, b, c]);
}

// largest connected component
const parent = Int32Array.from({ length: n }, (_, i) => i);
const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
const weld = new Map();
for (let i = 0; i < n; i++) {
  const k = `${Math.round(P[i * 3] * 1e5)},${Math.round(P[i * 3 + 1] * 1e5)},${Math.round(P[i * 3 + 2] * 1e5)}`;
  if (weld.has(k)) parent[find(i)] = find(weld.get(k)); else weld.set(k, i);
}
for (const [a, b, c] of tris) { parent[find(b)] = find(a); parent[find(c)] = find(a); }
const size = new Map();
for (const [a] of tris) { const r = find(a); size.set(r, (size.get(r) || 0) + 1); }
const big = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
tris = tris.filter(([a]) => find(a) === big);

// compact, normalise
const map = new Int32Array(n).fill(-1), pos = [], uv = [], idx = [];
for (const tri of tris) for (const v of tri) {
  if (map[v] < 0) { map[v] = pos.length / 3; pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); uv.push(m.uv[v * 2], m.uv[v * 2 + 1]); }
  idx.push(map[v]);
}
let minY = Infinity, maxY = -Infinity;
for (let i = 1; i < pos.length; i += 3) { minY = Math.min(minY, pos[i]); maxY = Math.max(maxY, pos[i]); }
const s = HEIGHT / (maxY - minY), cx = (ankles[0][0] + ankles[1][0]) / 2, cz = (ankles[0][1] + ankles[1][1]) / 2 + 0.06;
for (let i = 0; i < pos.length; i += 3) { pos[i] = (pos[i] - cx) * s; pos[i + 1] = (pos[i + 1] - minY) * s; pos[i + 2] = (pos[i + 2] - cz) * s; }
writeFileSync(out, JSON.stringify({ pos, uv, idx }));
console.log(`kept ${pos.length / 3} of ${n} verts, ${idx.length / 3} tris; scale ${s.toFixed(4)}; ankles ${JSON.stringify(ankles.map(a => a.map(v => +v.toFixed(3))))}`);
