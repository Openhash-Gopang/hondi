#!/usr/bin/env python3
"""새 배치(나비 로고 칸 + 숫자열, 최대 10칸) 인식 테스트 프레임 생성기.

gen_cases.py 와 같은 시험 항목(S1~S7)을 새 배치로 그린다. 노란 바탕 로고 블록은 컬러로 그려지고,
열화(축소·블러·노이즈·밝기·색조명·회전·원근·JPEG·종이/벽·잘림·어수선한 화면)도 컬러 그대로 입힌다.
출력: cases_v3/<suite>/<id>.png + cases_v3.json.   먼저 `npm run consts` 로 consts.json(V3 포함)을 만들어 둘 것.
"""
import json, os, random, sys, io
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from multiprocessing import Pool
import gen_cases as G

HERE = os.path.dirname(os.path.abspath(__file__))
C = G.C
V3 = C['V3']
ART = Image.open(os.path.join(HERE, '..', '..', 'assets', 'navi-code-logo.png')).convert('RGB')
OUT = os.path.join(HERE, 'cases_v3')
FW, FH, SS = G.FW, G.FH, G.SS
YELLOW = (254, 207, 1)


def box_layout(serial):
    out = []
    I = C['INNER']
    for i, ch in enumerate(serial):
        bx, by = V3['firstBoxX'] + i * V3['pitch'], V3['boxY']
        ix, iy = bx + I['x1'] * V3['boxW'], by + I['y1'] * V3['boxH']
        iw, ih = (I['x2'] - I['x1']) * V3['boxW'], (I['y2'] - I['y1']) * V3['boxH']
        segs = []
        for s in C['PAT'][ch]:
            b = C['SEG_BOXES'][s]
            segs.append((ix + b['x1'] * iw, iy + b['y1'] * ih, (b['x2'] - b['x1']) * iw, (b['y2'] - b['y1']) * ih))
        out.append((bx, by, V3['boxW'], V3['boxH'], segs))
    return out


def draw_fake_art(dr, kind):
    a = V3['art']; x1, y1, x2, y2 = a['x1'], a['y1'], a['x2'], a['y2']
    s = SS
    if kind == 'bar': dr.rectangle([x1 * s, y1 * s, x2 * s, y2 * s], fill=(26, 26, 26))
    elif kind == 'blocks':
        for i in range(5): dr.rectangle([(x1 + i * 22) * s, y1 * s, (x1 + i * 22 + 16) * s, y2 * s], fill=(26, 26, 26))
    elif kind == 'wide_lines':
        for i in range(4): dr.rectangle([x1 * s, (y1 + i * 20) * s, x2 * s, (y1 + i * 20 + 9) * s], fill=(26, 26, 26))
    elif kind == 'dots':
        for i in range(5):
            for j in range(4): dr.ellipse([(x1 + i * 21) * s, (y1 + j * 19) * s, (x1 + i * 21 + 12) * s, (y1 + j * 19 + 12) * s], fill=(26, 26, 26))
    elif kind == 'hondi_wordmark':          # 옛 hondi.net 로고를 새 로고 자리에 — 다른 배치의 로고는 인정하지 않아야 한다
        wm = G.LOGO.convert('RGB').resize((int((x2 - x1) * s), int((x2 - x1) * s * G.LOGO.height / G.LOGO.width)), Image.LANCZOS)
        dr._image.paste(wm, (int(x1 * s), int(((y1 + y2) / 2) * s - wm.height / 2)))
    elif kind in ('other_text', 'typed_bold'):
        f = ImageFont.load_default(size=int(40 * s))
        for dx in ((0,) if kind == 'other_text' else (0, 1, 2)):
            dr.text(((x1 + dx) * s, (y1 + 8) * s), 'HELLO' if kind == 'other_text' else 'NAVI', fill=(26, 26, 26), font=f)


def render_code_v3(serial, logo='art', with_outline=True):
    W, H = V3['w'], V3['h']
    im = Image.new('RGB', (W * SS, H * SS), (255, 255, 255))
    b = V3['block']
    if logo == 'art':
        im.paste(ART.resize((b['w'] * SS, b['h'] * SS), Image.LANCZOS), (b['x'] * SS, b['y'] * SS))
    elif logo in ('wings_only', 'text_only'):
        blk = ART.copy(); d2 = ImageDraw.Draw(blk); w, h = blk.size
        if logo == 'wings_only': d2.rectangle([0, int(h * 0.60), int(w * 0.64), h], fill=YELLOW); d2.rectangle([0, 0, int(w * 0.60), h], fill=YELLOW)
        else: d2.rectangle([int(w * 0.62), 0, w, int(h * 0.60)], fill=YELLOW)
        im.paste(blk.resize((b['w'] * SS, b['h'] * SS), Image.LANCZOS), (b['x'] * SS, b['y'] * SS))
    elif logo not in ('none', None):
        im.paste(Image.new('RGB', (b['w'] * SS, b['h'] * SS), YELLOW), (b['x'] * SS, b['y'] * SS))
        draw_fake_art(ImageDraw.Draw(im), logo)
    dr = ImageDraw.Draw(im)
    lw = max(1, round(V3['boxW'] * 0.03)) * SS
    for (x, y, w, h, segs) in box_layout(serial):
        if with_outline:
            dr.rectangle([x * SS, y * SS, (x + w) * SS - 1, (y + h) * SS - 1], outline=(0, 0, 0), width=lw)
        for (sx, sy, sw, sh) in segs:
            dr.rectangle([sx * SS, sy * SS, (sx + sw) * SS - 1, (sy + sh) * SS - 1], fill=(0, 0, 0))
    return im.resize((W, H), Image.LANCZOS)


def make_frame_v3(serial, rng, *, frac=0.7, blur=0.0, noise=0.0, gain=1.0, offset=0, contrast=1.0,
                  cast=(1, 1, 1), rot=0.0, persp=0.0, jpeg=None, scene='screen', wall=110,
                  dx=0, dy=0, logo='art', outline=True, occlude=None, clutter=False):
    code = render_code_v3(serial, logo=logo, with_outline=outline)
    W, H = code.size
    M = 40 if scene == 'screen' else 260
    bgv = 255 if scene == 'screen' else wall
    bg = (bgv, bgv, bgv)
    if clutter:
        top_pad, bot_pad = 110, 420
        paper = Image.new('RGB', (W + 80, H + top_pad + bot_pad), (255, 255, 255))
        paper.paste(code, (40, top_pad))
        d = ImageDraw.Draw(paper); r2 = random.Random(int(rng.integers(1 << 30)))
        g = lambda v: (v, v, v)
        for i in range(3): d.rectangle([40, 20 + i * 26, 40 + r2.randint(200, W - 80), 20 + i * 26 + 8], fill=g(60))
        y = top_pad + H + 24
        d.rectangle([40, y, W + 40, y + 6], fill=g(90))
        for i in range(3): d.rounded_rectangle([40 + i * ((W - 16) // 3 + 8), y + 30, 40 + i * ((W - 16) // 3 + 8) + (W - 16) // 3, y + 78], 8, outline=g(150), width=2)
        d.rounded_rectangle([40 + (W - 16) // 3 + 8, y + 96, W + 40, y + 150], 10, fill=g(40))
        for i in range(4): d.rectangle([40, y + 180 + i * 28, 40 + r2.randint(250, W - 40), y + 180 + i * 28 + 8], fill=g(70))
        top_off = top_pad
    else:
        paper = Image.new('RGB', (W + 80, H + 80), (255, 255, 255)); paper.paste(code, (40, 40)); top_off = 40
    pad = (M - 40) if M > 40 else 0
    canvas = Image.new('RGB', (paper.width + 2 * pad, paper.height + 2 * pad), bg)
    off = (canvas.width - paper.width) // 2
    canvas.paste(paper, (off, off))
    img = canvas
    if occlude:
        d = ImageDraw.Draw(img); kind, frac_pos = occlude
        cx = off + 40 + V3['firstBoxX'] + frac_pos * len(serial) * V3['pitch']
        top = off + top_off + V3['boxY']
        fill = (30, 30, 30) if kind == 'dark' else (255, 255, 255)
        d.rectangle([cx - 5, top - 4, cx + 5, top + V3['boxH'] + 4], fill=fill)
    if rot: img = img.rotate(rot, resample=Image.BICUBIC, expand=True, fillcolor=bg)
    if persp:
        co = G.perspective_coeffs(img.width, img.height, persp)
        img = img.transform(img.size, Image.PERSPECTIVE, co, Image.BICUBIC, fillcolor=bg)
    s = (frac * FW) / W
    img = img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)
    frame = Image.new('RGB', (FW, FH), bg)
    frame.paste(img, (FW // 2 + dx - img.width // 2, FH // 2 + dy - img.height // 2))
    a = np.asarray(frame, float)
    if wall and scene == 'wall':
        tex = rng.normal(0, 6, a.shape[:2])[..., None]
        same = np.all(np.asarray(frame) == bgv, axis=-1)[..., None]
        a = np.where(same, a + tex, a)
    a = (a - 128) * contrast + 128
    a = a * gain + offset
    rgb = a * np.array(cast, float)[None, None, :]
    if blur:
        rgb = np.asarray(Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), float)
    if noise: rgb = rgb + rng.normal(0, noise, rgb.shape)
    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB')
    if jpeg:
        buf = io.BytesIO(); out.save(buf, 'JPEG', quality=jpeg); buf.seek(0); out = Image.open(buf).convert('RGB')
    return out


def fake_frame(serial, kind):
    code = render_code_v3(serial, logo=kind)
    s = (0.7 * FW) / code.width
    img = code.resize((int(code.width * s), int(code.height * s)), Image.LANCZOS)
    fr = Image.new('RGB', (FW, FH), (255, 255, 255)); fr.paste(img, ((FW - img.width) // 2, (FH - img.height) // 2))
    return fr


def logo_only_frame(rng):
    a = np.full((FH, FW), rng.integers(60, 230), float)
    im = Image.fromarray(a.astype(np.uint8)).convert('RGB')
    w = int(FW * rng.uniform(0.15, 0.5)); h = int(w * ART.height / ART.width)
    im.paste(ART.resize((w, h), Image.LANCZOS), (int(rng.integers(0, FW - w)), int(rng.integers(0, FH - h))))
    out = np.asarray(im, float) + rng.normal(0, 5, (FH, FW, 3))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def build_specs():
    specs = G.build_specs()                       # S1~S7 항목을 그대로 쓴다(QUICK 환경변수도 동일하게 적용)
    n0 = len(specs)
    rng = random.Random(20261013)
    extra = []
    for kind in ['wings_only', 'text_only', 'hondi_wordmark']:       # 로고의 일부만 있거나 옛 로고인 경우(거절이 정상)
        for _ in range(10):
            s = G.rand_serial(rng.randint(1, 10), rng)
            extra.append(dict(suite='S6_fake_logo', level=kind, serial=s, expect=None, kw=dict(_fake=kind)))
    for i, sp in enumerate(extra):
        sp['id'] = f"S6_fake_logo_x{i:05d}"; sp['seed'] = n0 + 100000 + i
    return specs + extra


def run(sp):
    rng = np.random.default_rng(sp['seed'] + 7)
    kw = dict(sp['kw'])
    d = os.path.join(OUT, sp['suite']); os.makedirs(d, exist_ok=True)
    path = os.path.join(d, sp['id'] + '.png')
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return sp['id'], os.path.relpath(path, HERE)
    if kw.pop('_blank', False):
        a = np.full((FH, FW), rng.integers(40, 230), float) + rng.normal(0, 6, (FH, FW))
        Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('RGB').save(path)
    elif kw.pop('_logo_only', False):
        logo_only_frame(rng).save(path)
    elif kw.get('_fake'):
        fake_frame(sp['serial'], kw['_fake']).save(path)
    elif kw.pop('_boxes', False):
        G.negative_frame('random_boxes', rng).save(path)
    else:
        lg = kw.pop('logo', True)
        make_frame_v3(sp['serial'], rng, logo='art' if lg else 'none', **kw).save(path)
    return sp['id'], os.path.relpath(path, HERE)


if __name__ == '__main__':
    specs = build_specs()
    os.makedirs(OUT, exist_ok=True)
    with Pool() as p:
        res = {}
        for i, (k, v) in enumerate(p.imap_unordered(run, specs, chunksize=10)):
            res[k] = v
            if i % 200 == 0: print(i, flush=True)
    for sp in specs: sp['path'] = res[sp['id']]
    json.dump(specs, open(os.path.join(HERE, 'cases_v3.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print(len(specs), 'cases')
