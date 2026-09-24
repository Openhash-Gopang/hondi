// 사용: node real.mjs <이미지.png ...>   실제 사진/스크린샷 한 장씩 인식해 결과를 출력
import fs from 'node:fs'; import { PNG } from 'pngjs';
import * as C from '../../src/gopang/ai/hondi-digit-core.js';
for (const f of process.argv.slice(2)) {
  const { width: W, height: H, data } = PNG.sync.read(fs.readFileSync(f));
  const g = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { const a = data[i*4+3] / 255; g[i] = Math.round(((data[i*4] + data[i*4+1] + data[i*4+2]) / 3) * a + 255 * (1 - a)); }
  const r = C.analyzeGray(g, W, H);
  console.log(f, `${W}x${H}`, r.ok ? `OK serial=${r.serial} n=${r.n}` : `REJECT ${r.reason}`);
}
