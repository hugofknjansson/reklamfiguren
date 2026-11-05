"""Recolour the scanned T-shirt and shorts to black, keeping the photographed folds and shading.

Usage: python3 -I tools/scan/texture.py <clean.json> <color.jpg> <normal.jpg> <out_dir> [size]
Every texel is mapped back to its 3D position on the body, so clothing can be told apart from skin
by both where it is and what colour it has.
"""
import json
import sys

import numpy as np
from PIL import Image

clean, color_path, normal_path, out_dir = sys.argv[1:5]
N = int(sys.argv[5]) if len(sys.argv) > 5 else 2048

mesh = json.load(open(clean))
pos = np.array(mesh['pos'], dtype=np.float32).reshape(-1, 3)
uv = np.array(mesh['uv'], dtype=np.float32).reshape(-1, 2)
idx = np.array(mesh['idx'], dtype=np.int64).reshape(-1, 3)

img = np.asarray(Image.open(color_path).convert('RGB').resize((N, N), Image.LANCZOS), dtype=np.float32) / 255.0
P = np.full((N, N, 3), np.nan, dtype=np.float32)

# rasterise every triangle in texture space, storing the interpolated 3D position per texel
for tri in idx:
    t = uv[tri] * N
    x0, y0 = np.floor(t.min(0)).astype(int)
    x1, y1 = np.ceil(t.max(0)).astype(int)
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, N - 1), min(y1, N - 1)
    if x1 < x0 or y1 < y0:
        continue
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    (ax, ay), (bx, by), (cx, cy) = t
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(den) < 1e-9:
        continue
    w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
    w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
    w2 = 1 - w0 - w1
    inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
    if not inside.any():
        continue
    p = w0[..., None] * pos[tri[0]] + w1[..., None] * pos[tri[1]] + w2[..., None] * pos[tri[2]]
    sub = P[y0:y1 + 1, x0:x1 + 1]
    sub[inside] = p[inside]

X, Y, Z = P[..., 0], P[..., 1], P[..., 2]
valid = ~np.isnan(Y)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
mx, mn = img.max(-1), img.min(-1)
lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
hue = np.zeros_like(lum)
d = np.maximum(mx - mn, 1e-6)
hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60

skin = (hue < 30) & (sat > 0.37) & (lum > 0.06)
Yv = np.where(valid, Y, -1)
shirt_band = (Yv > 0.97) & (Yv < 1.56)
shorts_band = (Yv > 0.55) & (Yv < 1.07)
chest_print = (Yv > 1.2) & (Yv < 1.45) & (np.abs(np.where(valid, X, 9)) < 0.17) & (np.where(valid, Z, -9) > 0.0)
Xv, Zv = np.where(valid, X, 0), np.where(valid, Z, 0)
ax = np.abs(Xv)
# arms hang outside the torso below the sleeves; the sleeve hem sits at about y = 1.27 on the outside of the arm
arm_zone = (ax > 0.215) & (Yv < 1.19 + (ax - 0.215) * 0.15)
neck_zone = (Yv > 1.515) & (np.hypot(Xv, (Zv - 0.0) / 0.9) < 0.07 + (Yv - 1.515) * 0.5)
torso_cloth = valid & (Yv > 0.97) & (Yv < 1.53) & ~arm_zone & ~neck_zone
hands = (ax > 0.215) & (Yv > 0.84) & (Yv < 1.06)
shorts_cloth = valid & (Yv > 0.62) & (Yv < 1.0) & ~hands & ~((ax > 0.24) & (Yv > 0.85))
edge = (np.abs(Yv - 0.62) < 0.03) | ((ax > 0.2) & (np.abs(Yv - 1.19) < 0.012))
cloth = ((torso_cloth | shorts_cloth) & ~(edge & skin) | (valid & (shirt_band | shorts_band) & ~skin & ~arm_zone & ~((ax > 0.2) & (Yv > 0.85) & (Yv < 1.2)))) & ~hands

# keep relative shading: normalise luminance by its median over the cloth, then map into near-black
ref = np.median(lum[cloth]) if cloth.any() else 0.5
shade = np.clip(lum / ref, 0.25, 1.8)
black = np.stack([0.032 * shade + 0.006, 0.034 * shade + 0.006, 0.038 * shade + 0.008], -1)
out = img.copy()
out[cloth] = black[cloth]

from PIL import ImageFilter
# grow the cloth label into the empty gutters and the 2-texel rim of each texture island so seams do not show through
grown = np.asarray(Image.fromarray((cloth * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0
rim = valid & ~(np.asarray(Image.fromarray((valid * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5))) > 0)
cloth_all = cloth | (grown & (~valid | rim))
# feathered edge towards skin
m = np.asarray(Image.fromarray((cloth_all * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), dtype=np.float32)[..., None] / 255.0
m = np.where(cloth_all[..., None], 1.0, m)
out = img * (1 - m) + black * m

Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(f'{out_dir}/scan-color.jpg', quality=86, optimize=True)
Image.open(normal_path).convert('RGB').resize((N, N), Image.LANCZOS).save(f'{out_dir}/scan-normal.jpg', quality=88, optimize=True)
print('cloth texels', int(cloth.sum()), 'of', int(valid.sum()), 'median lum', round(float(ref), 3))
