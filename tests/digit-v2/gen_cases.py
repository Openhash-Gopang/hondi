#!/usr/bin/env python3
"""혼디 숫자 코드 인식 테스트 프레임 생성기.

hondi-digit-core.js의 layoutDigitCode()와 같은 상수(consts.json)로 코드를 그린 뒤,
폰 카메라가 만들 법한 열화(축소·블러·노이즈·밝기·색조명·회전·원근·JPEG·종이/벽·잘림)를 입힌다.
출력: cases/<suite>/<id>.png  +  cases.json (정답/기대결과)
"""
import json, os, random, sys, io
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(os.path.join(HERE, 'consts.json'), encoding='utf-8'))
LOGO = Image.open(os.path.join(HERE, '..', '..', 'assets', 'hondi-net-logo.png')).convert('L')
OUT = os.path.join(HERE, 'cases')
FW, FH = 1280, 720
SS = 3  # supersample


def layout(serial):
    top = C['LOGO']['inkY2'] + C['GAP']
    boxes = []
    for i, ch in enumerate(serial):
        d = int(ch)
        bx = C['LOGO']['inkX1'] + i * C['PITCH']
        segs = []
        I = C['INNER']
        ix, iy = bx + I['x1'] * C['BOX_W'], top + I['y1'] * C['BOX_H']
        iw, ih = (I['x2'] - I['x1']) * C['BOX_W'], (I['y2'] - I['y1']) * C['BOX_H']
        for s in C['PAT'][str(d)]:
            b = C['SEG_BOXES'][s]
            segs.append((ix + b['x1'] * iw, iy + b['y1'] * ih, (b['x2'] - b['x1']) * iw, (b['y2'] - b['y1']) * ih))
        boxes.append((bx, top, C['BOX_W'], C['BOX_H'], segs))
    return boxes, int(top + C['BOX_H'] + 16)


def render_code(serial, with_logo=True, with_outline=True):
    boxes, H = layout(serial)
    W = C['LOGO']['w']
    im = Image.new('L', (W * SS, H * SS), 255)
    if with_logo:
        im.paste(LOGO.resize((W * SS, LOGO.height * SS), Image.LANCZOS), (0, 0))
    dr = ImageDraw.Draw(im)
    lw = max(1, round(C['BOX_W'] * 0.03)) * SS
    for (x, y, w, h, segs) in boxes:
        if with_outline:
            dr.rectangle([x * SS, y * SS, (x + w) * SS - 1, (y + h) * SS - 1], outline=0, width=lw)
        for (sx, sy, sw, sh) in segs:
            dr.rectangle([sx * SS, sy * SS, (sx + sw) * SS - 1, (sy + sh) * SS - 1], fill=0)
    return im.resize((W, H), Image.LANCZOS)


def perspective_coeffs(w, h, p):
    """p: 0~0.3 — 윗변을 좌우로 안쪽으로 조여 원근 흉내 + 약간의 비대칭."""
    dx = w * p
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    dst = [(dx, h * p * 0.3), (w - dx * 0.4, 0), (w, h), (0, h - h * p * 0.2)]
    A = []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    A = np.array(A, float); B = np.array([c for uv in src for c in uv], float)
    return np.linalg.solve(A, B).tolist()


def make_frame(serial, rng, *, frac=0.7, blur=0.0, noise=0.0, gain=1.0, offset=0, contrast=1.0,
               cast=(1, 1, 1), rot=0.0, persp=0.0, jpeg=None, scene='screen', wall=110,
               cut=None, dx=0, dy=0, logo=True, outline=True, occlude=None):
    code = render_code(serial, with_logo=logo, with_outline=outline)
    W, H = code.size
    M = 40 if scene == 'screen' else 260
    bg = 255 if scene == 'screen' else wall
    paper = Image.new('L', (W + 2 * 40, H + 2 * 40), 255)
    paper.paste(code, (40, 40))
    canvas = Image.new('L', (paper.width + 2 * (M - 40 if M > 40 else 0), paper.height + 2 * (M - 40 if M > 40 else 0)), bg)
    off = (canvas.width - paper.width) // 2
    canvas.paste(paper, (off, off))
    img = canvas
    if occlude:
        d = ImageDraw.Draw(img)
        kind, frac_pos = occlude
        # 숫자열 한가운데 근처를 가로/세로로 가리는 줄
        cx = off + 40 + C['LOGO']['inkX1'] + frac_pos * len(serial) * C['PITCH']
        top = off + 40 + C['LOGO']['inkY2'] + C['GAP']
        if kind == 'dark':
            d.rectangle([cx - 5, top - 4, cx + 5, top + C['BOX_H'] + 4], fill=30)
        else:
            d.rectangle([cx - 5, top - 4, cx + 5, top + C['BOX_H'] + 4], fill=255)
    if rot:
        img = img.rotate(rot, resample=Image.BICUBIC, expand=True, fillcolor=bg)
    if persp:
        co = perspective_coeffs(img.width, img.height, persp)
        img = img.transform(img.size, Image.PERSPECTIVE, co, Image.BICUBIC, fillcolor=bg)
    # 코드 캔버스 폭이 프레임 폭의 frac가 되도록 확대/축소
    s = (frac * FW) / W
    img = img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)
    frame = Image.new('L', (FW, FH), bg)
    # 코드 캔버스 중심을 프레임 중심(+dx,dy)에 둔다
    cxp = FW // 2 + dx - img.width // 2
    cyp = FH // 2 + dy - img.height // 2
    frame.paste(img, (cxp, cyp))
    if cut:
        # 잘림 시뮬레이션: 프레임 안에서 코드의 일부를 '프레임 밖'으로 밀어낸 것과 같은 효과 — 해당 영역을 배경으로 덮는다가 아니라
        # 프레임 자체를 자르는 것이므로, 코드 위치(dx,dy)로 처리한다(호출부 참조).
        pass
    a = np.asarray(frame, float)
    if wall and scene == 'wall':
        tex = rng.normal(0, 6, a.shape)
        a = np.where(np.asarray(frame) == bg, a + tex, a)
    a = (a - 128) * contrast + 128
    a = a * gain + offset
    rgb = np.stack([a * cast[0], a * cast[1], a * cast[2]], -1)
    if blur:
        rgbi = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
        rgb = np.asarray(rgbi, float)
    if noise:
        rgb = rgb + rng.normal(0, noise, rgb.shape)
    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB')
    if jpeg:
        buf = io.BytesIO(); out.save(buf, 'JPEG', quality=jpeg); buf.seek(0); out = Image.open(buf).convert('RGB')
    return out


def rand_serial(n, rng):
    return str(rng.randint(1, 9)) + ''.join(str(rng.randint(0, 9)) for _ in range(n - 1))


def build_specs():
    rng = random.Random(20260924)
    specs = []
    def add(suite, level, serial, expect, **kw):
        specs.append(dict(suite=suite, level=str(level), serial=serial, expect=expect, kw=kw))

    # S1: 깨끗한 프레임, 자릿수 1~10
    for n in range(1, 11):
        for _ in range(60):
            s = rand_serial(n, rng); add('S1_clean', f'N{n}', s, s)

    # S2: 획이 적거나 헷갈리는 번호
    hard = ['1', '7', '11', '77', '17', '71', '111', '1111', '11111', '111111', '1111111', '11111111', '111111111', '1111111111',
            '7777777777', '8888888888', '9999999999', '1000000000', '1234567890', '1717171717', '3939393939', '5656565656',
            '0'.join(['1', '8']), '1004', '5882', '8282', '10101', '70707', '18181', '39393', '56565', '90909']
    for s in hard:
        if s[0] == '0': continue
        for _ in range(5): add('S2_hardpairs', f'N{len(s)}', s, s)

    # S3: 열화 스윕 (N=5, N=10)
    def sweep(name, levels, fn, count=20):
        for n in (5, 10):
            for lv in levels:
                for _ in range(count):
                    s = rand_serial(n, rng); add('S3_' + name, f'N{n}@{lv}', s, s, **fn(lv))
    sweep('scale', [0.12, 0.16, 0.2, 0.25, 0.3, 0.4, 0.55, 0.8, 0.95], lambda v: dict(frac=v))
    sweep('blur', [0.5, 1, 1.5, 2, 3, 4], lambda v: dict(blur=v))
    sweep('noise', [5, 15, 30, 50], lambda v: dict(noise=v))
    sweep('dark', [0.7, 0.5, 0.3, 0.2], lambda v: dict(gain=v, offset=0, noise=6))
    sweep('lowcontrast', [0.6, 0.4, 0.25], lambda v: dict(contrast=v, offset=40))
    sweep('cast', ['warm', 'cool', 'green'], lambda v: dict(cast={'warm': (1, .85, .55), 'cool': (.6, .85, 1), 'green': (.7, 1, .7)}[v]))
    sweep('rot', [2, 5, 8, 12, 20], lambda v: dict(rot=v))
    sweep('persp', [0.05, 0.1, 0.15, 0.25], lambda v: dict(persp=v))
    sweep('jpeg', [90, 60, 40, 20, 10], lambda v: dict(jpeg=v))
    sweep('wall', [60, 110, 170, 220], lambda v: dict(scene='wall', wall=v, noise=4))
    sweep('occlude', ['dark', 'white'], lambda v: dict(occlude=(v, 0.5)))
    # 복합: 폰 카메라 현실 (약간 흐림+노이즈+회전+원근+JPEG+벽)
    sweep('combo', ['mild', 'harsh'], lambda v: dict(
        frac=0.5, blur=1.0 if v == 'mild' else 2.0, noise=8 if v == 'mild' else 25, rot=3 if v == 'mild' else 9,
        persp=0.05 if v == 'mild' else 0.15, jpeg=75 if v == 'mild' else 35, scene='wall', wall=120,
        gain=0.9 if v == 'mild' else 0.55, cast=(1, .95, .8)))

    # S4: 잘린 프레임 — 숫자열 일부가 프레임 밖 (기대: 거절)
    for n in (5, 10):
        code_w = 0.7 * FW
        for name, dx, dy in [('left', -int(code_w * 0.5 + 60), 0), ('left_small', -int(code_w * 0.5 + 20), 0),
                             ('right', int(code_w * 0.5 + 60), 0), ('right_small', int(code_w * 0.5 + 20), 0),
                             ('bottom', 0, 300), ('top_logo_cut', 0, -330)]:
            for _ in range(20):
                s = rand_serial(n, rng)
                # 기대: 어느 자릿수라도 잘려 있으면 거절(None). 단, 코드가 완전히 프레임 안에 남는 경우는 정답.
                add('S4_truncated', f'N{n}@{name}', s, None, dx=dx, dy=dy, frac=0.7)

    # S5: 코드 없는 화면(오탐 시험)
    for _ in range(60):
        s = rand_serial(rng.randint(3, 10), rng); add('S5_negative', 'digits_no_logo', s, None, logo=False)
    for _ in range(40):
        s = rand_serial(rng.randint(3, 10), rng); add('S5_negative', 'clock_no_outline_no_logo', s, None, logo=False, outline=False)
    for _ in range(40):
        s = rand_serial(rng.randint(3, 10), rng); add('S5_negative', 'clock_no_outline_with_logo', s, None, outline=False)
    for _ in range(40):
        add('S5_negative', 'blank_wall', '', None, _blank=True)
    for _ in range(40):
        add('S5_negative', 'logo_only', '', None, _logo_only=True)
    for _ in range(40):
        add('S5_negative', 'random_boxes', '', None, _boxes=True)
    if os.environ.get('QUICK'):
        specs = specs[::12]          # 빠른 점검용(약 1/12)
    for i, sp in enumerate(specs):
        sp['id'] = f"{sp['suite']}_{i:05d}"
        sp['seed'] = i
    return specs


def negative_frame(kind, rng):
    a = np.full((FH, FW), rng.integers(60, 230), float)
    im = Image.fromarray(a.astype(np.uint8))
    dr = ImageDraw.Draw(im)
    if kind == 'logo_only':
        code = LOGO.resize((int(517 * rng.uniform(1.0, 1.8)),) * 1 + (0,)) if False else LOGO
        w = int(FW * rng.uniform(0.4, 0.8)); h = int(w * LOGO.height / LOGO.width)
        im.paste(LOGO.resize((w, h), Image.LANCZOS), (int(rng.integers(0, FW - w)), int(rng.integers(0, FH - h))))
    elif kind == 'random_boxes':
        for _ in range(int(rng.integers(3, 30))):
            x, y = int(rng.integers(0, FW - 50)), int(rng.integers(0, FH - 50))
            w, h = int(rng.integers(20, 200)), int(rng.integers(20, 200))
            if rng.random() < .5: dr.rectangle([x, y, x + w, y + h], outline=0, width=int(rng.integers(1, 5)))
            else: dr.rectangle([x, y, x + w, y + h], fill=int(rng.integers(0, 60)))
    out = np.asarray(im, float) + rng.normal(0, 5, (FH, FW))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert('RGB')


def run(sp):
    rng = np.random.default_rng(sp['seed'])
    kw = dict(sp['kw'])
    d = os.path.join(OUT, sp['suite']); os.makedirs(d, exist_ok=True)
    path = os.path.join(d, sp['id'] + '.png')
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return sp['id'], os.path.relpath(path, HERE)
    if kw.pop('_blank', False):
        a = np.full((FH, FW), rng.integers(40, 230), float) + rng.normal(0, 6, (FH, FW))
        Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('RGB').save(path)
    elif kw.pop('_logo_only', False):
        negative_frame('logo_only', rng).save(path)
    elif kw.pop('_boxes', False):
        negative_frame('random_boxes', rng).save(path)
    else:
        make_frame(sp['serial'], rng, **kw).save(path)
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
    json.dump(specs, open(os.path.join(HERE, 'cases.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print(len(specs), 'cases')
