"""Fit a separate head scan onto the head of a cleaned body scan (similarity transform found by ICP).

Usage: python3 -I tools/scan/align_head.py <head mesh.json> <body clean.json> <out head-aligned.json> [yaw degrees]
The head scan may have any scale and any rotation about the vertical axis.
"""
import json
import sys

import numpy as np

head_path, body_path, out_path = sys.argv[1:4]
H = json.load(open(head_path))
B = json.load(open(body_path))
hp = np.array(H['pos'], dtype=np.float64).reshape(-1, 3)
bp = np.array(B['pos'], dtype=np.float64).reshape(-1, 3)


def neck_level(P, lo, hi, step=0.01):
    """Height of the narrowest horizontal cross-section between lo and hi."""
    best = None
    for y in np.arange(lo, hi, step):
        s = P[np.abs(P[:, 1] - y) < step]
        if len(s) < 20:
            continue
        w = (s[:, 0].max() - s[:, 0].min()) * (s[:, 2].max() - s[:, 2].min())
        if best is None or w < best[0]:
            best = (w, y)
    return best[1]


h_top, b_top = hp[:, 1].max(), bp[:, 1].max()
h_neck = neck_level(hp, h_top * 0.45, h_top * 0.7)
b_neck = neck_level(bp, b_top - 0.3, b_top - 0.17)
s0 = (b_top - b_neck) / (h_top - h_neck)
print('neck levels', round(h_neck, 3), round(b_neck, 3), 'initial scale', round(s0, 3))

rng = np.random.default_rng(1)
src_all = hp[hp[:, 1] > h_neck + 0.04 * (h_top - h_neck)]
src = src_all[rng.choice(len(src_all), min(5000, len(src_all)), replace=False)]
tgt = bp[bp[:, 1] > b_neck + 0.01]


def nearest(a, b):
    d = ((a[:, None, :] - b[None, :, :]) ** 2).sum(-1)
    j = d.argmin(1)
    return j, np.sqrt(d[np.arange(len(a)), j])


def umeyama(a, b):
    """Similarity transform (s, R, t) minimising |s R a + t - b|."""
    ma, mb = a.mean(0), b.mean(0)
    A, Bc = a - ma, b - mb
    U, D, Vt = np.linalg.svd(Bc.T @ A / len(a))
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1
    R = U @ S @ Vt
    s = (D * np.diag(S)).sum() / A.var(0).sum()
    return s, R, mb - s * R @ ma


def icp(yaw, iters=40):
    c, sn = np.cos(yaw), np.sin(yaw)
    R = np.array([[c, 0, sn], [0, 1, 0], [-sn, 0, c]])
    s = s0
    t = tgt.mean(0) - s * R @ src.mean(0)
    t[1] = b_top - s * h_top
    err = None
    for i in range(iters):
        x = s * src @ R.T + t
        j, d = nearest(x, tgt)
        keep = d < np.quantile(d, 0.85)
        s, R, t = umeyama(src[keep], tgt[j[keep]])
        err = d[keep].mean()
    return err, s, R, t


best = None
# an optional 4th argument gives the yaw in degrees and skips the sweep
sweep = [np.radians(float(sys.argv[4]))] if len(sys.argv) > 4 else np.arange(0, 2 * np.pi, np.pi / 9)
for yaw in sweep:
    r = icp(yaw, 15)
    print(f'yaw {np.degrees(yaw):5.0f}  err {r[0] * 1000:.2f} mm  scale {r[1]:.3f}')
    if best is None or r[0] < best[0][0]:
        best = (r, yaw)
err, s, R, t = icp(best[1], 60)
# refine starting from the best transform with all source points against the target
print('best yaw', round(float(np.degrees(best[1]))), 'err mm', round(err * 1000, 2), 'scale', round(s, 4))

pos = s * hp @ R.T + t
json.dump({'pos': pos.round(5).ravel().tolist(), 'uv': H['uv'], 'idx': H['idx'], 'scale': s, 'R': R.tolist(), 't': t.tolist(),
           'neck': float(s * h_neck + t[1])}, open(out_path, 'w'))
print('aligned bbox', pos.min(0).round(3), pos.max(0).round(3))
