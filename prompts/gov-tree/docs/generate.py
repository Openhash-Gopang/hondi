# -*- coding: utf-8 -*-
import json, sys
sys.path.insert(0, '/home/claude/gen')
from departments import DEPARTMENTS

CIVIL_TEMPLATES = [
    "{duty} 관련해서 어떻게 신청하는지 문의드립니다.",
    "{duty}에 해당하는지 저희 집(사업장) 상황으로 확인 부탁드립니다.",
    "{duty} 처리 기간이 얼마나 걸리는지, 어디로 서류를 제출해야 하는지 알고 싶습니다.",
    "{duty} 관련 안내를 받았는데 내용이 이해가 안 돼서 다시 설명 부탁드립니다.",
    "{duty}와 관련해 이의가 있어 재검토를 요청합니다.",
]

DIRECTIVE_TEMPLATES = [
    "[{superior} 지시] {duty} 관련 이번 분기 추진 실적을 익일까지 보고할 것.",
    "[도의회 행정사무감사 대응] {duty} 관련 자료 일체를 정리하여 제출할 것.",
    "[{superior} 지시] {duty} 관련 최근 감사 지적사항에 대한 시정조치 계획을 수립할 것.",
    "[예산 집행점검] {duty} 관련 예산 집행 현황을 기획조정실에 보고할 것.",
    "[정책 연계 협조 요청] {duty} 관련 타 실·국과의 협업 방안을 마련해 회신할 것.",
]

records = []
rid = 1
for d in DEPARTMENTS:
    duties = d["duties"]
    for i, tmpl in enumerate(CIVIL_TEMPLATES):
        duty = duties[i % len(duties)]
        text = tmpl.format(duty=duty)
        records.append(dict(
            id=rid, 실국=d["sil"], 과=d["name"], sp_code=d["sp"], 확인상태=d["level"],
            유형="민원", 내용=text
        ))
        rid += 1
    for i, tmpl in enumerate(DIRECTIVE_TEMPLATES):
        duty = duties[i % len(duties)]
        text = tmpl.format(duty=duty, superior=d["superior"])
        records.append(dict(
            id=rid, 실국=d["sil"], 과=d["name"], sp_code=d["sp"], 확인상태=d["level"],
            유형="내부지시", 내용=text
        ))
        rid += 1

print("총 부서:", len(DEPARTMENTS), "총 항목:", len(records))

with open('/home/claude/gen/requests_raw.json', 'w', encoding='utf-8') as f:
    json.dump(records, f, ensure_ascii=False, indent=1)


# ── 조사(와/과) 자동 교정 (2026-09-16 추가, 별도 fix_particle.py는
#    .gitignore의 fix*.py 규칙에 걸려 저장소에 못 들어가므로 이 파일에
#    합쳐서 재현 가능하게 유지) ──
def has_batchim(ch):
    if not ('가' <= ch <= '힣'):
        return False
    return (ord(ch) - ord('가')) % 28 != 0

def fix_wa_gwa(text):
    idx = text.find('와 관련해')
    if idx == -1:
        return text
    if has_batchim(text[idx-1]):
        return text[:idx] + '과 관련해' + text[idx+len('와 관련해'):]
    return text

if __name__ == '__main__':
    for r in records:
        r['내용'] = fix_wa_gwa(r['내용'])
    with open('/home/claude/gen/requests_fixed.json', 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=1)
