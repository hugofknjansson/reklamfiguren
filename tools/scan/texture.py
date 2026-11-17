"""Prepare the scan textures for the web page.

Usage: python3 -I tools/scan/texture.py <body-rigged.json> <rig.json> <body color.jpg> <body normal.jpg>
                                         <head-final.json> <head color.jpg> <out_dir> [body size] [head size]

Body: the T-shirt and shorts are recoloured to black with the photographed folds kept. The skeleton decides
what is torso, arm and leg, so skin is never painted and cloth is never missed; colour only decides along
the sleeve and shorts hems. Skin tones are matched to the head scan.
Head: texture parts that the trimmed head no longer uses are blanked out, and the texture is downsized.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
body_path, rig_path, body_color, body_normal, head_path, head_color, out_dir = sys.argv[1:8]
NB = int(sys.argv[8]) if len(sys.argv) > 8 else 2048
NH = int(sys.argv[9]) if len(sys.argv) > 9 else 4096


def load(path):
    m = json.load(open(path))
    return (np.array(m['pos'], dtype=np.float32).reshape(-1, 3), np.array(m['uv'], dtype=np.float32).reshape(-1, 2),
            np.array(m['idx'], dtype=np.int64).reshape(-1, 3))


def rasterise(uv, idx, N, attrs):
    """Interpolate per-vertex attributes (V x K) into texture space. Returns (N, N, K) and a validity mask."""
    out = np.zeros((N, N, attrs.shape[1]), dtype=np.float32)
    valid = np.zeros((N, N), dtype=bool)
    t_all = uv[idx] * N
    for tri, t in zip(idx, t_all):
        x0, y0 = np.floor(t.min(0)).astype(int)
        x1, y1 = np.ceil(t.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, N - 1), min(y1, N - 1)
        if x1 < x0 or y1 < y0:
            continue
        (ax, ay), (bx, by), (cx, cy) = t
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        w2 = 1 - w0 - w1
        inside = (w0 >= -0.03) & (w1 >= -0.03) & (w2 >= -0.03)
        if not inside.any():
            continue
        val = w0[..., None] * attrs[tri[0]] + w1[..., None] * attrs[tri[1]] + w2[..., None] * attrs[tri[2]]
        out[y0:y1 + 1, x0:x1 + 1][inside] = val[inside]
        valid[y0:y1 + 1, x0:x1 + 1][inside] = True
    return out, valid


def hsl(img):
    mx, mn = img.max(-1), img.min(-1)
    lum = img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return hue, sat, lum


def grow(mask, valid, rounds=12):
    """Extend a texel mask into the gutters between texture islands: every gutter texel takes the value of
    the nearest island, so cloth and skin islands each claim their own side of a gutter."""
    rim = valid & ~(np.asarray(Image.fromarray((valid * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) > 0)
    known = valid & ~rim
    val = mask & known
    for _ in range(rounds + 1):
        yes, tot = np.zeros(val.shape, dtype=np.int16), np.zeros(val.shape, dtype=np.int16)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            k = np.roll(known, (dy, dx), (0, 1))
            yes += np.roll(val, (dy, dx), (0, 1)) & k
            tot += k
        new = ~known & (tot > 0)
        val = val | (new & (yes * 2 >= tot))
        known = known | new
    return val


def dilate_colours(img, valid, rounds=6):
    """Bleed island colours outwards so texture filtering never picks up the blank background."""
    out, v = img.copy(), valid.copy()
    for _ in range(rounds):
        acc, cnt = np.zeros_like(out), np.zeros(v.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sv = np.roll(v, (dy, dx), (0, 1))
            acc += np.roll(out, (dy, dx), (0, 1)) * sv[..., None]
            cnt += sv
        new = ~v & (cnt > 0)
        out[new] = acc[new] / cnt[new][:, None]
        v |= new
    return out, v


# ---------- head ----------
hp, huv, hidx = load(head_path)
himg = np.asarray(Image.open(head_color).convert('RGB').resize((NH, NH), Image.LANCZOS), dtype=np.float32) / 255
hattr, hvalid = rasterise(huv, hidx, NH, hp[:, 1:2])
hhue, hsat, hlum = hsl(himg)
hskin = hvalid & (hhue < 30) & (hsat > 0.3) & (hlum > 0.25) & (hattr[..., 0] < hp[:, 1].min() + 0.1)
head_skin = himg[hskin].mean(0)
# the underside of the chin was never photographed and comes out as a pale blank patch: give it neck colour
low = hvalid & (hattr[..., 0] < hp[:, 1].min() + 0.16)
blank = low & (hlum > 0.68) & (hsat < 0.33)
blank = np.asarray(Image.fromarray((blank * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))) > 0
soft = np.asarray(Image.fromarray((blank * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4)), dtype=np.float32)[..., None] / 255
himg = himg * (1 - soft) + (head_skin * 0.72) * soft
# the bare shoulders caught bright light in the head scan: even out the last centimetres above the collar
neck_y = next(b for b in json.load(open(rig_path))['bones'] if b['n'] == 'head')['h'][1] - 0.03
k = np.clip((neck_y - 0.012 - hattr[..., 0]) / 0.03, 0, 1)[..., None] * hvalid[..., None] * 0.8
himg = himg * (1 - k) + (head_skin * 0.78) * k
filled, v = dilate_colours(himg, hvalid)
filled[~v] = himg[hvalid].mean(0)
Image.fromarray((np.clip(filled, 0, 1) * 255).astype(np.uint8)).save(f'{out_dir}/scan-head.jpg', quality=84, optimize=True)
print('head texels used', int(hvalid.sum()), 'of', NH * NH, 'neck skin colour', head_skin.round(3))

# ---------- body ----------
bp, buv, bidx = load(body_path)
rig = json.load(open(rig_path))
label = np.array(rig['label'])
img = np.asarray(Image.open(body_color).convert('RGB').resize((NB, NB), Image.LANCZOS), dtype=np.float32) / 255
y = bp[:, 1]
SLEEVE = 1.14  # the sleeves end here, measured along the slanted hem line from the rig tool
torso = (label == 0).astype(np.float32)
upper = (label == 1).astype(np.float32)
maybe = (((label == 3) & (y > 0.5)) | (label == 6)).astype(np.float32)
arm = ((label == 1) | (label == 2)).astype(np.float32)
ra, valid = rasterise(buv, bidx, NB, np.stack([torso, arm, maybe, arm, np.array(rig['hem'], dtype=np.float32)], 1))
above = ra[..., 4] > SLEEVE  # decided per texel, so the hem is a clean line
attrs = np.stack([np.maximum(ra[..., 0], ra[..., 1] * above), ra[..., 2], ra[..., 3] * ~above], -1)
hue, sat, lum = hsl(img)
skin = (hue < 30) & (sat > 0.37) & (lum > 0.06)
shirt_coloured = ((sat < 0.3) & (lum > 0.5)) | ((hue > 27) & (hue < 70) & (sat < 0.4) & (lum > 0.45))
cloth = valid & ((attrs[..., 0] > 0.5) | ((attrs[..., 0] + attrs[..., 1] > 0.5) & ~skin) | ((attrs[..., 2] > 0.5) & shirt_coloured))

ref = np.median(lum[cloth])
shade = np.clip(lum / ref, 0.25, 1.8)[..., None]
black = shade * np.array([0.032, 0.034, 0.038], dtype=np.float32) + np.array([0.006, 0.006, 0.008], dtype=np.float32)

# match the body's skin tone to the head scan (in linear light), leaving the cloth alone
body_skin = img[valid & ~cloth & skin & (lum > 0.25)].mean(0)
gain = (head_skin ** 2.2 / body_skin ** 2.2) ** 0.6
matched = np.clip(img ** 2.2 * gain, 0, 1) ** (1 / 2.2)
print('body skin colour', body_skin.round(3), 'gain', gain.round(3))

cloth_all = grow(cloth, valid)
m = np.asarray(Image.fromarray((cloth_all * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), dtype=np.float32)[..., None] / 255.0
m = np.where(cloth_all[..., None], 1.0, m)
out = matched * (1 - m) + black * m
Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(f'{out_dir}/scan-body.jpg', quality=86, optimize=True)
Image.open(body_normal).convert('RGB').resize((NB, NB), Image.LANCZOS).save(f'{out_dir}/scan-body-n.jpg', quality=88, optimize=True)
print('cloth texels', int(cloth.sum()), 'of', int(valid.sum()))
