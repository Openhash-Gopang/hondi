/** tests/signal-offer-push-waituntil.test.mjs — 호출(offer) 알림 발송이 응답 이후에도 끝까지 보장되는지, VAPID 없이도 FCM 기기에 발송되는지를 소스 수준에서 고정한다. 실행: node tests/signal-offer-push-waituntil.test.mjs */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } };

t('/signal/send 라우트가 ctx 를 넘긴다', () => assert.match(src, /pathname === '\/signal\/send'\)\s+return handleSignalSend\(request, env, corsHeaders, ctx\)/));
t('handleSignalSend 가 ctx 를 받는다', () => assert.match(src, /async function handleSignalSend\(request, env, corsHeaders, ctx\)/));
const fn = src.slice(src.indexOf('async function handleSignalSend('), src.indexOf('async function handleSignalPoll('));
t('offer 알림 발송을 ctx.waitUntil 로 끝까지 보장한다', () => assert.match(fn, /ctx\.waitUntil\(_pushFull\)/));
t('응답은 푸시를 최대 4초만 기다린다', () => assert.match(fn, /Promise\.race\(\[_pushFull, new Promise\(r => setTimeout\(r, 4000\)\)\]\)/));
const push = src.slice(src.indexOf('async function _sendPushToGuid('), src.indexOf('async function _sendPushToGuid(') + 2500);
t('VAPID 가 없어도 FCM 서비스 계정이 있으면 막지 않는다', () => assert.match(push, /!_hasVapid && !env\.FCM_SERVICE_ACCOUNT_JSON\) return 'config'/));
t('VAPID 가 없으면 FCM 기기에만 발송한다', () => assert.match(push, /_hasVapid \? _allDevices : _allDevices\.filter\(d => _isFcmSub\(d\.subscription\)\)/));
console.log(`${pass}/6`);
