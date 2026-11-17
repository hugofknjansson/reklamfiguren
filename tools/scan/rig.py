"""Place a skeleton inside the merged body scan, free the arms from the torso, and compute bone weights.

Usage: python3 -I tools/scan/rig.py <body-final.json> <out rig.json> <out body-rigged.json>
Bone names follow the MakeHuman rig so the page's warm-up animation works unchanged.

A person scanned with the arms at their sides comes out with arms and hands fused to the torso and shorts.
The mesh is split along those contact lines and the open sides are closed with patches, so the arms can move.
"""
import json
import sys

import numpy as np

body_path, out_path, mesh_path = sys.argv[1:4]
m = json.load(open(body_path))
P = np.array(m['pos'], dtype=np.float64).reshape(-1, 3)
UV = np.array(m['uv'], dtype=np.float64).reshape(-1, 2)
T = np.array(m['idx'], dtype=np.int64).reshape(-1, 3)
neck_y, (ncx, ncz) = m['neck'], m['neckAxis']
Y_PIT = 1.345  # armpit height: below it the arms are cut free, above it they blend into the shoulders


def band(y, h=0.012):
    return P[np.abs(P[:, 1] - y) < h]


def sstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def seg_dist(Q, a, b):
    a, b = np.array(a), np.array(b)
    ab = b - a
    t = np.clip(((Q - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    return np.linalg.norm(Q - (a + t[:, None] * ab), axis=1)


def swatch(target):
    """UV of the middle of the triangle nearest to a point: a spot of clean colour for patches."""
    c = P[T].mean(1)
    return UV[T[np.argmin(np.linalg.norm(c - np.array(target), axis=1))]].mean(0)


# ---------- joints ----------
hipband = band(0.72, 0.03)
cx = (hipband[:, 0].min() + hipband[:, 0].max()) / 2


def torso_centre(y):
    s = band(y, 0.02)
    s = s[np.abs(s[:, 0] - cx) < 0.19]
    return [(s[:, 0].min() + s[:, 0].max()) / 2, y, (s[:, 2].min() + s[:, 2].max()) / 2]


def limb_centre(y, side, outside=None, h=0.015):
    s = band(y, h)
    s = s[(s[:, 0] - cx) * side > (outside if outside is not None else 0)]
    return [float(s[:, 0].mean()), y, float(s[:, 2].mean())]


J = {}
pel = torso_centre(0.95)
J['root'] = pel
for name, y in (('spine05', 1.00), ('spine04', 1.08), ('spine03', 1.16), ('spine02', 1.26), ('spine01', 1.36)):
    t = torso_centre(y)
    J[name] = [0.5 * (t[0] + pel[0]), y, t[2]] if y < 1.1 else t
top = torso_centre(1.42)
wide = band(1.43, 0.02)
top[0] = (wide[:, 0].min() + wide[:, 0].max()) / 2  # shoulders: midpoint of the full width
J['neck01'] = [ncx, neck_y - 0.06, ncz - 0.02]
J['head'] = [ncx, neck_y + 0.03, ncz]
ends = {'head': [ncx, neck_y + 0.2, ncz + 0.01]}
SIDES = ((1, '.L'), (-1, '.R'))
for side, L in SIDES:
    sh = [top[0] + side * 0.185, 1.455, top[2] - 0.005]
    wrist = limb_centre(0.955, side, outside=0.235)
    hand = limb_centre(0.86, side, outside=0.235)
    elbow_guess = limb_centre(1.10, side, outside=0.215)
    f = (np.array(elbow_guess) - np.array(wrist)) / (elbow_guess[1] - wrist[1])
    elbow = (np.array(wrist) + f * (1.165 - wrist[1])).tolist()
    J['shoulder01' + L] = [top[0] + side * 0.06, 1.475, top[2] - 0.005]
    J['upperarm01' + L] = sh
    J['lowerarm01' + L] = elbow
    J['wrist' + L] = wrist
    ends['wrist' + L] = [hand[0], 0.82, hand[2]]
    knee = limb_centre(0.50, side)
    ankle = limb_centre(m['legCut'] + 0.02, side)
    J['upperleg01' + L] = [pel[0] + side * 0.092, 0.935, pel[2]]
    J['lowerleg01' + L] = knee
    J['foot' + L] = [ankle[0], 0.085, ankle[2] - 0.005]
    ends['foot' + L] = [ankle[0], 0.03, ankle[2] + 0.16]

PARENT = {'root': None, 'spine05': 'root', 'spine04': 'spine05', 'spine03': 'spine04', 'spine02': 'spine03', 'spine01': 'spine02',
          'neck01': 'spine01', 'head': 'neck01'}
for _, L in SIDES:
    PARENT.update({'shoulder01' + L: 'spine01', 'upperarm01' + L: 'shoulder01' + L, 'lowerarm01' + L: 'upperarm01' + L, 'wrist' + L: 'lowerarm01' + L,
                   'upperleg01' + L: 'root', 'lowerleg01' + L: 'upperleg01' + L, 'foot' + L: 'lowerleg01' + L})
names = list(PARENT)
idx = {n: i for i, n in enumerate(names)}
children = {n: [c for c in names if PARENT[c] == n] for n in names}


def tail(n):
    if n in ends:
        return ends[n]
    if n == 'root':
        return [J['root'][0], 0.86, J['root'][2]]
    if n == 'spine01':
        return [top[0], 1.47, top[2]]
    line = [c for c in children[n] if not c.startswith(('shoulder', 'upperleg'))]
    return J[line[0]] if line else J[n]


# ---------- regions ----------
x, y, z = P.T
n0, nb = len(P), len(names)
Wb = np.zeros((n0, nb))  # torso and legs
spine = [('root', 0.90), ('spine05', 1.04), ('spine04', 1.12), ('spine03', 1.21), ('spine02', 1.31), ('spine01', 1.41)]
hs = [h for _, h in spine]
for k, (n, _) in enumerate(spine):
    Wb[:, idx[n]] = np.interp(y, hs, np.eye(len(spine))[k])
knee_y = J['lowerleg01.L'][1]
leg = sstep(0.88, 0.76, y)
left = sstep(-0.025, 0.025, x - pel[0])
lower = sstep(knee_y + 0.05, knee_y - 0.05, y)
Wb *= (1 - leg)[:, None]
for L, sidew in (('.L', left), ('.R', 1 - left)):
    Wb[:, idx['upperleg01' + L]] = leg * sidew * (1 - lower)
    Wb[:, idx['lowerleg01' + L]] = leg * sidew * lower

arm_a, arm_W, arm_part, swatches = [], [], [], {}
near_arm = np.zeros(n0, dtype=bool)
near_hand = np.zeros(n0, dtype=bool)
hem = np.full(n0, 2.0)  # height measured against the slanted sleeve hem (sleeves hang lower on the inside of the arm); 2 = not an arm
cls = np.zeros(n0, dtype=int)  # 0 body, 1 left arm, 2 right arm
for k, (side, L) in enumerate(SIDES, 1):
    S, El, Wr, H = J['upperarm01' + L], J['lowerarm01' + L], J['wrist' + L], ends['wrist' + L]
    ys = [H[1] - 0.05, Wr[1], El[1], S[1]]
    ax = np.interp(y, ys, [H[0], Wr[0], El[0], S[0]])
    az = np.interp(y, ys, [H[2], Wr[2], El[2], S[2]])
    R = np.interp(y, ys, [0.045, 0.045, 0.052, 0.062])
    rel = (x - ax) * side  # positive on the outer side of the arm's axis
    a = sstep(-R - 0.02, -R + 0.015, rel) * (np.abs(z - az) < 0.1) * (y > H[1] - 0.08) * sstep(1.52, 1.47, y)
    wl = sstep(El[1] + 0.035, El[1] - 0.035, y)
    ww = sstep(Wr[1] + 0.03, Wr[1] - 0.03, y)
    Wa = np.zeros((n0, nb))
    Wa[:, idx['upperarm01' + L]] = 1 - wl
    Wa[:, idx['lowerarm01' + L]] = wl * (1 - ww)
    Wa[:, idx['wrist' + L]] = wl * ww
    arm_a.append(a)
    arm_W.append(Wa)
    arm_part.append(np.where(y < Wr[1] + 0.01, 5, np.where(y < El[1], 2, 1)))
    cls = np.where(a > 0.5, k, cls)
    hem = np.where(a > 0.5, y - 0.6 * np.clip(rel, -0.07, 0.07), hem)
    d_axis = np.minimum(seg_dist(P, El, Wr), seg_dist(P, Wr, [H[0], H[1] - 0.05, H[2]]))
    near_arm |= (d_axis < 0.07) & (y < 1.06)
    near_hand |= seg_dist(P, Wr, [H[0], H[1] - 0.05, H[2]]) < 0.09
    mid = (np.array(El) + np.array(Wr)) / 2
    swatches[k] = swatch(mid + [side * 0.05, 0, 0.01])  # outer side of the forearm: evenly lit skin
swatches[0] = swatch([cx, 1.1, pel[2] + 0.2])  # front of the shirt

# slivers of hand and forearm that ended up on the body's side of the contact line would be left hanging on the shorts
sliver = (cls == 0) & near_arm
drop = sliver[T].sum(1) >= 2
dropped = set(T[drop].ravel().tolist())
T = T[~drop]
print(f'removed {int(drop.sum())} sliver triangles left behind by the hands')

# ---------- cut the arms free below the armpits ----------
tri_cls = cls[T]
mixed = (tri_cls.max(1) > 0) & (tri_cls.min(1) == 0) & (P[T][:, :, 1].mean(1) < Y_PIT)
src, vcls, dup, T2 = list(range(n0)), cls.tolist(), {}, T.copy()
for ti in np.where(mixed)[0]:
    c = tri_cls[ti]
    k = c.max()
    owner = k if (c == k).sum() >= 2 else 0
    for j in range(3):
        v = T[ti, j]
        if cls[v] != owner:
            if (v, owner) not in dup:
                dup[(v, owner)] = len(src)
                src.append(v)
                vcls.append(owner)
            T2[ti, j] = dup[(v, owner)]
src, vcls = np.array(src), np.array(vcls)
P2, UV2, y2 = P[src], UV[src], P[src][:, 1]
# drop small loose pieces that the cut set free
k0 = np.concatenate([np.round(P2 * 1e5).astype(np.int64), vcls[:, None]], 1)
_, w0 = np.unique(k0, axis=0, return_inverse=True)
par = np.arange(w0.max() + 1)


def find(a):
    while par[a] != a:
        par[a] = par[par[a]]
        a = par[a]
    return a


for a, b, c in w0[T2]:
    ra = find(a)
    par[find(b)] = ra
    par[find(c)] = ra
comp = np.array([find(a) for a in w0[T2[:, 0]]])
vals, counts = np.unique(comp, return_counts=True)
small = np.isin(comp, vals[counts < 80])
print(f'dropped {int(small.sum())} triangles in {int((counts < 80).sum())} small loose pieces')
mixed = mixed[~small]
T2 = T2[~small]
W = Wb[src].copy()
for k in (1, 2):
    a = np.where(y2 < Y_PIT, (vcls == k).astype(float), arm_a[k - 1][src])
    W = W * (1 - a)[:, None] + arm_W[k - 1][src] * a[:, None]
label = np.where(leg[src] > 0.5, np.where(y2 > knee_y, 3, 4), 0)
label = np.where(near_hand[src], 6, label)  # next to a hand: may be shorts or a bit of the fist, colour decides
for k in (1, 2):
    label = np.where(vcls == k, arm_part[k - 1][src], label)
print(f'cut {int(mixed.sum())} triangles between arms and body, {len(dup)} vertices duplicated')

# ---------- weld (same position and same owner), smooth the weights along the surface ----------
key = np.concatenate([np.round(P2 * 1e5).astype(np.int64), vcls[:, None]], 1)
_, weld = np.unique(key, axis=0, return_inverse=True)
nw = weld.max() + 1
Ww = np.zeros((nw, nb))
np.add.at(Ww, weld, W)
Ww /= np.bincount(weld, minlength=nw)[:, None]
e = np.concatenate([weld[T2[:, [0, 1]]], weld[T2[:, [1, 2]]], weld[T2[:, [2, 0]]]])
e = np.concatenate([e, e[:, ::-1]])
deg = np.bincount(e[:, 0], minlength=nw)[:, None].astype(float)
for _ in range(3):
    acc = np.zeros_like(Ww)
    np.add.at(acc, e[:, 0], Ww[e[:, 1]])
    Ww = 0.5 * Ww + 0.5 * acc / np.maximum(deg, 1)
W = Ww[weld]

# ---------- close the cut surfaces ----------
count, owner_edge = {}, {}
for tri in T2.tolist():
    for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
        kk = (weld[a], weld[b])
        count[kk] = count.get(kk, 0) + 1
        owner_edge[kk] = (a, b)
nxt = {}
for (wa, wb), (a, b) in owner_edge.items():
    if count.get((wb, wa), 0) == 0:
        nxt[wb] = (wa, b, a)  # walk rims against the triangles' direction so patches face outwards
cut_w = set(weld[T2[mixed]].ravel().tolist()) | set(weld[[v for v in dropped]].tolist())
loops, seen = [], set()
for start in list(nxt):
    if start in seen:
        continue
    loop, w = [], start
    while w in nxt and w not in seen:
        seen.add(w)
        w2, a, b = nxt[w]
        loop.append((w, a, b))
        w = w2
    if w == start and len(loop) >= 4 and np.mean([q[0] in cut_w for q in loop]) > 0.6:
        loops.append(loop)

newP, newUV, newW, newL, newT, newH = [], [], [], [], [], []
hem2 = hem[src]


def add_vertex(like, uv):
    newH.append(hem2[like])
    newP.append(P2[like])
    newUV.append(uv)
    newW.append(W[like])
    newL.append(label[like])
    return len(P2) + len(newP) - 1


def zipper(run, uv):
    """Close a U-shaped rim by stitching its two legs together from the ends inwards. The patch gets one flat colour."""
    i, j = 0, len(run) - 1
    while j - i >= 2:
        # advance the side that gives the shorter new edge, so the patch stays a narrow band between the legs
        if np.linalg.norm(P2[run[i + 1][1]] - P2[run[j][1]]) <= np.linalg.norm(P2[run[i][1]] - P2[run[j - 1][1]]):
            _, a, b = run[i]
            newT.append([add_vertex(a, uv), add_vertex(b, uv), add_vertex(run[j][1], uv)])
            i += 1
        else:
            _, a, b = run[j - 1]
            newT.append([add_vertex(a, uv), add_vertex(b, uv), add_vertex(run[i][1], uv)])
            j -= 1


patched = 0
for loop in loops:
    owners = [vcls[a] for _, a, _ in loop]
    if len(set(owners)) == 1:
        top_i = int(np.argmax([P2[a][1] for _, a, _ in loop]))
        runs = [loop[top_i:] + loop[:top_i]]
    else:
        first = next(i for i in range(len(loop)) if owners[i] != owners[i - 1])
        rot, ro = loop[first:] + loop[:first], owners[first:] + owners[:first]
        runs, cur = [], [rot[0]]
        for q, o, po in zip(rot[1:], ro[1:], ro[:-1]):
            if o != po:
                runs.append(cur)
                cur = []
            cur.append(q)
        runs.append(cur)
    for run in runs:
        if len(run) < 3:
            continue
        pts = np.array([P2[a] for _, a, _ in run])
        length = np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()
        # a rim whose ends are far apart is one side of a plain slit: nothing is missing there, so no patch
        if np.linalg.norm(pts[0] - pts[-1]) > 0.35 * length:
            continue
        mid = run[len(run) // 2][1]
        zipper(run, swatches[0 if hem2[mid] > 1.14 else int(vcls[mid])])  # patches on the sleeves are cloth
        patched += 1
print(f'{len(loops)} open rims closed with {patched} patches, {len(newT)} triangles')
if newP:
    P2 = np.concatenate([P2, np.array(newP)])
    UV2 = np.concatenate([UV2, np.array(newUV)])
    W = np.concatenate([W, np.array(newW)])
    label = np.concatenate([label, np.array(newL)])
    hem2 = np.concatenate([hem2, np.array(newH)])
    T2 = np.concatenate([T2, np.array(newT, dtype=np.int64)])

order = np.argsort(-W, 1)[:, :4]
w4 = np.take_along_axis(W, order, 1)
w4 /= w4.sum(1, keepdims=True)
bones = [{'n': n, 'p': idx[PARENT[n]] if PARENT[n] else -1, 'h': [round(float(v), 4) for v in J[n]], 't': [round(float(v), 4) for v in tail(n)]} for n in names]
json.dump({'bones': bones, 'si': order.ravel().tolist(), 'sw': w4.round(4).ravel().tolist(), 'label': label.tolist(), 'hem': hem2.round(4).tolist(), 'cx': float(cx)}, open(out_path, 'w'))
json.dump({'pos': P2.round(5).ravel().tolist(), 'uv': UV2.round(6).ravel().tolist(), 'idx': T2.ravel().tolist()}, open(mesh_path, 'w'))
near = W.argmax(1)
for b in bones:
    print(f"  {b['n']:14s} head {b['h']}  verts {int((near == idx[b['n']]).sum())}")
