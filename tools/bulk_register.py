#!/usr/bin/env python3
"""
M14 — Bulk Register 모듈 (bulk_register.py)
저장 위치: gopang/src/profile2.0/bulk_register.py

사용법:
  python bulk_register.py --csv data/entities.csv [--workers 10] [--batch 100] [--dry-run]

CSV 필수 컬럼: phone, name, region (한글 읍면동)
CSV 선택 컬럼: entity_type(consumer/org/institution), address, lat, lng
"""

import asyncio
import csv
import hashlib
import json
import os
import sys
import uuid
import argparse
import logging
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional
import urllib.request
import urllib.error

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('bulk_register')

# ── 제주 읍면동 → 영문 매핑 ───────────────────────────────────────
REGION_MAP = {
    '한림읍': 'hallim', '애월읍': 'aewol', '구좌읍': 'gujwa', '성산읍': 'seongsan',
    '표선면': 'pyoseon', '남원읍': 'namwon', '안덕면': 'andeok', '대정읍': 'daejeong',
    '한경면': 'hangyeong', '추자면': 'chuja',
    '제주시': 'jeju', '서귀포시': 'seogwipo',
}

UUID_NAMESPACE = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')  # DNS namespace

# ── 한글 로마자 변환 (Revised Romanization 간이 구현) ─────────────
ROMANIZE_TABLE = {
    'ㄱ': 'g', 'ㄴ': 'n', 'ㄷ': 'd', 'ㄹ': 'l', 'ㅁ': 'm', 'ㅂ': 'b',
    'ㅅ': 's', 'ㅇ': '', 'ㅈ': 'j', 'ㅊ': 'ch', 'ㅋ': 'k', 'ㅌ': 't',
    'ㅍ': 'p', 'ㅎ': 'h', 'ㄲ': 'kk', 'ㄸ': 'tt', 'ㅃ': 'pp', 'ㅆ': 'ss',
    'ㅉ': 'jj',
    'ㅏ': 'a', 'ㅑ': 'ya', 'ㅓ': 'eo', 'ㅕ': 'yeo', 'ㅗ': 'o', 'ㅛ': 'yo',
    'ㅜ': 'u', 'ㅠ': 'yu', 'ㅡ': 'eu', 'ㅣ': 'i', 'ㅐ': 'ae', 'ㅒ': 'yae',
    'ㅔ': 'e', 'ㅖ': 'ye', 'ㅘ': 'wa', 'ㅙ': 'wae', 'ㅚ': 'oe', 'ㅝ': 'wo',
    'ㅞ': 'we', 'ㅟ': 'wi', 'ㅢ': 'ui',
}

FIRST = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
MIDDLE = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
LAST = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'

def hangul_to_roman(text: str) -> str:
    result = []
    for ch in text:
        code = ord(ch)
        if 0xAC00 <= code <= 0xD7A3:
            offset = code - 0xAC00
            first  = FIRST[offset // (21 * 28)]
            middle = MIDDLE[(offset % (21 * 28)) // 28]
            last   = LAST[offset % 28]
            r  = ROMANIZE_TABLE.get(first, first)
            r += ROMANIZE_TABLE.get(middle, middle)
            r += ROMANIZE_TABLE.get(last.strip(), last.strip())
            result.append(r)
        elif ch.isalnum():
            result.append(ch.lower())
    return ''.join(result)


def make_guid(phone: str) -> str:
    digits = ''.join(c for c in phone if c.isdigit())
    return str(uuid.uuid5(UUID_NAMESPACE, digits))


def make_handle(region: str, name: str) -> str:
    region_en = REGION_MAP.get(region, hangul_to_roman(region))
    name_en   = hangul_to_roman(name)[:10]
    return f'@{region_en}_{name_en}'


@dataclass
class RegisterResult:
    total:    int = 0
    inserted: int = 0
    updated:  int = 0
    skipped:  int = 0
    errors:   list = field(default_factory=list)


# ── Supabase upsert (단건, sync wrapper) ──────────────────────────
def supabase_upsert(url: str, service_key: str, row: dict) -> dict:
    payload = json.dumps(row).encode()
    req = urllib.request.Request(
        f'{url}/rest/v1/user_profiles',
        data=payload,
        headers={
            'Content-Type': 'application/json',
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return {'status': resp.status, 'ok': True}
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {'status': e.code, 'ok': False, 'error': body}


# ── handle UNIQUE 충돌 처리 ────────────────────────────────────────
def resolve_handle(url: str, service_key: str, base_handle: str) -> str:
    for i in range(1, 10000):
        candidate = f'{base_handle}_{i:04d}'
        check_url = f'{url}/rest/v1/user_profiles?handle=eq.{urllib.parse.quote(candidate)}&select=handle'
        req = urllib.request.Request(check_url, headers={
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
        })
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                rows = json.loads(resp.read())
                if len(rows) == 0:
                    return candidate
        except Exception:
            return candidate
    return base_handle


import urllib.parse


# ── 배치 처리 ─────────────────────────────────────────────────────
async def process_batch(rows: list, supabase_url: str, service_key: str,
                        result: RegisterResult, dry_run: bool):
    loop = asyncio.get_event_loop()
    for row in rows:
        phone = row.get('phone', '').strip()
        name  = row.get('name', '').strip()

        if not phone or not name:
            result.skipped += 1
            log.warning(f'빈 phone/name 스킵: {row}')
            continue

        guid       = make_guid(phone)
        base_handle = make_handle(row.get('region', '제주시'), name)

        profile = {
            'guid':        guid,
            'name':        name,
            'handle':      base_handle,
            'entity_type': row.get('entity_type', 'consumer'),
            'address':     row.get('address', ''),
            'lat':         float(row['lat']) if row.get('lat') else None,
            'lng':         float(row['lng']) if row.get('lng') else None,
            'extra':       {},
        }

        if dry_run:
            log.info(f'[DRY-RUN] {guid} {name} → {base_handle}')
            result.inserted += 1
            continue

        resp = await loop.run_in_executor(None, supabase_upsert, supabase_url, service_key, profile)
        if resp['ok']:
            result.inserted += 1
        else:
            # handle 충돌(23505) 시 suffix 재시도
            if '23505' in resp.get('error', ''):
                new_handle = await loop.run_in_executor(None, resolve_handle, supabase_url, service_key, base_handle)
                profile['handle'] = new_handle
                resp2 = await loop.run_in_executor(None, supabase_upsert, supabase_url, service_key, profile)
                if resp2['ok']:
                    result.inserted += 1
                else:
                    result.errors.append({'guid': guid, 'error': resp2.get('error')})
            else:
                result.errors.append({'guid': guid, 'error': resp.get('error')})

        result.total += 1


async def bulk_register(csv_path: str, supabase_url: str, service_key: str,
                        batch_size: int = 100, workers: int = 10, dry_run: bool = False) -> RegisterResult:
    result = RegisterResult()

    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        reader = list(csv.DictReader(f))

    result.total = len(reader)
    log.info(f'총 {result.total}건 로드. batch={batch_size}, workers={workers}')

    batches = [reader[i:i+batch_size] for i in range(0, len(reader), batch_size)]

    sem = asyncio.Semaphore(workers)
    async def run_batch(batch):
        async with sem:
            await process_batch(batch, supabase_url, service_key, result, dry_run)

    await asyncio.gather(*[run_batch(b) for b in batches])
    return result


def main():
    parser = argparse.ArgumentParser(description='나비 대량 등록')
    parser.add_argument('--csv', required=True)
    parser.add_argument('--workers', type=int, default=10)
    parser.add_argument('--batch',   type=int, default=100)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    supabase_url = os.environ.get('SUPABASE_URL')
    service_key  = os.environ.get('SUPABASE_SERVICE_KEY')
    if not supabase_url or not service_key:
        log.error('SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수 필수')
        sys.exit(1)

    result = asyncio.run(bulk_register(
        args.csv, supabase_url, service_key,
        batch_size=args.batch, workers=args.workers, dry_run=args.dry_run,
    ))

    log.info(f'완료 — total={result.total} inserted={result.inserted} skipped={result.skipped} errors={len(result.errors)}')
    if result.errors:
        log.warning(f'오류 {len(result.errors)}건: {result.errors[:5]}')


if __name__ == '__main__':
    main()
