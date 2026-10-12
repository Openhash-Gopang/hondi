import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { _parseInstanceEnrichTag } from '../worker.js';

// 2026-07-24 신설 — LAZY-INSTANCE-ENRICHMENT-DESIGN_v1.0.md §3-1 구현
// (주피터 지시로 승인·구현: "나비는 안내가 아니라 실행이 주된 목표").
describe('_parseInstanceEnrichTag', () => {
  test('필수 필드 7개가 모두 있으면 정상 파싱된다', () => {
    const raw = 'layer=city, province=busan, instance_id=haeundae, ' +
      'field=상하수도_capability_문구, value=안내만 수행 (부산시 상수도사업본부 소관 확인됨), ' +
      'source=user_reported, confidence=low, note=사용자가 민원 접수 중 직접 확인해줌';
    const fields = _parseInstanceEnrichTag(raw);
    assert.ok(fields);
    assert.equal(fields.layer, 'city');
    assert.equal(fields.province, 'busan');
    assert.equal(fields.instance_id, 'haeundae');
    assert.equal(fields.field, '상하수도_capability_문구');
    assert.equal(fields.source, 'user_reported');
    assert.equal(fields.confidence, 'low');
    assert.equal(fields.note, '사용자가 민원 접수 중 직접 확인해줌');
  });

  test('필수 필드 하나라도 빠지면 null을 반환한다(예: confidence 누락)', () => {
    const raw = 'layer=national, province=busan, instance_id=police, ' +
      'field=콜센터번호, value=051-xxx-xxxx, source=web_search';
    assert.equal(_parseInstanceEnrichTag(raw), null);
  });

  test('layer 값이 화이트리스트 밖이면 null을 반환한다', () => {
    const raw = 'layer=invalid_layer, province=busan, instance_id=x, ' +
      'field=y, value=z, source=inference, confidence=medium';
    assert.equal(_parseInstanceEnrichTag(raw), null);
  });

  test('source 값이 화이트리스트 밖이면 null을 반환한다', () => {
    const raw = 'layer=do, province=jeju, instance_id=plan, ' +
      'field=콜센터번호, value=064-120, source=llm_guess, confidence=high';
    assert.equal(_parseInstanceEnrichTag(raw), null);
  });

  test('confidence 값이 화이트리스트 밖이면 null을 반환한다', () => {
    const raw = 'layer=citydept, province=gyeonggi, instance_id=suwon/jachi, ' +
      'field=국이름, value=자치행정국, source=web_search, confidence=certain';
    assert.equal(_parseInstanceEnrichTag(raw), null);
  });

  test('note는 선택 필드다 — 없어도 나머지 필수 필드만 있으면 통과한다', () => {
    const raw = 'layer=emd, province=jeju, instance_id=noheong, ' +
      'field=콜센터번호, value=064-120, source=web_search, confidence=high';
    const fields = _parseInstanceEnrichTag(raw);
    assert.ok(fields);
    assert.equal(fields.note, undefined);
  });
});
