// 새 배치(나비 로고 칸)의 로고 그림 검증 템플릿(24×16)을 assets/navi-code-logo.png 에서 만들어 출력한다.
// core 의 LOGO3_TEMPLATE 에 붙여 넣는다. 로고 이미지를 바꾸면 V3.art(잉크 범위)도 함께 맞춘 뒤 다시 실행한다.
// 사용: node make-logo3-template.mjs
import fs from 'node:fs'; import { PNG } from 'pngjs';
import { logoDescriptor, LOGO3_GX, LOGO3_GY, V3 } from '../../src/gopang/ai/hondi-digit-core.js';
const { width: W, height: H, data } = PNG.sync.read(fs.readFileSync(new URL('../../assets/navi-code-logo.png', import.meta.url)));
const k = W / V3.block.w;                                           // 블록 한 단위가 몇 픽셀인가(원본은 4배)
const g = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) g[i] = data[i * 4];                   // 빨강 채널(스캐너가 새 배치를 읽는 채널)
const ink = { min: Math.round((V3.art.x1 - V3.block.x) * k), max: Math.round((V3.art.x2 - V3.block.x) * k) };
const row = { p1: Math.round((V3.art.y1 - V3.block.y) * k), p2: Math.round((V3.art.y2 - V3.block.y) * k) };
const d = logoDescriptor(g, W, H, ink, row, 254, 26, LOGO3_GX, LOGO3_GY);
console.log(JSON.stringify(Array.from(d, v => Math.round(v * 100) / 100)));
