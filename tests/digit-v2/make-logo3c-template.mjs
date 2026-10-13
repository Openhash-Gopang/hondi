// 노란 블록 기준점 경로의 거친 로고 검증 템플릿(8×10)을 assets/navi-code-logo.png 에서 만들어 출력한다 (core 의 LOGO3C_TEMPLATE).
// 사용: node make-logo3c-template.mjs
import fs from 'node:fs'; import { PNG } from 'pngjs';
import { logoDescriptor, V3 } from '../../src/gopang/ai/hondi-digit-core.js';
const { width: W, height: H, data } = PNG.sync.read(fs.readFileSync(new URL('../../assets/navi-code-logo.png', import.meta.url)));
const k = W / V3.block.w, g = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) g[i] = data[i * 4];
const ink = { min: Math.round((V3.art.x1 - V3.block.x) * k), max: Math.round((V3.art.x2 - V3.block.x) * k) };
const row = { p1: Math.round((V3.art.y1 - V3.block.y) * k), p2: Math.round((V3.art.y2 - V3.block.y) * k) };
console.log(JSON.stringify(Array.from(logoDescriptor(g, W, H, ink, row, 254, 26, 8, 10), v => Math.round(v * 100) / 100)));
