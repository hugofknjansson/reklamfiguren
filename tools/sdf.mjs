// Signed distance fields for the figure. Metres, y up, figure faces +z, figure's left is +x.
const { sqrt, max, min, abs, sin, cos, atan2, exp } = Math;

export const len = (x, y, z) => sqrt(x * x + y * y + z * z);
export const smin = (a, b, k) => { const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => -smin(-a, -b, k);
export const gauss = (v, c, w) => exp(-(((v - c) / w) ** 2));
const clamp = (v, a, b) => max(a, min(b, v));

export function S(c, r) { return (x, y, z) => len(x - c[0], y - c[1], z - c[2]) - r; }
export function E(c, r) {
  return (x, y, z) => {
    const qx = (x - c[0]) / r[0], qy = (y - c[1]) / r[1], qz = (z - c[2]) / r[2];
    const k0 = len(qx, qy, qz), k1 = len(qx / r[0], qy / r[1], qz / r[2]);
    return k1 === 0 ? -min(r[0], r[1], r[2]) : k0 * (k0 - 1) / k1;
  };
}
export function RC(a, b, r1, r2) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const l2 = bx * bx + by * by + bz * bz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const yy = px * bx + py * by + pz * bz, zz = yy - l2;
    const qx = px * l2 - bx * yy, qy = py * l2 - by * yy, qz = pz * l2 - bz * yy;
    const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
    return (sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = a => { const l = len(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const blend = (fs, k) => (x, y, z) => { let d = fs[0](x, y, z); for (let i = 1; i < fs.length; i++) d = smin(d, fs[i](x, y, z), k); return d; };

// ---------- shared skeleton ----------
export const EYE_Y = 1.666, EYE_Z = 0.0705, EYE_X = 0.032, EYE_R = 0.0125;
export const arm = {};
for (const s of [1, -1]) {
  const S0 = [s * 0.19, 1.405, -0.01];
  const u = norm([s * sin(0.2), -cos(0.2), 0.02]);
  const E1 = add(S0, mul(u, 0.29));
  const f = norm([s * sin(0.13), -cos(0.13), 0.16]);
  const W = add(E1, mul(f, 0.25));
  arm[s] = { S0, u, E1, f, W };
}
const along = (s, x, y, z) => { const a = arm[s]; return (x - a.S0[0]) * a.u[0] + (y - a.S0[1]) * a.u[1] + (z - a.S0[2]) * a.u[2]; };

// ---------- skin: head, neck, arms, hands (the rest is covered by clothes) ----------
const eyeC = s => [s * EYE_X, EYE_Y, EYE_Z];
const head = (() => {
  const parts = [
    E([0, 1.675, 0], [0.079, 0.098, 0.096]),
    RC([0, 1.64, 0.0], [0, 1.592, 0.05], 0.06, 0.028),
  ];
  const skull = blend(parts, 0.03);
  const cheeks = [1, -1].map(s => E([s * 0.043, 1.654, 0.05], [0.024, 0.018, 0.026]));
  const chin = S([0, 1.578, 0.068], 0.02);
  const brow = RC([-0.04, 1.693, 0.071], [0.04, 1.693, 0.071], 0.014, 0.014);
  const nose = RC([0, 1.69, 0.084], [0, 1.649, 0.102], 0.0085, 0.012);
  const wings = [1, -1].map(s => E([s * 0.0135, 1.645, 0.091], [0.009, 0.008, 0.009]));
  const lipU = E([0, 1.6125, 0.081], [0.02, 0.0055, 0.009]);
  const lipL = E([0, 1.602, 0.079], [0.018, 0.007, 0.009]);
  const mouth = E([0, 1.6072, 0.09], [0.02, 0.0012, 0.012]);
  const sockets = [1, -1].map(s => S([s * EYE_X, EYE_Y, 0.086], 0.0185));
  const lids = [1, -1].map(s => {
    const ball = S(eyeC(s), 0.0143), low = S(eyeC(s), 0.0136);
    return (x, y, z) => min(max(ball(x, y, z), EYE_Y + 0.0004 - y), max(low(x, y, z), y - (EYE_Y - 0.0068)));
  });
  const ears = [1, -1].map(s => E([s * 0.078, 1.664, -0.006], [0.011, 0.03, 0.019]));
  const earHoles = [1, -1].map(s => E([s * 0.085, 1.664, -0.004], [0.006, 0.02, 0.012]));
  const neck = RC([0, 1.40, -0.015], [0, 1.6, -0.008], 0.068, 0.058);
  return (x, y, z) => {
    let d = skull(x, y, z);
    for (const c of cheeks) d = smin(d, c(x, y, z), 0.02);
    d = smin(d, chin(x, y, z), 0.015);
    d = smin(d, brow(x, y, z), 0.02);
    for (const sk of sockets) d = smax(d, -sk(x, y, z), 0.012);
    for (const l of lids) d = smin(d, l(x, y, z), 0.003);
    d = smin(d, nose(x, y, z), 0.008);
    for (const w of wings) d = smin(d, w(x, y, z), 0.006);
    d = smin(d, lipU(x, y, z), 0.006);
    d = smin(d, lipL(x, y, z), 0.006);
    d = smax(d, -mouth(x, y, z), 0.002);
    for (let i = 0; i < 2; i++) d = smax(smin(d, ears[i](x, y, z), 0.008), -earHoles[i](x, y, z), 0.004);
    return smin(d, neck(x, y, z), 0.03);
  };
})();
export const lipDist = (x, y, z) => min(E([0, 1.6125, 0.081], [0.02, 0.0055, 0.009])(x, y, z), E([0, 1.602, 0.079], [0.018, 0.007, 0.009])(x, y, z));

const arms = [1, -1].map(s => {
  const { S0, u, E1, f, W } = arm[s];
  const limb = blend([
    RC(S0, E1, 0.046, 0.038),
    E(add(add(S0, mul(u, 0.14)), [0, 0, 0.012]), [0.038, 0.075, 0.04]),
    S(E1, 0.035),
    RC(E1, W, 0.041, 0.026),
    E(add(E1, mul(f, 0.07)), [0.04, 0.07, 0.038]),
  ], 0.02);
  const palm = E(add(W, [s * 0.002, -0.048, 0.004]), [0.017, 0.046, 0.04]);
  const fingers = [[0.028, 0.07, 0.0083], [0.0095, 0.078, 0.0086], [-0.0095, 0.074, 0.0082], [-0.027, 0.06, 0.0073]].map(([dz, L, r]) => {
    const K = add(W, [0, -0.088, dz]), M = add(K, [-s * 0.006, -L * 0.55, 0.004]), T = add(M, [-s * 0.012, -L * 0.45, 0.002]);
    const a = RC(K, M, r, r * 0.92), b = RC(M, T, r * 0.92, r * 0.8);
    return (x, y, z) => smin(a(x, y, z), b(x, y, z), 0.004);
  });
  const tb = add(W, [-s * 0.012, -0.03, 0.03]), tm = add(W, [-s * 0.02, -0.062, 0.05]), tt = add(W, [-s * 0.022, -0.088, 0.058]);
  const th1 = RC(tb, tm, 0.0115, 0.0095), th2 = RC(tm, tt, 0.0095, 0.0085);
  return (x, y, z) => {
    let h = palm(x, y, z);
    let fm = Infinity;
    for (const fg of fingers) fm = min(fm, fg(x, y, z));
    h = smin(h, fm, 0.006);
    h = smin(h, smin(th1(x, y, z), th2(x, y, z), 0.004), 0.01);
    const d = smin(limb(x, y, z), h, 0.015);
    return max(d, 0.12 - along(s, x, y, z));
  };
});
export const skin = (x, y, z) => smin(head(x, y, z), min(arms[0](x, y, z), arms[1](x, y, z)), 0.01);

// ---------- T-shirt ----------
const torso = blend([
  E([0, 0.97, 0], [0.2, 0.22, 0.13]),
  E([0, 1.06, 0.005], [0.155, 0.13, 0.108]),
  E([0, 1.27, 0], [0.178, 0.17, 0.12]),
  E([0.07, 1.3, 0.058], [0.08, 0.055, 0.05]), E([-0.07, 1.3, 0.058], [0.08, 0.055, 0.05]),
  E([0, 1.375, -0.015], [0.205, 0.085, 0.095]),
  RC([0, 1.45, -0.02], [0.17, 1.415, -0.01], 0.055, 0.045), RC([0, 1.45, -0.02], [-0.17, 1.415, -0.01], 0.055, 0.045),
  E([0.195, 1.39, -0.005], [0.058, 0.062, 0.057]), E([-0.195, 1.39, -0.005], [0.058, 0.062, 0.057]),
], 0.05);
const sleeves = [1, -1].map(s => {
  const { S0, u } = arm[s];
  const c = RC(S0, add(S0, mul(u, 0.17)), 0.062, 0.058);
  return (x, y, z) => {
    const t = along(s, x, y, z);
    return max(c(x, y, z) - 0.0035 * gauss(t, 0.163, 0.006), t - 0.17);
  };
});
export const shirt = (x, y, z) => {
  const ang = atan2(x, z);
  let d = torso(x, y, z) - 0.012;
  d = smin(d, min(sleeves[0](x, y, z), sleeves[1](x, y, z)), 0.03);
  d += 0.0025 * sin(ang * 9 + y * 20) * gauss(y, 0.99, 0.04) + 0.0015 * sin(ang * 5 + 1) * gauss(y, 1.16, 0.06);
  d -= 0.002 * gauss(y, 0.897, 0.005);
  d = smax(d, 0.885 - y, 0.008);
  const hole = max(len(x, 0, (z + 0.012) / 0.85) - 0.062, 1.405 - y);
  d = smax(d, -hole, 0.01);
  const rib = len(len(x, 0, (z + 0.012) / 0.85) - 0.066, y - 1.452, 0) - 0.0085;
  return smin(d, rib, 0.004);
};
export const inSleeve = (s, x, y, z) => along(s, x, y, z);

// ---------- jeans ----------
const hips = blend([
  E([0, 0.92, 0], [0.172, 0.115, 0.118]),
  E([0.07, 0.87, -0.05], [0.09, 0.095, 0.08]), E([-0.07, 0.87, -0.05], [0.09, 0.095, 0.08]),
], 0.04);
const legs = [1, -1].map(s => {
  const H = [s * 0.09, 0.9, 0], K = [s * 0.1, 0.49, 0.012], A = [s * 0.105, 0.07, -0.005];
  return blend([RC(H, K, 0.1, 0.072), RC(K, A, 0.072, 0.06)], 0.03);
});
export const legCenterX = s => s * 0.1;
export const pants = (x, y, z) => {
  let d = smin(hips(x, y, z), min(legs[0](x, y, z), legs[1](x, y, z)), 0.04) + 0.004;
  const s = x >= 0 ? 1 : -1, la = atan2(x - s * 0.1, z);
  d += 0.003 * sin(la * 5) * gauss(y, 0.48, 0.04) + 0.005 * sin(la * 6 + y * 80) * gauss(y, 0.1, 0.03);
  d -= 0.0018 * gauss(y, 0.938, 0.003);
  const pocket = (z < 0 ? 1 : 0) * clamp((0.05 - abs(abs(x) - 0.075)) * 200, 0, 1) * clamp((0.045 - abs(y - 0.845)) * 200, 0, 1);
  d -= 0.002 * pocket;
  return max(max(d, y - 0.975), 0.065 - y);
};

// ---------- sneakers ----------
const shoeShape = [1, -1].map(s => RC([s * 0.105, 0.045, -0.035], [s * 0.112, 0.04, 0.16], 0.048, 0.042));
export const shoes = (x, y, z) => {
  let d = Infinity;
  for (let i = 0; i < 2; i++) {
    const s = i ? -1 : 1, yy = (y - 0.03) * 1.25 + 0.03;
    let e = max(shoeShape[i](x, yy, z), 0.024 - y);
    e = smax(e, -max(len(x - s * 0.105, 0, z + 0.02) - 0.034, 0.085 - y), 0.006);
    d = min(d, e);
  }
  return d;
};
export const soles = (x, y, z) => {
  let d = Infinity;
  for (let i = 0; i < 2; i++) d = min(d, shoeShape[i](x, 0.042, z) - 0.004);
  return smax(d, abs(y - 0.014) - 0.014, 0.006);
};

// ---------- hair and brows ----------
const hairBase = E([0, 1.69, -0.008], [0.087, 0.101, 0.105]);
const fringe = E([0, 1.737, 0.058], [0.072, 0.026, 0.042]);
const earCut = [1, -1].map(s => E([s * 0.08, 1.66, -0.006], [0.02, 0.04, 0.03]));
const brows = [1, -1].map(s => RC([s * 0.015, 1.692, 0.094], [s * 0.05, 1.696, 0.086], 0.0052, 0.0036));
export const hair = (x, y, z) => {
  let d = smin(hairBase(x, y, z), fringe(x, y, z), 0.02);
  d -= 0.0025 * sin(x * 140 + sin(z * 90) * 2) * sin(y * 120 + z * 70);
  const hl = 1.598 + clamp((z + 0.1) / 0.19, 0, 1) * 0.137;
  d += 0.007 * clamp(1 - (y - hl) / 0.025, 0, 1);
  d = smax(d, hl - y, 0.006);
  for (const c of earCut) d = smax(d, -c(x, y, z), 0.01);
  return min(d, brows[0](x, y, z), brows[1](x, y, z));
};

export const eyes = [1, -1].map(s => eyeC(s));
