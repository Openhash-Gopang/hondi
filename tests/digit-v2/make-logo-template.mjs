// 로고 원본(assets/hondi-net-logo.png)에서 48×8 템플릿을 만들어 출력한다 — core의 LOGO_TEMPLATE에 붙여 넣는다.
// 사용: node make-logo-template.mjs
import fs from 'node:fs'; import { PNG } from 'pngjs';
import { logoDescriptor, LOGO } from '../../src/gopang/ai/hondi-digit-core.js';
const { width: W, height: H, data } = PNG.sync.read(fs.readFileSync(new URL('../../assets/hondi-net-logo.png', import.meta.url)));
const g = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { const a = data[i*4+3] / 255; g[i] = Math.round(((data[i*4] + data[i*4+1] + data[i*4+2]) / 3) * a + 255 * (1 - a)); }
const d = logoDescriptor(g, W, H, { min: LOGO.inkX1, max: LOGO.inkX2 }, { p1: LOGO.inkY1, p2: LOGO.inkY2 }, 255, 0);
console.log(JSON.stringify(Array.from(d, v => Math.round(v * 100) / 100)));
