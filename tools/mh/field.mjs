// Voxel solids and signed distance fields (Felzenszwalb EDT) for fitting clothes to the body mesh.
export class Grid {
  constructor(lo, hi, h) {
    this.lo = lo; this.h = h;
    this.n = [0, 1, 2].map(a => Math.ceil((hi[a] - lo[a]) / h) + 1);
    this.size = this.n[0] * this.n[1] * this.n[2];
  }
  id(i, j, k) { return i + this.n[0] * (j + this.n[1] * k); }
  pos(i, j, k) { return [this.lo[0] + i * this.h, this.lo[1] + j * this.h, this.lo[2] + k * this.h]; }
}

// Mark voxels touched by triangles (dense barycentric sampling).
export function surfaceVoxels(G, pos, tris) {
  const S = new Uint8Array(G.size), h = G.h;
  for (const [a, b, c] of tris) {
    const A = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], B = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], C = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    const L = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), Math.hypot(C[0] - A[0], C[1] - A[1], C[2] - A[2]), Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]));
    const m = Math.max(1, Math.ceil(L / (h * 0.4)));
    for (let u = 0; u <= m; u++) for (let v = 0; v <= m - u; v++) {
      const w = m - u - v;
      const p = [0, 1, 2].map(k => (A[k] * u + B[k] * v + C[k] * w) / m);
      const i = Math.round((p[0] - G.lo[0]) / h), j = Math.round((p[1] - G.lo[1]) / h), k = Math.round((p[2] - G.lo[2]) / h);
      if (i >= 0 && j >= 0 && k >= 0 && i < G.n[0] && j < G.n[1] && k < G.n[2]) S[G.id(i, j, k)] = 1;
    }
  }
  return S;
}
// Inside = everything the outside flood fill cannot reach (the grid's top face is not a seed).
export function solidFromSurface(G, S) {
  const [nx, ny, nz] = G.n, out = new Uint8Array(G.size), stack = new Int32Array(G.size);
  let sp = 0;
  const push = (i, j, k) => { const q = G.id(i, j, k); if (!S[q] && !out[q]) { out[q] = 1; stack[sp++] = q; } };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny - 1; j++) { push(0, j, k); push(nx - 1, j, k); }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) push(i, 0, k);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++) { push(i, j, 0); push(i, j, nz - 1); }
  while (sp) {
    const q = stack[--sp], i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0;
    if (i > 0) push(i - 1, j, k); if (i < nx - 1) push(i + 1, j, k);
    if (j > 0) push(i, j - 1, k); if (j < ny - 2) push(i, j + 1, k);
    if (k > 0) push(i, j, k - 1); if (k < nz - 1) push(i, j, k + 1);
  }
  const solid = new Uint8Array(G.size);
  for (let q = 0; q < G.size; q++) solid[q] = out[q] ? 0 : 1;
  return solid;
}

const INF = 1e20;
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
// Squared distance (in voxels) to the nearest voxel where src is set.
function edt(G, src) {
  const [nx, ny, nz] = G.n, D = new Float64Array(G.size);
  for (let q = 0; q < G.size; q++) D[q] = src[q] ? 0 : INF;
  const m = Math.max(nx, ny, nz), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = D[G.id(i, j, k)];
    edt1d(f, nx, d, v, z);
    for (let i = 0; i < nx; i++) D[G.id(i, j, k)] = d[i];
  }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = D[G.id(i, j, k)];
    edt1d(f, ny, d, v, z);
    for (let j = 0; j < ny; j++) D[G.id(i, j, k)] = d[j];
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) f[k] = D[G.id(i, j, k)];
    edt1d(f, nz, d, v, z);
    for (let k = 0; k < nz; k++) D[G.id(i, j, k)] = d[k];
  }
  return D;
}
// Signed distance in metres: negative inside the solid.
export function signedDistance(G, solid) {
  const inv = new Uint8Array(G.size);
  for (let q = 0; q < G.size; q++) inv[q] = solid[q] ? 0 : 1;
  const dOut = edt(G, solid), dIn = edt(G, inv), sd = new Float32Array(G.size), h = G.h;
  for (let q = 0; q < G.size; q++) sd[q] = solid[q] ? -(Math.sqrt(dIn[q]) - 0.5) * h : (Math.sqrt(dOut[q]) - 0.5) * h;
  return sd;
}
export function threshold(G, sd, t) { const s = new Uint8Array(G.size); for (let q = 0; q < G.size; q++) s[q] = sd[q] < t ? 1 : 0; return s; }
// Morphological closing with radius r, returned as a signed distance field.
export function closing(G, solid, r) {
  const dil = threshold(G, signedDistance(G, solid), r);
  const sd = signedDistance(G, dil);
  for (let q = 0; q < G.size; q++) sd[q] += r;
  return sd;
}
// Mark voxels within r of any listed vertex.
export function stamp(G, pos, ids, r) {
  const Z = new Uint8Array(G.size), h = G.h, k = Math.ceil(r / h), r2 = (r / h) ** 2;
  for (const i of ids) {
    const ci = Math.round((pos[i * 3] - G.lo[0]) / h), cj = Math.round((pos[i * 3 + 1] - G.lo[1]) / h), ck = Math.round((pos[i * 3 + 2] - G.lo[2]) / h);
    for (let c = -k; c <= k; c++) for (let b = -k; b <= k; b++) for (let a = -k; a <= k; a++) {
      if (a * a + b * b + c * c > r2) continue;
      const x = ci + a, y = cj + b, z = ck + c;
      if (x >= 0 && y >= 0 && z >= 0 && x < G.n[0] && y < G.n[1] && z < G.n[2]) Z[G.id(x, y, z)] = 1;
    }
  }
  return Z;
}
export function mask(G, solid, keep) {
  const out = new Uint8Array(G.size), [nx, ny] = G.n;
  for (let q = 0; q < G.size; q++) {
    if (!solid[q]) continue;
    const i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0;
    if (keep(G.lo[0] + i * G.h, G.lo[1] + j * G.h, G.lo[2] + k * G.h, q)) out[q] = 1;
  }
  return out;
}
// Separable box blur, used to remove voxel stair-steps from distance fields.
export function blur(G, sd, passes = 2) {
  const [nx, ny, nz] = G.n, strides = [1, nx, nx * ny], dims = [nx, ny, nz];
  let a = Float32Array.from(sd), b = new Float32Array(G.size);
  for (let p = 0; p < passes; p++) for (let ax = 0; ax < 3; ax++) {
    const st = strides[ax], n = dims[ax];
    for (let q = 0; q < G.size; q++) {
      const c = ((q / st) | 0) % n;
      b[q] = (a[c > 0 ? q - st : q] + a[q] + a[c < n - 1 ? q + st : q]) / 3;
    }
    [a, b] = [b, a];
  }
  return a;
}
export function sampler(G, sd) {
  const [nx, ny, nz] = G.n, h = G.h;
  return (x, y, z) => {
    const fx = (x - G.lo[0]) / h, fy = (y - G.lo[1]) / h, fz = (z - G.lo[2]) / h;
    if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1.001 || fy > ny - 1.001 || fz > nz - 1.001) return 0.05;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, v = fy - j, w = fz - k;
    const g = (a, b, c) => sd[(i + a) + nx * ((j + b) + ny * (k + c))];
    return (((g(0, 0, 0) * (1 - u) + g(1, 0, 0) * u) * (1 - v) + (g(0, 1, 0) * (1 - u) + g(1, 1, 0) * u) * v) * (1 - w)
      + ((g(0, 0, 1) * (1 - u) + g(1, 0, 1) * u) * (1 - v) + (g(0, 1, 1) * (1 - u) + g(1, 1, 1) * u) * v) * w);
  };
}
