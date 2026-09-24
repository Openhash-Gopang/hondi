import fs from 'node:fs';
import * as C from '../../src/gopang/ai/hondi-digit-core.js';
fs.writeFileSync(new URL('./consts.json', import.meta.url), JSON.stringify({LOGO:C.LOGO,PITCH:C.PITCH,BOX_W:C.BOX_W,BOX_H:C.BOX_H,GAP:C.LOGO_TO_ROW_GAP,SEG_BOXES:C.SEG_BOXES,PAT:C.SEGMENT_PATTERNS,INNER:C.INNER}));
