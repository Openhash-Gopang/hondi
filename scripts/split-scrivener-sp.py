#!/usr/bin/env python3
"""법무사·행정사 SP 를 일반인용(안내)과 전문가용(보조 AI)으로 나눈다 (2026-10-21, 주피터님 지시).

입력: 현재 SP_judicial-scrivener_v3_3.md, SP_administrative-scrivener_v1_3.md (겸용 — STEP C·STEP W·부록 A 포함)
출력:
  prompts/SP_<id>-assistant_v1_0.md  전문가용 — 입력 전체를 보존하고 제목·머리말만 바꾼다(서류 작성 기능은 그대로).
  prompts/SP_<id>_v<새버전>.md        일반인용 — STEP C(서류 작성)·STEP W(작성 트랙)·부록 A(문서 카탈로그)를 뺀 안내 SP.
사용: python3 scripts/split-scrivener-sp.py   (저장소 루트에서, 멱등)
"""
import importlib.util, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
spec = importlib.util.spec_from_file_location('genasp', os.path.join(ROOT, 'scripts/gen-assistant-sp.py'))
genasp = importlib.util.module_from_spec(spec); spec.loader.exec_module(genasp)

CFG = {
    'judicial-scrivener': dict(src='SP_judicial-scrivener_v3_3.md', pub='SP_judicial-scrivener_v4_0.md', pubv='v4.0', code='SP-LAW-02', prof='법무사',
                               name='법무사 보조 AI', pub_name='법무사 업무 안내 AI'),
    'administrative-scrivener': dict(src='SP_administrative-scrivener_v1_3.md', pub='SP_administrative-scrivener_v2_0.md', pubv='v2.0', code='SP-LAW-08', prof='행정사',
                                     name='행정사 보조 AI', pub_name='행정사 업무 안내 AI'),
}


def cut(text, start_pat, end_pat):
    """start_pat 줄부터 end_pat 줄 직전까지 삭제."""
    m1 = re.search(start_pat, text, re.M); m2 = re.search(end_pat, text, re.M)
    if not m1 or not m2 or m2.start() <= m1.start(): raise SystemExit('섹션 경계를 찾지 못함: %s / %s' % (start_pat, end_pat))
    return text[:m1.start()] + text[m2.start():], text[m1.start():m2.start()]


def assistant(pid, c, src):
    t = src
    t = re.sub(r'^# %s · %s v[\d.]+' % (c['code'], c['name']), '# %sA · %s v1.0' % (c['code'], c['name']), t, count=1, flags=re.M)
    note = ('\n> **v1.0 (2026-10-21, 주피터님 지시 — 전문가용 분리)**\n'
            '> %s SP 를 **일반인용(`SP_%s`, 안내·쟁점 정리)**과 **전문가용(이 SP, 서류 작성·전문 지식 상담)**으로 나눴다. 이 SP 는 겸용이던 `%s`의 내용을 **그대로 이어받는다**'
            '(§LEGAL-LIMIT, STEP C, STEP W 서류 작성 트랙, 부록 A 모두 무수정). 서버가 전문가 인증(면허 확인)을 마친 세션에만 이 SP 의 호출을 허용한다(pro-gate). '
            '일반인용 화면에서는 서류 작성 기능을 제공하지 않는다.\n') % (c['prof'], pid, c['src'])
    first_nl = t.index('\n')
    return t[:first_nl + 1] + note + t[first_nl + 1:]


def public(pid, c, src):
    t = src
    t, _ = cut(t, r'^## STEP C — 서류 작성 및 검증', r'^## STEP D ')
    t, _ = cut(t, r'^## STEP W — ', r'^## 부록 B ')
    # 서류 작성 안내 절 (STEP D 앞)
    pointer = ('## 서류 작성 — 전문가용 화면 안내 (v%s 신설)\n\n'
               '이 일반인용 SP 는 **서류를 작성하지 않는다.** 소장·신청서·등기 서류 등의 초안 작성, 서식 DB 조회·저장, 제출 준비는 면허 인증을 마친 %s 가 쓰는 '
               '**전문가용 화면(`SP_%s-assistant`)**에서만 제공한다. 이용자가 서류 작성을 요청하면 (1) 어떤 서류가 필요한지, 누가 작성·제출해야 하는지를 일반 정보로 설명하고 '
               '(2) %s 에게 직접 맡기는 것을 권고하되 소개·연결·알선은 하지 않는다(§LEGAL-LIMIT).\n\n') % (c['pubv'][1:], c['prof'], pid, c['prof'])
    t = t.replace('## STEP D ', pointer + '## STEP D ', 1)
    t = re.sub(r'^# %s · %s v[\d.]+' % (c['code'], c['name']), '# %s · %s %s' % (c['code'], c['pub_name'], c['pubv']), t, count=1, flags=re.M)
    t = t.replace(c['name'], c['pub_name'])
    note = ('\n> **%s (2026-10-21, 주피터님 지시 — 일반인용/전문가용 분리)**\n'
            '> 겸용이던 SP 에서 **서류 작성(STEP C)·서류 작성 트랙(STEP W)·문서 카탈로그(부록 A)를 전문가용 `SP_%s-assistant_v1_0`으로 옮겼다.** 이 SP 는 안내·쟁점 정리·'
            '절차 설명·%s 권고만 한다. §LEGAL-LIMIT·STEP 0~B+·R·D·부록 B 는 그대로다. L2·L3 분기 문구는 정리 예정이다.\n') % (c['pubv'], pid, c['prof'])
    first_nl = t.index('\n')
    t = t[:first_nl + 1] + note + t[first_nl + 1:]
    # 우선 규칙 — 아래에 남은 서술(L2·L3 분기, 서류 작성 언급)보다 앞선다.
    override = ('> **v%s 적용 규칙 (최우선)**: 이 SP 에서는 **인증 여부와 관계없이 누구에게도 서류 초안 작성·서식 DB 조회·저장·제출 준비 기능을 제공하지 않는다.** '
                '그 기능은 면허 인증을 마친 %s 전용 화면(`SP_%s-assistant`)에만 있다. 아래 본문에 서류 작성·부록 A·STEP C·STEP W 를 전제한 서술이 남아 있어도 이 규칙이 우선한다.\n') % (c['pubv'][1:], c['prof'], pid)
    nl = t.index('\n', t.index('> **%s (2026-10-21' % c['pubv']))
    nl = t.index('\n', nl + 1)       # 머리말 2줄째 끝
    t = t[:nl + 1] + override + t[nl + 1:]
    # 남은 부록 A·STEP C·작성 태그 참조 정리
    t = t.replace('**%s 업무 보조 AI 도구**' % c['prof'], '**%s 업무 안내·쟁점 정리 AI 도구**' % c['prof'])
    t = t.replace('STEP C·D, 전문가용 화면', 'STEP D, 전문가용 화면').replace('STEP 0-4, STEP C-1', 'STEP 0-4').replace('STEP C-1, 전문가용 화면', 'STEP 0, 전문가용 화면').replace('STEP C-2 날인란', 'STEP D')
    t = t.replace('(부록 A의 문서종류와 대응)', '').replace('(부록 A의 영역과 대응)', '').replace(', 부록 A의 어느 문서종류인지', '').replace(', 부록 A의 어느 서류인지', '')
    t = t.replace('이 절은 STEP C의 출력 완성 규칙과 ', '이 절은 ')
    t = t.replace('- **L3 (등록 행정사)**: 전 기능. 부록 A의 서류를 채워진 초안으로 작성한다.', '- **L3 (등록 행정사)**: 서류 작성은 전문가용 화면에서만 제공하며, 이 화면에서는 일반 안내를 한다.')
    t = re.sub(r'^서류를 쓰는 것이 목적이면 절차 설명으로 넘어가지 않는다\..*$', '서류 작성이 목적이면 이 화면에서는 작성하지 않고, 필요한 서류의 종류·작성 주체·제출처를 일반 정보로 안내한다(아래 "서류 작성 — 전문가용 화면 안내").', t, flags=re.M)
    t = re.sub(r'부록 A-\d+(?:~A?-?\d+)?(?:, ?A-\d+)*', '전문가용 화면', t)
    t = t.replace('부록 A 전체 문서를 채워진 초안으로 작성하고 실무 모듈(A-1 이하)을 사용한다', '서류 작성은 전문가용 화면에서만 제공하며, 이 화면에서는 일반 안내를 한다')
    t = t.replace('STEP C·D, ', 'STEP D, ').replace('STEP C-1, 전문가용 화면', 'STEP 0, 전문가용 화면')
    t = re.sub(r'`\[DOCUMENT_DRAFT: [^\]]*\]`(\([^)]*\))?', '', t)
    return t


def main():
    for pid, c in CFG.items():
        src = open(os.path.join(ROOT, 'prompts', c['src']), encoding='utf-8', newline='').read()
        outs = {
            'SP_%s-assistant_v1_0.md' % pid: assistant(pid, c, src),
            c['pub']: public(pid, c, src),
        }
        for fname, text in outs.items():
            p = os.path.join(ROOT, 'prompts', fname)
            old = open(p, encoding='utf-8', newline='').read() if os.path.exists(p) else None
            if old != text: open(p, 'w', encoding='utf-8', newline='').write(text)
            print('%s: %s (%d줄)%s' % (pid, fname, text.count('\n') + 1, '' if old != text else ' — 변경 없음'))
        genasp.register(pid, c['name'], 'SP_%s-assistant_v1_0.md' % pid)
        # 일반인용 SP 의 새 버전으로 카탈로그·분류·페르소나 색인의 경로를 갱신한다.
        for rel in ('prompts/sp-catalog.json', 'prompts/sp-catalog-categories.json', 'data/expert-persona-index.json'):
            fp = os.path.join(ROOT, rel)
            tx = open(fp, encoding='utf-8', newline='').read()
            nx = tx.replace(c['src'], c['pub'])
            if nx != tx: open(fp, 'w', encoding='utf-8', newline='').write(nx); print('  %s: %s → %s' % (rel, c['src'], c['pub']))


if __name__ == '__main__':
    main()
