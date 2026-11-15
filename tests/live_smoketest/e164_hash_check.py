"""e164_hash 일치 점검(2026-11-16). 비밀값·해시·번호는 출력하지 않고 일치 여부(참/거짓)와 개수만 출력한다.
PHONE_VERIFY_SECRET(Worker 와 같은 값이어야 함)로 계산한 해시가 PocketBase profiles.e164_hash 와 같은지 본다."""
import os, sys, hmac, hashlib, json, requests
L1 = os.environ.get('L1_BASE', 'https://l1-hanlim.hondi.net')
SECRET = os.environ['PHONE_VERIFY_SECRET']
handle = sys.argv[1] if len(sys.argv) > 1 else '@98807170'
def h(e164): return hmac.new(SECRET.encode(), ('e164-lookup:' + e164).encode(), hashlib.sha256).hexdigest()
r = requests.post(f'{L1}/api/admins/auth-with-password', json={'identity': os.environ['PB_ADMIN_EMAIL'], 'password': os.environ['PB_ADMIN_PASSWORD']}, timeout=20)
print('admin_auth_status', r.status_code); r.raise_for_status()
H = {'Authorization': 'Bearer ' + r.json()['token']}
def recs(flt, n=1, extra=''):
    q = requests.get(f'{L1}/api/collections/profiles/records', params={'filter': flt, 'perPage': n, 'sort': '-created'}, headers=H, timeout=20)
    q.raise_for_status(); return q.json().get('items', [])
items = recs(f"handle='{handle}'", 5)
print('profiles_with_handle', len(items))
for p in items:
    last8 = p.get('e164_last8') or ''
    print('--- profile: has_e164_hash', bool(p.get('e164_hash')), '| has_e164_last8', bool(last8), '| has_e164_plain', bool(p.get('e164')), '| country', p.get('country_code'),
          '| phone_findable', p.get('phone_findable'), '| name_findable', p.get('name_findable'), '| claim_status', p.get('claim_status'), '| migrated', bool((p.get('extra') or {}).get('migrated_to')))
    if last8 and p.get('e164_hash'):
        variants = {'+8210'+last8: 'canonical(+8210xxxxxxxx)', '+82010'+last8: 'with_0(+82010…)', '8210'+last8: 'no_plus', '010'+last8: 'domestic(010…)'}
        hit = [name for e, name in variants.items() if h(e) == p['e164_hash']]
        print('hash_matches_variant:', hit or 'NONE')
# 전체 경향: 최근 가입 200건 중 canonical 로 일치하는 비율
rows = recs("e164_hash!='' && e164_last8!='' && country_code='KR'", 200)
ok = sum(1 for p in rows if h('+8210' + p['e164_last8']) == p['e164_hash'])
print('recent_KR_profiles_checked', len(rows), 'canonical_hash_match', ok, 'mismatch', len(rows) - ok)

# 원인 추적: 접두어·번호 모양·비밀값 가장자리 공백 조합을 모두 시험한다(어느 조합이 맞는지만 출력).
def hm(key, msg): return hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()
keys = {'secret': SECRET, 'secret_stripped': SECRET.strip(), 'secret+newline': SECRET + '\n', 'secret+space': SECRET + ' '}
print('secret_len', len(SECRET), 'has_edge_whitespace', SECRET != SECRET.strip())
prefixes = ['e164-lookup:', '', 'e164:', 'phone:']
for p in items:
    last8 = p.get('e164_last8') or ''
    if not (last8 and p.get('e164_hash')): continue
    forms = ['+8210'+last8, '+82010'+last8, '8210'+last8, '010'+last8, '+82 10 '+last8[:4]+' '+last8[4:], '+82-10-'+last8[:4]+'-'+last8[4:]]
    found = []
    for kn, k in keys.items():
        for pre in prefixes:
            for i, f in enumerate(forms):
                if hm(k, pre+f) == p['e164_hash']: found.append((kn, pre, 'form%d' % i))
                if hashlib.sha256((pre+f).encode()).hexdigest() == p['e164_hash']: found.append(('plain-sha256', pre, 'form%d' % i))
    print('deep_match:', found or 'NONE')
