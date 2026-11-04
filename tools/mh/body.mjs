// Morphed and posed MakeHuman body in metres (y up, ground at y = SOLE, facing +z, figure's left is +x).
import { readFileSync } from 'node:fs';
import { MH, parseObj, applyTarget, loadRig, pose, fitProxy } from './mh.mjs';

export const SOLE = 0.026;
const HEIGHT = 1.8;

const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function buildBody() {
  const obj = parseObj(readFileSync(MH + '3dobjs/base.obj', 'utf8'));
  const v = obj.v;
  applyTarget(v, MH + 'targets/caucasian-male-young.target', 1);
  applyTarget(v, MH + 'targets/universal-male-young-averagemuscle-averageweight.target', 0.25);
  applyTarget(v, MH + 'targets/universal-male-young-maxmuscle-averageweight.target', 0.75);
  const rig = loadRig(v);
  const B = rig.bones, dir = n => norm(sub(B[n].tail, B[n].head));

  const spec = {};
  const put = (n, ax, t) => (spec[n] = spec[n] || []).push([ax, t]);
  for (const s of [1, -1]) {
    const L = s > 0 ? '.L' : '.R';
    put('shoulder01' + L, [0, 0, 1], -s * 0.1);
    put('upperarm01' + L, [0, 0, 1], -s * 0.46);
    put('upperarm01' + L, [1, 0, 0], -0.06);
    const up = norm(sub(B['lowerarm01' + L].head, B['upperarm01' + L].head)), fo = norm(sub(B['wrist' + L].head, B['lowerarm01' + L].head));
    put('lowerarm01' + L, norm(cross(up, fo)), -0.5);
    put('wrist' + L, [0, 0, 1], -s * 0.08);
    const across = norm(sub(B['finger2-1' + L].head, B['finger5-1' + L].head));
    for (let f = 1; f <= 5; f++) {
      const curl = f === 1 ? [0.1, 0.15, 0.15] : [0.18 + 0.05 * f, 0.32 + 0.04 * f, 0.22 + 0.03 * f];
      for (let j = 1; j <= 3; j++) {
        const n = `finger${f}-${j}${L}`;
        if (!B[n]) continue;
        const ax = f === 1 ? norm(cross(dir(n), [0, 1, 0])) : norm(cross(dir(n), across));
        put(n, ax, -s * curl[j - 1] * (f === 1 ? 1 : 1));
      }
    }
  }
  put('upperleg01.L', [0, 1, 0], 0.12);
  put('upperleg01.L', [1, 0, 0], -0.09);
  put('upperleg01.L', [0, 0, 1], -0.02);
  put('lowerleg01.L', [1, 0, 0], 0.17);
  put('foot.L', [1, 0, 0], -0.05);
  put('upperleg01.R', [0, 1, 0], -0.06);
  put('upperleg01.R', [0, 0, 1], 0.015);
  put('spine03', [0, 0, 1], 0.025);
  put('spine01', [0, 0, 1], 0.015);
  put('neck01', [0, 1, 0], 0.04);
  put('head', [0, 1, 0], 0.05);
  put('head', [0, 0, 1], -0.03);
  put('head', [1, 0, 0], 0.03);

  const posed = pose(v, rig, spec);
  const P = posed.v;
  const bodyFaces = obj.faces.filter(f => f.g === 'body');
  const used = new Set(); bodyFaces.forEach(f => f.v.forEach(i => used.add(i)));
  let minY = Infinity, maxY = -Infinity;
  for (const i of used) { minY = Math.min(minY, P[i * 3 + 1]); maxY = Math.max(maxY, P[i * 3 + 1]); }
  const sc = HEIGHT / (maxY - minY);
  const X = p => [p[0] * sc, (p[1] - minY) * sc + SOLE, p[2] * sc];
  const out = new Float64Array(P.length);
  for (let i = 0; i < P.length / 3; i++) { const q = X([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); out[i * 3] = q[0]; out[i * 3 + 1] = q[1]; out[i * 3 + 2] = q[2]; }

  const joints = {};
  for (const [n, T] of Object.entries(posed.W)) joints[n] = { head: X(T.headPosed), tail: X(T.T(B[n].tail)), R: T.R };

  // eyes: fit the high-poly proxy to the unposed mesh, then move it with the head bone
  const eyeObj = parseObj(readFileSync(MH + 'eyes/high-poly.obj', 'utf8'));
  const eyeRest = fitProxy(MH + 'eyes/high-poly.mhclo', v, eyeObj);
  const H = posed.W['head'];
  const eyes = new Float64Array(eyeRest.length);
  for (let i = 0; i < eyeRest.length / 3; i++) { const q = X(H.T([eyeRest[i * 3], eyeRest[i * 3 + 1], eyeRest[i * 3 + 2]])); eyes[i * 3] = q[0]; eyes[i * 3 + 1] = q[1]; eyes[i * 3 + 2] = q[2]; }

  const weightsOf = {};
  for (const [bn, list] of Object.entries(rig.weights)) for (const [i, w] of list) (weightsOf[i] = weightsOf[i] || []).push([bn, w]);

  return { v: out, faces: obj.faces, bodyFaces, joints, eyes, eyeObj, weightsOf, scale: sc, groups: [...new Set(obj.faces.map(f => f.g))] };
}

// Triangles of a face list, as [i, j, k] vertex triples (and matching uv triples).
export function triangulate(faces) {
  const tris = [], uvs = [];
  for (const f of faces) for (let k = 1; k + 1 < f.v.length; k++) { tris.push([f.v[0], f.v[k], f.v[k + 1]]); uvs.push([f.t[0], f.t[k], f.t[k + 1]]); }
  return { tris, uvs };
}
