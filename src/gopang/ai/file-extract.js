// 첨부 파일에서 서식의 글자를 뽑는 브라우저 도우미 (2026-10-14 신설).
//   PDF  : 글자층이 있으면 텍스트, 없는 스캔본이면 앞쪽 몇 쪽을 그림으로 그려 비전 모델에 넘긴다.
//   DOCX : mammoth로 HTML을 만든 뒤 표를 "칸 | 칸" 줄로 펴서 서식의 표 구조를 살린다.
//   HWPX : zip 안의 section XML에서 글자를 뽑는다. (예전 .hwp 이진 형식은 열 수 없다 — PDF/HWPX로 저장하거나 사진을 안내한다.)
// 라이브러리는 필요할 때만 jsdelivr에서 받는다(kdoctor-chat-widget.js와 같은 버전·고정 해시).
// 순수 변환 함수는 node에서 테스트한다.

export const LIMITS = { maxBytes: 20 * 1024 * 1024, maxTextPages: 30, maxScanPages: 5, imageMaxEdge: 1600, jpegQuality: 0.85, maxChars: 20000 };

export function classifyFile(name = '', type = '') {
  const n = name.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (/\.(txt|md|csv)$/.test(n) || type.startsWith('text/')) return 'text';
  if (/\.pdf$/.test(n) || type === 'application/pdf') return 'pdf';
  if (/\.docx$/.test(n)) return 'docx';
  if (/\.hwpx$/.test(n)) return 'hwpx';
  if (/\.hwp$/.test(n)) return 'hwp';
  if (/\.doc$/.test(n)) return 'doc';
  return 'other';
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
const decode = s => s.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, m => ENT[m] ?? m)
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const tidy = s => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// mammoth HTML → 줄 단위 글. 표의 칸은 " | "로 잇고 행은 줄바꿈.
export function htmlToFormText(html) {
  return tidy(decode(String(html)
    // mammoth는 표 칸 안을 <p>로 한 겹 더 감싼다 — 칸 안의 문단 경계는 공백 하나로 접어 한 칸이 한 줄에 남게 한다.
    .replace(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (m, tag, attrs, inner) =>
      `<${tag}>` + inner.replace(/<\/p>\s*<p\b[^>]*>/gi, ' ').replace(/<\/?p\b[^>]*>/gi, '') + `</${tag}>`)
    .replace(/<\/(td|th)>\s*(?=<(td|th)\b)/gi, ' | ')
    .replace(/<\/(td|th)>/gi, '')
    .replace(/<\/(tr|p|h[1-6]|li|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')));
}

// HWPX section XML → 글. <hp:t>가 글자, <hp:p>가 문단, <hp:tc>가 표 칸, <hp:tr>이 행.
export function hwpxXmlToText(xml) {
  return tidy(decode(String(xml)
    // 표 칸 안의 문단 끝은 공백으로 접어 한 칸이 한 줄에 남게 한다(칸 사이는 " | ").
    .replace(/<hp:tc\b[^>]*>[\s\S]*?<\/hp:tc>/g, m => m.replace(/<\/hp:p>/g, ' '))
    .replace(/<\/hp:tc>\s*(?=<hp:tc\b)/g, ' | ')
    .replace(/<\/hp:tc>/g, '')
    .replace(/<\/hp:tr>/g, '\n')
    .replace(/<\/hp:p>/g, '\n')
    .replace(/<hp:lineBreak\s*\/>/g, '\n')
    .replace(/<hp:tab\b[^>]*\/>/g, '\t')
    .replace(/<(?!\/?hp:t\b)[^>]+>/g, '')      // hp:t 외 태그 제거
    .replace(/<\/?hp:t\b[^>]*>/g, '')
    .replace(/ +\| /g, ' | ')));
}

// ── 브라우저 전용 ─────────────────────────────────────
const CDN = 'https://cdn.jsdelivr.net/npm';
const PDFJS_VER = '4.4.168';
const SRI = {
  mammoth: ['mammoth@1.8.0/mammoth.browser.min.js', 'sha384-/cXAMbzovUIKbBERjPmR3SnPTh8siWr5lsvFYj1Uq4XP0yaJUZJmsh0YXyGv5P0y', 'mammoth'],
  jszip: ['jszip@3.10.1/dist/jszip.min.js', 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG', 'JSZip'],
};
const libs = {};

function loadScript(key) {
  const [path, integrity, globalName] = SRI[key];
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!libs[key]) libs[key] = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = `${CDN}/${path}`; sc.integrity = integrity; sc.crossOrigin = 'anonymous';
    sc.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(key + ' missing'));
    sc.onerror = () => reject(new Error(key + ' load'));
    document.head.appendChild(sc);
  });
  libs[key].catch(() => { libs[key] = null; });
  return libs[key];
}
function loadPdfjs() {
  if (!libs.pdf) libs.pdf = (async () => {
    const mod = await import(/* @vite-ignore */ `${CDN}/pdfjs-dist@${PDFJS_VER}/build/pdf.min.mjs`);
    const w = await fetch(`${CDN}/pdfjs-dist@${PDFJS_VER}/build/pdf.worker.min.mjs`);
    if (!w.ok) throw new Error('pdf worker ' + w.status);
    mod.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([await w.text()], { type: 'text/javascript' }));
    return mod;
  })();
  libs.pdf.catch(() => { libs.pdf = null; });
  return libs.pdf;
}
const readBuf = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); });

async function extractPdf(file) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await readBuf(file)) }).promise;
  const n = Math.min(doc.numPages, LIMITS.maxTextPages);
  let text = '';
  for (let i = 1; i <= n; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    text += tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  if (text.replace(/\s/g, '').length >= 40 * Math.min(n, 3)) {
    return { kind: 'text', text: tidy(text), note: doc.numPages > n ? `PDF ${doc.numPages}쪽 중 앞 ${n}쪽만 읽음` : '' };
  }
  // 글자층이 없는 스캔 PDF → 앞쪽 몇 쪽을 그림으로
  const scanN = Math.min(doc.numPages, LIMITS.maxScanPages), images = [];
  for (let j = 1; j <= scanN; j++) {
    const page = await doc.getPage(j), vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2, LIMITS.imageMaxEdge / Math.max(vp0.width, vp0.height)) });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: cx, viewport: vp }).promise;
    images.push(cv.toDataURL('image/jpeg', LIMITS.jpegQuality));
  }
  return { kind: 'images', images, note: `스캔본 PDF — ${doc.numPages}쪽 중 앞 ${scanN}쪽을 그림으로 읽음` };
}
async function extractDocx(file) {
  const mammoth = await loadScript('mammoth');
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await readBuf(file) });
  return { kind: 'text', text: htmlToFormText(value), note: '' };
}
async function extractHwpx(file) {
  const JSZip = await loadScript('jszip');
  const zip = await JSZip.loadAsync(await readBuf(file));
  const names = Object.keys(zip.files).filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!names.length) throw new Error('hwpx section 없음');
  const parts = [];
  for (const n of names) parts.push(hwpxXmlToText(await zip.files[n].async('string')));
  return { kind: 'text', text: tidy(parts.join('\n\n')), note: '' };
}

// → { kind:'text', text, note } | { kind:'images', images, note } | { kind:'unsupported', reason }
export async function extractFile(file) {
  const kind = classifyFile(file.name, file.type);
  if (file.size > LIMITS.maxBytes) return { kind: 'unsupported', reason: '파일이 20MB를 넘어 열지 않았습니다.' };
  try {
    let r;
    if (kind === 'pdf') r = await extractPdf(file);
    else if (kind === 'docx') r = await extractDocx(file);
    else if (kind === 'hwpx') r = await extractHwpx(file);
    else if (kind === 'hwp') return { kind: 'unsupported', reason: '예전 한글(.hwp) 형식은 열 수 없습니다. 한글에서 「다른 이름으로 저장」으로 PDF나 HWPX로 저장하거나, 종이를 촬영해 주세요.' };
    else if (kind === 'doc') return { kind: 'unsupported', reason: '예전 워드(.doc) 형식은 열 수 없습니다. DOCX나 PDF로 저장하거나 촬영해 주세요.' };
    else return { kind: 'unsupported', reason: '이 형식은 아직 열 수 없습니다.' };
    if (r.kind === 'text' && r.text.replace(/\s/g, '').length < 10) return { kind: 'unsupported', reason: '글자를 찾지 못했습니다. 사진 촬영을 권합니다.' };
    return r;
  } catch (e) {
    return { kind: 'unsupported', reason: `파일을 읽다 오류가 났습니다(${e.message}).` };
  }
}
