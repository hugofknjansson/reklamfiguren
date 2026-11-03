// Surface nets over a distance function, with vertices projected onto the surface and normals from the gradient.
const { abs, min, max, sqrt } = Math;
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const grad = (f, x, y, z, e) => [f(x + e, y, z) - f(x - e, y, z), f(x, y + e, z) - f(x, y - e, z), f(x, y, z + e) - f(x, y, z - e)];

export function surfaceNets(f, lo, hi, h) {
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
  const pos = [], c = new Float64Array(8);
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
  const q2 = quads.map(q => q.map(x => cell[x])).filter(q => q.every(v => v >= 0));
  // project, normals
  const n = pos.length / 3, nrm = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const x0 = x, y0 = y, z0 = z;
    for (let it = 0; it < 3; it++) {
      const d = f(x, y, z), g = grad(f, x, y, z, h * 0.25), gg = g[0] ** 2 + g[1] ** 2 + g[2] ** 2;
      if (gg < 1e-12) break;
      const s = d * (h * 0.5) / gg;
      x -= g[0] * s; y -= g[1] * s; z -= g[2] * s;
    }
    if (Math.hypot(x - x0, y - y0, z - z0) > h) { x = x0; y = y0; z = z0; }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    const g = grad(f, x, y, z, h * 0.5), gl = Math.hypot(...g) || 1;
    nrm[v * 3] = g[0] / gl; nrm[v * 3 + 1] = g[1] / gl; nrm[v * 3 + 2] = g[2] / gl;
  }
  const P = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const d2 = (a, b) => { const p = P(a), q = P(b); return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; };
  const tris = [];
  for (const [a, b, c2, d] of q2) {
    for (const tri of d2(a, c2) < d2(b, d) ? [[a, b, c2], [a, c2, d]] : [[a, b, d], [b, c2, d]]) {
      const p0 = P(tri[0]), p1 = P(tri[1]), p2 = P(tri[2]);
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      let sx = 0, sy = 0, sz = 0;
      for (const t of tri) { sx += nrm[t * 3]; sy += nrm[t * 3 + 1]; sz += nrm[t * 3 + 2]; }
      tris.push(fx * sx + fy * sy + fz * sz < 0 ? [tri[0], tri[2], tri[1]] : tri);
    }
  }
  return { pos: Float64Array.from(pos), nrm, tris };
}

export function bakeAO(pos, nrm, scene, step = 0.008) {
  const n = pos.length / 3, ao = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
    let occ = 0;
    for (let i = 1; i <= 5; i++) { const dd = i * step; occ += (dd - scene(x + nx * dd, y + ny * dd, z + nz * dd)) / (1 << i); }
    ao[v] = max(0.3, min(1, 1 - 3.4 * occ));
  }
  return ao;
}
