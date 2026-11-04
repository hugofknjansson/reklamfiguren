// A relaxed closed-mouth smile, applied as a smooth displacement field around the mouth, cheeks and lower lids.
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function applySmile(body, tris, amount = 1) {
  const R = body.joints['head'].R, n = body.eyes.length / 3;
  let e = [0, 0, 0];
  for (let i = 0; i < n; i++) e = add(e, [body.eyes[i * 3], body.eyes[i * 3 + 1], body.eyes[i * 3 + 2]]);
  e = mul(e, 1 / n);
  const ax = [R[0][0], R[1][0], R[2][0]], ay = [R[0][1], R[1][1], R[2][1]], az = [R[0][2], R[1][2], R[2][2]];
  const origin = add(add(e, mul(ay, 0.009)), mul(az, -0.0705));
  const toL = p => { const q = sub(p, origin); return [dot(q, ax), dot(q, ay), dot(q, az)]; };
  const toWd = l => add(add(mul(ax, l[0]), mul(ay, l[1])), mul(az, l[2]));
  const eyeL = [1, -1].map(s => {
    let c = [0, 0, 0], k = 0;
    for (let i = 0; i < n; i++) if ((body.eyes[i * 3] - e[0]) * s > 0) { c = add(c, [body.eyes[i * 3], body.eyes[i * 3 + 1], body.eyes[i * 3 + 2]]); k++; }
    return toL(mul(c, 1 / k));
  });
  const ids = [...new Set(tris.flat())];
  const L = new Map(ids.map(i => [i, toL([body.v[i * 3], body.v[i * 3 + 1], body.v[i * 3 + 2]])]));
  let nose = null, slit = null;
  for (const l of L.values()) if (Math.abs(l[0]) < 0.006 && l[1] < eyeL[0][1] && l[1] > eyeL[0][1] - 0.07 && (!nose || l[2] > nose[2])) nose = l;
  for (const l of L.values()) if (Math.abs(l[0]) < 0.004 && l[1] < nose[1] - 0.025 && l[1] > nose[1] - 0.04 && l[2] > nose[2] - 0.04 && (!slit || l[2] < slit[2])) slit = l;
  // mouth corners: the most lateral points on the lip line that are still on the front of the face
  const corner = [1, -1].map(s => {
    let best = null;
    for (const l of L.values()) if (Math.abs(l[1] - slit[1]) < 0.003 && l[2] > slit[2] - 0.018 && s * l[0] > 0 && s * l[0] < 0.032 && (!best || s * l[0] > s * best[0])) best = l;
    return best;
  });
  const g = (l, c, r) => Math.exp(-(((l[0] - c[0]) ** 2 + (l[1] - c[1]) ** 2 + (l[2] - c[2]) ** 2) / (r * r)));
  const fields = [];
  for (const [k, s] of [[0, 1], [1, -1]]) {
    const C = corner[k];
    fields.push([[C[0], C[1], C[2] - 0.003], 0.012, [s * 0.0022, 0.0036, -0.0018]]);
    fields.push([[C[0] - s * 0.008, C[1] + 0.003, C[2] + 0.004], 0.008, [s * 0.0008, 0.0012, -0.0004]]);
    fields.push([[C[0] - s * 0.009, C[1] - 0.005, C[2] + 0.003], 0.008, [s * 0.0008, 0.0008, -0.0006]]);
    fields.push([[s * 0.039, nose[1] - 0.004, nose[2] - 0.032], 0.019, [s * 0.0006, 0.0024, 0.0016]]);
    const E = eyeL[k];
    fields.push([[E[0], E[1] - 0.0095, E[2] + 0.006], 0.0075, [0, 0.0011, 0.0004]]);
  }
  for (const [i, l] of L) {
    if (Math.hypot(l[0], l[1], l[2]) > 0.2) continue;
    let d = [0, 0, 0];
    for (const [c, r, v] of fields) d = add(d, mul(v, g(l, c, r) * amount));
    if (d[0] === 0 && d[1] === 0 && d[2] === 0) continue;
    const w = toWd(d);
    body.v[i * 3] += w[0]; body.v[i * 3 + 1] += w[1]; body.v[i * 3 + 2] += w[2];
  }
  return { nose, slit, corner };
}
