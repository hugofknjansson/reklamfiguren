// Loads the MakeHuman base mesh (CC0), applies body targets, and poses it with the default rig.
import { readFileSync } from 'node:fs';

export const MH = process.env.MH_DATA || new URL('../../vendor/makehuman/', import.meta.url).pathname;

export function parseObj(text) {
  const v = [], vt = [], faces = [];
  let group = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) { const p = line.split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
    else if (line.startsWith('vt ')) { const p = line.split(/\s+/); vt.push(+p[1], +p[2]); }
    else if (line.startsWith('g ')) group = line.slice(2).trim();
    else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1).map(t => t.split('/').map(x => x ? +x - 1 : -1));
      faces.push({ g: group, v: p.map(q => q[0]), t: p.map(q => q[1]) });
    }
  }
  return { v: Float64Array.from(v), vt: Float64Array.from(vt), faces };
}

export function applyTarget(v, file, w) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    const i = +p[0] * 3;
    v[i] += w * +p[1]; v[i + 1] += w * +p[2]; v[i + 2] += w * +p[3];
  }
}

// ---------- rotation helpers ----------
const axisAngle = (ax, t) => {
  const [x, y, z] = ax, l = Math.hypot(x, y, z), a = x / l, b = y / l, c = z / l, C = Math.cos(t), S = Math.sin(t), D = 1 - C;
  return [[C + a * a * D, a * b * D - c * S, a * c * D + b * S], [b * a * D + c * S, C + b * b * D, b * c * D - a * S], [c * a * D - b * S, c * b * D + a * S, C + c * c * D]];
};
const mm = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mv = (M, p) => [M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2], M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2], M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2]];
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export function loadRig(v) {
  const skel = JSON.parse(readFileSync(MH + 'rigs/default.mhskel', 'utf8'));
  const weights = JSON.parse(readFileSync(MH + 'rigs/default_weights.mhw', 'utf8')).weights;
  const joint = name => {
    const ids = skel.joints[name]; let x = 0, y = 0, z = 0;
    for (const i of ids) { x += v[i * 3]; y += v[i * 3 + 1]; z += v[i * 3 + 2]; }
    return [x / ids.length, y / ids.length, z / ids.length];
  };
  const bones = {};
  for (const [name, b] of Object.entries(skel.bones)) bones[name] = { name, parent: b.parent, head: joint(b.head), tail: joint(b.tail) };
  const order = [];
  const visit = n => { if (order.includes(n)) return; const p = bones[n].parent; if (p) visit(p); order.push(n); };
  Object.keys(bones).forEach(visit);
  return { bones, order, weights };
}

// pose: { boneName: [[axis, angle], ...] } rotations in world space at the bone head, applied in rest orientation.
export function pose(v, rig, spec) {
  const { bones, order, weights } = rig;
  const W = {};
  for (const n of order) {
    const b = bones[n], P = b.parent ? W[b.parent] : null;
    let R = I3;
    for (const [ax, t] of spec[n] || []) R = mm(axisAngle(ax, t), R);
    const Rw = P ? mm(P.R, R) : R;
    const headPosed = P ? add3(P.T(b.head), [0, 0, 0]) : b.head;
    W[n] = { R: Rw, head: b.head, headPosed, T: p => add3(mv(Rw, sub3(p, b.head)), headPosed) };
  }
  const n = v.length / 3, out = new Float64Array(v.length), wsum = new Float64Array(n);
  for (const [bn, list] of Object.entries(weights)) {
    const T = W[bn]; if (!T) continue;
    for (const [i, w] of list) {
      const p = T.T([v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]);
      out[i * 3] += w * p[0]; out[i * 3 + 1] += w * p[1]; out[i * 3 + 2] += w * p[2]; wsum[i] += w;
    }
  }
  for (let i = 0; i < n; i++) {
    if (wsum[i] > 0) { out[i * 3] /= wsum[i]; out[i * 3 + 1] /= wsum[i]; out[i * 3 + 2] /= wsum[i]; }
    else { out[i * 3] = v[i * 3]; out[i * 3 + 1] = v[i * 3 + 1]; out[i * 3 + 2] = v[i * 3 + 2]; }
  }
  return { v: out, W };
}
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// Fit a proxy (.mhclo) to the (unposed, morphed) base mesh.
export function fitProxy(clo, baseV, proxyObj) {
  const lines = readFileSync(clo, 'utf8').split('\n');
  let mode = '', scale = [1, 1, 1];
  const refs = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const p = t.split(/\s+/);
    if (p[0] === 'x_scale' || p[0] === 'y_scale' || p[0] === 'z_scale') {
      const a = +p[1], b = +p[2], ref = +p[3], ax = 'xyz'.indexOf(p[0][0]);
      scale[ax] = Math.abs(baseV[a * 3 + ax] - baseV[b * 3 + ax]) / ref;
      continue;
    }
    if (p[0] === 'verts') { mode = 'verts'; continue; }
    if (mode === 'verts' && /^[\d]/.test(p[0])) {
      if (p.length >= 9) refs.push(p.slice(0, 9).map(Number));
      else if (p.length === 1) refs.push([+p[0], +p[0], +p[0], 1, 0, 0, 0, 0, 0]);
    } else if (mode === 'verts' && !/^[\d-]/.test(p[0])) mode = '';
  }
  const out = new Float64Array(refs.length * 3);
  refs.forEach((r, k) => {
    for (let a = 0; a < 3; a++)
      out[k * 3 + a] = r[3] * baseV[r[0] * 3 + a] + r[4] * baseV[r[1] * 3 + a] + r[5] * baseV[r[2] * 3 + a] + r[6 + a] * scale[a];
  });
  return out;
}
