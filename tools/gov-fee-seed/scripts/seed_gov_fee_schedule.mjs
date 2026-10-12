// seed_gov_fee_schedule.mjs
//
// 사용법:
//   node scripts/seed_gov_fee_schedule.mjs --file ./나비_정부수수료_기준표_초안.xlsx --dry-run
//   node scripts/seed_gov_fee_schedule.mjs --file ./나비_정부수수료_기준표_초안.xlsx
//   node scripts/seed_gov_fee_schedule.mjs --file ./나비_정부수수료_기준표_초안.xlsx --embed --worker-url https://hondi-proxy.example.workers.dev
//
// 환경변수 (PocketBase 실제 반영 시 필요, --dry-run이면 불필요):
//   POCKETBASE_URL, POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD
//   HONDI_WORKER_URL (--embed 시, --worker-url 생략하면 이 값을 씀)
//
// 옵션:
//   --file <path>       엑셀 파일 경로 (필수)
//   --region <code>     기준표(천안시) 시트를 어느 region_code로 저장할지 (기본: chungnam_cheonan)
//   --multiplier <n>    gdc_multiplier 기본값 (기본: 2, 나비 과금 원칙 ③)
//   --dry-run           PocketBase에 쓰지 않고 파싱 결과만 콘솔에 출력 + JSON으로 저장
//   --embed             PocketBase 반영 후, worker.js POST /orchestration/gov-fee-embed-index로
//                        REAL 레코드를 bge-m3+Vectorize(hondi-gov-fee-schedule 인덱스)에 색인
//   --worker-url <url>  --embed용 Worker 베이스 URL (HONDI_WORKER_URL 환경변수로도 지정 가능)

import ExcelJS from 'exceljs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Windows에서 상대경로가 올바르게 해석되도록 pathToFileURL 패턴 사용
// (기존 gopang bootstrap seeding 스크립트 컨벤션과 동일)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { dryRun: false, region: 'chungnam_cheonan', multiplier: 2, embed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--embed') args.embed = true;
    else if (a === '--worker-url') args.workerUrl = argv[++i];
    else if (a === '--region') args.region = argv[++i];
    else if (a === '--multiplier') args.multiplier = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--pb-url') args.pbUrl = argv[++i];
  }
  return args;
}

function getCellText(cell) {
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return v;
  if (v.richText) return v.richText.map((r) => r.text).join('').trim();
  if (v.text) return String(v.text).trim();
  return String(v).trim();
}

function normalizeName(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/['"'']/g, '')
    .trim();
}

// ── 1) 기준표(천안시) 시트 파싱 ──
function parseBaselineSheet(ws, { region, multiplier }) {
  const records = [];
  const header = ws.getRow(1);
  const colIndex = {};
  header.eachCell((cell, colNumber) => {
    colIndex[getCellText(cell)] = colNumber;
  });

  const required = ['민원사무명', '처리부서(원본:천안시)', '수수료_원문', '최소금액(원)', '최대금액(원)', '분류', '처리일수', '관련법규(발췌)'];
  for (const key of required) {
    if (!colIndex[key]) throw new Error(`기준표 시트에서 컬럼을 찾지 못함: ${key}`);
  }

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = getCellText(row.getCell(colIndex['민원사무명']));
    if (!name || typeof name !== 'string') continue;
    if (name.startsWith('※')) continue; // 하단 안내 문구 행 skip

    const feeText = getCellText(row.getCell(colIndex['수수료_원문']));
    const min = getCellText(row.getCell(colIndex['최소금액(원)']));
    const max = getCellText(row.getCell(colIndex['최대금액(원)']));
    const classification = getCellText(row.getCell(colIndex['분류']));
    const dept = getCellText(row.getCell(colIndex['처리부서(원본:천안시)']));
    const days = getCellText(row.getCell(colIndex['처리일수']));
    const law = getCellText(row.getCell(colIndex['관련법규(발췌)']));

    const hasParsedNumber = typeof min === 'number';
    const feeTypeMap = {
      '무료': 'free',
      '금액명시': hasParsedNumber ? 'flat' : 'unknown',
      '조례참조': 'ordinance_ref',
      '정보없음': 'unknown',
    };
    // 상태는 분류 라벨이 아니라 "실제로 쓸 수 있는 숫자를 확보했는가"로 결정한다.
    // 라벨이 '금액명시'라도 정규식이 놓친 한글 숫자("1만5천원" 등)면 REAL로 표시하지 않는다.
    let status;
    if (classification === '무료') status = 'REAL';
    else if (classification === '금액명시' && hasParsedNumber) status = 'REAL';
    else if (classification === '금액명시' && !hasParsedNumber) status = 'NEEDS_REVIEW'; // 원문에 숫자 있는데 파싱 실패
    else if (classification === '조례참조') status = 'NEEDS_REVIEW';
    else status = 'MISSING';

    const govMin = classification === '무료' ? 0 : hasParsedNumber ? min : null;
    const govMax = classification === '무료' ? 0 : typeof max === 'number' ? max : null;

    const hondiMin = govMin != null ? Math.round(govMin * multiplier) : null;
    const hondiMax = govMax != null ? Math.round(govMax * multiplier) : null;

    records.push({
      service_name: name,
      service_name_norm: normalizeName(name),
      scope: 'regional',
      region_code: region,
      fee_type: feeTypeMap[classification] ?? 'unknown',
      gov_reference_fee_min: govMin,
      gov_reference_fee_max: govMax,
      formula_json: null,
      gdc_multiplier: multiplier,
      hondi_service_fee_min: hondiMin,
      hondi_service_fee_max: hondiMax,
      status,
      source: '천안시 민원사무편람 (사용자 제공, 2026-08 기준)',
      effective_date: null,
      last_verified: null,
      notes:
        classification === '조례참조'
          ? '조례/별표 원문 확인 필요 — 자동 산정 금지'
          : classification === '금액명시' && !hasParsedNumber
          ? '원문에 금액이 명시되어 있으나 한글 숫자 표기 등으로 자동 파싱 실패 — 수동 확인 필요'
          : null,
      raw_fee_text: typeof feeText === 'string' ? feeText : feeText != null ? String(feeText) : null,
      related_law: typeof law === 'string' ? law : null,
    });
  }
  return records;
}

// ── 2) 국세(인지세) 시트 파싱 ──
function buildStampTaxRecords(multiplier) {
  // 인지세법 제3조제1항제1~3호 — 서로 다른 문서유형이지만 세액 구간표는 동일.
  // ★ 2026-08-15 수정 — 원래 세 문서유형을 한 레코드(service_name에 전부 나열)로
  // 묶었다가, 키워드 매칭 테스트에서 이름이 너무 길어져(9토큰) 실사용 문의와의
  // 겹침 점수가 근소하게 임계값을 못 넘기는 문제를 발견했다(테스트 스위트 참고).
  // 매칭 정확도를 위해 문서유형별로 레코드를 분리한다 — formula_json은 동일 tier를
  // 그대로 복사(공식이 실제로 동일하므로 중복이 아니라 정확한 표현).
  const sharedTiers = [
    { max: 10000000, rate: 0, base: 0 },
    { max: 30000000, rate: 0, base: 20000 },
    { max: 50000000, rate: 0, base: 40000 },
    { max: 100000000, rate: 0, base: 70000 },
    { max: 1000000000, rate: 0, base: 150000 },
    { max: null, rate: 0, base: 350000 },
  ];
  const rawFeeText = '1천만원 이하 면세 / 1천만~3천만 2만원 / 3천만~5천만 4만원 / 5천만~1억 7만원 / 1억~10억 15만원 / 10억 초과 35만원';
  const commonNote = '주택 이전 1억원 이하·대출 5천만원 이하는 비과세(제6조) — 계산 전 비과세 요건 확인 필요';

  const docTypes = [
    { key: '부동산·선박·항공기 소유권이전증서', lawNo: '제1호' },
    { key: '금융기관 대출(금전소비대차)증서', lawNo: '제2호' },
    { key: '도급·위임증서(법정)', lawNo: '제3호' },
  ];

  const tieredRecords = docTypes.map(({ key, lawNo }) => ({
    service_name: `인지세(${key})`,
    service_name_norm: normalizeName(`인지세${key}`),
    scope: 'national',
    region_code: null,
    fee_type: 'formula',
    gov_reference_fee_min: 0,
    gov_reference_fee_max: 350000,
    formula_json: { calc: 'tiered_threshold', tiers: sharedTiers },
    gdc_multiplier: multiplier,
    hondi_service_fee_min: null,
    hondi_service_fee_max: null,
    status: 'REAL',
    source: '인지세법 제3조·제6조 (국가법령정보센터, 2026-08 기준)',
    effective_date: null,
    last_verified: '2026-08-15',
    notes: commonNote,
    raw_fee_text: rawFeeText,
    related_law: `인지세법 제3조제1항${lawNo}, 제6조`,
  }));

  const flatRecord = {
    service_name: '인지세(등록대상 동산 양도증서 - 자동차 등)',
    service_name_norm: normalizeName('인지세등록대상동산양도증서자동차등'),
    scope: 'national',
    region_code: null,
    fee_type: 'flat',
    gov_reference_fee_min: 3000,
    gov_reference_fee_max: 3000,
    formula_json: null,
    gdc_multiplier: multiplier,
    hondi_service_fee_min: 3000 * multiplier,
    hondi_service_fee_max: 3000 * multiplier,
    status: 'REAL',
    source: '인지세법 제3조 (국가법령정보센터, 2026-08 기준)',
    effective_date: null,
    last_verified: '2026-08-15',
    notes: null,
    raw_fee_text: '3,000원 정액',
    related_law: '인지세법 제3조제1항제4호',
  };

  return [...tieredRecords, flatRecord];
}

// ── 3) 법원 인지대·송달료 시트 → 레코드 ──
function buildCourtFeeRecords(multiplier) {
  const courtFeeFormula = {
    calc: 'tiered_rate_plus_base',
    roundDown: 100,
    tiers: [
      { max: 10000000, rate: 0.005, base: 0 },
      { max: 100000000, rate: 0.0045, base: 5000 },
      { max: 1000000000, rate: 0.004, base: 55000 },
      { max: null, rate: 0.0035, base: 555000 },
    ],
    efileDiscount: 0.1,
  };
  const serviceMailFormula = {
    calc: 'service_mail',
    unitFee: 5500, // 2025-06-01 개정 기준
  };
  return [
    {
      service_name: '법원 인지대(민사소송 등, 본안)',
      service_name_norm: normalizeName('법원인지대민사소송등본안'),
      scope: 'national',
      region_code: null,
      fee_type: 'formula',
      gov_reference_fee_min: null,
      gov_reference_fee_max: null,
      formula_json: courtFeeFormula,
      gdc_multiplier: multiplier,
      hondi_service_fee_min: null,
      hondi_service_fee_max: null,
      status: 'REAL',
      source: '민사소송 등 인지법 제2조·제3조, 인지규칙 (2026-08 기준)',
      effective_date: null,
      last_verified: '2026-08-15',
      notes: '지급명령(독촉절차)은 본안 인지액의 1/10. 전자소송 10% 할인. 100원 미만 절사.',
      raw_fee_text: '소가 1천만원 미만: ×0.5% / 1천만~1억: ×0.45%+5,000원 / 1억~10억: ×0.40%+55,000원 / 10억 이상: ×0.35%+555,000원',
      related_law: '민사소송 등 인지법 제2조, 제3조',
    },
    {
      service_name: '법원 송달료',
      service_name_norm: normalizeName('법원송달료'),
      scope: 'national',
      region_code: null,
      fee_type: 'formula',
      gov_reference_fee_min: null,
      gov_reference_fee_max: null,
      formula_json: serviceMailFormula,
      gdc_multiplier: multiplier,
      hondi_service_fee_min: null,
      hondi_service_fee_max: null,
      status: 'REAL',
      source: '송달료규칙 (2025-06-01 개정, 1회 5,500원)',
      effective_date: '2025-06-01',
      last_verified: '2026-08-15',
      notes: '예상 송달료 = 단가 × 당사자수 × 예납 회수(사건유형별 회수 상이, 기본 15회는 예시)',
      raw_fee_text: '1회 5,500원',
      related_law: '송달료규칙',
    },
  ];
}

// ── 관리자 로그인 (PocketBase 버전별 그레이스풀 디그레이드) ──────────
// PocketBase 0.23부터 관리자가 일반 컬렉션(_superusers)으로 통합됐다
// (npm pocketbase SDK v0.27은 이 모델만 지원 — pb.admins가 내부적으로
// this.collection('_superusers')로 매핑돼 있다). 0.23 미만 서버는
// 여전히 별도 최상위 라우트 /api/admins/auth-with-password를 쓴다
// (2026-08-15 — 실제로 PocketBase 0.22.14 운영 서버에서 SDK 쪽
// _superusers 경로가 404 나는 걸 확인하고 발견).
//
// 먼저 새 방식(_superusers)을 시도하고, 404면 구버전 엔드포인트로
// raw fetch 후 pb.authStore에 토큰을 직접 채운다 — 이후의 모든
// pb.collection('gov_fee_schedule').* 호출은 일반 레코드 CRUD라
// 버전 차이가 없으므로 그대로 정상 동작한다.
async function authenticateAdmin(pb, pbUrl, email, password) {
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    console.log('[AUTH] PocketBase >=0.23 (_superusers) 방식으로 로그인 성공');
    return;
  } catch (e) {
    if (e?.status !== 404) throw e; // 404 이외의 오류(비밀번호 오류 등)는 그대로 던진다
  }

  console.log('[AUTH] _superusers 방식 404 — PocketBase <0.23 구버전 엔드포인트로 재시도합니다.');
  const res = await fetch(new URL('/api/admins/auth-with-password', pbUrl).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`구버전 관리자 로그인도 실패: HTTP ${res.status} ${text}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error('구버전 로그인 응답에 token이 없습니다: ' + JSON.stringify(data));
  pb.authStore.save(data.token, data.admin || null);
  console.log('[AUTH] PocketBase <0.23 (/api/admins) 방식으로 로그인 성공');
}

async function upsertRecord(pb, record) {
  const filter = `service_name_norm = "${record.service_name_norm}" && region_code ${record.region_code ? `= "${record.region_code}"` : '= null'}`;
  try {
    const existing = await pb.collection('gov_fee_schedule').getFirstListItem(filter);
    const updated = await pb.collection('gov_fee_schedule').update(existing.id, record);
    return { action: 'updated', id: updated.id };
  } catch (e) {
    if (e?.status === 404) {
      const created = await pb.collection('gov_fee_schedule').create(record);
      return { action: 'created', id: created.id };
    }
    throw e;
  }
}

// ── 시맨틱 검색 인덱싱 (2026-08-15 신설) ────────────────────────────
// worker.js POST /orchestration/gov-fee-embed-index를 배치(최대 100건)로
// 호출한다. id는 반드시 PocketBase가 방금 발급한 실제 레코드 id를 써야
// 한다(gov-fee-lookup.js/handleGovFeeEmbedIndex 주석 참조 — entity 버전이
// guid를 써서 겪은 404 버그 클래스를 여기서는 애초에 피한다).
async function embedIndexBatch(workerBaseUrl, records) {
  const url = new URL('/orchestration/gov-fee-embed-index', workerBaseUrl);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${text}`);
  }
  return res.json();
}

async function embedIndexAll(workerBaseUrl, indexableRecords) {
  const BATCH_SIZE = 100; // worker.js 쪽 배치 한도와 동일
  let indexed = 0;
  for (let i = 0; i < indexableRecords.length; i += BATCH_SIZE) {
    const batch = indexableRecords.slice(i, i + BATCH_SIZE);
    try {
      const result = await embedIndexBatch(workerBaseUrl, batch);
      indexed += result.count || 0;
      console.log(`[EMBED] 배치 ${i / BATCH_SIZE + 1}: ${result.count}건 색인 완료`);
    } catch (e) {
      console.error(`[EMBED-FAIL] 배치 ${i / BATCH_SIZE + 1} (${batch.length}건):`, e.message);
    }
  }
  return indexed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('사용법: node seed_gov_fee_schedule.mjs --file <xlsx경로> [--dry-run] [--region cheonan] [--multiplier 2]');
    process.exit(1);
  }

  const filePath = path.isAbsolute(args.file) ? args.file : path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`파일을 찾을 수 없습니다: ${filePath}`);
    process.exit(1);
  }
  // Windows 경로 호환을 위해 file:// URL로도 정규화해 로그에 남김 (컨벤션 유지)
  console.log('대상 파일:', pathToFileURL(filePath).href);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const baselineWs = wb.getWorksheet('기준표(천안시)');
  if (!baselineWs) throw new Error('"기준표(천안시)" 시트를 찾지 못했습니다.');

  const regionalRecords = parseBaselineSheet(baselineWs, { region: args.region, multiplier: args.multiplier });
  const stampTaxRecords = buildStampTaxRecords(args.multiplier);
  const courtFeeRecords = buildCourtFeeRecords(args.multiplier);

  const all = [...regionalRecords, ...stampTaxRecords, ...courtFeeRecords];

  const summary = {
    total: all.length,
    regional: regionalRecords.length,
    national: stampTaxRecords.length + courtFeeRecords.length,
    byStatus: all.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
  };
  console.log('파싱 요약:', JSON.stringify(summary, null, 2));

  if (args.dryRun) {
    const outPath = path.join(__dirname, 'seed_preview.json');
    fs.writeFileSync(outPath, JSON.stringify(all, null, 2), 'utf-8');
    console.log(`[DRY-RUN] PocketBase에 쓰지 않았습니다. 미리보기 저장: ${outPath}`);
    return;
  }

  const { default: PocketBase } = await import('pocketbase');
  const pbUrl = args.pbUrl || process.env.POCKETBASE_URL;
  const email = process.env.POCKETBASE_ADMIN_EMAIL;
  const password = process.env.POCKETBASE_ADMIN_PASSWORD;
  if (!pbUrl || !email || !password) {
    console.error('POCKETBASE_URL / POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD 환경변수가 필요합니다.');
    process.exit(1);
  }

  const pb = new PocketBase(pbUrl);
  await authenticateAdmin(pb, pbUrl, email, password);

  let created = 0, updated = 0, failed = 0;
  const indexableRecords = []; // --embed용: 성공적으로 upsert된 REAL 레코드만 모은다
  for (const record of all) {
    try {
      const { action, id } = await upsertRecord(pb, record);
      if (action === 'created') created++;
      else updated++;
      // NEEDS_REVIEW/MISSING은 애초에 자동 계산 대상이 아니므로 색인 대상에서
      // 제외한다 — 시맨틱 검색이 "그럴듯하게 매칭됐지만 실제로는 사람 확인이
      // 필요한" 레코드를 찾아내 봐야 resolveGovFee가 어차피 NEEDS_APPROVAL로
      // 되돌리므로, 색인 낭비일 뿐 아니라 오탐 표면적만 넓힌다.
      if (record.status === 'REAL') {
        indexableRecords.push({
          id,
          service_name: record.service_name,
          raw_fee_text: record.raw_fee_text,
          related_law: record.related_law,
          scope: record.scope,
          region_code: record.region_code,
          fee_type: record.fee_type,
        });
      }
    } catch (e) {
      failed++;
      console.error(`[FAIL] ${record.service_name} (${record.region_code ?? 'national'}):`, e?.message || e);
    }
  }

  console.log(`완료 — 생성 ${created} / 갱신 ${updated} / 실패 ${failed}`);

  if (args.embed) {
    const workerBaseUrl = args.workerUrl || process.env.HONDI_WORKER_URL;
    if (!workerBaseUrl) {
      console.error('[EMBED] --worker-url 또는 HONDI_WORKER_URL 환경변수가 필요합니다 (예: https://hondi-proxy.example.workers.dev).');
      console.error('[EMBED] 색인을 건너뜁니다 — PocketBase 반영은 이미 완료됐으니 나중에 이 스크립트를 --embed로 다시 실행해도 됩니다(멱등).');
      return;
    }
    console.log(`[EMBED] REAL 레코드 ${indexableRecords.length}건 색인 시작 → ${workerBaseUrl}`);
    const indexed = await embedIndexAll(workerBaseUrl, indexableRecords);
    console.log(`[EMBED] 완료 — ${indexed}/${indexableRecords.length}건 색인됨`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
