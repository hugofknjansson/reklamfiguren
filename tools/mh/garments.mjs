// T-shirt, jeans and sneakers fitted to the posed MakeHuman body.
import { Grid, surfaceVoxels, solidFromSurface, signedDistance, closing, mask, sampler, blur, stamp } from './field.mjs';

const { sqrt, max, min, abs, sin, cos, atan2, exp, PI } = Math;
const clamp = (v, a, b) => max(a, min(b, v));
const gauss = (v, c, w) => exp(-(((v - c) / w) ** 2));
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
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
// Distance from p to segment a-b and the segment parameter.
function seg(p, a, b) {
  const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / dot(ab, ab), 0, 1);
  const q = add(a, mul(ab, t));
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), t, q };
}

export function buildGarments(body, tris, log, sealTris = []) {
  const J = n => body.joints[n];
  const G = new Grid([-0.42, 0.0, -0.24], [0.42, 1.7, 0.28], 0.004);
  const surf = surfaceVoxels(G, body.v, tris);
  for (const { pos, tris: t } of sealTris) { const s2 = surfaceVoxels(G, pos, t); for (let q = 0; q < G.size; q++) surf[q] |= s2[q]; }
  const solid = solidFromSurface(G, surf);
  log('body voxelised');

  const side = {};
  for (const [s, L] of [[1, '.L'], [-1, '.R']]) {
    const sh = J('upperarm01' + L).head, el = J('lowerarm01' + L).head, wr = J('wrist' + L).head;
    const ud = norm(sub(el, sh)), tip = J('finger3-3' + L).tail, hand = add(tip, mul(norm(sub(tip, wr)), 0.015));
    const hip = J('upperleg01' + L).head, knee = J('lowerleg01' + L).head, ankle = J('foot' + L).head;
    side[s] = { sh, el, wr, ud, hand, hip, knee, ankle, L };
  }
  const neckA = J('neck01').head, neckB = J('head').head;
  const neckY = neckA[1];
  const hemY = J('upperleg01.L').head[1] - 0.025;
  const waistY = J('upperleg01.L').head[1] + 0.085;
  const pantsHem = 0.088;

  const vertsOf = test => Object.entries(body.weightsOf).filter(([, ws]) => { let w = 0; for (const [b, ww] of ws) if (test(b)) w += ww; return w > 0.5; }).map(([i]) => +i);
  const armBone = b => /^(upperarm|lowerarm|wrist|metacarpal|finger)/.test(b);
  const foreBone = b => /^(lowerarm|wrist|metacarpal|finger)/.test(b);
  const armZone = stamp(G, body.v, vertsOf(armBone), 0.018);
  const foreZone = stamp(G, body.v, vertsOf(foreBone), 0.022);
  const armSD = sampler(G, blur(G, signedDistance(G, armZone), 1));
  log('arm zones');
  // ----- T-shirt -----
  const inArm = (p, s, from) => { const S = side[s]; return seg(p, add(S.sh, mul(S.ud, from)), S.hand).d < 0.072; };
  const torso = mask(G, solid, (x, y, z, q) => y > hemY - 0.08 && y < neckY - 0.01 && !armZone[q]);
  const torsoSD = sampler(G, blur(G, closing(G, torso, 0.019), 3));
  log('shirt torso closed');
  const sleeveSolid = mask(G, solid, (x, y, z, q) => {
    const p = [x, y, z];
    if (foreZone[q]) return false;
    for (const s of [1, -1]) { const S = side[s], r = seg(p, sub(S.sh, mul(S.ud, 0.03)), add(S.sh, mul(S.ud, 0.22))); if (r.d < 0.075) return true; }
    return false;
  });
  const sleeveSD = sampler(G, blur(G, closing(G, sleeveSolid, 0.01), 2));
  log('sleeves closed');
  const along = (s, p) => dot(sub(p, side[s].sh), side[s].ud);
  const neckDist = p => seg(p, neckA, neckB).d;
  const shirt = (x, y, z) => {
    const p = [x, y, z], ang = atan2(x, z);
    let d = torsoSD(x, y, z) - 0.013;
    d = smax(d, -armSD(x, y, z) + (y < side[1].sh[1] - 0.16 ? 0.012 : -0.002), 0.008);
    for (const s of [1, -1]) {
      const t = along(s, p);
      let sl = sleeveSD(x, y, z) - 0.012 - 0.005 * smoothstep(0.1, 0.02, t);
      sl -= 0.0035 * gauss(t, 0.128, 0.006);
      sl = smax(sl, t - 0.134, 0.004);
      d = smin(d, sl, 0.03);
      const lat = s * x;
      d -= 0.0022 * sin(((y - side[s].sh[1] + 0.12) + (lat - 0.13) * 0.9) * 140) * gauss(lat, 0.13, 0.035) * gauss(y, side[s].sh[1] - 0.12, 0.05) * (z > -0.02 ? 1 : 0.4);
    }
    d += 0.003 * sin(ang * 8 + y * 25 + 2 * vnoise(x * 30, y * 30, z * 30)) * gauss(y, hemY + 0.08, 0.045);
    d += 0.0018 * sin(ang * 5 + 1) * gauss(y, hemY + 0.24, 0.06);
    d -= 0.0022 * gauss(y, hemY + 0.012, 0.005);
    d = smax(d, hemY - y, 0.008);
    const nd = neckDist(p);
    const ny0 = neckY - 0.03 - 0.25 * max(0, z - neckA[2]);
    d = smax(d, -max(nd - 0.07, ny0 - y), 0.01);
    const rib = Math.hypot(nd - 0.074, (y - ny0 - 0.004) * 0.7) - 0.0085;
    return smin(d, rib, 0.004);
  };

  // ----- jeans -----
  const lower = mask(G, solid, (x, y, z, q) => y < waistY + 0.03 && y > 0.05 && !foreZone[q]);
  const lowerSD = sampler(G, blur(G, closing(G, lower, 0.016), 3));
  log('jeans closed');
  const legOf = x => side[x >= 0 ? 1 : -1];
  const legAngle = (S, p) => {
    const r1 = seg(p, S.hip, S.knee), r2 = seg(p, S.knee, S.ankle), q = (r1.d < r2.d ? r1 : r2).q;
    return { ang: atan2((x => x)(p[0] - q[0]) * (S === side[1] ? 1 : -1), p[2] - q[2]), q };
  };
  const pants = (x, y, z) => {
    const p = [x, y, z], S = legOf(x), { ang } = legAngle(S, p);
    const loose = 0.008 + 0.011 * smoothstep(S.knee[1], S.ankle[1] + 0.05, y);
    let d = lowerSD(x, y, z) - loose;
    d += 0.0035 * sin(ang * 5 + 0.5) * gauss(y, S.knee[1], 0.035) * (S === side[1] ? 1.6 : 0.7);
    d += 0.0055 * sin(ang * 6 + y * 80) * gauss(y, pantsHem + 0.03, 0.03);
    d -= 0.0013 * gauss(abs(ang), PI / 2, 0.06) * (y < hemY ? 1 : 0);
    d -= 0.0011 * gauss(abs(ang), PI / 2 + 0.55, 0.05) * (y < hemY - 0.12 ? 1 : 0);
    if (z < 0) for (const s of [1, -1]) {
      const px = s * x - 0.07, py = y - (hemY - 0.045);
      if (abs(px) < 0.05 - max(0, -py - 0.02) * 0.4 && py < 0.045 && py > -0.05) d -= 0.0022;
    }
    if (z > 0) for (let k = 0; k < 4; k++) {
      const s = x >= 0 ? 1 : -1, w = (y - (hemY - 0.13)) + (s * x - 0.03) * (0.35 + k * 0.25);
      d -= 0.0012 * gauss(w, 0, 0.004) * gauss(s * x, 0.07, 0.04) * gauss(y, hemY - 0.15, 0.04);
    }
    d = smax(d, y - waistY, 0.004);
    return smax(d, pantsHem - y, 0.004);
  };
  const denimWash = (x, y, z) => {
    const S = legOf(x), { ang } = legAngle(S, [x, y, z]);
    return clamp(gauss(ang, 0, 0.8) * (0.55 * gauss(y, (S.hip[1] + S.knee[1]) / 2, 0.1) + 0.45 * gauss(y, S.knee[1], 0.05)) + 0.15 * vnoise(x * 60, y * 25, z * 60), 0, 1);
  };

  // ----- sneakers, sized from the feet -----
  const feet = [1, -1].map(s => {
    const L = side[s].L, ids = [];
    for (const [vi, ws] of Object.entries(body.weightsOf)) {
      let w = 0;
      for (const [bn, ww] of ws) if (bn === 'foot' + L || bn.startsWith('toe')) w += bn.endsWith(L) || bn === 'foot' + L ? ww : 0;
      if (w > 0.5) ids.push(+vi);
    }
    const toeTip = J('toe3-1' + L).tail, ankle = side[s].ankle;
    const f = norm([toeTip[0] - ankle[0], 0, toeTip[2] - ankle[2]]), sd = norm(cross([0, 1, 0], f));
    let zmin = Infinity, zmax = -Infinity, wmax = 0, o = [ankle[0], 0, ankle[2]];
    for (const i of ids) {
      const q = sub([body.v[i * 3], 0, body.v[i * 3 + 2]], o);
      const a = dot(q, f), b = dot(q, sd);
      zmin = min(zmin, a); zmax = max(zmax, a); wmax = max(wmax, abs(b));
    }
    const heel = add(o, mul(f, zmin - 0.012));
    return { s, o: heel, f, sd, len: zmax - zmin + 0.03, wid: 2 * wmax + 0.016 };
  });
  const toFoot = (F, x, y, z) => {
    const q = [x - F.o[0], 0, z - F.o[2]];
    return [dot(q, F.sd) * F.s * (0.09 / F.wid), y, dot(q, F.f) * (0.27 / F.len)];
  };
  const soleOutline = (x, z) => {
    const c1 = Math.hypot(x, z - 0.045) - 0.037, c2 = Math.hypot(x - 0.004, z - 0.19) - 0.046, c3 = Math.hypot(x + 0.002, z - 0.235) - 0.036;
    return smin(smin(c1, c2, 0.08), c3, 0.03);
  };
  const E = (c, r) => (x, y, z) => {
    const qx = (x - c[0]) / r[0], qy = (y - c[1]) / r[1], qz = (z - c[2]) / r[2];
    const k0 = Math.hypot(qx, qy, qz), k1 = Math.hypot(qx / r[0], qy / r[1], qz / r[2]);
    return k1 === 0 ? -min(...r) : k0 * (k0 - 1) / k1;
  };
  const capsule = (a, b, r) => p3 => seg(p3, a, b).d - r;
  const upperParts = [E([0, 0.064, 0.052], [0.038, 0.052, 0.05]), E([0.002, 0.052, 0.165], [0.044, 0.038, 0.088]), E([0, 0.042, 0.228], [0.037, 0.028, 0.04])];
  const laceZ = [0.095, 0.115, 0.135, 0.155];
  const laces = laceZ.map(zz => { const yy = 0.094 - (zz - 0.095) * 0.42; return capsule([-0.018, yy, zz - 0.004], [0.018, yy, zz + 0.006], 0.0024); });
  const tongue = E([0, 0.093, 0.112], [0.026, 0.013, 0.052]);
  const shoeLocal = (x, y, z) => {
    let u = smin(smin(upperParts[0](x, y, z), upperParts[1](x, y, z), 0.04), upperParts[2](x, y, z), 0.04);
    u = smin(u, tongue(x, y, z), 0.01);
    u = max(u, 0.028 - y);
    u = smax(u, -max(Math.hypot(x, z - 0.06) - 0.034, 0.09 - y), 0.006);
    let lc = Infinity;
    for (const l of laces) lc = min(lc, l([x, y, z]));
    return min(u, lc);
  };
  const soleLocal = (x, y, z) => smax(soleOutline(x, z) - 0.002, abs(y - smoothstep(0.2, 0.27, z) * 0.012 - 0.016) - 0.016, 0.008);
  const shoes = (x, y, z) => min(...feet.map(F => { const p = toFoot(F, x, y, z); return shoeLocal(p[0], p[1], p[2]); }));
  const soles = (x, y, z) => min(...feet.map(F => { const p = toFoot(F, x, y, z); return soleLocal(p[0], p[1], p[2]); }));
  const shoeColor = (x, y, z) => {
    const F = feet[x >= 0 ? 0 : 1], p = toFoot(F, x, y, z);
    let lc = Infinity;
    for (const l of laces) lc = min(lc, l(p));
    if (lc < 0.0015) return [0.92, 0.92, 0.9];
    if (laceZ.some(zz => abs(abs(p[0]) - 0.021) < 0.0035 && abs(p[2] - zz) < 0.0035)) return [0.75, 0.75, 0.75];
    if ((p[2] > 0.205 && p[1] < 0.062) || (p[2] < 0.025 && p[1] > 0.065)) return [0.2, 0.21, 0.24];
    return [0.11, 0.12, 0.14];
  };
  const soleColor = (x, y, z) => {
    const p = toFoot(feet[x >= 0 ? 0 : 1], x, y, z);
    if (p[1] < 0.005) return [0.35, 0.35, 0.36];
    if (abs(p[1] - 0.021) < 0.0025) return [0.62, 0.63, 0.65];
    return [0.93, 0.93, 0.91];
  };

  const shirtUV = (x, y, z) => {
    for (const s of [1, -1]) {
      const S = side[s], t = along(s, [x, y, z]);
      if (t > 0.02 && s * x > s * S.sh[0] - 0.01) { const c = add(S.sh, mul(S.ud, t)); return [atan2(z - c[2], s * (x - c[0])) * 0.06, t]; }
    }
    return [atan2(x, z) * 0.18, y];
  };
  const pantsUV = (x, y, z) => [legAngle(legOf(x), [x, y, z]).ang * 0.085, y];
  const shoeBox = { lo: [min(...feet.map(F => F.o[0])) - 0.12, 0, min(...feet.map(F => F.o[2])) - 0.05], hi: [max(...feet.map(F => F.o[0])) + 0.12, 0.14, max(...feet.map(F => F.o[2] + F.f[2] * F.len)) + 0.06] };
  const bodySD = sampler(G, blur(G, signedDistance(G, solid), 1));
  log('body field');
  return { shirt, pants, shoes, soles, denimWash, shoeColor, soleColor, shirtUV, pantsUV, shoeBox, bodySD, hemY, waistY, neckY, side };
}
