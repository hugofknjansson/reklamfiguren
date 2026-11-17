"""Combine a cleaned body scan with an aligned head scan.

Usage: python3 -I tools/scan/merge.py <body clean.json> <head aligned.json> <out_dir>
Writes body-final.json (the body without its own blurry head and without the feet) and
head-final.json (the head scan trimmed to head and neck).
"""
import json
import sys

import numpy as np

body_path, head_path, out_dir = sys.argv[1:4]
LEG_CUT = 0.20  # just above the sock tops; generated socks and shoes take over below


def load(path):
    m = json.load(open(path))
    return m, np.array(m['pos'], dtype=np.float64).reshape(-1, 3), np.array(m['uv'], dtype=np.float64).reshape(-1, 2), np.array(m['idx'], dtype=np.int64).reshape(-1, 3)


def components(P, T):
    """Connected components over triangles, welding vertices that share a position (UV seams)."""
    key = np.round(P * 1e5).astype(np.int64)
    _, weld = np.unique(key, axis=0, return_inverse=True)
    parent = np.arange(weld.max() + 1)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for a, b, c in weld[T]:
        ra = find(a)
        parent[find(b)] = ra
        parent[find(c)] = ra
    return np.array([find(a) for a in weld[T[:, 0]]])


def compact(P, UV, T):
    used = np.unique(T)
    remap = -np.ones(len(P), dtype=np.int64)
    remap[used] = np.arange(len(used))
    return P[used], UV[used], remap[T]


def clip(P, UV, T, f):
    """Cut the mesh along f = 0 and keep the part where f < 0. New vertices are placed exactly on the cut."""
    P, UV = [tuple(p) for p in P], [tuple(u) for u in UV]
    cache, out = {}, []

    def cut(a, b):
        key = (a, b) if a < b else (b, a)
        if key not in cache:
            t = f[a] / (f[a] - f[b])
            P.append(tuple(P[a][k] + t * (P[b][k] - P[a][k]) for k in range(3)))
            UV.append(tuple(UV[a][k] + t * (UV[b][k] - UV[a][k]) for k in range(2)))
            f.append(0.0)
            cache[key] = len(P) - 1
        return cache[key]
    f = list(f)
    for tri in T.tolist():
        inside = [f[v] < 0 for v in tri]
        n = sum(inside)
        if n == 3:
            out.append(tri)
        elif n == 1:
            i = inside.index(True)
            a, b, c = tri[i], tri[(i + 1) % 3], tri[(i + 2) % 3]
            out.append([a, cut(a, b), cut(a, c)])
        elif n == 2:
            i = inside.index(False)
            a, b, c = tri[i], tri[(i + 1) % 3], tri[(i + 2) % 3]
            ab, ac = cut(b, a), cut(c, a)
            out.append([ab, b, c])
            out.append([ab, c, ac])
    return np.array(P), np.array(UV), np.array(out, dtype=np.int64)


def fill_holes(P, UV, T, max_perimeter=0.4):
    """Close holes the scanner left (for example under the chin) with fans that smear the rim's colours inwards.
    The lowest boundary loop is the open bottom of the neck and is left alone."""
    key = np.round(P * 1e5).astype(np.int64)
    _, weld = np.unique(key, axis=0, return_inverse=True)
    count, owner = {}, {}
    for tri in T.tolist():
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            k = (weld[a], weld[b])
            count[k] = count.get(k, 0) + 1
            owner[k] = (a, b)
    nxt = {}
    for (wa, wb), (a, b) in owner.items():
        if count.get((wb, wa), 0) == 0:
            nxt[wb] = (wa, b, a)  # walk the rim against the triangle's direction so the patch faces outwards
    loops, seen = [], set()
    for start in list(nxt):
        if start in seen:
            continue
        loop, w = [], start
        while w in nxt and w not in seen:
            seen.add(w)
            w2, a, b = nxt[w]
            loop.append((a, b))
            w = w2
        if w == start and len(loop) >= 3:
            loops.append(loop)
    if not loops:
        return P, UV, T, 0
    lowest = min(range(len(loops)), key=lambda i: np.mean([P[a][1] for a, _ in loops[i]]))
    P, UV, T, filled = list(map(tuple, P)), list(map(tuple, UV)), T.tolist(), 0
    for i, loop in enumerate(loops):
        pts = np.array([P[a] for a, _ in loop])
        per = np.linalg.norm(pts - np.roll(pts, -1, 0), axis=1).sum()
        if i == lowest or per > max_perimeter:
            continue
        centre = tuple(pts.mean(0))
        for a, b in loop:
            P.append(centre)
            UV.append(UV[a])
            T.append([a, b, len(P) - 1])
        filled += 1
    return np.array(P), np.array(UV), np.array(T, dtype=np.int64), filled


def save(path, P, UV, T, extra=None):
    d = {'pos': P.round(5).ravel().tolist(), 'uv': UV.round(6).ravel().tolist(), 'idx': T.ravel().tolist()}
    d.update(extra or {})
    json.dump(d, open(path, 'w'))


# ---------- head: keep the head and a neck stub that goes down inside the collar ----------
hm, hp, huv, ht = load(head_path)
neck_y = hm['neck']
top = hp[:, 1].max()
ring = hp[np.abs(hp[:, 1] - neck_y) < 0.008]
c = ring[:, [0, 2]].mean(0)
for _ in range(3):
    c = ring[np.hypot(ring[:, 0] - c[0], ring[:, 2] - c[1]) < 0.11][:, [0, 2]].mean(0)
r_neck = float(np.quantile(np.hypot(ring[:, 0] - c[0], ring[:, 2] - c[1]), 0.9))
print('neck level', round(neck_y, 3), 'neck radius', round(r_neck, 3), 'neck centre', c.round(3))


def collar(P):
    """Signed height above the shirt's collar line: lower at the throat, higher at the nape and up the sides of the neck."""
    return P[:, 1] - (neck_y - 0.040 - 0.21 * (P[:, 2] - c[1]) + 0.45 * np.maximum(0, np.abs(P[:, 0] - c[0]) - 0.035))


STUB = 0.014  # how far the neck continues down inside the collar
dist = np.hypot(hp[:, 0] - c[0], hp[:, 2] - c[1])
f = np.maximum(-(collar(hp) + STUB), dist - (r_neck + 0.006))
f = np.where(hp[:, 1] > neck_y - 0.02, -1.0, f)  # the chin reaches further forward than the neck's radius
P, UV, T = clip(hp, huv, ht, f)
comp = components(P, T)
vals, counts = np.unique(comp, return_counts=True)
T = T[comp == vals[counts.argmax()]]
P, UV, T = compact(P, UV, T)
P, UV, T, nfilled = fill_holes(P, UV, T)
print('holes filled in the head scan:', nfilled)
save(f'{out_dir}/head-final.json', P, UV, T)
print('head kept', len(P), 'verts', len(T), 'tris; y range', P[:, 1].min().round(3), P[:, 1].max().round(3))

# ---------- body: remove its own head and neck skin, and the feet ----------
bm, bp, buv, bt = load(body_path)
bd = np.hypot(bp[:, 0] - c[0], bp[:, 2] - c[1])
# keep everything below the collar line, and the shoulders outside the collar ring; cut the legs above the socks
f = np.where(bd < r_neck + 0.026, collar(bp), np.minimum(collar(bp), bp[:, 1] - (neck_y + 0.02)))
f = np.maximum(f, LEG_CUT - bp[:, 1])
P, UV, T = clip(bp, buv, bt, f)
comp = components(P, T)
vals, counts = np.unique(comp, return_counts=True)
T = T[comp == vals[counts.argmax()]]
P, UV, T = compact(P, UV, T)

# leg cross-sections at the cut, for fitting socks and shoes
legs = []
for s in (1, -1):
    ring = bp[(np.abs(bp[:, 1] - (LEG_CUT + 0.012)) < 0.012) & (bp[:, 0] * s > 0)]
    lc = ring[:, [0, 2]].mean(0)
    legs.append({'side': s, 'cx': float(lc[0]), 'cz': float(lc[1]), 'r': float(np.hypot(ring[:, 0] - lc[0], ring[:, 2] - lc[1]).mean())})
save(f'{out_dir}/body-final.json', P, UV, T, {'legCut': LEG_CUT, 'legs': legs, 'neck': neck_y, 'neckAxis': [float(c[0]), float(c[1])], 'neckRadius': r_neck})
print('body kept', len(P), 'verts', len(T), 'tris; legs', json.dumps(legs))
