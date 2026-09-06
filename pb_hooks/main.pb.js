/// <reference path="../pb_data/types.d.ts" />

const NODE_ID = "KR-JEJU-JEJU-HANLIM";


// ── 서명 암호학적 검증 공유 유틸 (2026-07-19, 모듈 최상단으로 승격) ──────
// TweetNaCl Ed25519 포트 — 원래 /api/tx 콜백 내부 지역변수였던 것을
// 여러 훅(onRecordBeforeUpdateRequest 등)에서 재사용할 수 있도록 여기로
// 옮겼다. IIFE로 감싸 짧은 이름(D, X, Y, I, K 등)의 전역 오염을 막는다.
var _sigVerify = (function() {
var nacl = {};
'use strict';

// Ported in 2014 by Dmitry Chestnykh and Devi Mandiri.
// Public domain.
//
// Implementation derived from TweetNaCl version 20140427.
// See for details: http://tweetnacl.cr.yp.to/

var u64 = function(h, l) { this.hi = h|0 >>> 0; this.lo = l|0 >>> 0; };
var gf = function(init) {
  var i, r = new Float64Array(16);
  if (init) for (i = 0; i < init.length; i++) r[i] = init[i];
  return r;
};

//  Pluggable, initialized in high-level API below.
var randombytes = function(/* x, n */) { throw new Error('no PRNG'); };

var _0 = new Uint8Array(16);
var _9 = new Uint8Array(32); _9[0] = 9;

var gf0 = gf(),
    gf1 = gf([1]),
    _121665 = gf([0xdb41, 1]),
    D = gf([0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070, 0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203]),
    D2 = gf([0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0, 0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406]),
    X = gf([0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c, 0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169]),
    Y = gf([0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666]),
    I = gf([0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43, 0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83]);

function L32(x, c) { return (x << c) | (x >>> (32 - c)); }

function ld32(x, i) {
  var u = x[i+3] & 0xff;
  u = (u<<8)|(x[i+2] & 0xff);
  u = (u<<8)|(x[i+1] & 0xff);
  return (u<<8)|(x[i+0] & 0xff);
}

function dl64(x, i) {
  var h = (x[i] << 24) | (x[i+1] << 16) | (x[i+2] << 8) | x[i+3];
  var l = (x[i+4] << 24) | (x[i+5] << 16) | (x[i+6] << 8) | x[i+7];
  return new u64(h, l);
}

function st32(x, j, u) {
  var i;
  for (i = 0; i < 4; i++) { x[j+i] = u & 255; u >>>= 8; }
}

function ts64(x, i, u) {
  x[i]   = (u.hi >> 24) & 0xff;
  x[i+1] = (u.hi >> 16) & 0xff;
  x[i+2] = (u.hi >>  8) & 0xff;
  x[i+3] = u.hi & 0xff;
  x[i+4] = (u.lo >> 24)  & 0xff;
  x[i+5] = (u.lo >> 16)  & 0xff;
  x[i+6] = (u.lo >>  8)  & 0xff;
  x[i+7] = u.lo & 0xff;
}

function vn(x, xi, y, yi, n) {
  var i,d = 0;
  for (i = 0; i < n; i++) d |= x[xi+i]^y[yi+i];
  return (1 & ((d - 1) >>> 8)) - 1;
}

function crypto_verify_16(x, xi, y, yi) {
  return vn(x,xi,y,yi,16);
}

function crypto_verify_32(x, xi, y, yi) {
  return vn(x,xi,y,yi,32);
}

function core(out,inp,k,c,h) {
  var w = new Uint32Array(16), x = new Uint32Array(16),
      y = new Uint32Array(16), t = new Uint32Array(4);
  var i, j, m;

  for (i = 0; i < 4; i++) {
    x[5*i] = ld32(c, 4*i);
    x[1+i] = ld32(k, 4*i);
    x[6+i] = ld32(inp, 4*i);
    x[11+i] = ld32(k, 16+4*i);
  }

  for (i = 0; i < 16; i++) y[i] = x[i];

  for (i = 0; i < 20; i++) {
    for (j = 0; j < 4; j++) {
      for (m = 0; m < 4; m++) t[m] = x[(5*j+4*m)%16];
      t[1] ^= L32((t[0]+t[3])|0, 7);
      t[2] ^= L32((t[1]+t[0])|0, 9);
      t[3] ^= L32((t[2]+t[1])|0,13);
      t[0] ^= L32((t[3]+t[2])|0,18);
      for (m = 0; m < 4; m++) w[4*j+(j+m)%4] = t[m];
    }
    for (m = 0; m < 16; m++) x[m] = w[m];
  }

  if (h) {
    for (i = 0; i < 16; i++) x[i] = (x[i] + y[i]) | 0;
    for (i = 0; i < 4; i++) {
      x[5*i] = (x[5*i] - ld32(c, 4*i)) | 0;
      x[6+i] = (x[6+i] - ld32(inp, 4*i)) | 0;
    }
    for (i = 0; i < 4; i++) {
      st32(out,4*i,x[5*i]);
      st32(out,16+4*i,x[6+i]);
    }
  } else {
    for (i = 0; i < 16; i++) st32(out, 4 * i, (x[i] + y[i]) | 0);
  }
}

function crypto_core_salsa20(out,inp,k,c) {
  core(out,inp,k,c,false);
  return 0;
}

function crypto_core_hsalsa20(out,inp,k,c) {
  core(out,inp,k,c,true);
  return 0;
}

var sigma = new Uint8Array([101, 120, 112, 97, 110, 100, 32, 51, 50, 45, 98, 121, 116, 101, 32, 107]);
            // "expand 32-byte k"

function crypto_stream_salsa20_xor(c,cpos,m,mpos,b,n,k) {
  var z = new Uint8Array(16), x = new Uint8Array(64);
  var u, i;
  if (!b) return 0;
  for (i = 0; i < 16; i++) z[i] = 0;
  for (i = 0; i < 8; i++) z[i] = n[i];
  while (b >= 64) {
    crypto_core_salsa20(x,z,k,sigma);
    for (i = 0; i < 64; i++) c[cpos+i] = (m?m[mpos+i]:0) ^ x[i];
    u = 1;
    for (i = 8; i < 16; i++) {
      u = u + (z[i] & 0xff) | 0;
      z[i] = u & 0xff;
      u >>>= 8;
    }
    b -= 64;
    cpos += 64;
    if (m) mpos += 64;
  }
  if (b > 0) {
    crypto_core_salsa20(x,z,k,sigma);
    for (i = 0; i < b; i++) c[cpos+i] = (m?m[mpos+i]:0) ^ x[i];
  }
  return 0;
}

function crypto_stream_salsa20(c,cpos,d,n,k) {
  return crypto_stream_salsa20_xor(c,cpos,null,0,d,n,k);
}

function crypto_stream(c,cpos,d,n,k) {
  var s = new Uint8Array(32);
  crypto_core_hsalsa20(s,n,k,sigma);
  return crypto_stream_salsa20(c,cpos,d,n.subarray(16),s);
}

function crypto_stream_xor(c,cpos,m,mpos,d,n,k) {
  var s = new Uint8Array(32);
  crypto_core_hsalsa20(s,n,k,sigma);
  return crypto_stream_salsa20_xor(c,cpos,m,mpos,d,n.subarray(16),s);
}

function add1305(h, c) {
  var j, u = 0;
  for (j = 0; j < 17; j++) {
    u = (u + ((h[j] + c[j]) | 0)) | 0;
    h[j] = u & 255;
    u >>>= 8;
  }
}

var minusp = new Uint32Array([
  5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 252
]);

function crypto_onetimeauth(out, outpos, m, mpos, n, k) {
  var s, i, j, u;
  var x = new Uint32Array(17), r = new Uint32Array(17),
      h = new Uint32Array(17), c = new Uint32Array(17),
      g = new Uint32Array(17);
  for (j = 0; j < 17; j++) r[j]=h[j]=0;
  for (j = 0; j < 16; j++) r[j]=k[j];
  r[3]&=15;
  r[4]&=252;
  r[7]&=15;
  r[8]&=252;
  r[11]&=15;
  r[12]&=252;
  r[15]&=15;

  while (n > 0) {
    for (j = 0; j < 17; j++) c[j] = 0;
    for (j = 0; (j < 16) && (j < n); ++j) c[j] = m[mpos+j];
    c[j] = 1;
    mpos += j; n -= j;
    add1305(h,c);
    for (i = 0; i < 17; i++) {
      x[i] = 0;
      for (j = 0; j < 17; j++) x[i] = (x[i] + (h[j] * ((j <= i) ? r[i - j] : ((320 * r[i + 17 - j])|0))) | 0) | 0;
    }
    for (i = 0; i < 17; i++) h[i] = x[i];
    u = 0;
    for (j = 0; j < 16; j++) {
      u = (u + h[j]) | 0;
      h[j] = u & 255;
      u >>>= 8;
    }
    u = (u + h[16]) | 0; h[16] = u & 3;
    u = (5 * (u >>> 2)) | 0;
    for (j = 0; j < 16; j++) {
      u = (u + h[j]) | 0;
      h[j] = u & 255;
      u >>>= 8;
    }
    u = (u + h[16]) | 0; h[16] = u;
  }

  for (j = 0; j < 17; j++) g[j] = h[j];
  add1305(h,minusp);
  s = (-(h[16] >>> 7) | 0);
  for (j = 0; j < 17; j++) h[j] ^= s & (g[j] ^ h[j]);

  for (j = 0; j < 16; j++) c[j] = k[j + 16];
  c[16] = 0;
  add1305(h,c);
  for (j = 0; j < 16; j++) out[outpos+j] = h[j];
  return 0;
}

function crypto_onetimeauth_verify(h, hpos, m, mpos, n, k) {
  var x = new Uint8Array(16);
  crypto_onetimeauth(x,0,m,mpos,n,k);
  return crypto_verify_16(h,hpos,x,0);
}

function crypto_secretbox(c,m,d,n,k) {
  var i;
  if (d < 32) return -1;
  crypto_stream_xor(c,0,m,0,d,n,k);
  crypto_onetimeauth(c, 16, c, 32, d - 32, c);
  for (i = 0; i < 16; i++) c[i] = 0;
  return 0;
}

function crypto_secretbox_open(m,c,d,n,k) {
  var i;
  var x = new Uint8Array(32);
  if (d < 32) return -1;
  crypto_stream(x,0,32,n,k);
  if (crypto_onetimeauth_verify(c, 16,c, 32,d - 32,x) !== 0) return -1;
  crypto_stream_xor(m,0,c,0,d,n,k);
  for (i = 0; i < 32; i++) m[i] = 0;
  return 0;
}

function set25519(r, a) {
  var i;
  for (i = 0; i < 16; i++) r[i] = a[i]|0;
}

function car25519(o) {
  var c;
  var i;
  for (i = 0; i < 16; i++) {
      o[i] += 65536;
      c = Math.floor(o[i] / 65536);
      o[(i+1)*(i<15?1:0)] += c - 1 + 37 * (c-1) * (i===15?1:0);
      o[i] -= (c * 65536);
  }
}

function sel25519(p, q, b) {
  var t, c = ~(b-1);
  for (var i = 0; i < 16; i++) {
    t = c & (p[i] ^ q[i]);
    p[i] ^= t;
    q[i] ^= t;
  }
}

function pack25519(o, n) {
  var i, j, b;
  var m = gf(), t = gf();
  for (i = 0; i < 16; i++) t[i] = n[i];
  car25519(t);
  car25519(t);
  car25519(t);
  for (j = 0; j < 2; j++) {
    m[0] = t[0] - 0xffed;
    for (i = 1; i < 15; i++) {
      m[i] = t[i] - 0xffff - ((m[i-1]>>16) & 1);
      m[i-1] &= 0xffff;
    }
    m[15] = t[15] - 0x7fff - ((m[14]>>16) & 1);
    b = (m[15]>>16) & 1;
    m[14] &= 0xffff;
    sel25519(t, m, 1-b);
  }
  for (i = 0; i < 16; i++) {
    o[2*i] = t[i] & 0xff;
    o[2*i+1] = t[i]>>8;
  }
}

function neq25519(a, b) {
  var c = new Uint8Array(32), d = new Uint8Array(32);
  pack25519(c, a);
  pack25519(d, b);
  return crypto_verify_32(c, 0, d, 0);
}

function par25519(a) {
  var d = new Uint8Array(32);
  pack25519(d, a);
  return d[0] & 1;
}

function unpack25519(o, n) {
  var i;
  for (i = 0; i < 16; i++) o[i] = n[2*i] + (n[2*i+1] << 8);
  o[15] &= 0x7fff;
}

function A(o, a, b) {
  var i;
  for (i = 0; i < 16; i++) o[i] = (a[i] + b[i])|0;
}

function Z(o, a, b) {
  var i;
  for (i = 0; i < 16; i++) o[i] = (a[i] - b[i])|0;
}

function M(o, a, b) {
  var i, j, t = new Float64Array(31);
  for (i = 0; i < 31; i++) t[i] = 0;
  for (i = 0; i < 16; i++) {
    for (j = 0; j < 16; j++) {
      t[i+j] += a[i] * b[j];
    }
  }
  for (i = 0; i < 15; i++) {
    t[i] += 38 * t[i+16];
  }
  for (i = 0; i < 16; i++) o[i] = t[i];
  car25519(o);
  car25519(o);
}

function S(o, a) {
  M(o, a, a);
}

function inv25519(o, i) {
  var c = gf();
  var a;
  for (a = 0; a < 16; a++) c[a] = i[a];
  for (a = 253; a >= 0; a--) {
    S(c, c);
    if(a !== 2 && a !== 4) M(c, c, i);
  }
  for (a = 0; a < 16; a++) o[a] = c[a];
}

function pow2523(o, i) {
  var c = gf();
  var a;
  for (a = 0; a < 16; a++) c[a] = i[a];
  for (a = 250; a >= 0; a--) {
      S(c, c);
      if(a !== 1) M(c, c, i);
  }
  for (a = 0; a < 16; a++) o[a] = c[a];
}

function crypto_scalarmult(q, n, p) {
  var z = new Uint8Array(32);
  var x = new Float64Array(80), r, i;
  var a = gf(), b = gf(), c = gf(),
      d = gf(), e = gf(), f = gf();
  for (i = 0; i < 31; i++) z[i] = n[i];
  z[31]=(n[31]&127)|64;
  z[0]&=248;
  unpack25519(x,p);
  for (i = 0; i < 16; i++) {
    b[i]=x[i];
    d[i]=a[i]=c[i]=0;
  }
  a[0]=d[0]=1;
  for (i=254; i>=0; --i) {
    r=(z[i>>>3]>>>(i&7))&1;
    sel25519(a,b,r);
    sel25519(c,d,r);
    A(e,a,c);
    Z(a,a,c);
    A(c,b,d);
    Z(b,b,d);
    S(d,e);
    S(f,a);
    M(a,c,a);
    M(c,b,e);
    A(e,a,c);
    Z(a,a,c);
    S(b,a);
    Z(c,d,f);
    M(a,c,_121665);
    A(a,a,d);
    M(c,c,a);
    M(a,d,f);
    M(d,b,x);
    S(b,e);
    sel25519(a,b,r);
    sel25519(c,d,r);
  }
  for (i = 0; i < 16; i++) {
    x[i+16]=a[i];
    x[i+32]=c[i];
    x[i+48]=b[i];
    x[i+64]=d[i];
  }
  var x32 = x.subarray(32);
  var x16 = x.subarray(16);
  inv25519(x32,x32);
  M(x16,x16,x32);
  pack25519(q,x16);
  return 0;
}

function crypto_scalarmult_base(q, n) {
  return crypto_scalarmult(q, n, _9);
}

function crypto_box_keypair(y, x) {
  randombytes(x, 32);
  return crypto_scalarmult_base(y, x);
}

function crypto_box_beforenm(k, y, x) {
  var s = new Uint8Array(32);
  crypto_scalarmult(s, x, y);
  return crypto_core_hsalsa20(k, _0, s, sigma);
}

var crypto_box_afternm = crypto_secretbox;
var crypto_box_open_afternm = crypto_secretbox_open;

function crypto_box(c, m, d, n, y, x) {
  var k = new Uint8Array(32);
  crypto_box_beforenm(k, y, x);
  return crypto_box_afternm(c, m, d, n, k);
}

function crypto_box_open(m, c, d, n, y, x) {
  var k = new Uint8Array(32);
  crypto_box_beforenm(k, y, x);
  return crypto_box_open_afternm(m, c, d, n, k);
}

function add64() {
  var a = 0, b = 0, c = 0, d = 0, m16 = 65535, l, h, i;
  for (i = 0; i < arguments.length; i++) {
    l = arguments[i].lo;
    h = arguments[i].hi;
    a += (l & m16); b += (l >>> 16);
    c += (h & m16); d += (h >>> 16);
  }

  b += (a >>> 16);
  c += (b >>> 16);
  d += (c >>> 16);

  return new u64((c & m16) | (d << 16), (a & m16) | (b << 16));
}

function shr64(x, c) {
  return new u64((x.hi >>> c), (x.lo >>> c) | (x.hi << (32 - c)));
}

function xor64() {
  var l = 0, h = 0, i;
  for (i = 0; i < arguments.length; i++) {
    l ^= arguments[i].lo;
    h ^= arguments[i].hi;
  }
  return new u64(h, l);
}

function R(x, c) {
  var h, l, c1 = 32 - c;
  if (c < 32) {
    h = (x.hi >>> c) | (x.lo << c1);
    l = (x.lo >>> c) | (x.hi << c1);
  } else if (c < 64) {
    h = (x.lo >>> c) | (x.hi << c1);
    l = (x.hi >>> c) | (x.lo << c1);
  }
  return new u64(h, l);
}

function Ch(x, y, z) {
  var h = (x.hi & y.hi) ^ (~x.hi & z.hi),
      l = (x.lo & y.lo) ^ (~x.lo & z.lo);
  return new u64(h, l);
}

function Maj(x, y, z) {
  var h = (x.hi & y.hi) ^ (x.hi & z.hi) ^ (y.hi & z.hi),
      l = (x.lo & y.lo) ^ (x.lo & z.lo) ^ (y.lo & z.lo);
  return new u64(h, l);
}

function Sigma0(x) { return xor64(R(x,28), R(x,34), R(x,39)); }
function Sigma1(x) { return xor64(R(x,14), R(x,18), R(x,41)); }
function sigma0(x) { return xor64(R(x, 1), R(x, 8), shr64(x,7)); }
function sigma1(x) { return xor64(R(x,19), R(x,61), shr64(x,6)); }

var K = [
  new u64(0x428a2f98, 0xd728ae22), new u64(0x71374491, 0x23ef65cd),
  new u64(0xb5c0fbcf, 0xec4d3b2f), new u64(0xe9b5dba5, 0x8189dbbc),
  new u64(0x3956c25b, 0xf348b538), new u64(0x59f111f1, 0xb605d019),
  new u64(0x923f82a4, 0xaf194f9b), new u64(0xab1c5ed5, 0xda6d8118),
  new u64(0xd807aa98, 0xa3030242), new u64(0x12835b01, 0x45706fbe),
  new u64(0x243185be, 0x4ee4b28c), new u64(0x550c7dc3, 0xd5ffb4e2),
  new u64(0x72be5d74, 0xf27b896f), new u64(0x80deb1fe, 0x3b1696b1),
  new u64(0x9bdc06a7, 0x25c71235), new u64(0xc19bf174, 0xcf692694),
  new u64(0xe49b69c1, 0x9ef14ad2), new u64(0xefbe4786, 0x384f25e3),
  new u64(0x0fc19dc6, 0x8b8cd5b5), new u64(0x240ca1cc, 0x77ac9c65),
  new u64(0x2de92c6f, 0x592b0275), new u64(0x4a7484aa, 0x6ea6e483),
  new u64(0x5cb0a9dc, 0xbd41fbd4), new u64(0x76f988da, 0x831153b5),
  new u64(0x983e5152, 0xee66dfab), new u64(0xa831c66d, 0x2db43210),
  new u64(0xb00327c8, 0x98fb213f), new u64(0xbf597fc7, 0xbeef0ee4),
  new u64(0xc6e00bf3, 0x3da88fc2), new u64(0xd5a79147, 0x930aa725),
  new u64(0x06ca6351, 0xe003826f), new u64(0x14292967, 0x0a0e6e70),
  new u64(0x27b70a85, 0x46d22ffc), new u64(0x2e1b2138, 0x5c26c926),
  new u64(0x4d2c6dfc, 0x5ac42aed), new u64(0x53380d13, 0x9d95b3df),
  new u64(0x650a7354, 0x8baf63de), new u64(0x766a0abb, 0x3c77b2a8),
  new u64(0x81c2c92e, 0x47edaee6), new u64(0x92722c85, 0x1482353b),
  new u64(0xa2bfe8a1, 0x4cf10364), new u64(0xa81a664b, 0xbc423001),
  new u64(0xc24b8b70, 0xd0f89791), new u64(0xc76c51a3, 0x0654be30),
  new u64(0xd192e819, 0xd6ef5218), new u64(0xd6990624, 0x5565a910),
  new u64(0xf40e3585, 0x5771202a), new u64(0x106aa070, 0x32bbd1b8),
  new u64(0x19a4c116, 0xb8d2d0c8), new u64(0x1e376c08, 0x5141ab53),
  new u64(0x2748774c, 0xdf8eeb99), new u64(0x34b0bcb5, 0xe19b48a8),
  new u64(0x391c0cb3, 0xc5c95a63), new u64(0x4ed8aa4a, 0xe3418acb),
  new u64(0x5b9cca4f, 0x7763e373), new u64(0x682e6ff3, 0xd6b2b8a3),
  new u64(0x748f82ee, 0x5defb2fc), new u64(0x78a5636f, 0x43172f60),
  new u64(0x84c87814, 0xa1f0ab72), new u64(0x8cc70208, 0x1a6439ec),
  new u64(0x90befffa, 0x23631e28), new u64(0xa4506ceb, 0xde82bde9),
  new u64(0xbef9a3f7, 0xb2c67915), new u64(0xc67178f2, 0xe372532b),
  new u64(0xca273ece, 0xea26619c), new u64(0xd186b8c7, 0x21c0c207),
  new u64(0xeada7dd6, 0xcde0eb1e), new u64(0xf57d4f7f, 0xee6ed178),
  new u64(0x06f067aa, 0x72176fba), new u64(0x0a637dc5, 0xa2c898a6),
  new u64(0x113f9804, 0xbef90dae), new u64(0x1b710b35, 0x131c471b),
  new u64(0x28db77f5, 0x23047d84), new u64(0x32caab7b, 0x40c72493),
  new u64(0x3c9ebe0a, 0x15c9bebc), new u64(0x431d67c4, 0x9c100d4c),
  new u64(0x4cc5d4be, 0xcb3e42b6), new u64(0x597f299c, 0xfc657e2a),
  new u64(0x5fcb6fab, 0x3ad6faec), new u64(0x6c44198c, 0x4a475817)
];

function crypto_hashblocks(x, m, n) {
  var z = [], b = [], a = [], w = [], t, i, j;

  for (i = 0; i < 8; i++) z[i] = a[i] = dl64(x, 8*i);

  var pos = 0;
  while (n >= 128) {
    for (i = 0; i < 16; i++) w[i] = dl64(m, 8*i+pos);
    for (i = 0; i < 80; i++) {
      for (j = 0; j < 8; j++) b[j] = a[j];
      t = add64(a[7], Sigma1(a[4]), Ch(a[4], a[5], a[6]), K[i], w[i%16]);
      b[7] = add64(t, Sigma0(a[0]), Maj(a[0], a[1], a[2]));
      b[3] = add64(b[3], t);
      for (j = 0; j < 8; j++) a[(j+1)%8] = b[j];
      if (i%16 === 15) {
        for (j = 0; j < 16; j++) {
          w[j] = add64(w[j], w[(j+9)%16], sigma0(w[(j+1)%16]), sigma1(w[(j+14)%16]));
        }
      }
    }

    for (i = 0; i < 8; i++) {
      a[i] = add64(a[i], z[i]);
      z[i] = a[i];
    }

    pos += 128;
    n -= 128;
  }

  for (i = 0; i < 8; i++) ts64(x, 8*i, z[i]);
  return n;
}

var iv = new Uint8Array([
  0x6a,0x09,0xe6,0x67,0xf3,0xbc,0xc9,0x08,
  0xbb,0x67,0xae,0x85,0x84,0xca,0xa7,0x3b,
  0x3c,0x6e,0xf3,0x72,0xfe,0x94,0xf8,0x2b,
  0xa5,0x4f,0xf5,0x3a,0x5f,0x1d,0x36,0xf1,
  0x51,0x0e,0x52,0x7f,0xad,0xe6,0x82,0xd1,
  0x9b,0x05,0x68,0x8c,0x2b,0x3e,0x6c,0x1f,
  0x1f,0x83,0xd9,0xab,0xfb,0x41,0xbd,0x6b,
  0x5b,0xe0,0xcd,0x19,0x13,0x7e,0x21,0x79
]);

function crypto_hash(out, m, n) {
  var h = new Uint8Array(64), x = new Uint8Array(256);
  var i, b = n;

  for (i = 0; i < 64; i++) h[i] = iv[i];

  crypto_hashblocks(h, m, n);
  n %= 128;

  for (i = 0; i < 256; i++) x[i] = 0;
  for (i = 0; i < n; i++) x[i] = m[b-n+i];
  x[n] = 128;

  n = 256-128*(n<112?1:0);
  x[n-9] = 0;
  ts64(x, n-8, new u64((b / 0x20000000) | 0, b << 3));
  crypto_hashblocks(h, x, n);

  for (i = 0; i < 64; i++) out[i] = h[i];

  return 0;
}

function add(p, q) {
  var a = gf(), b = gf(), c = gf(),
      d = gf(), e = gf(), f = gf(),
      g = gf(), h = gf(), t = gf();

  Z(a, p[1], p[0]);
  Z(t, q[1], q[0]);
  M(a, a, t);
  A(b, p[0], p[1]);
  A(t, q[0], q[1]);
  M(b, b, t);
  M(c, p[3], q[3]);
  M(c, c, D2);
  M(d, p[2], q[2]);
  A(d, d, d);
  Z(e, b, a);
  Z(f, d, c);
  A(g, d, c);
  A(h, b, a);

  M(p[0], e, f);
  M(p[1], h, g);
  M(p[2], g, f);
  M(p[3], e, h);
}

function cswap(p, q, b) {
  var i;
  for (i = 0; i < 4; i++) {
    sel25519(p[i], q[i], b);
  }
}

function pack(r, p) {
  var tx = gf(), ty = gf(), zi = gf();
  inv25519(zi, p[2]);
  M(tx, p[0], zi);
  M(ty, p[1], zi);
  pack25519(r, ty);
  r[31] ^= par25519(tx) << 7;
}

function scalarmult(p, q, s) {
  var b, i;
  set25519(p[0], gf0);
  set25519(p[1], gf1);
  set25519(p[2], gf1);
  set25519(p[3], gf0);
  for (i = 255; i >= 0; --i) {
    b = (s[(i/8)|0] >> (i&7)) & 1;
    cswap(p, q, b);
    add(q, p);
    add(p, p);
    cswap(p, q, b);
  }
}

function scalarbase(p, s) {
  var q = [gf(), gf(), gf(), gf()];
  set25519(q[0], X);
  set25519(q[1], Y);
  set25519(q[2], gf1);
  M(q[3], X, Y);
  scalarmult(p, q, s);
}

function crypto_sign_keypair(pk, sk, seeded) {
  var d = new Uint8Array(64);
  var p = [gf(), gf(), gf(), gf()];
  var i;

  if (!seeded) randombytes(sk, 32);
  crypto_hash(d, sk, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  scalarbase(p, d);
  pack(pk, p);

  for (i = 0; i < 32; i++) sk[i+32] = pk[i];
  return 0;
}

var L = new Float64Array([0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10]);

function modL(r, x) {
  var carry, i, j, k;
  for (i = 63; i >= 32; --i) {
    carry = 0;
    for (j = i - 32, k = i - 12; j < k; ++j) {
      x[j] += carry - 16 * x[i] * L[j - (i - 32)];
      carry = Math.floor((x[j] + 128) / 256);
      x[j] -= carry * 256;
    }
    x[j] += carry;
    x[i] = 0;
  }
  carry = 0;
  for (j = 0; j < 32; j++) {
    x[j] += carry - (x[31] >> 4) * L[j];
    carry = x[j] >> 8;
    x[j] &= 255;
  }
  for (j = 0; j < 32; j++) x[j] -= carry * L[j];
  for (i = 0; i < 32; i++) {
    x[i+1] += x[i] >> 8;
    r[i] = x[i] & 255;
  }
}

function reduce(r) {
  var x = new Float64Array(64), i;
  for (i = 0; i < 64; i++) x[i] = r[i];
  for (i = 0; i < 64; i++) r[i] = 0;
  modL(r, x);
}

// Note: difference from C - smlen returned, not passed as argument.
function crypto_sign(sm, m, n, sk) {
  var d = new Uint8Array(64), h = new Uint8Array(64), r = new Uint8Array(64);
  var i, j, x = new Float64Array(64);
  var p = [gf(), gf(), gf(), gf()];

  crypto_hash(d, sk, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  var smlen = n + 64;
  for (i = 0; i < n; i++) sm[64 + i] = m[i];
  for (i = 0; i < 32; i++) sm[32 + i] = d[32 + i];

  crypto_hash(r, sm.subarray(32), n+32);
  reduce(r);
  scalarbase(p, r);
  pack(sm, p);

  for (i = 32; i < 64; i++) sm[i] = sk[i];
  crypto_hash(h, sm, n + 64);
  reduce(h);

  for (i = 0; i < 64; i++) x[i] = 0;
  for (i = 0; i < 32; i++) x[i] = r[i];
  for (i = 0; i < 32; i++) {
    for (j = 0; j < 32; j++) {
      x[i+j] += h[i] * d[j];
    }
  }

  modL(sm.subarray(32), x);
  return smlen;
}

function unpackneg(r, p) {
  var t = gf(), chk = gf(), num = gf(),
      den = gf(), den2 = gf(), den4 = gf(),
      den6 = gf();

  set25519(r[2], gf1);
  unpack25519(r[1], p);
  S(num, r[1]);
  M(den, num, D);
  Z(num, num, r[2]);
  A(den, r[2], den);

  S(den2, den);
  S(den4, den2);
  M(den6, den4, den2);
  M(t, den6, num);
  M(t, t, den);

  pow2523(t, t);
  M(t, t, num);
  M(t, t, den);
  M(t, t, den);
  M(r[0], t, den);

  S(chk, r[0]);
  M(chk, chk, den);
  if (neq25519(chk, num)) M(r[0], r[0], I);

  S(chk, r[0]);
  M(chk, chk, den);
  if (neq25519(chk, num)) return -1;

  if (par25519(r[0]) === (p[31]>>7)) Z(r[0], gf0, r[0]);

  M(r[3], r[0], r[1]);
  return 0;
}

function crypto_sign_open(m, sm, n, pk) {
  var i;
  var t = new Uint8Array(32), h = new Uint8Array(64);
  var p = [gf(), gf(), gf(), gf()],
      q = [gf(), gf(), gf(), gf()];

  if (n < 64) return -1;

  if (unpackneg(q, pk)) return -1;

  for (i = 0; i < n; i++) m[i] = sm[i];
  for (i = 0; i < 32; i++) m[i+32] = pk[i];
  crypto_hash(h, m, n);
  reduce(h);
  scalarmult(p, q, h);

  scalarbase(q, sm.subarray(32));
  add(p, q);
  pack(t, p);

  n -= 64;
  if (crypto_verify_32(sm, 0, t, 0)) {
    for (i = 0; i < n; i++) m[i] = 0;
    return -1;
  }

  for (i = 0; i < n; i++) m[i] = sm[i + 64];
  return n;
}

var crypto_secretbox_KEYBYTES = 32,
    crypto_secretbox_NONCEBYTES = 24,
    crypto_secretbox_ZEROBYTES = 32,
    crypto_secretbox_BOXZEROBYTES = 16,
    crypto_scalarmult_BYTES = 32,
    crypto_scalarmult_SCALARBYTES = 32,
    crypto_box_PUBLICKEYBYTES = 32,
    crypto_box_SECRETKEYBYTES = 32,
    crypto_box_BEFORENMBYTES = 32,
    crypto_box_NONCEBYTES = crypto_secretbox_NONCEBYTES,
    crypto_box_ZEROBYTES = crypto_secretbox_ZEROBYTES,
    crypto_box_BOXZEROBYTES = crypto_secretbox_BOXZEROBYTES,
    crypto_sign_BYTES = 64,
    crypto_sign_PUBLICKEYBYTES = 32,
    crypto_sign_SECRETKEYBYTES = 64,
    crypto_sign_SEEDBYTES = 32,
    crypto_hash_BYTES = 64;

nacl.lowlevel = {
  crypto_core_hsalsa20: crypto_core_hsalsa20,
  crypto_stream_xor: crypto_stream_xor,
  crypto_stream: crypto_stream,
  crypto_stream_salsa20_xor: crypto_stream_salsa20_xor,
  crypto_stream_salsa20: crypto_stream_salsa20,
  crypto_onetimeauth: crypto_onetimeauth,
  crypto_onetimeauth_verify: crypto_onetimeauth_verify,
  crypto_verify_16: crypto_verify_16,
  crypto_verify_32: crypto_verify_32,
  crypto_secretbox: crypto_secretbox,
  crypto_secretbox_open: crypto_secretbox_open,
  crypto_scalarmult: crypto_scalarmult,
  crypto_scalarmult_base: crypto_scalarmult_base,
  crypto_box_beforenm: crypto_box_beforenm,
  crypto_box_afternm: crypto_box_afternm,
  crypto_box: crypto_box,
  crypto_box_open: crypto_box_open,
  crypto_box_keypair: crypto_box_keypair,
  crypto_hash: crypto_hash,
  crypto_sign: crypto_sign,
  crypto_sign_keypair: crypto_sign_keypair,
  crypto_sign_open: crypto_sign_open,

  crypto_secretbox_KEYBYTES: crypto_secretbox_KEYBYTES,
  crypto_secretbox_NONCEBYTES: crypto_secretbox_NONCEBYTES,
  crypto_secretbox_ZEROBYTES: crypto_secretbox_ZEROBYTES,
  crypto_secretbox_BOXZEROBYTES: crypto_secretbox_BOXZEROBYTES,
  crypto_scalarmult_BYTES: crypto_scalarmult_BYTES,
  crypto_scalarmult_SCALARBYTES: crypto_scalarmult_SCALARBYTES,
  crypto_box_PUBLICKEYBYTES: crypto_box_PUBLICKEYBYTES,
  crypto_box_SECRETKEYBYTES: crypto_box_SECRETKEYBYTES,
  crypto_box_BEFORENMBYTES: crypto_box_BEFORENMBYTES,
  crypto_box_NONCEBYTES: crypto_box_NONCEBYTES,
  crypto_box_ZEROBYTES: crypto_box_ZEROBYTES,
  crypto_box_BOXZEROBYTES: crypto_box_BOXZEROBYTES,
  crypto_sign_BYTES: crypto_sign_BYTES,
  crypto_sign_PUBLICKEYBYTES: crypto_sign_PUBLICKEYBYTES,
  crypto_sign_SECRETKEYBYTES: crypto_sign_SECRETKEYBYTES,
  crypto_sign_SEEDBYTES: crypto_sign_SEEDBYTES,
  crypto_hash_BYTES: crypto_hash_BYTES,

  gf: gf,
  D: D,
  L: L,
  pack25519: pack25519,
  unpack25519: unpack25519,
  M: M,
  A: A,
  S: S,
  Z: Z,
  pow2523: pow2523,
  add: add,
  set25519: set25519,
  modL: modL,
  scalarmult: scalarmult,
  scalarbase: scalarbase,
};

/* High-level API */

function checkLengths(k, n) {
  if (k.length !== crypto_secretbox_KEYBYTES) throw new Error('bad key size');
  if (n.length !== crypto_secretbox_NONCEBYTES) throw new Error('bad nonce size');
}

function checkBoxLengths(pk, sk) {
  if (pk.length !== crypto_box_PUBLICKEYBYTES) throw new Error('bad public key size');
  if (sk.length !== crypto_box_SECRETKEYBYTES) throw new Error('bad secret key size');
}

function checkArrayTypes() {
  for (var i = 0; i < arguments.length; i++) {
    if (!(arguments[i] instanceof Uint8Array))
      throw new TypeError('unexpected type, use Uint8Array');
  }
}

function cleanup(arr) {
  for (var i = 0; i < arr.length; i++) arr[i] = 0;
}

nacl.randomBytes = function(n) {
  var b = new Uint8Array(n);
  randombytes(b, n);
  return b;
};

nacl.secretbox = function(msg, nonce, key) {
  checkArrayTypes(msg, nonce, key);
  checkLengths(key, nonce);
  var m = new Uint8Array(crypto_secretbox_ZEROBYTES + msg.length);
  var c = new Uint8Array(m.length);
  for (var i = 0; i < msg.length; i++) m[i+crypto_secretbox_ZEROBYTES] = msg[i];
  crypto_secretbox(c, m, m.length, nonce, key);
  return c.subarray(crypto_secretbox_BOXZEROBYTES);
};

nacl.secretbox.open = function(box, nonce, key) {
  checkArrayTypes(box, nonce, key);
  checkLengths(key, nonce);
  var c = new Uint8Array(crypto_secretbox_BOXZEROBYTES + box.length);
  var m = new Uint8Array(c.length);
  for (var i = 0; i < box.length; i++) c[i+crypto_secretbox_BOXZEROBYTES] = box[i];
  if (c.length < 32) return null;
  if (crypto_secretbox_open(m, c, c.length, nonce, key) !== 0) return null;
  return m.subarray(crypto_secretbox_ZEROBYTES);
};

nacl.secretbox.keyLength = crypto_secretbox_KEYBYTES;
nacl.secretbox.nonceLength = crypto_secretbox_NONCEBYTES;
nacl.secretbox.overheadLength = crypto_secretbox_BOXZEROBYTES;

nacl.scalarMult = function(n, p) {
  checkArrayTypes(n, p);
  if (n.length !== crypto_scalarmult_SCALARBYTES) throw new Error('bad n size');
  if (p.length !== crypto_scalarmult_BYTES) throw new Error('bad p size');
  var q = new Uint8Array(crypto_scalarmult_BYTES);
  crypto_scalarmult(q, n, p);
  return q;
};

nacl.scalarMult.base = function(n) {
  checkArrayTypes(n);
  if (n.length !== crypto_scalarmult_SCALARBYTES) throw new Error('bad n size');
  var q = new Uint8Array(crypto_scalarmult_BYTES);
  crypto_scalarmult_base(q, n);
  return q;
};

nacl.scalarMult.scalarLength = crypto_scalarmult_SCALARBYTES;
nacl.scalarMult.groupElementLength = crypto_scalarmult_BYTES;

nacl.box = function(msg, nonce, publicKey, secretKey) {
  var k = nacl.box.before(publicKey, secretKey);
  return nacl.secretbox(msg, nonce, k);
};

nacl.box.before = function(publicKey, secretKey) {
  checkArrayTypes(publicKey, secretKey);
  checkBoxLengths(publicKey, secretKey);
  var k = new Uint8Array(crypto_box_BEFORENMBYTES);
  crypto_box_beforenm(k, publicKey, secretKey);
  return k;
};

nacl.box.after = nacl.secretbox;

nacl.box.open = function(msg, nonce, publicKey, secretKey) {
  var k = nacl.box.before(publicKey, secretKey);
  return nacl.secretbox.open(msg, nonce, k);
};

nacl.box.open.after = nacl.secretbox.open;

nacl.box.keyPair = function() {
  var pk = new Uint8Array(crypto_box_PUBLICKEYBYTES);
  var sk = new Uint8Array(crypto_box_SECRETKEYBYTES);
  crypto_box_keypair(pk, sk);
  return {publicKey: pk, secretKey: sk};
};

nacl.box.keyPair.fromSecretKey = function(secretKey) {
  checkArrayTypes(secretKey);
  if (secretKey.length !== crypto_box_SECRETKEYBYTES)
    throw new Error('bad secret key size');
  var pk = new Uint8Array(crypto_box_PUBLICKEYBYTES);
  crypto_scalarmult_base(pk, secretKey);
  return {publicKey: pk, secretKey: new Uint8Array(secretKey)};
};

nacl.box.publicKeyLength = crypto_box_PUBLICKEYBYTES;
nacl.box.secretKeyLength = crypto_box_SECRETKEYBYTES;
nacl.box.sharedKeyLength = crypto_box_BEFORENMBYTES;
nacl.box.nonceLength = crypto_box_NONCEBYTES;
nacl.box.overheadLength = nacl.secretbox.overheadLength;

nacl.sign = function(msg, secretKey) {
  checkArrayTypes(msg, secretKey);
  if (secretKey.length !== crypto_sign_SECRETKEYBYTES)
    throw new Error('bad secret key size');
  var signedMsg = new Uint8Array(crypto_sign_BYTES+msg.length);
  crypto_sign(signedMsg, msg, msg.length, secretKey);
  return signedMsg;
};

nacl.sign.open = function(signedMsg, publicKey) {
  checkArrayTypes(signedMsg, publicKey);
  if (publicKey.length !== crypto_sign_PUBLICKEYBYTES)
    throw new Error('bad public key size');
  var tmp = new Uint8Array(signedMsg.length);
  var mlen = crypto_sign_open(tmp, signedMsg, signedMsg.length, publicKey);
  if (mlen < 0) return null;
  var m = new Uint8Array(mlen);
  for (var i = 0; i < m.length; i++) m[i] = tmp[i];
  return m;
};

nacl.sign.detached = function(msg, secretKey) {
  var signedMsg = nacl.sign(msg, secretKey);
  var sig = new Uint8Array(crypto_sign_BYTES);
  for (var i = 0; i < sig.length; i++) sig[i] = signedMsg[i];
  return sig;
};

nacl.sign.detached.verify = function(msg, sig, publicKey) {
  checkArrayTypes(msg, sig, publicKey);
  if (sig.length !== crypto_sign_BYTES)
    throw new Error('bad signature size');
  if (publicKey.length !== crypto_sign_PUBLICKEYBYTES)
    throw new Error('bad public key size');
  var sm = new Uint8Array(crypto_sign_BYTES + msg.length);
  var m = new Uint8Array(crypto_sign_BYTES + msg.length);
  var i;
  for (i = 0; i < crypto_sign_BYTES; i++) sm[i] = sig[i];
  for (i = 0; i < msg.length; i++) sm[i+crypto_sign_BYTES] = msg[i];
  return (crypto_sign_open(m, sm, sm.length, publicKey) >= 0);
};

nacl.sign.keyPair = function() {
  var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  var sk = new Uint8Array(crypto_sign_SECRETKEYBYTES);
  crypto_sign_keypair(pk, sk);
  return {publicKey: pk, secretKey: sk};
};

nacl.sign.keyPair.fromSecretKey = function(secretKey) {
  checkArrayTypes(secretKey);
  if (secretKey.length !== crypto_sign_SECRETKEYBYTES)
    throw new Error('bad secret key size');
  var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  for (var i = 0; i < pk.length; i++) pk[i] = secretKey[32+i];
  return {publicKey: pk, secretKey: new Uint8Array(secretKey)};
};

nacl.sign.keyPair.fromSeed = function(seed) {
  checkArrayTypes(seed);
  if (seed.length !== crypto_sign_SEEDBYTES)
    throw new Error('bad seed size');
  var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  var sk = new Uint8Array(crypto_sign_SECRETKEYBYTES);
  for (var i = 0; i < 32; i++) sk[i] = seed[i];
  crypto_sign_keypair(pk, sk, true);
  return {publicKey: pk, secretKey: sk};
};

nacl.sign.publicKeyLength = crypto_sign_PUBLICKEYBYTES;
nacl.sign.secretKeyLength = crypto_sign_SECRETKEYBYTES;
nacl.sign.seedLength = crypto_sign_SEEDBYTES;
nacl.sign.signatureLength = crypto_sign_BYTES;

nacl.hash = function(msg) {
  checkArrayTypes(msg);
  var h = new Uint8Array(crypto_hash_BYTES);
  crypto_hash(h, msg, msg.length);
  return h;
};

nacl.hash.hashLength = crypto_hash_BYTES;

nacl.verify = function(x, y) {
  checkArrayTypes(x, y);
  // Zero length arguments are considered not equal.
  if (x.length === 0 || y.length === 0) return false;
  if (x.length !== y.length) return false;
  return (vn(x, 0, y, 0, x.length) === 0) ? true : false;
};

function ed25519Verify(msgBytes, sigBytes, pubkeyBytes) {
  return nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
}

    return {
      sortedStringify: sortedStringify,
      ed25519Verify: ed25519Verify,
      b64uToBytes: b64uToBytes,
      asciiToBytes: asciiToBytes,
    };

    function sortedStringify(obj) {
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        return JSON.stringify(obj);
      }
      var sorted = {};
      Object.keys(obj).sort().forEach(function(k) { sorted[k] = obj[k]; });
      return '{' + Object.keys(sorted).map(function(k) {
        return JSON.stringify(k) + ':' + sortedStringify(sorted[k]);
      }).join(',') + '}';
    }

    function b64uToBytes(b64uStr) {
      var b64 = b64uStr.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      var bytes = [];
      var buffer = 0, bits = 0;
      for (var i = 0; i < b64.length; i++) {
        var c = b64[i];
        if (c === '=') break;
        var val = chars.indexOf(c);
        if (val === -1) continue;
        buffer = (buffer << 6) | val;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          bytes.push((buffer >> bits) & 0xff);
        }
      }
      return new Uint8Array(bytes);
    }

    function asciiToBytes(s) {
      var out = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
      return out;
    }
  })();

routerAdd("POST", "/api/tx", (c) => {
  // 2026-09-06 임시 진단 패치: 원인 미상의 "Something went wrong" 400을
  // 잡기 위해 /api/mint(2026-07-07)에 적용했던 것과 동일한 패턴으로
  // 핸들러 전체를 하나의 try/catch로 감싼다. 이 핸들러 안의 개별
  // try/catch들은 각 단계만 국소적으로 보호하고 있어서, 그 사이(특히
  // computeBalance() 호출부, totalOutput 계산, buyerClaim/sellerClaim
  // 생성부)에서 예외가 나면 PocketBase(jsvm) 상위 레벨이 그걸 잡아
  // "Something went wrong while processing your request." 라는 정본
  // 에러 메시지로 뭉개버린다 — 실제 e.message/e.stack이 응답에도, 서버
  // 로그(/opt/gopang/logs/hanlim.log)에도 전혀 남지 않는다. 원인을
  // 특정하면 이 바깥 try/catch는 제거하거나 최소한으로 축소할 것.
  try {
  console.log("[TX] 진입");
  // 2026-09-06 근본 원인 수정: 파일 최상단(line 10)의 전역 var _sigVerify가
  // 실제 운영 환경(PocketBase Goja)에서는 /api/tx 콜백 안에서 "_sigVerify is
  // not defined" ReferenceError를 내는 것이 실사로 확인됐다 — 처음 있는 진짜
  // 이체(register-key → mint → transfer 전체 플로우)가 서명 검증 단계까지
  // 도달한 게 이번이 처음이라, 2026-07-19 "모듈 최상단 승격"이 실제로는 한
  // 번도 이 경로에서 실행 검증된 적이 없었다. 이 파일의 computeBalance/
  // MINT_SECRET/NODE_CONFIG/sha256hex와 동일하게 이미 검증된 워크어라운드
  // (콜백 내부 지역 선언)를 여기도 적용한다 — 전역 참조 대신 콜백 내부에서
  // 매번 새로 만든다. (주의: _balanceUtils(3418번째 줄 부근)와 다른 훅에서
  // 쓰는 _sigVerify(3642번째 줄 부근)도 같은 잠재 버그를 안고 있을 가능성이
  // 높다 — 아직 확인 안 됐을 뿐, 그 경로들이 실제로 트리거되면 똑같이
  // 터질 수 있다. 별도로 확인/수정 필요.)
var _sigVerify = (function() {
var nacl = {};
'use strict';

// Ported in 2014 by Dmitry Chestnykh and Devi Mandiri.
// Public domain.
//
// Implementation derived from TweetNaCl version 20140427.
// See for details: http://tweetnacl.cr.yp.to/

var u64 = function(h, l) { this.hi = h|0 >>> 0; this.lo = l|0 >>> 0; };
var gf = function(init) {
  var i, r = new Float64Array(16);
  if (init) for (i = 0; i < init.length; i++) r[i] = init[i];
  return r;
};

//  Pluggable, initialized in high-level API below.
var randombytes = function(/* x, n */) { throw new Error('no PRNG'); };

var _0 = new Uint8Array(16);
var _9 = new Uint8Array(32); _9[0] = 9;

var gf0 = gf(),
    gf1 = gf([1]),
    _121665 = gf([0xdb41, 1]),
    D = gf([0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070, 0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203]),
    D2 = gf([0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0, 0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406]),
    X = gf([0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c, 0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169]),
    Y = gf([0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666]),
    I = gf([0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43, 0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83]);

function L32(x, c) { return (x << c) | (x >>> (32 - c)); }

function ld32(x, i) {
  var u = x[i+3] & 0xff;
  u = (u<<8)|(x[i+2] & 0xff);
  u = (u<<8)|(x[i+1] & 0xff);
  return (u<<8)|(x[i+0] & 0xff);
}

function dl64(x, i) {
  var h = (x[i] << 24) | (x[i+1] << 16) | (x[i+2] << 8) | x[i+3];
  var l = (x[i+4] << 24) | (x[i+5] << 16) | (x[i+6] << 8) | x[i+7];
  return new u64(h, l);
}

function st32(x, j, u) {
  var i;
  for (i = 0; i < 4; i++) { x[j+i] = u & 255; u >>>= 8; }
}

function ts64(x, i, u) {
  x[i]   = (u.hi >> 24) & 0xff;
  x[i+1] = (u.hi >> 16) & 0xff;
  x[i+2] = (u.hi >>  8) & 0xff;
  x[i+3] = u.hi & 0xff;
  x[i+4] = (u.lo >> 24)  & 0xff;
  x[i+5] = (u.lo >> 16)  & 0xff;
  x[i+6] = (u.lo >>  8)  & 0xff;
  x[i+7] = u.lo & 0xff;
}

function vn(x, xi, y, yi, n) {
  var i,d = 0;
  for (i = 0; i < n; i++) d |= x[xi+i]^y[yi+i];
  return (1 & ((d - 1) >>> 8)) - 1;
}

function crypto_verify_16(x, xi, y, yi) {
  return vn(x,xi,y,yi,16);
}

function crypto_verify_32(x, xi, y, yi) {
  return vn(x,xi,y,yi,32);
}

function core(out,inp,k,c,h) {
  var w = new Uint32Array(16), x = new Uint32Array(16),
      y = new Uint32Array(16), t = new Uint32Array(4);
  var i, j, m;

  for (i = 0; i < 4; i++) {
    x[5*i] = ld32(c, 4*i);
    x[1+i] = ld32(k, 4*i);
    x[6+i] = ld32(inp, 4*i);
    x[11+i] = ld32(k, 16+4*i);
  }

  for (i = 0; i < 16; i++) y[i] = x[i];

  for (i = 0; i < 20; i++) {
    for (j = 0; j < 4; j++) {
      for (m = 0; m < 4; m++) t[m] = x[(5*j+4*m)%16];
      t[1] ^= L32((t[0]+t[3])|0, 7);
      t[2] ^= L32((t[1]+t[0])|0, 9);
      t[3] ^= L32((t[2]+t[1])|0,13);
      t[0] ^= L32((t[3]+t[2])|0,18);
      for (m = 0; m < 4; m++) w[4*j+(j+m)%4] = t[m];
    }
    for (m = 0; m < 16; m++) x[m] = w[m];
  }

  if (h) {
    for (i = 0; i < 16; i++) x[i] = (x[i] + y[i]) | 0;
    for (i = 0; i < 4; i++) {
      x[5*i] = (x[5*i] - ld32(c, 4*i)) | 0;
      x[6+i] = (x[6+i] - ld32(inp, 4*i)) | 0;
    }
    for (i = 0; i < 4; i++) {
      st32(out,4*i,x[5*i]);
      st32(out,16+4*i,x[6+i]);
    }
  } else {
    for (i = 0; i < 16; i++) st32(out, 4 * i, (x[i] + y[i]) | 0);
  }
}

function crypto_core_salsa20(out,inp,k,c) {
  core(out,inp,k,c,false);
  return 0;
}

function crypto_core_hsalsa20(out,inp,k,c) {
  core(out,inp,k,c,true);
  return 0;
}

var sigma = new Uint8Array([101, 120, 112, 97, 110, 100, 32, 51, 50, 45, 98, 121, 116, 101, 32, 107]);
            // "expand 32-byte k"

function crypto_stream_salsa20_xor(c,cpos,m,mpos,b,n,k) {
  var z = new Uint8Array(16), x = new Uint8Array(64);
  var u, i;
  if (!b) return 0;
  for (i = 0; i < 16; i++) z[i] = 0;
  for (i = 0; i < 8; i++) z[i] = n[i];
  while (b >= 64) {
    crypto_core_salsa20(x,z,k,sigma);
    for (i = 0; i < 64; i++) c[cpos+i] = (m?m[mpos+i]:0) ^ x[i];
    u = 1;
    for (i = 8; i < 16; i++) {
      u = u + (z[i] & 0xff) | 0;
      z[i] = u & 0xff;
      u >>>= 8;
    }
    b -= 64;
    cpos += 64;
    if (m) mpos += 64;
  }
  if (b > 0) {
    crypto_core_salsa20(x,z,k,sigma);
    for (i = 0; i < b; i++) c[cpos+i] = (m?m[mpos+i]:0) ^ x[i];
  }
  return 0;
}

function crypto_stream_salsa20(c,cpos,d,n,k) {
  return crypto_stream_salsa20_xor(c,cpos,null,0,d,n,k);
}

function crypto_stream(c,cpos,d,n,k) {
  var s = new Uint8Array(32);
  crypto_core_hsalsa20(s,n,k,sigma);
  return crypto_stream_salsa20(c,cpos,d,n.subarray(16),s);
}

function crypto_stream_xor(c,cpos,m,mpos,d,n,k) {
  var s = new Uint8Array(32);
  crypto_core_hsalsa20(s,n,k,sigma);
  return crypto_stream_salsa20_xor(c,cpos,m,mpos,d,n.subarray(16),s);
}

function add1305(h, c) {
  var j, u = 0;
  for (j = 0; j < 17; j++) {
    u = (u + ((h[j] + c[j]) | 0)) | 0;
    h[j] = u & 255;
    u >>>= 8;
  }
}

var minusp = new Uint32Array([
  5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 252
]);

function crypto_onetimeauth(out, outpos, m, mpos, n, k) {
  var s, i, j, u;
  var x = new Uint32Array(17), r = new Uint32Array(17),
      h = new Uint32Array(17), c = new Uint32Array(17),
      g = new Uint32Array(17);
  for (j = 0; j < 17; j++) r[j]=h[j]=0;
  for (j = 0; j < 16; j++) r[j]=k[j];
  r[3]&=15;
  r[4]&=252;
  r[7]&=15;
  r[8]&=252;
  r[11]&=15;
  r[12]&=252;
  r[15]&=15;

  while (n > 0) {
    for (j = 0; j < 17; j++) c[j] = 0;
    for (j = 0; (j < 16) && (j < n); ++j) c[j] = m[mpos+j];
    c[j] = 1;
    mpos += j; n -= j;
    add1305(h,c);
    for (i = 0; i < 17; i++) {
      x[i] = 0;
      for (j = 0; j < 17; j++) x[i] = (x[i] + (h[j] * ((j <= i) ? r[i - j] : ((320 * r[i + 17 - j])|0))) | 0) | 0;
    }
    for (i = 0; i < 17; i++) h[i] = x[i];
    u = 0;
    for (j = 0; j < 16; j++) {
      u = (u + h[j]) | 0;
      h[j] = u & 255;
      u >>>= 8;
    }
    u = (u + h[16]) | 0; h[16] = u & 3;
    u = (5 * (u >>> 2)) | 0;
    for (j = 0; j < 16; j++) {
      u = (u + h[j]) | 0;
      h[j] = u & 255;
      u >>>= 8;
    }
    u = (u + h[16]) | 0; h[16] = u;
  }

  for (j = 0; j < 17; j++) g[j] = h[j];
  add1305(h,minusp);
  s = (-(h[16] >>> 7) | 0);
  for (j = 0; j < 17; j++) h[j] ^= s & (g[j] ^ h[j]);

  for (j = 0; j < 16; j++) c[j] = k[j + 16];
  c[16] = 0;
  add1305(h,c);
  for (j = 0; j < 16; j++) out[outpos+j] = h[j];
  return 0;
}

function crypto_onetimeauth_verify(h, hpos, m, mpos, n, k) {
  var x = new Uint8Array(16);
  crypto_onetimeauth(x,0,m,mpos,n,k);
  return crypto_verify_16(h,hpos,x,0);
}

function crypto_secretbox(c,m,d,n,k) {
  var i;
  if (d < 32) return -1;
  crypto_stream_xor(c,0,m,0,d,n,k);
  crypto_onetimeauth(c, 16, c, 32, d - 32, c);
  for (i = 0; i < 16; i++) c[i] = 0;
  return 0;
}

function crypto_secretbox_open(m,c,d,n,k) {
  var i;
  var x = new Uint8Array(32);
  if (d < 32) return -1;
  crypto_stream(x,0,32,n,k);
  if (crypto_onetimeauth_verify(c, 16,c, 32,d - 32,x) !== 0) return -1;
  crypto_stream_xor(m,0,c,0,d,n,k);
  for (i = 0; i < 32; i++) m[i] = 0;
  return 0;
}

function set25519(r, a) {
  var i;
  for (i = 0; i < 16; i++) r[i] = a[i]|0;
}

function car25519(o) {
  var c;
  var i;
  for (i = 0; i < 16; i++) {
      o[i] += 65536;
      c = Math.floor(o[i] / 65536);
      o[(i+1)*(i<15?1:0)] += c - 1 + 37 * (c-1) * (i===15?1:0);
      o[i] -= (c * 65536);
  }
}

function sel25519(p, q, b) {
  var t, c = ~(b-1);
  for (var i = 0; i < 16; i++) {
    t = c & (p[i] ^ q[i]);
    p[i] ^= t;
    q[i] ^= t;
  }
}

function pack25519(o, n) {
  var i, j, b;
  var m = gf(), t = gf();
  for (i = 0; i < 16; i++) t[i] = n[i];
  car25519(t);
  car25519(t);
  car25519(t);
  for (j = 0; j < 2; j++) {
    m[0] = t[0] - 0xffed;
    for (i = 1; i < 15; i++) {
      m[i] = t[i] - 0xffff - ((m[i-1]>>16) & 1);
      m[i-1] &= 0xffff;
    }
    m[15] = t[15] - 0x7fff - ((m[14]>>16) & 1);
    b = (m[15]>>16) & 1;
    m[14] &= 0xffff;
    sel25519(t, m, 1-b);
  }
  for (i = 0; i < 16; i++) {
    o[2*i] = t[i] & 0xff;
    o[2*i+1] = t[i]>>8;
  }
}

function neq25519(a, b) {
  var c = new Uint8Array(32), d = new Uint8Array(32);
  pack25519(c, a);
  pack25519(d, b);
  return crypto_verify_32(c, 0, d, 0);
}

function par25519(a) {
  var d = new Uint8Array(32);
  pack25519(d, a);
  return d[0] & 1;
}

function unpack25519(o, n) {
  var i;
  for (i = 0; i < 16; i++) o[i] = n[2*i] + (n[2*i+1] << 8);
  o[15] &= 0x7fff;
}

function A(o, a, b) {
  var i;
  for (i = 0; i < 16; i++) o[i] = (a[i] + b[i])|0;
}

function Z(o, a, b) {
  var i;
  for (i = 0; i < 16; i++) o[i] = (a[i] - b[i])|0;
}

function M(o, a, b) {
  var i, j, t = new Float64Array(31);
  for (i = 0; i < 31; i++) t[i] = 0;
  for (i = 0; i < 16; i++) {
    for (j = 0; j < 16; j++) {
      t[i+j] += a[i] * b[j];
    }
  }
  for (i = 0; i < 15; i++) {
    t[i] += 38 * t[i+16];
  }
  for (i = 0; i < 16; i++) o[i] = t[i];
  car25519(o);
  car25519(o);
}

function S(o, a) {
  M(o, a, a);
}

function inv25519(o, i) {
  var c = gf();
  var a;
  for (a = 0; a < 16; a++) c[a] = i[a];
  for (a = 253; a >= 0; a--) {
    S(c, c);
    if(a !== 2 && a !== 4) M(c, c, i);
  }
  for (a = 0; a < 16; a++) o[a] = c[a];
}

function pow2523(o, i) {
  var c = gf();
  var a;
  for (a = 0; a < 16; a++) c[a] = i[a];
  for (a = 250; a >= 0; a--) {
      S(c, c);
      if(a !== 1) M(c, c, i);
  }
  for (a = 0; a < 16; a++) o[a] = c[a];
}

function crypto_scalarmult(q, n, p) {
  var z = new Uint8Array(32);
  var x = new Float64Array(80), r, i;
  var a = gf(), b = gf(), c = gf(),
      d = gf(), e = gf(), f = gf();
  for (i = 0; i < 31; i++) z[i] = n[i];
  z[31]=(n[31]&127)|64;
  z[0]&=248;
  unpack25519(x,p);
  for (i = 0; i < 16; i++) {
    b[i]=x[i];
    d[i]=a[i]=c[i]=0;
  }
  a[0]=d[0]=1;
  for (i=254; i>=0; --i) {
    r=(z[i>>>3]>>>(i&7))&1;
    sel25519(a,b,r);
    sel25519(c,d,r);
    A(e,a,c);
    Z(a,a,c);
    A(c,b,d);
    Z(b,b,d);
    S(d,e);
    S(f,a);
    M(a,c,a);
    M(c,b,e);
    A(e,a,c);
    Z(a,a,c);
    S(b,a);
    Z(c,d,f);
    M(a,c,_121665);
    A(a,a,d);
    M(c,c,a);
    M(a,d,f);
    M(d,b,x);
    S(b,e);
    sel25519(a,b,r);
    sel25519(c,d,r);
  }
  for (i = 0; i < 16; i++) {
    x[i+16]=a[i];
    x[i+32]=c[i];
    x[i+48]=b[i];
    x[i+64]=d[i];
  }
  var x32 = x.subarray(32);
  var x16 = x.subarray(16);
  inv25519(x32,x32);
  M(x16,x16,x32);
  pack25519(q,x16);
  return 0;
}

function crypto_scalarmult_base(q, n) {
  return crypto_scalarmult(q, n, _9);
}

function crypto_box_keypair(y, x) {
  randombytes(x, 32);
  return crypto_scalarmult_base(y, x);
}

function crypto_box_beforenm(k, y, x) {
  var s = new Uint8Array(32);
  crypto_scalarmult(s, x, y);
  return crypto_core_hsalsa20(k, _0, s, sigma);
}

var crypto_box_afternm = crypto_secretbox;
var crypto_box_open_afternm = crypto_secretbox_open;

function crypto_box(c, m, d, n, y, x) {
  var k = new Uint8Array(32);
  crypto_box_beforenm(k, y, x);
  return crypto_box_afternm(c, m, d, n, k);
}

function crypto_box_open(m, c, d, n, y, x) {
  var k = new Uint8Array(32);
  crypto_box_beforenm(k, y, x);
  return crypto_box_open_afternm(m, c, d, n, k);
}

function add64() {
  var a = 0, b = 0, c = 0, d = 0, m16 = 65535, l, h, i;
  for (i = 0; i < arguments.length; i++) {
    l = arguments[i].lo;
    h = arguments[i].hi;
    a += (l & m16); b += (l >>> 16);
    c += (h & m16); d += (h >>> 16);
  }

  b += (a >>> 16);
  c += (b >>> 16);
  d += (c >>> 16);

  return new u64((c & m16) | (d << 16), (a & m16) | (b << 16));
}

function shr64(x, c) {
  return new u64((x.hi >>> c), (x.lo >>> c) | (x.hi << (32 - c)));
}

function xor64() {
  var l = 0, h = 0, i;
  for (i = 0; i < arguments.length; i++) {
    l ^= arguments[i].lo;
    h ^= arguments[i].hi;
  }
  return new u64(h, l);
}

function R(x, c) {
  var h, l, c1 = 32 - c;
  if (c < 32) {
    h = (x.hi >>> c) | (x.lo << c1);
    l = (x.lo >>> c) | (x.hi << c1);
  } else if (c < 64) {
    h = (x.lo >>> c) | (x.hi << c1);
    l = (x.hi >>> c) | (x.lo << c1);
  }
  return new u64(h, l);
}

function Ch(x, y, z) {
  var h = (x.hi & y.hi) ^ (~x.hi & z.hi),
      l = (x.lo & y.lo) ^ (~x.lo & z.lo);
  return new u64(h, l);
}

function Maj(x, y, z) {
  var h = (x.hi & y.hi) ^ (x.hi & z.hi) ^ (y.hi & z.hi),
      l = (x.lo & y.lo) ^ (x.lo & z.lo) ^ (y.lo & z.lo);
  return new u64(h, l);
}

function Sigma0(x) { return xor64(R(x,28), R(x,34), R(x,39)); }
function Sigma1(x) { return xor64(R(x,14), R(x,18), R(x,41)); }
function sigma0(x) { return xor64(R(x, 1), R(x, 8), shr64(x,7)); }
function sigma1(x) { return xor64(R(x,19), R(x,61), shr64(x,6)); }

var K = [
  new u64(0x428a2f98, 0xd728ae22), new u64(0x71374491, 0x23ef65cd),
  new u64(0xb5c0fbcf, 0xec4d3b2f), new u64(0xe9b5dba5, 0x8189dbbc),
  new u64(0x3956c25b, 0xf348b538), new u64(0x59f111f1, 0xb605d019),
  new u64(0x923f82a4, 0xaf194f9b), new u64(0xab1c5ed5, 0xda6d8118),
  new u64(0xd807aa98, 0xa3030242), new u64(0x12835b01, 0x45706fbe),
  new u64(0x243185be, 0x4ee4b28c), new u64(0x550c7dc3, 0xd5ffb4e2),
  new u64(0x72be5d74, 0xf27b896f), new u64(0x80deb1fe, 0x3b1696b1),
  new u64(0x9bdc06a7, 0x25c71235), new u64(0xc19bf174, 0xcf692694),
  new u64(0xe49b69c1, 0x9ef14ad2), new u64(0xefbe4786, 0x384f25e3),
  new u64(0x0fc19dc6, 0x8b8cd5b5), new u64(0x240ca1cc, 0x77ac9c65),
  new u64(0x2de92c6f, 0x592b0275), new u64(0x4a7484aa, 0x6ea6e483),
  new u64(0x5cb0a9dc, 0xbd41fbd4), new u64(0x76f988da, 0x831153b5),
  new u64(0x983e5152, 0xee66dfab), new u64(0xa831c66d, 0x2db43210),
  new u64(0xb00327c8, 0x98fb213f), new u64(0xbf597fc7, 0xbeef0ee4),
  new u64(0xc6e00bf3, 0x3da88fc2), new u64(0xd5a79147, 0x930aa725),
  new u64(0x06ca6351, 0xe003826f), new u64(0x14292967, 0x0a0e6e70),
  new u64(0x27b70a85, 0x46d22ffc), new u64(0x2e1b2138, 0x5c26c926),
  new u64(0x4d2c6dfc, 0x5ac42aed), new u64(0x53380d13, 0x9d95b3df),
  new u64(0x650a7354, 0x8baf63de), new u64(0x766a0abb, 0x3c77b2a8),
  new u64(0x81c2c92e, 0x47edaee6), new u64(0x92722c85, 0x1482353b),
  new u64(0xa2bfe8a1, 0x4cf10364), new u64(0xa81a664b, 0xbc423001),
  new u64(0xc24b8b70, 0xd0f89791), new u64(0xc76c51a3, 0x0654be30),
  new u64(0xd192e819, 0xd6ef5218), new u64(0xd6990624, 0x5565a910),
  new u64(0xf40e3585, 0x5771202a), new u64(0x106aa070, 0x32bbd1b8),
  new u64(0x19a4c116, 0xb8d2d0c8), new u64(0x1e376c08, 0x5141ab53),
  new u64(0x2748774c, 0xdf8eeb99), new u64(0x34b0bcb5, 0xe19b48a8),
  new u64(0x391c0cb3, 0xc5c95a63), new u64(0x4ed8aa4a, 0xe3418acb),
  new u64(0x5b9cca4f, 0x7763e373), new u64(0x682e6ff3, 0xd6b2b8a3),
  new u64(0x748f82ee, 0x5defb2fc), new u64(0x78a5636f, 0x43172f60),
  new u64(0x84c87814, 0xa1f0ab72), new u64(0x8cc70208, 0x1a6439ec),
  new u64(0x90befffa, 0x23631e28), new u64(0xa4506ceb, 0xde82bde9),
  new u64(0xbef9a3f7, 0xb2c67915), new u64(0xc67178f2, 0xe372532b),
  new u64(0xca273ece, 0xea26619c), new u64(0xd186b8c7, 0x21c0c207),
  new u64(0xeada7dd6, 0xcde0eb1e), new u64(0xf57d4f7f, 0xee6ed178),
  new u64(0x06f067aa, 0x72176fba), new u64(0x0a637dc5, 0xa2c898a6),
  new u64(0x113f9804, 0xbef90dae), new u64(0x1b710b35, 0x131c471b),
  new u64(0x28db77f5, 0x23047d84), new u64(0x32caab7b, 0x40c72493),
  new u64(0x3c9ebe0a, 0x15c9bebc), new u64(0x431d67c4, 0x9c100d4c),
  new u64(0x4cc5d4be, 0xcb3e42b6), new u64(0x597f299c, 0xfc657e2a),
  new u64(0x5fcb6fab, 0x3ad6faec), new u64(0x6c44198c, 0x4a475817)
];

function crypto_hashblocks(x, m, n) {
  var z = [], b = [], a = [], w = [], t, i, j;

  for (i = 0; i < 8; i++) z[i] = a[i] = dl64(x, 8*i);

  var pos = 0;
  while (n >= 128) {
    for (i = 0; i < 16; i++) w[i] = dl64(m, 8*i+pos);
    for (i = 0; i < 80; i++) {
      for (j = 0; j < 8; j++) b[j] = a[j];
      t = add64(a[7], Sigma1(a[4]), Ch(a[4], a[5], a[6]), K[i], w[i%16]);
      b[7] = add64(t, Sigma0(a[0]), Maj(a[0], a[1], a[2]));
      b[3] = add64(b[3], t);
      for (j = 0; j < 8; j++) a[(j+1)%8] = b[j];
      if (i%16 === 15) {
        for (j = 0; j < 16; j++) {
          w[j] = add64(w[j], w[(j+9)%16], sigma0(w[(j+1)%16]), sigma1(w[(j+14)%16]));
        }
      }
    }

    for (i = 0; i < 8; i++) {
      a[i] = add64(a[i], z[i]);
      z[i] = a[i];
    }

    pos += 128;
    n -= 128;
  }

  for (i = 0; i < 8; i++) ts64(x, 8*i, z[i]);
  return n;
}

var iv = new Uint8Array([
  0x6a,0x09,0xe6,0x67,0xf3,0xbc,0xc9,0x08,
  0xbb,0x67,0xae,0x85,0x84,0xca,0xa7,0x3b,
  0x3c,0x6e,0xf3,0x72,0xfe,0x94,0xf8,0x2b,
  0xa5,0x4f,0xf5,0x3a,0x5f,0x1d,0x36,0xf1,
  0x51,0x0e,0x52,0x7f,0xad,0xe6,0x82,0xd1,
  0x9b,0x05,0x68,0x8c,0x2b,0x3e,0x6c,0x1f,
  0x1f,0x83,0xd9,0xab,0xfb,0x41,0xbd,0x6b,
  0x5b,0xe0,0xcd,0x19,0x13,0x7e,0x21,0x79
]);

function crypto_hash(out, m, n) {
  var h = new Uint8Array(64), x = new Uint8Array(256);
  var i, b = n;

  for (i = 0; i < 64; i++) h[i] = iv[i];

  crypto_hashblocks(h, m, n);
  n %= 128;

  for (i = 0; i < 256; i++) x[i] = 0;
  for (i = 0; i < n; i++) x[i] = m[b-n+i];
  x[n] = 128;

  n = 256-128*(n<112?1:0);
  x[n-9] = 0;
  ts64(x, n-8, new u64((b / 0x20000000) | 0, b << 3));
  crypto_hashblocks(h, x, n);

  for (i = 0; i < 64; i++) out[i] = h[i];

  return 0;
}

function add(p, q) {
  var a = gf(), b = gf(), c = gf(),
      d = gf(), e = gf(), f = gf(),
      g = gf(), h = gf(), t = gf();

  Z(a, p[1], p[0]);
  Z(t, q[1], q[0]);
  M(a, a, t);
  A(b, p[0], p[1]);
  A(t, q[0], q[1]);
  M(b, b, t);
  M(c, p[3], q[3]);
  M(c, c, D2);
  M(d, p[2], q[2]);
  A(d, d, d);
  Z(e, b, a);
  Z(f, d, c);
  A(g, d, c);
  A(h, b, a);

  M(p[0], e, f);
  M(p[1], h, g);
  M(p[2], g, f);
  M(p[3], e, h);
}

function cswap(p, q, b) {
  var i;
  for (i = 0; i < 4; i++) {
    sel25519(p[i], q[i], b);
  }
}

function pack(r, p) {
  var tx = gf(), ty = gf(), zi = gf();
  inv25519(zi, p[2]);
  M(tx, p[0], zi);
  M(ty, p[1], zi);
  pack25519(r, ty);
  r[31] ^= par25519(tx) << 7;
}

function scalarmult(p, q, s) {
  var b, i;
  set25519(p[0], gf0);
  set25519(p[1], gf1);
  set25519(p[2], gf1);
  set25519(p[3], gf0);
  for (i = 255; i >= 0; --i) {
    b = (s[(i/8)|0] >> (i&7)) & 1;
    cswap(p, q, b);
    add(q, p);
    add(p, p);
    cswap(p, q, b);
  }
}

function scalarbase(p, s) {
  var q = [gf(), gf(), gf(), gf()];
  set25519(q[0], X);
  set25519(q[1], Y);
  set25519(q[2], gf1);
  M(q[3], X, Y);
  scalarmult(p, q, s);
}

function crypto_sign_keypair(pk, sk, seeded) {
  var d = new Uint8Array(64);
  var p = [gf(), gf(), gf(), gf()];
  var i;

  if (!seeded) randombytes(sk, 32);
  crypto_hash(d, sk, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  scalarbase(p, d);
  pack(pk, p);

  for (i = 0; i < 32; i++) sk[i+32] = pk[i];
  return 0;
}

var L = new Float64Array([0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10]);

function modL(r, x) {
  var carry, i, j, k;
  for (i = 63; i >= 32; --i) {
    carry = 0;
    for (j = i - 32, k = i - 12; j < k; ++j) {
      x[j] += carry - 16 * x[i] * L[j - (i - 32)];
      carry = Math.floor((x[j] + 128) / 256);
      x[j] -= carry * 256;
    }
    x[j] += carry;
    x[i] = 0;
  }
  carry = 0;
  for (j = 0; j < 32; j++) {
    x[j] += carry - (x[31] >> 4) * L[j];
    carry = x[j] >> 8;
    x[j] &= 255;
  }
  for (j = 0; j < 32; j++) x[j] -= carry * L[j];
  for (i = 0; i < 32; i++) {
    x[i+1] += x[i] >> 8;
    r[i] = x[i] & 255;
  }
}

function reduce(r) {
  var x = new Float64Array(64), i;
  for (i = 0; i < 64; i++) x[i] = r[i];
  for (i = 0; i < 64; i++) r[i] = 0;
  modL(r, x);
}

// Note: difference from C - smlen returned, not passed as argument.
function crypto_sign(sm, m, n, sk) {
  var d = new Uint8Array(64), h = new Uint8Array(64), r = new Uint8Array(64);
  var i, j, x = new Float64Array(64);
  var p = [gf(), gf(), gf(), gf()];

  crypto_hash(d, sk, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  var smlen = n + 64;
  for (i = 0; i < n; i++) sm[64 + i] = m[i];
  for (i = 0; i < 32; i++) sm[32 + i] = d[32 + i];

  crypto_hash(r, sm.subarray(32), n+32);
  reduce(r);
  scalarbase(p, r);
  pack(sm, p);

  for (i = 32; i < 64; i++) sm[i] = sk[i];
  crypto_hash(h, sm, n + 64);
  reduce(h);

  for (i = 0; i < 64; i++) x[i] = 0;
  for (i = 0; i < 32; i++) x[i] = r[i];
  for (i = 0; i < 32; i++) {
    for (j = 0; j < 32; j++) {
      x[i+j] += h[i] * d[j];
    }
  }

  modL(sm.subarray(32), x);
  return smlen;
}

function unpackneg(r, p) {
  var t = gf(), chk = gf(), num = gf(),
      den = gf(), den2 = gf(), den4 = gf(),
      den6 = gf();

  set25519(r[2], gf1);
  unpack25519(r[1], p);
  S(num, r[1]);
  M(den, num, D);
  Z(num, num, r[2]);
  A(den, r[2], den);

  S(den2, den);
  S(den4, den2);
  M(den6, den4, den2);
  M(t, den6, num);
  M(t, t, den);

  pow2523(t, t);
  M(t, t, num);
  M(t, t, den);
  M(t, t, den);
  M(r[0], t, den);

  S(chk, r[0]);
  M(chk, chk, den);
  if (neq25519(chk, num)) M(r[0], r[0], I);

  S(chk, r[0]);
  M(chk, chk, den);
  if (neq25519(chk, num)) return -1;

  if (par25519(r[0]) === (p[31]>>7)) Z(r[0], gf0, r[0]);

  M(r[3], r[0], r[1]);
  return 0;
}

function crypto_sign_open(m, sm, n, pk) {
  var i;
  var t = new Uint8Array(32), h = new Uint8Array(64);
  var p = [gf(), gf(), gf(), gf()],
      q = [gf(), gf(), gf(), gf()];

  if (n < 64) return -1;

  if (unpackneg(q, pk)) return -1;

  for (i = 0; i < n; i++) m[i] = sm[i];
  for (i = 0; i < 32; i++) m[i+32] = pk[i];
  crypto_hash(h, m, n);
  reduce(h);
  scalarmult(p, q, h);

  scalarbase(q, sm.subarray(32));
  add(p, q);
  pack(t, p);

  n -= 64;
  if (crypto_verify_32(sm, 0, t, 0)) {
    for (i = 0; i < n; i++) m[i] = 0;
    return -1;
  }

  for (i = 0; i < n; i++) m[i] = sm[i + 64];
  return n;
}

var crypto_secretbox_KEYBYTES = 32,
    crypto_secretbox_NONCEBYTES = 24,
    crypto_secretbox_ZEROBYTES = 32,
    crypto_secretbox_BOXZEROBYTES = 16,
    crypto_scalarmult_BYTES = 32,
    crypto_scalarmult_SCALARBYTES = 32,
    crypto_box_PUBLICKEYBYTES = 32,
    crypto_box_SECRETKEYBYTES = 32,
    crypto_box_BEFORENMBYTES = 32,
    crypto_box_NONCEBYTES = crypto_secretbox_NONCEBYTES,
    crypto_box_ZEROBYTES = crypto_secretbox_ZEROBYTES,
    crypto_box_BOXZEROBYTES = crypto_secretbox_BOXZEROBYTES,
    crypto_sign_BYTES = 64,
    crypto_sign_PUBLICKEYBYTES = 32,
    crypto_sign_SECRETKEYBYTES = 64,
    crypto_sign_SEEDBYTES = 32,
    crypto_hash_BYTES = 64;

nacl.lowlevel = {
  crypto_core_hsalsa20: crypto_core_hsalsa20,
  crypto_stream_xor: crypto_stream_xor,
  crypto_stream: crypto_stream,
  crypto_stream_salsa20_xor: crypto_stream_salsa20_xor,
  crypto_stream_salsa20: crypto_stream_salsa20,
  crypto_onetimeauth: crypto_onetimeauth,
  crypto_onetimeauth_verify: crypto_onetimeauth_verify,
  crypto_verify_16: crypto_verify_16,
  crypto_verify_32: crypto_verify_32,
  crypto_secretbox: crypto_secretbox,
  crypto_secretbox_open: crypto_secretbox_open,
  crypto_scalarmult: crypto_scalarmult,
  crypto_scalarmult_base: crypto_scalarmult_base,
  crypto_box_beforenm: crypto_box_beforenm,
  crypto_box_afternm: crypto_box_afternm,
  crypto_box: crypto_box,
  crypto_box_open: crypto_box_open,
  crypto_box_keypair: crypto_box_keypair,
  crypto_hash: crypto_hash,
  crypto_sign: crypto_sign,
  crypto_sign_keypair: crypto_sign_keypair,
  crypto_sign_open: crypto_sign_open,

  crypto_secretbox_KEYBYTES: crypto_secretbox_KEYBYTES,
  crypto_secretbox_NONCEBYTES: crypto_secretbox_NONCEBYTES,
  crypto_secretbox_ZEROBYTES: crypto_secretbox_ZEROBYTES,
  crypto_secretbox_BOXZEROBYTES: crypto_secretbox_BOXZEROBYTES,
  crypto_scalarmult_BYTES: crypto_scalarmult_BYTES,
  crypto_scalarmult_SCALARBYTES: crypto_scalarmult_SCALARBYTES,
  crypto_box_PUBLICKEYBYTES: crypto_box_PUBLICKEYBYTES,
  crypto_box_SECRETKEYBYTES: crypto_box_SECRETKEYBYTES,
  crypto_box_BEFORENMBYTES: crypto_box_BEFORENMBYTES,
  crypto_box_NONCEBYTES: crypto_box_NONCEBYTES,
  crypto_box_ZEROBYTES: crypto_box_ZEROBYTES,
  crypto_box_BOXZEROBYTES: crypto_box_BOXZEROBYTES,
  crypto_sign_BYTES: crypto_sign_BYTES,
  crypto_sign_PUBLICKEYBYTES: crypto_sign_PUBLICKEYBYTES,
  crypto_sign_SECRETKEYBYTES: crypto_sign_SECRETKEYBYTES,
  crypto_sign_SEEDBYTES: crypto_sign_SEEDBYTES,
  crypto_hash_BYTES: crypto_hash_BYTES,

  gf: gf,
  D: D,
  L: L,
  pack25519: pack25519,
  unpack25519: unpack25519,
  M: M,
  A: A,
  S: S,
  Z: Z,
  pow2523: pow2523,
  add: add,
  set25519: set25519,
  modL: modL,
  scalarmult: scalarmult,
  scalarbase: scalarbase,
};

/* High-level API */

function checkLengths(k, n) {
  if (k.length !== crypto_secretbox_KEYBYTES) throw new Error('bad key size');
  if (n.length !== crypto_secretbox_NONCEBYTES) throw new Error('bad nonce size');
}

function checkBoxLengths(pk, sk) {
  if (pk.length !== crypto_box_PUBLICKEYBYTES) throw new Error('bad public key size');
  if (sk.length !== crypto_box_SECRETKEYBYTES) throw new Error('bad secret key size');
}

function checkArrayTypes() {
  for (var i = 0; i < arguments.length; i++) {
    if (!(arguments[i] instanceof Uint8Array))
      throw new TypeError('unexpected type, use Uint8Array');
  }
}

function cleanup(arr) {
  for (var i = 0; i < arr.length; i++) arr[i] = 0;
}

nacl.randomBytes = function(n) {
  var b = new Uint8Array(n);
  randombytes(b, n);
  return b;
};

nacl.secretbox = function(msg, nonce, key) {
  checkArrayTypes(msg, nonce, key);
  checkLengths(key, nonce);
  var m = new Uint8Array(crypto_secretbox_ZEROBYTES + msg.length);
  var c = new Uint8Array(m.length);
  for (var i = 0; i < msg.length; i++) m[i+crypto_secretbox_ZEROBYTES] = msg[i];
  crypto_secretbox(c, m, m.length, nonce, key);
  return c.subarray(crypto_secretbox_BOXZEROBYTES);
};

nacl.secretbox.open = function(box, nonce, key) {
  checkArrayTypes(box, nonce, key);
  checkLengths(key, nonce);
  var c = new Uint8Array(crypto_secretbox_BOXZEROBYTES + box.length);
  var m = new Uint8Array(c.length);
  for (var i = 0; i < box.length; i++) c[i+crypto_secretbox_BOXZEROBYTES] = box[i];
  if (c.length < 32) return null;
  if (crypto_secretbox_open(m, c, c.length, nonce, key) !== 0) return null;
  return m.subarray(crypto_secretbox_ZEROBYTES);
};

nacl.secretbox.keyLength = crypto_secretbox_KEYBYTES;
nacl.secretbox.nonceLength = crypto_secretbox_NONCEBYTES;
nacl.secretbox.overheadLength = crypto_secretbox_BOXZEROBYTES;

nacl.scalarMult = function(n, p) {
  checkArrayTypes(n, p);
  if (n.length !== crypto_scalarmult_SCALARBYTES) throw new Error('bad n size');
  if (p.length !== crypto_scalarmult_BYTES) throw new Error('bad p size');
  var q = new Uint8Array(crypto_scalarmult_BYTES);
  crypto_scalarmult(q, n, p);
  return q;
};

nacl.scalarMult.base = function(n) {
  checkArrayTypes(n);
  if (n.length !== crypto_scalarmult_SCALARBYTES) throw new Error('bad n size');
  var q = new Uint8Array(crypto_scalarmult_BYTES);
  crypto_scalarmult_base(q, n);
  return q;
};

nacl.scalarMult.scalarLength = crypto_scalarmult_SCALARBYTES;
nacl.scalarMult.groupElementLength = crypto_scalarmult_BYTES;

nacl.box = function(msg, nonce, publicKey, secretKey) {
  var k = nacl.box.before(publicKey, secretKey);
  return nacl.secretbox(msg, nonce, k);
};

nacl.box.before = function(publicKey, secretKey) {
  checkArrayTypes(publicKey, secretKey);
  checkBoxLengths(publicKey, secretKey);
  var k = new Uint8Array(crypto_box_BEFORENMBYTES);
  crypto_box_beforenm(k, publicKey, secretKey);
  return k;
};

nacl.box.after = nacl.secretbox;

nacl.box.open = function(msg, nonce, publicKey, secretKey) {
  var k = nacl.box.before(publicKey, secretKey);
  return nacl.secretbox.open(msg, nonce, k);
};

nacl.box.open.after = nacl.secretbox.open;

nacl.box.keyPair = function() {
  var pk = new Uint8Array(crypto_box_PUBLICKEYBYTES);
  var sk = new Uint8Array(crypto_box_SECRETKEYBYTES);
  crypto_box_keypair(pk, sk);
  return {publicKey: pk, secretKey: sk};
};

nacl.box.keyPair.fromSecretKey = function(secretKey) {
  checkArrayTypes(secretKey);
  if (secretKey.length !== crypto_box_SECRETKEYBYTES)
    throw new Error('bad secret key size');
  var pk = new Uint8Array(crypto_box_PUBLICKEYBYTES);
  crypto_scalarmult_base(pk, secretKey);
  return {publicKey: pk, secretKey: new Uint8Array(secretKey)};
};

nacl.box.publicKeyLength = crypto_box_PUBLICKEYBYTES;
nacl.box.secretKeyLength = crypto_box_SECRETKEYBYTES;
nacl.box.sharedKeyLength = crypto_box_BEFORENMBYTES;
nacl.box.nonceLength = crypto_box_NONCEBYTES;
nacl.box.overheadLength = nacl.secretbox.overheadLength;

nacl.sign = function(msg, secretKey) {
  checkArrayTypes(msg, secretKey);
  if (secretKey.length !== crypto_sign_SECRETKEYBYTES)
    throw new Error('bad secret key size');
  var signedMsg = new Uint8Array(crypto_sign_BYTES+msg.length);
  crypto_sign(signedMsg, msg, msg.length, secretKey);
  return signedMsg;
};

nacl.sign.open = function(signedMsg, publicKey) {
  checkArrayTypes(signedMsg, publicKey);
  if (publicKey.length !== crypto_sign_PUBLICKEYBYTES)
    throw new Error('bad public key size');
  var tmp = new Uint8Array(signedMsg.length);
  var mlen = crypto_sign_open(tmp, signedMsg, signedMsg.length, publicKey);
  if (mlen < 0) return null;
  var m = new Uint8Array(mlen);
  for (var i = 0; i < m.length; i++) m[i] = tmp[i];
  return m;
};

nacl.sign.detached = function(msg, secretKey) {
  var signedMsg = nacl.sign(msg, secretKey);
  var sig = new Uint8Array(crypto_sign_BYTES);
  for (var i = 0; i < sig.length; i++) sig[i] = signedMsg[i];
  return sig;
};

nacl.sign.detached.verify = function(msg, sig, publicKey) {
  checkArrayTypes(msg, sig, publicKey);
  if (sig.length !== crypto_sign_BYTES)
    throw new Error('bad signature size');
  if (publicKey.length !== crypto_sign_PUBLICKEYBYTES)
    throw new Error('bad public key size');
  var sm = new Uint8Array(crypto_sign_BYTES + msg.length);
  var m = new Uint8Array(crypto_sign_BYTES + msg.length);
  var i;
  for (i = 0; i < crypto_sign_BYTES; i++) sm[i] = sig[i];
  for (i = 0; i < msg.length; i++) sm[i+crypto_sign_BYTES] = msg[i];
  return (crypto_sign_open(m, sm, sm.length, publicKey) >= 0);
};

nacl.sign.keyPair = function() {
  var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  var sk = new Uint8Array(crypto_sign_SECRETKEYBYTES);
  crypto_sign_keypair(pk, sk);
  return {publicKey: pk, secretKey: sk};
};

nacl.sign.keyPair.fromSecretKey = function(secretKey) {
  checkArrayTypes(secretKey);
  if (secretKey.length !== crypto_sign_SECRETKEYBYTES)
    throw new Error('bad secret key size');
  var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  for (var i = 0; i < pk.length; i++) pk[i] = secretKey[32+i];
  return {publicKey: pk, secretKey: new Uint8Array(secretKey)};
};

nacl.sign.keyPair.fromSeed = function(seed) {
  checkArrayTypes(seed);
  if (seed.length !== crypto_sign_SEEDBYTES)
    throw new Error('bad seed size');
  var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  var sk = new Uint8Array(crypto_sign_SECRETKEYBYTES);
  for (var i = 0; i < 32; i++) sk[i] = seed[i];
  crypto_sign_keypair(pk, sk, true);
  return {publicKey: pk, secretKey: sk};
};

nacl.sign.publicKeyLength = crypto_sign_PUBLICKEYBYTES;
nacl.sign.secretKeyLength = crypto_sign_SECRETKEYBYTES;
nacl.sign.seedLength = crypto_sign_SEEDBYTES;
nacl.sign.signatureLength = crypto_sign_BYTES;

nacl.hash = function(msg) {
  checkArrayTypes(msg);
  var h = new Uint8Array(crypto_hash_BYTES);
  crypto_hash(h, msg, msg.length);
  return h;
};

nacl.hash.hashLength = crypto_hash_BYTES;

nacl.verify = function(x, y) {
  checkArrayTypes(x, y);
  // Zero length arguments are considered not equal.
  if (x.length === 0 || y.length === 0) return false;
  if (x.length !== y.length) return false;
  return (vn(x, 0, y, 0, x.length) === 0) ? true : false;
};

function ed25519Verify(msgBytes, sigBytes, pubkeyBytes) {
  return nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
}

    return {
      sortedStringify: sortedStringify,
      ed25519Verify: ed25519Verify,
      b64uToBytes: b64uToBytes,
      asciiToBytes: asciiToBytes,
    };

    function sortedStringify(obj) {
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        return JSON.stringify(obj);
      }
      var sorted = {};
      Object.keys(obj).sort().forEach(function(k) { sorted[k] = obj[k]; });
      return '{' + Object.keys(sorted).map(function(k) {
        return JSON.stringify(k) + ':' + sortedStringify(sorted[k]);
      }).join(',') + '}';
    }

    function b64uToBytes(b64uStr) {
      var b64 = b64uStr.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      var bytes = [];
      var buffer = 0, bits = 0;
      for (var i = 0; i < b64.length; i++) {
        var c = b64[i];
        if (c === '=') break;
        var val = chars.indexOf(c);
        if (val === -1) continue;
        buffer = (buffer << 6) | val;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          bytes.push((buffer >> bits) & 0xff);
        }
      }
      return new Uint8Array(bytes);
    }

    function asciiToBytes(s) {
      var out = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
      return out;
    }
  })();

  const body = $apis.requestInfo(c).data;
  const { tx, tx_hash, buyer_sig, buyer_public_key, purpose, skip_ledger } = body;

  if (!tx || !tx_hash || !buyer_sig || !buyer_public_key) {
    return c.json(400, { ok: false, error: "MISSING_FIELD" });
  }
  if (!/^[0-9a-f]{64}$/.test(tx_hash)) {
    return c.json(400, { ok: false, error: "INVALID_SIGNATURE", detail: "tx_hash 형식 오류" });
  }

  const { input, outputs } = tx;
  const { owner_guid, prev_settle_hash, balance_claimed } = input;

  // ── 2026-07-07 신설(제주 L1~L3 필드 테스트): 크로스-L1 브릿지 ──────────
  // Worker가 §4 레지스트리(L3의 guid_home_l1)로 판매자 소속 L1을 미리
  // 조회해 seller_home_node로 넘겨준다. 이 L1(자기 자신)과 다르면, 판매자
  // 몫 output의 recipient_guid를 sentinel("bridge-out:{target}")로 바꿔
  // 로컬 총량 보존식(발행==잔액합, sentinel도 guid 취급)을 그대로 유지한
  // 채, 실제 판매자 크레딧은 bridge_out 레코드를 통해 대상 L1으로 넘긴다
  // (jeju-l1-l3-field-test-plan-2026-07-07.md §5 참고).
  const { seller_home_node } = body;

  // 2단계: 공개키 확인
  let keyRecord = null;
  try {
    const allKeys = $app.dao().findRecordsByFilter("gdc_keys", "public_key != ''", "", 1000, 0);
    keyRecord = allKeys.find(r => r.getString("public_key") === buyer_public_key) || null;
  } catch(e) { console.log("[TX] 2단계 예외:", e.message); }
  if (!keyRecord) return c.json(403, { ok: false, error: "UNREGISTERED_KEY" });

  // 2026-07-19: 서명 검증 유틸(_sigVerify)을 파일 최상단 모듈 스코프로
  // 승격했었다 — 원래 이 콜백 안에서만 쓰던 지역변수였는데, 그렇게 두면
  // 다른 훅(onRecordBeforeUpdateRequest 등)에서 재사용하려 할 때마다
  // 1,200줄짜리 TweetNaCl 포트를 통째로 복붙해야 한다는 이유였다.
  // [2026-09-06 정정] 그 승격은 실제로는 동작하지 않았다 — 실사용
  // 이체(register-key→mint→transfer 전체 플로우)가 서명 검증 단계까지
  // 처음 도달한 게 이번이 처음이라 여태 발견 못 했을 뿐, 운영 환경
  // (PocketBase Goja)에서 이 콜백 안에서 전역 _sigVerify를 참조하면
  // "_sigVerify is not defined" ReferenceError가 난다 — computeBalance/
  // MINT_SECRET/NODE_CONFIG/sha256hex와 같은 부류의 "콜백 바깥 최상위
  // 선언이 콜백 안에서 안 보임" Goja 제약으로 추정된다(정확한 내부
  // 메커니즘은 미확인). 그래서 바로 위에 이 콜백 전용 지역 _sigVerify를
  // 다시 선언해 둔 상태다(복붙 재발이지만, 지금은 "동작하는 코드"가
  // "이론상 우아한데 실제로는 깨지는 코드"보다 우선이다). 파일 최상단의
  // 전역 _sigVerify(line 10)는 다른 훅(3642번째 줄 부근)이 아직 쓰고
  // 있으니 지우지 않았다 — 그 훅도 같은 버그를 잠재적으로 안고 있을
  // 가능성이 높으니(아직 미확인) 실사용 시 여기와 동일하게 콜백 내부
  // 지역 선언으로 바꿀 것. _balanceUtils(3418번째 줄 부근)도 동일 위험.

  var expectedTxHash = sha256hex(_sigVerify.sortedStringify(tx));
  if (expectedTxHash !== tx_hash) {
    console.log("[TX] TX_HASH_MISMATCH — 클라 주장:", tx_hash.slice(0,8), "실제:", expectedTxHash.slice(0,8));
    return c.json(400, { ok: false, error: "TX_HASH_MISMATCH", detail: "tx 내용과 tx_hash가 일치하지 않습니다" });
  }

  var sigValid = false;
  try {
    var pubBytes = _sigVerify.b64uToBytes(buyer_public_key);
    var sigBytes = _sigVerify.b64uToBytes(buyer_sig);
    if (pubBytes.length !== 32 || sigBytes.length !== 64) {
      return c.json(401, { ok: false, error: "INVALID_SIGNATURE", detail: "키/서명 길이 오류" });
    }
    sigValid = _sigVerify.ed25519Verify(_sigVerify.asciiToBytes(tx_hash), sigBytes, pubBytes);
  } catch (e) {
    console.log("[TX] 서명 검증 예외:", e.message);
    return c.json(401, { ok: false, error: "INVALID_SIGNATURE", detail: e.message });
  }
  if (!sigValid) {
    console.log("[TX] INVALID_SIGNATURE — 서명 검증 실패:", owner_guid);
    return c.json(401, { ok: false, error: "INVALID_SIGNATURE" });
  }
  console.log("[TX] 서명 암호학적 검증 통과");

  // 3단계: 블록 조회
  // (2026-07-14: buyer_guid만으로 필터링하던 걸 block_type==="tx_2party"로
  //  한정했다 — /api/ai-charge 신설로 buyer_guid가 실사용자 guid인
  //  "ai_usage_charge" 타입 블록이 생기기 시작했는데, 이 블록들은 P2P
  //  정산 체인(prev_settle_hash 연쇄)과 무관한 별도 계열이다. 한정하지
  //  않으면 AI 사용량 차감이 P2P 거래보다 늦게(혹은 먼저) 일어났을 때
  //  이 STALE_STATE 판정이 AI 차감 블록을 "직전 정산"으로 오인해, 클라
  //  이언트가 실제로는 최신인 prev_settle_hash를 보내도 거부당하는
  //  회귀가 생긴다. 같은 이유로 아래 /api/balance의 동일 필터도 함께
  //  고쳤다 — SP-GDC-BILLING-v2_0 STEP 0/3 파이프라인 연결 작업.)
  let latestBlock = null;
  try {
    const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "-height", 1000, 0);
    const buyerBlocks = allBlocks.filter(r => r.getString("buyer_guid") === owner_guid && r.getString("block_type") === "tx_2party");
    if (buyerBlocks.length > 0) latestBlock = buyerBlocks[0];
  } catch(e) { console.log("[TX] 3단계 예외:", e.message); }

  if (latestBlock) {
    const expectedHash = latestBlock.getString("content_hash");
    if (!prev_settle_hash || prev_settle_hash !== expectedHash) {
      return c.json(409, { ok: false, error: "STALE_STATE" });
    }
    // 이중 지불 확인
    try {
      const allBlocksForDup = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 1000, 0);
      const dup = allBlocksForDup.find(r => r.getString("prev_settle_hash") === prev_settle_hash);
      if (dup) return c.json(409, { ok: false, error: "STALE_STATE", detail: "이중 지불 감지" });
    } catch(e) { /* 중복 없음 */ }
  }

  const totalOutput = outputs.reduce((sum, o) => sum + (o.amount || 0), 0);

  // 4단계: 잔액 확인 — 2026-07-07 수정. 이전엔 balance_claimed(클라이언트
  // 자체 신고값)만 outputs 합계와 비교했다 — 지갑이 뭘 보내든 그대로
  // 믿었다는 뜻이다(진짜 UTXO 검증이 아니었음). 이제 L1이 자기 원장
  // (blocks)을 재생해서 직접 잔액을 계산하고, 그 값으로만 판단한다.
  // computeBalance는 이 콜백 안에 선언한다 — 이 프로젝트의 PocketBase
  // Goja 엔진은 콜백 바깥의 전역 함수 선언을 조용히 무시하는 제약이
  // 있어(main.pb.js 기존 sha256hex도 같은 이유로 콜백 내부에 있다),
  // 최상위에 선언하면 실제로는 실행되지 않을 위험이 있다.
  function computeBalance(guid) {
    const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 10000, 0);
    let balance = 0;
    for (const b of allBlocks) {
      let blkOutputs;
      try { blkOutputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
      for (const o of blkOutputs) {
        if (o.recipient_guid === guid) balance += (o.amount || 0);   // 이 guid가 수취인
      }
      if (b.getString("buyer_guid") === guid) {
        const total = blkOutputs.reduce((s, o) => s + (o.amount || 0), 0);
        balance -= total;                                            // 이 guid가 지불자
      }
    }
    return balance;
  }

  // 이 노드가 43개 L1 중 어디인지 자기 인식(폴더명 기준) — 콜백 내부 선언
  // (Goja 콜백 바깥 최상위 선언 제약, 파일 상단 기존 주석 참고)
const NODE_CONFIG = {
  "hanlim": { id: "KR-JEJU-JEJU-HANLIM", layer: 1, port: 8091, parentUrl: "http://127.0.0.1:8092" },
  "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL", layer: 1, port: 8101, parentUrl: "http://127.0.0.1:8092" },
  "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON", layer: 1, port: 8102, parentUrl: "http://127.0.0.1:8092" },
  "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA", layer: 1, port: 8103, parentUrl: "http://127.0.0.1:8092" },
  "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG", layer: 1, port: 8104, parentUrl: "http://127.0.0.1:8092" },
  "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA", layer: 1, port: 8105, parentUrl: "http://127.0.0.1:8092" },
  "l1-udo": { id: "KR-JEJU-JEJU-UDO", layer: 1, port: 8106, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1", layer: 1, port: 8107, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2", layer: 1, port: 8108, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido1": { id: "KR-JEJU-JEJU-IDO1", layer: 1, port: 8109, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido2": { id: "KR-JEJU-JEJU-IDO2", layer: 1, port: 8110, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1", layer: 1, port: 8111, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2", layer: 1, port: 8112, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1", layer: 1, port: 8113, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2", layer: 1, port: 8114, parentUrl: "http://127.0.0.1:8092" },
  "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP", layer: 1, port: 8115, parentUrl: "http://127.0.0.1:8092" },
  "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK", layer: 1, port: 8116, parentUrl: "http://127.0.0.1:8092" },
  "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG", layer: 1, port: 8117, parentUrl: "http://127.0.0.1:8092" },
  "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE", layer: 1, port: 8118, parentUrl: "http://127.0.0.1:8092" },
  "l1-ara": { id: "KR-JEJU-JEJU-ARA", layer: 1, port: 8119, parentUrl: "http://127.0.0.1:8092" },
  "l1-ora": { id: "KR-JEJU-JEJU-ORA", layer: 1, port: 8120, parentUrl: "http://127.0.0.1:8092" },
  "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG", layer: 1, port: 8121, parentUrl: "http://127.0.0.1:8092" },
  "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG", layer: 1, port: 8122, parentUrl: "http://127.0.0.1:8092" },
  "l1-oedo": { id: "KR-JEJU-JEJU-OEDO", layer: 1, port: 8123, parentUrl: "http://127.0.0.1:8092" },
  "l1-iho": { id: "KR-JEJU-JEJU-IHO", layer: 1, port: 8124, parentUrl: "http://127.0.0.1:8092" },
  "l1-dodu": { id: "KR-JEJU-JEJU-DODU", layer: 1, port: 8125, parentUrl: "http://127.0.0.1:8092" },
  "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG", layer: 1, port: 8126, parentUrl: "http://127.0.0.1:8093" },
  "l1-namwon": { id: "KR-JEJU-SGP-NAMWON", layer: 1, port: 8127, parentUrl: "http://127.0.0.1:8093" },
  "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN", layer: 1, port: 8128, parentUrl: "http://127.0.0.1:8093" },
  "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK", layer: 1, port: 8129, parentUrl: "http://127.0.0.1:8093" },
  "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON", layer: 1, port: 8130, parentUrl: "http://127.0.0.1:8093" },
  "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN", layer: 1, port: 8131, parentUrl: "http://127.0.0.1:8093" },
  "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG", layer: 1, port: 8132, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP", layer: 1, port: 8133, parentUrl: "http://127.0.0.1:8093" },
  "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI", layer: 1, port: 8134, parentUrl: "http://127.0.0.1:8093" },
  "l1-hyodon": { id: "KR-JEJU-SGP-HYODON", layer: 1, port: 8135, parentUrl: "http://127.0.0.1:8093" },
  "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON", layer: 1, port: 8136, parentUrl: "http://127.0.0.1:8093" },
  "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG", layer: 1, port: 8137, parentUrl: "http://127.0.0.1:8093" },
  "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG", layer: 1, port: 8138, parentUrl: "http://127.0.0.1:8093" },
  "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN", layer: 1, port: 8139, parentUrl: "http://127.0.0.1:8093" },
  "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON", layer: 1, port: 8140, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN", layer: 1, port: 8141, parentUrl: "http://127.0.0.1:8093" },
  "l1-yerae": { id: "KR-JEJU-SGP-YERAE", layer: 1, port: 8142, parentUrl: "http://127.0.0.1:8093" },
  "l2-jeju": { id: "KR-JEJU-JEJU-SI", layer: 2, port: 8092, parentUrl: "http://127.0.0.1:8094" },
  "l2-seogwipo": { id: "KR-JEJU-SGP-SI", layer: 2, port: 8093, parentUrl: "http://127.0.0.1:8094" },
  "l3-jejudo": { id: "KR-JEJU", layer: 3, port: 8094, parentUrl: "http://127.0.0.1:8095" },
  "l4-kr": { id: "KR", layer: 4, port: 8095, parentUrl: "http://127.0.0.1:8096" },
  "l5-global": { id: "GLOBAL", layer: 5, port: 8096, parentUrl: null },
};
  const _selfFolder = $app.dataDir().split("/").pop();
  const _self = NODE_CONFIG[_selfFolder] || NODE_CONFIG["hanlim"];
  const NODE_ID_SELF = _self.id;

  const actualBalance = computeBalance(owner_guid);
  if (actualBalance < totalOutput) {
    return c.json(400, { ok: false, error: "INSUFFICIENT_BALANCE",
      detail: `실제 잔액 ${actualBalance} < 필요 ${totalOutput}` });
  }
  if (balance_claimed != null && Math.abs(balance_claimed - actualBalance) > 0.01) {
    // 신뢰하진 않지만, 클라이언트 로컬 상태가 실제 원장과 얼마나 어긋나
    // 있는지는 로그로 남겨둔다 — 재대사(reconcile) 기능을 붙일 때 근거자료.
    console.log(`[TX] 잔액 불일치(참고용, 차단 아님): claimed=${balance_claimed} actual=${actualBalance}`);
  }

  // 블록 생성
  const prevBlockHash = latestBlock ? latestBlock.getString("content_hash") : "GENESIS";
  const currentHeight = latestBlock ? (latestBlock.getFloat("height") + 1) : 1;
  // 2026-07-07 수정: seller_guid를 outputs[0](순서 가정)이 아니라, 청구권
  // 생성에도 쓰는 것과 동일한 방식(플랫폼이 아닌 첫 수취인)으로 통일한다.
  const sellerOutput = outputs.find(o => o.recipient_guid !== "gopang-platform");

  // ── 브릿지 판단: 판매자가 이 L1 소속이 아니면 sentinel로 리디렉션 ──────
  let bridgeTarget = null;
  let effectiveOutputs = outputs;
  if (seller_home_node && sellerOutput && seller_home_node !== NODE_ID_SELF) {
    bridgeTarget = seller_home_node;
    effectiveOutputs = outputs.map(o =>
      o === sellerOutput
        ? { recipient_guid: "bridge-out:" + seller_home_node, amount: o.amount }
        : o
    );
  }
  // sha256 계산
  function sha256hex(str) {
    // 2026-07-18 버그 수정: 이 함수는 charCodeAt()이 256 이상(한글 등 비ASCII
    // 문자)이면 조용히 빈 문자열을 반환했다 — 코드포인트를 UTF-8 멀티바이트로
    // 인코딩하지 않고 1바이트로 취급하던 게 원인. 실제 GDC 이체 item_name
    // 기본값("GDC 이체") 하나만으로도 재현됨(sortedStringify(tx)에 포함되어
    // tx_hash 서버측 재계산이 매번 ''가 되고, 클라이언트가 보낸 진짜
    // tx_hash와 항상 달라 TX_HASH_MISMATCH로 거부됨 — 한글 상품명이 있는
    // 모든 K-Market 구매가 이 서명 검증 도입과 함께 깨질 뻔했다). 먼저
    // 문자열을 UTF-8 바이트열(각 char가 0~255인 문자열)로 변환한 뒤 기존
    // 알고리즘에 그대로 넘긴다 — Node TextEncoder와 결과 동일함을 실측
    // 검증(ASCII/한글/이모지 서로게이트쌍/혼합 문자 전부 일치).
    str = (function(s) {
      var o = '';
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 0x80) {
          o += String.fromCharCode(c);
        } else if (c < 0x800) {
          o += String.fromCharCode(0xc0 | (c >> 6));
          o += String.fromCharCode(0x80 | (c & 0x3f));
        } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
          var c2 = s.charCodeAt(i + 1);
          if (c2 >= 0xdc00 && c2 <= 0xdfff) {
            var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
            o += String.fromCharCode(0xf0 | (cp >> 18));
            o += String.fromCharCode(0x80 | ((cp >> 12) & 0x3f));
            o += String.fromCharCode(0x80 | ((cp >> 6) & 0x3f));
            o += String.fromCharCode(0x80 | (cp & 0x3f));
            i++;
            continue;
          }
          o += String.fromCharCode(0xef, 0xbf, 0xbd);
        } else {
          o += String.fromCharCode(0xe0 | (c >> 12));
          o += String.fromCharCode(0x80 | ((c >> 6) & 0x3f));
          o += String.fromCharCode(0x80 | (c & 0x3f));
        }
      }
      return o;
    })(str);
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let result = '';
    const words = [];
    const asciiBitLength = str.length * 8;
    let hash = [], k = [];
    let primeCounter = 0;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
      }
    }
    let s = str + '\x80';
    while (s.length % 64 - 56) s += '\x00';
    for (let i = 0; i < s.length; i++) {
      const j = s.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength | 0);
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const oldHash = hash.slice(0);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i-15], w2 = w[i-2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            w[i-16]
            + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3))
            + w[i-7]
            + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10))
          ) | 0);
        const temp2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1+temp2)|0].concat(hash);
        hash[4] = (hash[4]+temp1)|0;
        hash.length = 8;
      }
      hash = hash.map((v,i) => (v+oldHash[i])|0);
    }
    hash.forEach(val => {
      for (let i = 3; i+1; i--) {
        const byte = (val>>(i*8))&255;
        result += ((byte<16)?'0':'') + byte.toString(16);
      }
    });
    return result;
  }
  const contentHash = sha256hex(tx_hash + buyer_sig + prevBlockHash + Date.now().toString());
  console.log("[TX] sha256 완료:", contentHash.slice(0,8));

  let blockRecord;
  try {
    const col = $app.dao().findCollectionByNameOrId("blocks");
    blockRecord = new Record(col);
    blockRecord.set("block_type",       "tx_2party");
    blockRecord.set("tx_hash",          tx_hash);
    blockRecord.set("buyer_guid",       owner_guid);
    blockRecord.set("seller_guid",      sellerOutput ? sellerOutput.recipient_guid : "");
    blockRecord.set("buyer_sig",        buyer_sig);
    blockRecord.set("outputs",          JSON.stringify(effectiveOutputs));
    blockRecord.set("prev_block_hash",  prevBlockHash);
    blockRecord.set("content_hash",     contentHash);
    blockRecord.set("height",           currentHeight);
    blockRecord.set("prev_settle_hash", prev_settle_hash || "");
    $app.dao().saveRecord(blockRecord);
    console.log("[TX] 블록 저장 완료");
  } catch(e) {
    console.log("[TX] BLOCK_SAVE_FAILED:", e.message);
    return c.json(500, { ok: false, error: "BLOCK_SAVE_FAILED", detail: e.message });
  }

  // ── 브릿지 아웃박스 기록 — outbox 패턴(§5). Worker가 이 레코드를 폴링해
  // 대상 L1의 /api/bridge-in을 호출하고, 성공 시 /api/bridge-out/complete로
  // 되돌려 status를 갱신한다. L1은 다른 L1을 직접 호출하지 않는다(P1).
  if (bridgeTarget) {
    try {
      const boCol = $app.dao().findCollectionByNameOrId("bridge_out");
      const boRec = new Record(boCol);
      boRec.set("tx_hash",     tx_hash);
      boRec.set("target_node", bridgeTarget);
      boRec.set("guid",        sellerOutput.recipient_guid);
      boRec.set("amount",      sellerOutput.amount);
      boRec.set("status",      "pending");
      boRec.set("created_at",  new Date().toISOString());
      $app.dao().saveRecord(boRec);
      console.log("[TX] bridge_out 기록 완료 →", bridgeTarget);
    } catch(e) { console.log("[TX] bridge_out 기록 실패(치명적, 감사 필요):", e.message); }
  }

  const blockId   = blockRecord.getId();
  const blockHash = contentHash;

  // 청구권 생성 (sellerOutput은 위에서 이미 계산됨)
  const buyerClaim = {
    claim_id:   sha256hex("buyer-" + tx_hash + blockId).substring(0, 32),
    tx_id:      tx_hash,
    claimant:   owner_guid,
    // [2026-07-21 신설 — 사고실험 시나리오5에서 발견] counterpart가 없으면
    // fraud.js의 buildTxGraph가 이 행을 그래프 엣지로 못 쓰고 건너뛴다 —
    // 에스크로/PG를 거치지 않은 순수 P2P GDC 송금이 순환거래 탐지에서
    // 통째로 빠져있었다.
    counterpart: sellerOutput ? sellerOutput.recipient_guid : null,
    direction:  "debit",
    amount:     totalOutput,
    // 2026-07-07 수정: "bs-cash"였던 걸 "pl-purchase"로 고친다.
    // gopang-wallet.js의 redeemClaim()은 fs_account==='pl-purchase'일
    // 때만 pl-purchase(누적 지출)와 bs-cash(실잔액) 둘 다 갱신한다 —
    // "bs-cash"로 오면 bs-cash만 깎이고 pl-purchase는 영영 안 늘어난다.
    // 지금까지는 Worker가 이 claim을 무시하고 자체 생성한(올바른 값의)
    // claim을 썼어서 이 결함이 가려져 있었는데, 이제 Worker가 L1의
    // claim을 그대로 신뢰하므로 여기서 고쳐야 한다.
    fs_account: "pl-purchase",
    balance_after: actualBalance - totalOutput,
    block_id:   blockId,
    block_hash: blockHash,
    issued_by:  NODE_ID_SELF,
    expires_at: new Date(Date.now() + 72*60*60*1000).toISOString()
  };
  const sellerClaim = sellerOutput ? {
    claim_id:   sha256hex("seller-" + tx_hash + blockId).substring(0, 32),
    tx_id:      tx_hash,
    claimant:   sellerOutput.recipient_guid,
    counterpart: owner_guid,
    direction:  "credit",
    amount:     sellerOutput.amount,
    fs_account: "pl-revenue",
    // computeBalance는 블록 저장 후에 호출되므로(위 saveRecord 참고) 이번
    // 거래의 대변 반영분이 이미 재생 결과에 포함돼 있다 — 여기 또 더하면
    // 이중계산이라 그대로 쓴다. 단, 브릿지 중이면 판매자가 이 L1 소속이
    // 아니므로 로컬 잔액은 의미가 없다(항상 0) — null로 명시한다.
    balance_after: bridgeTarget ? null : computeBalance(sellerOutput.recipient_guid),
    block_id:   blockId,
    block_hash: blockHash,
    issued_by:  NODE_ID_SELF,
    expires_at: new Date(Date.now() + 72*60*60*1000).toISOString()
  } : null;
  console.log("[TX] 청구권 생성 완료");

  // ── 2026-07-18 신설, 2026-07-21 통합 — 재무제표 원장(ledger_entries) 기록 ──
  // buyerClaim/sellerClaim은 이미 회계 관점(차변/대변, 계정과목)으로
  // 계산돼 있다 — 이걸 그대로 영구 기록으로 남긴다(claim은 72시간 후
  // 만료되는 임시 청구권이라 재무제표 대사에는 못 쓴다). 이 기록이
  // 실패해도 이미 완료된 정산(blocks 저장) 자체는 되돌리지 않는다 —
  // 회계 부기는 보조 장부이지, 정산의 전제조건이 아니다.
  //
  // [2026-07-21 통합] 원장(fs) 관련 쓰기는 market-proxy가 전담하도록 변경—
  // 내부 dao().saveRecord() 직접 호출은 (1) fs_ledger.pb.js의 해시체인 훅을
  // 건너뛰고(entry_hash/seq 미계산, 2026-07-21 로컬 재현으로 실증) (2) 이
  // 노드와 market-proxy가 같은 guid에 동시에 쓸 때 경합 소지가 있었다.
  // market-proxy의 LedgerWriter DO(guid 단위 직렬화)를 거치도록 HTTP 호출로
  // 대체한다. 공유 시크릿은 body 필드로 전달(BRIDGE_SECRET과 동일 관례).
  // [2026-07-21 수정 — 사고실험 시나리오1 이중기장 발견] skip_ledger=true면
  // 이 자동 기장을 건너뛴다. EscrowSigner처럼 호출자가 자기만의 정확한 원장
  // 구조(3행 buyer/seller/platform)를 별도로 이미 기록하는 경우, 여기서
  // owner_guid(에스크로의 경우 'gopang-escrow' 시스템 계정 — 실제 구매자가
  // 아님) 기준으로 또 자동 기록하면 판매자 크레딧이 중복되고 구매자가
  // 잘못된 주체로 기록된다(실제 재현·확인됨).
  if (skip_ledger) {
    console.log("[TX] ledger_entries 자동 기록 건너뜀(skip_ledger=true, 호출자가 별도 기록)");
  } else {
  try {
    const source = purpose ? "gdc_transfer" : "market"; // handleGdcTransfer가 purpose를 실어 보낸다
    const marketProxyUrl = $os.getenv("MARKET_PROXY_URL");
    const ledgerWriteSecret = $os.getenv("LEDGER_WRITE_SECRET");

    const sendLedgerEntry = (claim) => {
      const res = $http.send({
        url: marketProxyUrl + "/internal/ledger-entries",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          l1_node: NODE_ID_SELF,
          guid: claim.claimant,
          direction: claim.direction,
          amount: claim.amount,
          fs_account: claim.fs_account,
          counterpart: claim.counterpart,
          source,
          block_hash: blockHash,
          tx_id: tx_hash,
          ledger_write_secret: ledgerWriteSecret,
        }),
      });
      // [2026-07-21 수정] $http.send()는 4xx/5xx여도 예외를 안 던진다 —
      // 반드시 statusCode를 직접 확인해야 한다(안 하면 실패해도
      // "기록 요청 완료" 로그가 찍히는 거짓 성공 상태가 됨, 실제 재현됨).
      if (res.statusCode !== 200) {
        console.log("[TX] ledger_entries 기록 실패(market-proxy 응답",
          res.statusCode, "):", res.raw);
      }
    };

    sendLedgerEntry(buyerClaim);
    if (sellerClaim) sendLedgerEntry(sellerClaim);
    console.log("[TX] ledger_entries 기록 요청 완료(market-proxy)");
  } catch (e) {
    // 의도적으로 응답 실패로 이어지지 않게 한다 — 위 주석 참고.
    console.log("[TX] ledger_entries 기록 실패(감사 필요, 정산 자체는 정상):", e.message);
  }
  } // skip_ledger 분기 종료

  // l1_ledger 앵커링
  try {
    const ledgerCol = $app.dao().findCollectionByNameOrId("l1_ledger");
    const ledgerRec = new Record(ledgerCol);
    ledgerRec.set("tx_id",       tx_hash);
    ledgerRec.set("tx_type",     "tx_2party");
    ledgerRec.set("from_guid",   owner_guid);
    ledgerRec.set("leaf_hash",   blockHash);
    ledgerRec.set("signature",   buyer_sig);
    ledgerRec.set("pubkey",      buyer_public_key);
    ledgerRec.set("l1_node",     NODE_ID_SELF);
    ledgerRec.set("parent_root", "");
    $app.dao().saveRecord(ledgerRec);
    console.log("[TX] ledger 저장 완료");

    // Merkle 계산
    const allLedger = $app.dao().findRecordsByFilter("l1_ledger", "tx_id != ''", "-created", 10000, 0);
    let layer = allLedger.map(r => r.getString("leaf_hash")).filter(Boolean);
    while (layer.length > 1) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2)
        next.push($security.md5(layer[i] + (layer[i+1] || layer[i])));
      layer = next;
    }
    const merkleRoot = layer[0] || blockHash;
    console.log("[TX] Merkle 완료:", merkleRoot.slice(0,8));

    // L2 전파 — 상위 노드 URL도 자기 인식 결과(_self.parentUrl)로 동적화
    if (_self.parentUrl) {
      try {
        const resp = $http.send({
          url: _self.parentUrl + "/push_root",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ child_node: NODE_ID_SELF, child_root: merkleRoot }),
        });
        console.log("[TX] 상위 전파 완료");
      } catch(e) { console.log("[TX] 상위 전파 실패:", e.message); }
    }

  } catch(e) { console.log("[TX] 앵커링 실패:", e.message); }

  console.log("[TX] 최종 응답 반환");
  return c.json(200, {
    ok:          true,
    block_id:    blockId,
    block_hash:  blockHash,
    height:      currentHeight,
    buyer_claim: buyerClaim,
    seller_claim: sellerClaim,
    balance_after: actualBalance - totalOutput,
    bridge: bridgeTarget ? { target_node: bridgeTarget, status: "pending" } : null,
  });
  } catch (e) {
    // 임시 진단용 — 위 큰 주석 참고. 원인 파악 후 제거/축소할 것.
    console.log("[TX] UNCAUGHT_EXCEPTION:", e.message, "| stack:", e.stack);
    return c.json(500, { ok: false, error: "UNCAUGHT_EXCEPTION", detail: e.message, stack: e.stack });
  }
});

// ── 2026-07-07 신설: 초기 GDC 지급(개발 전용) ──────────────────────────
// Supabase gdc_deposit.sql이 하던 "발행" 역할의 L1 대응물. block_type을
// "deposit"으로 두고 buyer_guid를 비워서(지불자 없음), 수취인의 실제
// 구매 체인(prev_settle_hash 연쇄, buyer_guid 기준 조회)과 완전히
// 분리한다 — computeBalance는 block_type을 가리지 않고 outputs만
// 합산하므로 별도 로직 추가 없이 그대로 반영된다.
//
// ⚠️ 아래 MINT_SECRET은 실서비스 전환 전 반드시 제거하거나 진짜 인증(관리자
// 토큰 검증 등)으로 교체해야 한다 — 지금은 사용자가 없는 개발 단계라
// 임시로 공유 비밀 문자열 하나로만 막아둔다. (2026-07-07: 처음엔 이걸
// 최상위 const로 선언했다가 "MINT_SECRET is not defined" 예외를 만났다
// — computeBalance와 같은 이유(Goja가 콜백 바깥 최상위 선언을 실행 시점에
// 못 찾음)라, 아래처럼 콜백 안에 직접 넣는다.)

routerAdd("POST", "/api/mint", (c) => {
  // 2026-07-07 진단용 강화: 원인 미상의 400 "Something went wrong"을 잡기
  // 위해 핸들러 전체를 하나의 try/catch로 감싼다. PocketBase Goja 바인딩이
  // dao().saveRecord()의 스키마 검증 에러를 JS에서 못 잡는 경우가 있어
  // (이 프로젝트에 이미 알려진 "콜백 바깥 전역 함수 무시" 류의 다른
  // Goja 특이 동작과 비슷한 계열) — 원인을 찾을 때까지 이 형태로 둔다.
  //
  // 2026-07-07 추가: 발행 환율 공식화 — KRW 100원당 GDC 1T.
  // krw_amount(원화 입금액)를 정본 입력으로 받아 gdc_amount를 서버가
  // 직접 계산한다(클라이언트가 gdc_amount를 임의로 우기지 못하게).
  // 개발 초기 테스트에서 쓰던 amount(=GDC 직접 지정)는 하위호환으로
  // 남기되, 감사 추적을 위해 블록에 "어느 방식으로 발행했는지"와 환율을
  // 반드시 같이 남긴다 — 나중에 실거래 발행과 테스트 발행을 구분할 수
  // 있어야 한다.
  // (2026-07-23: 환율 1,000:1 → 100:1로 정정. deepseek v4 flash/pro
  //  실사용 원가 기준 시뮬레이션 결과, 1,000:1은 GDC 최소 단위가 지나치게
  //  커서 소액 차감의 정밀도가 떨어졌다 — 100:1로 낮춰 GDC 단위를
  //  세분화한다. 이 상수를 바꾸면 worker.js의 동일 이름 상수 3곳도
  //  반드시 함께 바꿀 것 — 파일 내 다른 곳의 주석 참고.)
  const EXCHANGE_RATE_KRW_PER_GDC = 1; // KRW 1 = GDC 1 (2026-07-27: 100→1 정정, 테스트 기간 한정 — 주피터 지시. worker.js 2곳도 함께 변경 필수)

  try {
    console.log("[MINT] 진입");
    const body = $apis.requestInfo(c).data;
    console.log("[MINT] body 파싱 완료:", JSON.stringify(body));
    const { guid, amount, krw_amount, secret, memo } = body;

    const MINT_SECRET = $os.getenv("MINT_SECRET"); // 2026-07-19: 하드코딩 제거, 환경변수로 이관(공개 저장소 노출 방지)
    if (secret !== MINT_SECRET) {
      console.log("[MINT] secret 불일치");
      return c.json(403, { ok: false, error: "FORBIDDEN" });
    }

    let gdcAmount, krwAmount, mintMethod;
    if (krw_amount != null) {
      if (!(Number(krw_amount) > 0)) {
        return c.json(400, { ok: false, error: "INVALID_AMOUNT", detail: "krw_amount는 0보다 커야 합니다" });
      }
      krwAmount  = Number(krw_amount);
      gdcAmount  = krwAmount / EXCHANGE_RATE_KRW_PER_GDC;
      mintMethod = "krw_exchange";
    } else if (amount != null) {
      // 하위호환(개발 테스트 전용) — GDC 금액을 직접 지정. 실거래 발행이
      // 아니라는 걸 블록에 명시해서 나중에 구분할 수 있게 한다.
      if (!(Number(amount) > 0)) {
        return c.json(400, { ok: false, error: "MISSING_FIELD", detail: "guid, amount(>0) 필수" });
      }
      gdcAmount  = Number(amount);
      krwAmount  = null;
      mintMethod = "dev_direct";
    } else {
      return c.json(400, { ok: false, error: "MISSING_FIELD", detail: "krw_amount 또는 amount(하위호환) 필수" });
    }
    if (!guid) {
      return c.json(400, { ok: false, error: "MISSING_FIELD", detail: "guid 필수" });
    }
    console.log("[MINT] 검증 통과, guid:", guid, "gdc:", gdcAmount, "krw:", krwAmount, "method:", mintMethod);

    function sha256hex(str) {
      // 2026-07-18 버그 수정: 이 함수는 charCodeAt()이 256 이상(한글 등 비ASCII
      // 문자)이면 조용히 빈 문자열을 반환했다 — 코드포인트를 UTF-8 멀티바이트로
      // 인코딩하지 않고 1바이트로 취급하던 게 원인. 실제 GDC 이체 item_name
      // 기본값("GDC 이체") 하나만으로도 재현됨(sortedStringify(tx)에 포함되어
      // tx_hash 서버측 재계산이 매번 ''가 되고, 클라이언트가 보낸 진짜
      // tx_hash와 항상 달라 TX_HASH_MISMATCH로 거부됨 — 한글 상품명이 있는
      // 모든 K-Market 구매가 이 서명 검증 도입과 함께 깨질 뻔했다). 먼저
      // 문자열을 UTF-8 바이트열(각 char가 0~255인 문자열)로 변환한 뒤 기존
      // 알고리즘에 그대로 넘긴다 — Node TextEncoder와 결과 동일함을 실측
      // 검증(ASCII/한글/이모지 서로게이트쌍/혼합 문자 전부 일치).
      str = (function(s) {
        var o = '';
        for (var i = 0; i < s.length; i++) {
          var c = s.charCodeAt(i);
          if (c < 0x80) {
            o += String.fromCharCode(c);
          } else if (c < 0x800) {
            o += String.fromCharCode(0xc0 | (c >> 6));
            o += String.fromCharCode(0x80 | (c & 0x3f));
          } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
            var c2 = s.charCodeAt(i + 1);
            if (c2 >= 0xdc00 && c2 <= 0xdfff) {
              var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
              o += String.fromCharCode(0xf0 | (cp >> 18));
              o += String.fromCharCode(0x80 | ((cp >> 12) & 0x3f));
              o += String.fromCharCode(0x80 | ((cp >> 6) & 0x3f));
              o += String.fromCharCode(0x80 | (cp & 0x3f));
              i++;
              continue;
            }
            o += String.fromCharCode(0xef, 0xbf, 0xbd);
          } else {
            o += String.fromCharCode(0xe0 | (c >> 12));
            o += String.fromCharCode(0x80 | ((c >> 6) & 0x3f));
            o += String.fromCharCode(0x80 | (c & 0x3f));
          }
        }
        return o;
      })(str);
      const mathPow = Math.pow;
      const maxWord = mathPow(2, 32);
      let result = '';
      const words = [];
      const asciiBitLength = str.length * 8;
      let hash = [], k = [];
      let primeCounter = 0;
      const isComposite = {};
      for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
        }
      }
      let s = str + '\x80';
      while (s.length % 64 - 56) s += '\x00';
      for (let i = 0; i < s.length; i++) {
        const j = s.charCodeAt(i);
        if (j >> 8) return '';
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
      }
      words[words.length] = ((asciiBitLength / maxWord) | 0);
      words[words.length] = (asciiBitLength | 0);
      for (let j = 0; j < words.length;) {
        const w = words.slice(j, j += 16);
        const oldHash = hash.slice(0);
        for (let i = 0; i < 64; i++) {
          const w15 = w[i-15], w2 = w[i-2];
          const a = hash[0], e = hash[4];
          const temp1 = hash[7]
            + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7))
            + ((e & hash[5]) ^ (~e & hash[6]))
            + k[i]
            + (w[i] = (i < 16) ? w[i] : (
              w[i-16]
              + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3))
              + w[i-7]
              + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10))
            ) | 0);
          const temp2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1+temp2)|0].concat(hash);
          hash[4] = (hash[4]+temp1)|0;
          hash.length = 8;
        }
        hash = hash.map((v,i) => (v+oldHash[i])|0);
      }
      hash.forEach(val => {
        for (let i = 3; i+1; i--) {
          const byte = (val>>(i*8))&255;
          result += ((byte<16)?'0':'') + byte.toString(16);
        }
      });
      return result;
    }

    const contentHash = sha256hex("mint:" + guid + ":" + gdcAmount + ":" + Date.now());
    console.log("[MINT] contentHash:", contentHash, "| length:", contentHash.length);

    const col = $app.dao().findCollectionByNameOrId("blocks");
    console.log("[MINT] 컬렉션 조회 완료:", col ? col.id : "NULL");

    // 2026-07-07: krw_amount/exchange_rate/mint_method을 outputs 안에 같이
    // 남긴다 — blocks 스키마에 새 필드를 안 늘려도 되고(변경 최소화),
    // "발행 원장"이 블록 자체에 자기완결적으로 남는다(별도 감사 테이블 불요).
    const blockRecord = new Record(col);
    blockRecord.set("block_type",       "deposit");
    blockRecord.set("tx_hash",          contentHash);
    blockRecord.set("buyer_guid",       "gdc-mint");
    blockRecord.set("seller_guid",      guid);
    blockRecord.set("buyer_sig",        "");
    blockRecord.set("outputs", JSON.stringify([{
      recipient_guid: guid,
      amount: gdcAmount,
      krw_amount: krwAmount,
      exchange_rate: EXCHANGE_RATE_KRW_PER_GDC,
      mint_method: mintMethod,
    }]));
    blockRecord.set("prev_block_hash",  "");
    blockRecord.set("content_hash",     contentHash);
    blockRecord.set("height",           0);
    blockRecord.set("prev_settle_hash", "");
    console.log("[MINT] Record 필드 설정 완료, 저장 시도");

    $app.dao().saveRecord(blockRecord);
    console.log("[MINT] 저장 완료, id:", blockRecord.getId());

    // ── 2026-07-18 신설, 2026-07-21 통합 — 재무제표 원장(ledger_entries) 기록 (Phase 5
    // 발행잔액 추적의 전제). 발행(mint)은 수취인 입장에서 credit(bs-cash
    // 증가) — 대변 상대방이 "혼디(발행자)"라 복식부기 상대 계정은 만들지
    // 않는다(발행자 자신의 부채 계정을 추적하는 건 이번 범위 밖). 실패해도
    // 이미 완료된 발행(blockRecord 저장)은 되돌리지 않는다.
    //
    // [2026-07-21 통합] 원장(fs) 관련 쓰기는 market-proxy가 전담 — TX 핸들러와
    // 동일한 이유(해시체인 훅 우회, 경합 방지)로 HTTP 호출로 대체.
    // NODE_CONFIG/_self는 핸들러별 격리 컨텍스트라 이 핸들러에도 로컬로 재정의
    // (파일 내 기존 관례 — NODE_CONFIG가 핸들러마다 각각 정의되어 있음).
    try {
      const NODE_CONFIG = {
        "hanlim": { id: "KR-JEJU-JEJU-HANLIM" }, "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL" },
        "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON" }, "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA" },
        "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG" }, "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA" },
        "l1-udo": { id: "KR-JEJU-JEJU-UDO" }, "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1" },
        "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2" }, "l1-ido1": { id: "KR-JEJU-JEJU-IDO1" },
        "l1-ido2": { id: "KR-JEJU-JEJU-IDO2" }, "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1" },
        "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2" }, "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1" },
        "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2" }, "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP" },
        "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK" }, "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG" },
        "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE" }, "l1-ara": { id: "KR-JEJU-JEJU-ARA" },
        "l1-ora": { id: "KR-JEJU-JEJU-ORA" }, "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG" },
        "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG" }, "l1-oedo": { id: "KR-JEJU-JEJU-OEDO" },
        "l1-iho": { id: "KR-JEJU-JEJU-IHO" }, "l1-dodu": { id: "KR-JEJU-JEJU-DODU" },
        "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG" }, "l1-namwon": { id: "KR-JEJU-SGP-NAMWON" },
        "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN" }, "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK" },
        "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON" }, "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN" },
        "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG" }, "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP" },
        "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI" }, "l1-hyodon": { id: "KR-JEJU-SGP-HYODON" },
        "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON" }, "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG" },
        "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG" }, "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN" },
        "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON" }, "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN" },
        "l1-yerae": { id: "KR-JEJU-SGP-YERAE" }, "l2-jeju": { id: "KR-JEJU-JEJU-SI" },
        "l2-seogwipo": { id: "KR-JEJU-SGP-SI" }, "l3-jejudo": { id: "KR-JEJU" },
        "l4-kr": { id: "KR" }, "l5-global": { id: "GLOBAL" },
      };
      const _selfFolder = $app.dataDir().split("/").pop();
      const _self = NODE_CONFIG[_selfFolder] || NODE_CONFIG["hanlim"];

      const res = $http.send({
        url: $os.getenv("MARKET_PROXY_URL") + "/internal/ledger-entries",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          l1_node: _self.id,
          guid,
          direction: "credit",
          amount: gdcAmount,
          fs_account: "bs-cash",
          source: "mint",
          block_hash: contentHash,
          tx_id: contentHash,
          ledger_write_secret: $os.getenv("LEDGER_WRITE_SECRET"),
        }),
      });
      if (res.statusCode !== 200) {
        console.log("[MINT] ledger_entries 기록 실패(market-proxy 응답", res.statusCode, "):", res.raw);
      } else {
        console.log("[MINT] ledger_entries 기록 요청 완료(market-proxy)");
      }
    } catch (e) {
      console.log("[MINT] ledger_entries 기록 실패(감사 필요, 발행 자체는 정상):", e.message);
    }

    console.log("[MINT]", guid, "+" + gdcAmount + "T", "(krw:" + krwAmount + ")", memo ? "(" + memo + ")" : "");
    return c.json(200, {
      ok: true,
      block_id: blockRecord.getId(),
      content_hash: contentHash,
      guid,
      amount: gdcAmount,
      krw_amount: krwAmount,
      exchange_rate: EXCHANGE_RATE_KRW_PER_GDC,
    });
  } catch (e) {
    console.log("[MINT] 예외 발생:", e.message, "| stack:", e.stack || "(no stack)");
    return c.json(500, { ok: false, error: "MINT_EXCEPTION", detail: e.message || String(e) });
  }
});
// ── 2026-07-14 신설: AI 사용량 GDC 차감 (SP-GDC-BILLING-v2_0 STEP 0/3,
// TODO 1 최우선 항목 구현) ───────────────────────────────────────────
// worker.js가 가입자당 평생 100원 무료 한도(FREE_QUOTA_KRW_LIMIT)를 다
// 쓴 뒤, 실제 AI 사용량이 확정된 시점(_recordAiUsage의 onAfterRecord →
// _settleAiUsage)에 이 엔드포인트를 호출해 GDC 잔액에서 초과분만 정확히
// 차감한다.
//
// /api/mint와 동일하게 사용자 서명(buyer_sig) 없이 서버 공유 비밀
// (AI_CHARGE_SECRET)로만 인증한다 — 매 채팅 턴마다 사용자에게 서명을
// 요구하는 건 UX상 불가능하고(카드사가 매 결제마다 서명을 요구하지
// 않듯, 이미 가입 시점의 인증으로 신원이 확정된 뒤의 종량 청구다),
// worker.js가 이미 guid의 실제 요청 소유자를 인증(전화번호 기반 세션)한
// 뒤에만 이 경로를 호출하므로 이중 서명은 불필요한 마찰이다.
//
// ⚠️ AI_CHARGE_SECRET은 MINT_SECRET/BRIDGE_SECRET과 같은 임시 개발용
// 공유 비밀이다 — 실서비스 전환 전 반드시 제거하거나 진짜 인증(mTLS,
// Cloudflare Worker 전용 서명 등)으로 교체할 것.
//
// 멱등성: tx_hash(worker.js가 요청 단위로 crypto.randomUUID()로 생성)로
// 중복 차감을 막는다 — ctx.waitUntil 재시도나 네트워크 재시도로 같은
// 사용량이 두 번 청구되는 걸 방지.
//
// ⚠️ ai_usage_charge 블록은 buyer_guid를 실사용자 guid로 둔다 — 잔액을
// 실제로 깎으려면 computeBalance 공식상(buyer_guid 일치 시 outputs 합계
// 차감) 불가피하다. 이 때문에 /api/tx·/api/balance의 "P2P 정산 체인"
// 판정이 이 블록까지 자기 체인으로 오인하지 않도록, 두 곳 모두
// block_type==="tx_2party"로 필터를 한정하는 수정을 이 커밋에서 함께
// 적용했다(파일 위쪽 해당 주석 참고) — AI 차감 블록은 P2P 정산 체인과
// 완전히 무관한 별도 계열이어야 한다.
routerAdd("POST", "/api/ai-charge", (c) => {
  const EXCHANGE_RATE_KRW_PER_GDC = 1; // /api/mint와 동일 환율(정본은 그쪽 — 콜백마다 재선언 필요, Goja 제약 상단 주석 참고). 2026-07-27: 100→1 정정(테스트 기간 한정)

  try {
    console.log("[AI-CHARGE] 진입");
    const body = $apis.requestInfo(c).data;
    const {
      guid, tx_hash, krw_amount, secret,
      service_id, model, hit_tokens, miss_tokens, out_tokens, cost_krw, memo,
    } = body;

    const AI_CHARGE_SECRET = $os.getenv("AI_CHARGE_SECRET"); // 2026-07-19: 하드코딩 제거, 환경변수로 이관(공개 저장소 노출 방지)
    if (secret !== AI_CHARGE_SECRET) {
      console.log("[AI-CHARGE] secret 불일치");
      return c.json(403, { ok: false, error: "FORBIDDEN" });
    }
    if (!guid || !tx_hash) {
      return c.json(400, { ok: false, error: "MISSING_FIELD", detail: "guid, tx_hash 필수" });
    }
    if (!(Number(krw_amount) > 0)) {
      return c.json(400, { ok: false, error: "INVALID_AMOUNT", detail: "krw_amount는 0보다 커야 합니다" });
    }
    const krwAmount = Number(krw_amount);
    const gdcAmount = krwAmount / EXCHANGE_RATE_KRW_PER_GDC;
    console.log("[AI-CHARGE] 검증 통과, guid:", guid, "gdc:", gdcAmount, "krw:", krwAmount);

    // ── 멱등성 확인: 같은 tx_hash로 이미 차감된 적 있으면 그 결과를 그대로 반환 ──
    // (P12 필터 버그 회피 관례에 따라, 좁은 필터 문자열 대신 넓게 가져와
    //  JS 쪽에서 걸러낸다 — 파일 상단 P12 관련 기존 주석과 동일 패턴.)
    let already = null;
    try {
      const recent = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "-created", 5000, 0);
      already = recent.find(r => r.getString("block_type") === "ai_usage_charge" && r.getString("tx_hash") === tx_hash) || null;
    } catch (e) { console.log("[AI-CHARGE] 멱등성 조회 예외(무시하고 진행):", e.message); }
    if (already) {
      console.log("[AI-CHARGE] 이미 처리된 tx_hash, 중복 차감 방지:", tx_hash);
      return c.json(200, {
        ok: true, already_charged: true,
        block_id: already.getId(), content_hash: already.getString("content_hash"),
      });
    }

    // computeBalance — /api/tx와 동일 로직(콜백마다 따로 선언, Goja 제약)
    function computeBalance(g) {
      const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 10000, 0);
      let balance = 0;
      for (const b of allBlocks) {
        let blkOutputs;
        try { blkOutputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
        for (const o of blkOutputs) {
          if (o.recipient_guid === g) balance += (o.amount || 0);
        }
        if (b.getString("buyer_guid") === g) {
          const total = blkOutputs.reduce((s, o) => s + (o.amount || 0), 0);
          balance -= total;
        }
      }
      return balance;
    }

    const actualBalance = computeBalance(guid);
    if (actualBalance < gdcAmount) {
      console.log("[AI-CHARGE] 잔액 부족:", actualBalance, "<", gdcAmount);
      return c.json(402, {
        ok: false, error: "INSUFFICIENT_BALANCE",
        detail: `GDC 잔액 부족: 보유 ${actualBalance}T < 필요 ${gdcAmount}T`,
        balance_gdc: actualBalance, required_gdc: gdcAmount,
      });
    }

    function sha256hex(str) {
      // 2026-07-18 버그 수정: 이 함수는 charCodeAt()이 256 이상(한글 등 비ASCII
      // 문자)이면 조용히 빈 문자열을 반환했다 — 코드포인트를 UTF-8 멀티바이트로
      // 인코딩하지 않고 1바이트로 취급하던 게 원인. 실제 GDC 이체 item_name
      // 기본값("GDC 이체") 하나만으로도 재현됨(sortedStringify(tx)에 포함되어
      // tx_hash 서버측 재계산이 매번 ''가 되고, 클라이언트가 보낸 진짜
      // tx_hash와 항상 달라 TX_HASH_MISMATCH로 거부됨 — 한글 상품명이 있는
      // 모든 K-Market 구매가 이 서명 검증 도입과 함께 깨질 뻔했다). 먼저
      // 문자열을 UTF-8 바이트열(각 char가 0~255인 문자열)로 변환한 뒤 기존
      // 알고리즘에 그대로 넘긴다 — Node TextEncoder와 결과 동일함을 실측
      // 검증(ASCII/한글/이모지 서로게이트쌍/혼합 문자 전부 일치).
      str = (function(s) {
        var o = '';
        for (var i = 0; i < s.length; i++) {
          var c = s.charCodeAt(i);
          if (c < 0x80) {
            o += String.fromCharCode(c);
          } else if (c < 0x800) {
            o += String.fromCharCode(0xc0 | (c >> 6));
            o += String.fromCharCode(0x80 | (c & 0x3f));
          } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
            var c2 = s.charCodeAt(i + 1);
            if (c2 >= 0xdc00 && c2 <= 0xdfff) {
              var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
              o += String.fromCharCode(0xf0 | (cp >> 18));
              o += String.fromCharCode(0x80 | ((cp >> 12) & 0x3f));
              o += String.fromCharCode(0x80 | ((cp >> 6) & 0x3f));
              o += String.fromCharCode(0x80 | (cp & 0x3f));
              i++;
              continue;
            }
            o += String.fromCharCode(0xef, 0xbf, 0xbd);
          } else {
            o += String.fromCharCode(0xe0 | (c >> 12));
            o += String.fromCharCode(0x80 | ((c >> 6) & 0x3f));
            o += String.fromCharCode(0x80 | (c & 0x3f));
          }
        }
        return o;
      })(str);
      const mathPow = Math.pow;
      const maxWord = mathPow(2, 32);
      let result = '';
      const words = [];
      const asciiBitLength = str.length * 8;
      let hash = [], k = [];
      let primeCounter = 0;
      const isComposite = {};
      for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
        }
      }
      let s = str + '\x80';
      while (s.length % 64 - 56) s += '\x00';
      for (let i = 0; i < s.length; i++) {
        const j = s.charCodeAt(i);
        if (j >> 8) return '';
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
      }
      words[words.length] = ((asciiBitLength / maxWord) | 0);
      words[words.length] = (asciiBitLength | 0);
      for (let j = 0; j < words.length;) {
        const w = words.slice(j, j += 16);
        const oldHash = hash.slice(0);
        for (let i = 0; i < 64; i++) {
          const w15 = w[i-15], w2 = w[i-2];
          const a = hash[0], e = hash[4];
          const temp1 = hash[7]
            + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7))
            + ((e & hash[5]) ^ (~e & hash[6]))
            + k[i]
            + (w[i] = (i < 16) ? w[i] : (
              w[i-16]
              + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3))
              + w[i-7]
              + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10))
            ) | 0);
          const temp2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1+temp2)|0].concat(hash);
          hash[4] = (hash[4]+temp1)|0;
          hash.length = 8;
        }
        hash = hash.map((v,i) => (v+oldHash[i])|0);
      }
      hash.forEach(val => {
        for (let i = 3; i+1; i--) {
          const byte = (val>>(i*8))&255;
          result += ((byte<16)?'0':'') + byte.toString(16);
        }
      });
      return result;
    }

    const contentHash = sha256hex("aicharge:" + guid + ":" + tx_hash + ":" + Date.now());

    const col = $app.dao().findCollectionByNameOrId("blocks");
    const blockRecord = new Record(col);
    blockRecord.set("block_type",       "ai_usage_charge");
    blockRecord.set("tx_hash",          tx_hash);
    blockRecord.set("buyer_guid",       guid);
    blockRecord.set("seller_guid",      "gopang-platform");
    blockRecord.set("buyer_sig",        "");
    blockRecord.set("outputs", JSON.stringify([{
      recipient_guid: "gopang-platform",
      amount:          gdcAmount,
      krw_amount:      krwAmount,
      exchange_rate:   EXCHANGE_RATE_KRW_PER_GDC,
      service_id:      service_id || "hondi-chat",
      model:           model || "",
      hit_tokens:      hit_tokens  || 0,
      miss_tokens:     miss_tokens || 0,
      out_tokens:      out_tokens  || 0,
      cost_krw:        cost_krw || 0,
      memo:            memo || "",
    }]));
    // (deposit 블록과 동일 관례: P2P 정산 체인과 무관하므로
    //  prev_block_hash/prev_settle_hash는 비워두고 height는 0으로 둔다.
    //  위에서 이미 buyerBlocks 필터를 tx_2party로 한정했으므로 이 블록이
    //  누군가의 "직전 정산"으로 오인될 일은 없다.)
    blockRecord.set("prev_block_hash",  "");
    blockRecord.set("content_hash",     contentHash);
    blockRecord.set("height",           0);
    blockRecord.set("prev_settle_hash", "");

    try {
      $app.dao().saveRecord(blockRecord);
    } catch (e) {
      console.log("[AI-CHARGE] BLOCK_SAVE_FAILED:", e.message);
      return c.json(500, { ok: false, error: "BLOCK_SAVE_FAILED", detail: e.message });
    }

    // ── 2026-07-18 신설, 2026-07-21 통합 — 재무제표 원장(ledger_entries) 기록 ──
    // AI 이용료도 "거래"다 — GDC 상거래 완성 계획서 Phase 4가 P2P/마켓
    // 뿐 아니라 이것도 포함해야 한다고 명시함. 실패해도 이미 완료된
    // 차감(blockRecord 저장)은 되돌리지 않는다 — /api/tx와 동일 원칙.
    //
    // [2026-07-21 통합] 원장(fs) 관련 쓰기는 market-proxy가 전담 — 동일 이유로
    // HTTP 호출로 대체(NODE_CONFIG는 핸들러별 격리 컨텍스트라 로컬 재정의).
    try {
      const NODE_CONFIG = {
        "hanlim": { id: "KR-JEJU-JEJU-HANLIM" }, "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL" },
        "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON" }, "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA" },
        "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG" }, "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA" },
        "l1-udo": { id: "KR-JEJU-JEJU-UDO" }, "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1" },
        "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2" }, "l1-ido1": { id: "KR-JEJU-JEJU-IDO1" },
        "l1-ido2": { id: "KR-JEJU-JEJU-IDO2" }, "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1" },
        "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2" }, "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1" },
        "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2" }, "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP" },
        "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK" }, "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG" },
        "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE" }, "l1-ara": { id: "KR-JEJU-JEJU-ARA" },
        "l1-ora": { id: "KR-JEJU-JEJU-ORA" }, "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG" },
        "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG" }, "l1-oedo": { id: "KR-JEJU-JEJU-OEDO" },
        "l1-iho": { id: "KR-JEJU-JEJU-IHO" }, "l1-dodu": { id: "KR-JEJU-JEJU-DODU" },
        "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG" }, "l1-namwon": { id: "KR-JEJU-SGP-NAMWON" },
        "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN" }, "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK" },
        "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON" }, "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN" },
        "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG" }, "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP" },
        "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI" }, "l1-hyodon": { id: "KR-JEJU-SGP-HYODON" },
        "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON" }, "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG" },
        "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG" }, "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN" },
        "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON" }, "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN" },
        "l1-yerae": { id: "KR-JEJU-SGP-YERAE" }, "l2-jeju": { id: "KR-JEJU-JEJU-SI" },
        "l2-seogwipo": { id: "KR-JEJU-SGP-SI" }, "l3-jejudo": { id: "KR-JEJU" },
        "l4-kr": { id: "KR" }, "l5-global": { id: "GLOBAL" },
      };
      const _selfFolder = $app.dataDir().split("/").pop();
      const _self = NODE_CONFIG[_selfFolder] || NODE_CONFIG["hanlim"];

      const res = $http.send({
        url: $os.getenv("MARKET_PROXY_URL") + "/internal/ledger-entries",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          l1_node: _self.id,
          guid,
          direction: "debit",
          amount: gdcAmount,
          fs_account: "pl-purchase",
          source: "ai_usage",
          block_hash: contentHash,
          tx_id: tx_hash,
          ledger_write_secret: $os.getenv("LEDGER_WRITE_SECRET"),
        }),
      });
      if (res.statusCode !== 200) {
        console.log("[AI-CHARGE] ledger_entries 기록 실패(market-proxy 응답", res.statusCode, "):", res.raw);
      } else {
        console.log("[AI-CHARGE] ledger_entries 기록 요청 완료(market-proxy)");
      }
    } catch (e) {
      console.log("[AI-CHARGE] ledger_entries 기록 실패(감사 필요, 차감 자체는 정상):", e.message);
    }

    const balanceAfter = actualBalance - gdcAmount;
    console.log("[AI-CHARGE]", guid, "-" + gdcAmount + "T", "(krw:" + krwAmount + ")", memo ? "(" + memo + ")" : "");
    return c.json(200, {
      ok:             true,
      block_id:       blockRecord.getId(),
      content_hash:   contentHash,
      guid,
      charged_gdc:    gdcAmount,
      krw_amount:     krwAmount,
      balance_after:  balanceAfter,
    });
  } catch (e) {
    console.log("[AI-CHARGE] 예외 발생:", e.message, "| stack:", e.stack || "(no stack)");
    return c.json(500, { ok: false, error: "AI_CHARGE_EXCEPTION", detail: e.message || String(e) });
  }
});

// ── 2026-07-07 신설: 재대사(reconcile) 지원 — guid의 실제 잔액 +
// 다음 거래에 쓸 prev_settle_hash를 서버(L1)에서 직접 조회한다.
// 클라이언트(gopang-wallet.js)의 로컬 IndexedDB가 새 기기·스토리지
// 초기화 등으로 서버 원장과 어긋나는 경우, 이 엔드포인트로 복구한다.
routerAdd("GET", "/api/balance", (c) => {
  // /api/mint, /api/ai-charge와 동일 환율(정본은 그쪽 — 콜백마다 재선언 필요, Goja 제약).
  // 2026-07-28 신설: worker.js가 이 값을 자신의 로컬 상수와 대조해 정합성을
  // 감시할 수 있도록 응답에 포함시킨다(아래 exchange_rate 필드).
  const EXCHANGE_RATE_KRW_PER_GDC = 1;
  try {
    const guid = $apis.requestInfo(c).query.guid;
    console.log("[BALANCE] 진입, guid:", guid);
    if (!guid) return c.json(400, { ok: false, error: "MISSING_FIELD", detail: "guid 쿼리 파라미터 필수" });

    // computeBalance — /api/tx와 동일 로직(콜백마다 따로 선언, Goja 제약)
    function computeBalance(g) {
      const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 10000, 0);
      let balance = 0;
      for (const b of allBlocks) {
        let blkOutputs;
        try { blkOutputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
        for (const o of blkOutputs) {
          if (o.recipient_guid === g) balance += (o.amount || 0);
        }
        if (b.getString("buyer_guid") === g) {
          const total = blkOutputs.reduce((s, o) => s + (o.amount || 0), 0);
          balance -= total;
        }
      }
      return balance;
    }

    const balance = computeBalance(guid);

    // 이 guid가 buyer(지불자)로 등장한 가장 최근 블록 — 다음 거래의
    // prev_settle_hash 기준. 지불 이력이 없으면(발행만 받았거나 첫
    // 거래 전) null — 그 경우 클라이언트는 prev_settle_hash:null로
    // 첫 거래를 시도하면 된다(main.pb.js 3단계가 이미 그렇게 처리함).
    let latestBlockHash = null;
    let height = 0;
    try {
      // (2026-07-14: /api/tx와 동일하게 tx_2party로 한정 — 위 /api/tx
      //  3단계 주석 참고. ai_usage_charge 블록은 P2P 정산 포인터에서 제외.)
      const buyerBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "-height", 1000, 0)
        .filter(r => r.getString("buyer_guid") === guid && r.getString("block_type") === "tx_2party");
      if (buyerBlocks.length > 0) {
        latestBlockHash = buyerBlocks[0].getString("content_hash");
        height = buyerBlocks[0].getFloat("height");
      }
    } catch (e) { /* 이력 없음 */ }

    return c.json(200, {
      ok: true,
      guid,
      balance,
      latest_block_hash: latestBlockHash,
      height,
      exchange_rate: EXCHANGE_RATE_KRW_PER_GDC,
    });
  } catch (e) {
    return c.json(500, { ok: false, error: "BALANCE_QUERY_FAILED", detail: e.message });
  }
});

// ── 2026-07-07 신설: GDC 발행 총량 보존 검증 ──────────────────────────
// 불변식: 이 L1에서 지금까지 발행(mint)된 GDC 총량 == 이 L1에 등장한
// 모든 guid(구매자·판매자·gopang-platform 포함)의 잔액 합. 발행만이
// 총량을 늘리는 유일한 사건이고, 그 외 모든 거래(구매 등)는 이 L1
// 내부에서 제로섬이어야 하므로, 두 값이 항상 같아야 한다. 다르면
// 어딘가에서 GDC가 생기거나 사라진 것 — 감사해야 할 상황이다.
//
// L1→L2→...→L5 계층 간 제로섬 전파(다른 L1 소속 판매자와 거래 시,
// 개별 L1 총량은 변하지만 상위 L2에서는 제로섬이어야 한다는 것)는
// 별도로 설계했으나, 지금 이 L1(hanlim) 외에 실제로 살아있는 L1이
// 확인되지 않아 이 엔드포인트는 "이 L1 하나"에 대한 보존만 검증한다.
routerAdd("GET", "/api/supply/verify", (c) => {
  // ── 2026-07-07 신설(제주 L1~L3 필드 테스트): 계층 인식 ─────────────────
  // 이 엔드포인트가 이제 43개 L1 + 2개 L2 + 1개 L3가 전부 공유하는 훅
  // 파일에서 실행되므로, 폴더명으로 자기 층위를 먼저 확인한다. L2/L3는
  // 자체 blocks 원장이 없으므로(§2.1), 하위 노드들의 /api/supply/verify를
  // HTTP로 재귀 호출해 합산한다. 각 L1이 로컬에서 이미 발행==잔액합을
  // 만족하므로(브릿지도 sentinel 계정으로 로컬에서 항상 제로섬 —
  // jeju-l1-l3-field-test-plan-2026-07-07.md §5/§6 참고), 그 합도 자동으로
  // 일치한다 — 별도의 "브릿지 진행 중 유예시간" 로직이 필요 없다(당초
  // 계획서 §6.4가 우려했던 오탐은, sentinel 계정 설계로 근본적으로
  // 발생하지 않는다).
const NODE_CONFIG = {
  "hanlim": { id: "KR-JEJU-JEJU-HANLIM", layer: 1, port: 8091, parentUrl: "http://127.0.0.1:8092" },
  "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL", layer: 1, port: 8101, parentUrl: "http://127.0.0.1:8092" },
  "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON", layer: 1, port: 8102, parentUrl: "http://127.0.0.1:8092" },
  "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA", layer: 1, port: 8103, parentUrl: "http://127.0.0.1:8092" },
  "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG", layer: 1, port: 8104, parentUrl: "http://127.0.0.1:8092" },
  "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA", layer: 1, port: 8105, parentUrl: "http://127.0.0.1:8092" },
  "l1-udo": { id: "KR-JEJU-JEJU-UDO", layer: 1, port: 8106, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1", layer: 1, port: 8107, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2", layer: 1, port: 8108, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido1": { id: "KR-JEJU-JEJU-IDO1", layer: 1, port: 8109, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido2": { id: "KR-JEJU-JEJU-IDO2", layer: 1, port: 8110, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1", layer: 1, port: 8111, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2", layer: 1, port: 8112, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1", layer: 1, port: 8113, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2", layer: 1, port: 8114, parentUrl: "http://127.0.0.1:8092" },
  "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP", layer: 1, port: 8115, parentUrl: "http://127.0.0.1:8092" },
  "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK", layer: 1, port: 8116, parentUrl: "http://127.0.0.1:8092" },
  "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG", layer: 1, port: 8117, parentUrl: "http://127.0.0.1:8092" },
  "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE", layer: 1, port: 8118, parentUrl: "http://127.0.0.1:8092" },
  "l1-ara": { id: "KR-JEJU-JEJU-ARA", layer: 1, port: 8119, parentUrl: "http://127.0.0.1:8092" },
  "l1-ora": { id: "KR-JEJU-JEJU-ORA", layer: 1, port: 8120, parentUrl: "http://127.0.0.1:8092" },
  "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG", layer: 1, port: 8121, parentUrl: "http://127.0.0.1:8092" },
  "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG", layer: 1, port: 8122, parentUrl: "http://127.0.0.1:8092" },
  "l1-oedo": { id: "KR-JEJU-JEJU-OEDO", layer: 1, port: 8123, parentUrl: "http://127.0.0.1:8092" },
  "l1-iho": { id: "KR-JEJU-JEJU-IHO", layer: 1, port: 8124, parentUrl: "http://127.0.0.1:8092" },
  "l1-dodu": { id: "KR-JEJU-JEJU-DODU", layer: 1, port: 8125, parentUrl: "http://127.0.0.1:8092" },
  "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG", layer: 1, port: 8126, parentUrl: "http://127.0.0.1:8093" },
  "l1-namwon": { id: "KR-JEJU-SGP-NAMWON", layer: 1, port: 8127, parentUrl: "http://127.0.0.1:8093" },
  "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN", layer: 1, port: 8128, parentUrl: "http://127.0.0.1:8093" },
  "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK", layer: 1, port: 8129, parentUrl: "http://127.0.0.1:8093" },
  "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON", layer: 1, port: 8130, parentUrl: "http://127.0.0.1:8093" },
  "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN", layer: 1, port: 8131, parentUrl: "http://127.0.0.1:8093" },
  "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG", layer: 1, port: 8132, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP", layer: 1, port: 8133, parentUrl: "http://127.0.0.1:8093" },
  "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI", layer: 1, port: 8134, parentUrl: "http://127.0.0.1:8093" },
  "l1-hyodon": { id: "KR-JEJU-SGP-HYODON", layer: 1, port: 8135, parentUrl: "http://127.0.0.1:8093" },
  "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON", layer: 1, port: 8136, parentUrl: "http://127.0.0.1:8093" },
  "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG", layer: 1, port: 8137, parentUrl: "http://127.0.0.1:8093" },
  "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG", layer: 1, port: 8138, parentUrl: "http://127.0.0.1:8093" },
  "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN", layer: 1, port: 8139, parentUrl: "http://127.0.0.1:8093" },
  "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON", layer: 1, port: 8140, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN", layer: 1, port: 8141, parentUrl: "http://127.0.0.1:8093" },
  "l1-yerae": { id: "KR-JEJU-SGP-YERAE", layer: 1, port: 8142, parentUrl: "http://127.0.0.1:8093" },
  "l2-jeju": { id: "KR-JEJU-JEJU-SI", layer: 2, port: 8092, parentUrl: "http://127.0.0.1:8094" },
  "l2-seogwipo": { id: "KR-JEJU-SGP-SI", layer: 2, port: 8093, parentUrl: "http://127.0.0.1:8094" },
  "l3-jejudo": { id: "KR-JEJU", layer: 3, port: 8094, parentUrl: "http://127.0.0.1:8095" },
  "l4-kr": { id: "KR", layer: 4, port: 8095, parentUrl: "http://127.0.0.1:8096" },
  "l5-global": { id: "GLOBAL", layer: 5, port: 8096, parentUrl: null },
};
const CHILDREN_PORTS = {
  "l2-jeju": [8091, 8101, 8102, 8103, 8104, 8105, 8106, 8107, 8108, 8109, 8110, 8111, 8112, 8113, 8114, 8115, 8116, 8117, 8118, 8119, 8120, 8121, 8122, 8123, 8124, 8125],
  "l2-seogwipo": [8126, 8127, 8128, 8129, 8130, 8131, 8132, 8133, 8134, 8135, 8136, 8137, 8138, 8139, 8140, 8141, 8142],
  "l3-jejudo": [8092, 8093],
};
  const _selfFolder = $app.dataDir().split("/").pop();
  const _self = NODE_CONFIG[_selfFolder] || NODE_CONFIG["hanlim"];

  if (_self.layer >= 2) {
    const childPorts = CHILDREN_PORTS[_selfFolder] || [];
    let totalMinted = 0, totalBalance = 0, childConsistencyValid = true;
    const children = [];
    const unreachable = [];
    for (const port of childPorts) {
      try {
        const resp = $http.send({ url: "http://127.0.0.1:" + port + "/api/supply/verify", method: "GET" });
        const data = JSON.parse(resp.raw);
        if (!data || !data.ok) { unreachable.push(port); continue; }
        totalMinted  += (data.total_minted  || 0);
        totalBalance += (data.total_balance || 0);
        // ── 2026-07-08 수정: 도달 불가(topology)와 잔액 불일치(consistency)를
        // 분리한다. 미배포 노드가 많은 파일럿 단계에서 valid가 항상 false로
        // 뜨는 문제(애월 파일럿 시나리오5) — unreachable은 더 이상 consistency
        // 판정에 영향을 주지 않는다. topology_complete가 그 역할을 대신한다.
        if (!data.valid) childConsistencyValid = false;
        children.push({ node: data.node, port, layer: data.layer || 1,
          total_minted: data.total_minted, total_balance: data.total_balance, valid: data.valid });
      } catch (e) {
        unreachable.push(port);
        children.push({ port, error: e.message });
      }
    }
    const diff = Math.abs(totalMinted - totalBalance);
    const consistencyValid = childConsistencyValid && diff < 0.01;
    const topologyComplete = unreachable.length === 0;
    const valid = consistencyValid && topologyComplete; // 기존 호출부 호환 — 계산식 동일, 의미 변경 없음
    if (!consistencyValid) {
      console.error("[SUPPLY][" + _self.id + "] 보존 검증 실패(consistency)!",
        JSON.stringify({ totalMinted, totalBalance, diff }));
    }
    if (!topologyComplete) {
      console.warn("[SUPPLY][" + _self.id + "] 토폴로지 미완성 — 도달 불가 노드 존재(파일럿 단계에서는 정상일 수 있음)",
        JSON.stringify({ unreachable }));
    }
    return c.json(200, {
      ok: true,
      node: _self.id,
      layer: _self.layer,
      total_minted: totalMinted,
      total_balance: totalBalance,
      diff,
      valid,                          // 기존 필드 — 계산식 동일(consistency && topology)
      consistency_valid: consistencyValid,   // 신규 — 잔액 보존만 판정
      topology_complete: topologyComplete,   // 신규 — 전 노드 도달 여부만 판정
      child_count: childPorts.length,
      unreachable_children: unreachable,
      children,
    });
  }

  // ── L1: 기존 로컬 보존 검증 (기존 로직 그대로, node만 동적화) ─────────
  try {
    const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 10000, 0);

    let totalMinted = 0;
    const guidSet = new Set();
    for (const b of allBlocks) {
      let outputs;
      try { outputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
      const blockType = b.getString("block_type");
      for (const o of outputs) {
        if (o.recipient_guid) guidSet.add(o.recipient_guid);
        if (blockType === "deposit") totalMinted += (o.amount || 0);
      }
      const buyerGuid = b.getString("buyer_guid");
      if (buyerGuid && buyerGuid !== "gdc-mint") guidSet.add(buyerGuid);
    }

    function computeBalance(guid) {
      let balance = 0;
      for (const b of allBlocks) {
        let blkOutputs;
        try { blkOutputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
        for (const o of blkOutputs) {
          if (o.recipient_guid === guid) balance += (o.amount || 0);
        }
        if (b.getString("buyer_guid") === guid) {
          const total = blkOutputs.reduce((s, o) => s + (o.amount || 0), 0);
          balance -= total;
        }
      }
      return balance;
    }

    let totalBalance = 0;
    const balances = {};
    for (const g of guidSet) {
      const bal = computeBalance(g);
      balances[g] = bal;
      totalBalance += bal;
    }

    const diff  = Math.abs(totalMinted - totalBalance);
    const valid = diff < 0.01;
    if (!valid) {
      console.error("[SUPPLY][" + _self.id + "] 보존 검증 실패!", JSON.stringify({ totalMinted, totalBalance, diff }));
    }

    return c.json(200, {
      ok: true,
      node: _self.id,
      layer: 1,
      total_minted: totalMinted,
      total_balance: totalBalance,
      diff,
      valid,
      guid_count: guidSet.size,
      balances,
    });
  } catch (e) {
    return c.json(500, { ok: false, error: "SUPPLY_VERIFY_FAILED", detail: e.message });
  }
});

// GDC 발행 총량만 간단히 조회(검증 없이) — 대시보드 등에서 자주 호출할 땐 이쪽이 가볍다
routerAdd("GET", "/api/supply", (c) => {
  try {
const NODE_CONFIG = {
  "hanlim": { id: "KR-JEJU-JEJU-HANLIM", layer: 1, port: 8091, parentUrl: "http://127.0.0.1:8092" },
  "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL", layer: 1, port: 8101, parentUrl: "http://127.0.0.1:8092" },
  "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON", layer: 1, port: 8102, parentUrl: "http://127.0.0.1:8092" },
  "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA", layer: 1, port: 8103, parentUrl: "http://127.0.0.1:8092" },
  "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG", layer: 1, port: 8104, parentUrl: "http://127.0.0.1:8092" },
  "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA", layer: 1, port: 8105, parentUrl: "http://127.0.0.1:8092" },
  "l1-udo": { id: "KR-JEJU-JEJU-UDO", layer: 1, port: 8106, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1", layer: 1, port: 8107, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2", layer: 1, port: 8108, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido1": { id: "KR-JEJU-JEJU-IDO1", layer: 1, port: 8109, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido2": { id: "KR-JEJU-JEJU-IDO2", layer: 1, port: 8110, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1", layer: 1, port: 8111, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2", layer: 1, port: 8112, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1", layer: 1, port: 8113, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2", layer: 1, port: 8114, parentUrl: "http://127.0.0.1:8092" },
  "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP", layer: 1, port: 8115, parentUrl: "http://127.0.0.1:8092" },
  "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK", layer: 1, port: 8116, parentUrl: "http://127.0.0.1:8092" },
  "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG", layer: 1, port: 8117, parentUrl: "http://127.0.0.1:8092" },
  "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE", layer: 1, port: 8118, parentUrl: "http://127.0.0.1:8092" },
  "l1-ara": { id: "KR-JEJU-JEJU-ARA", layer: 1, port: 8119, parentUrl: "http://127.0.0.1:8092" },
  "l1-ora": { id: "KR-JEJU-JEJU-ORA", layer: 1, port: 8120, parentUrl: "http://127.0.0.1:8092" },
  "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG", layer: 1, port: 8121, parentUrl: "http://127.0.0.1:8092" },
  "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG", layer: 1, port: 8122, parentUrl: "http://127.0.0.1:8092" },
  "l1-oedo": { id: "KR-JEJU-JEJU-OEDO", layer: 1, port: 8123, parentUrl: "http://127.0.0.1:8092" },
  "l1-iho": { id: "KR-JEJU-JEJU-IHO", layer: 1, port: 8124, parentUrl: "http://127.0.0.1:8092" },
  "l1-dodu": { id: "KR-JEJU-JEJU-DODU", layer: 1, port: 8125, parentUrl: "http://127.0.0.1:8092" },
  "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG", layer: 1, port: 8126, parentUrl: "http://127.0.0.1:8093" },
  "l1-namwon": { id: "KR-JEJU-SGP-NAMWON", layer: 1, port: 8127, parentUrl: "http://127.0.0.1:8093" },
  "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN", layer: 1, port: 8128, parentUrl: "http://127.0.0.1:8093" },
  "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK", layer: 1, port: 8129, parentUrl: "http://127.0.0.1:8093" },
  "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON", layer: 1, port: 8130, parentUrl: "http://127.0.0.1:8093" },
  "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN", layer: 1, port: 8131, parentUrl: "http://127.0.0.1:8093" },
  "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG", layer: 1, port: 8132, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP", layer: 1, port: 8133, parentUrl: "http://127.0.0.1:8093" },
  "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI", layer: 1, port: 8134, parentUrl: "http://127.0.0.1:8093" },
  "l1-hyodon": { id: "KR-JEJU-SGP-HYODON", layer: 1, port: 8135, parentUrl: "http://127.0.0.1:8093" },
  "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON", layer: 1, port: 8136, parentUrl: "http://127.0.0.1:8093" },
  "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG", layer: 1, port: 8137, parentUrl: "http://127.0.0.1:8093" },
  "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG", layer: 1, port: 8138, parentUrl: "http://127.0.0.1:8093" },
  "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN", layer: 1, port: 8139, parentUrl: "http://127.0.0.1:8093" },
  "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON", layer: 1, port: 8140, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN", layer: 1, port: 8141, parentUrl: "http://127.0.0.1:8093" },
  "l1-yerae": { id: "KR-JEJU-SGP-YERAE", layer: 1, port: 8142, parentUrl: "http://127.0.0.1:8093" },
  "l2-jeju": { id: "KR-JEJU-JEJU-SI", layer: 2, port: 8092, parentUrl: "http://127.0.0.1:8094" },
  "l2-seogwipo": { id: "KR-JEJU-SGP-SI", layer: 2, port: 8093, parentUrl: "http://127.0.0.1:8094" },
  "l3-jejudo": { id: "KR-JEJU", layer: 3, port: 8094, parentUrl: "http://127.0.0.1:8095" },
  "l4-kr": { id: "KR", layer: 4, port: 8095, parentUrl: "http://127.0.0.1:8096" },
  "l5-global": { id: "GLOBAL", layer: 5, port: 8096, parentUrl: null },
};
    const _selfFolder = $app.dataDir().split("/").pop();
    const _self = NODE_CONFIG[_selfFolder] || NODE_CONFIG["hanlim"];
    const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type = 'deposit'", "", 10000, 0);
    let totalMinted = 0;
    for (const b of allBlocks) {
      let outputs;
      try { outputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
      totalMinted += outputs.reduce((s, o) => s + (o.amount || 0), 0);
    }
    return c.json(200, { ok: true, node: _self.id, total_minted: totalMinted });
  } catch (e) {
    return c.json(500, { ok: false, error: "SUPPLY_QUERY_FAILED", detail: e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// 2026-07-07 신설(제주 L1~L3 필드 테스트) — 브릿지 트랜잭션 프로토콜
// jeju-l1-l3-field-test-plan-2026-07-07.md §5 참고.
// L1은 다른 L1을 직접 호출하지 않는다(P1) — 아래 세 엔드포인트는 전부
// Worker(허브)가 폴링·트리거하는 대상이지, L1끼리 서로 부르지 않는다.
// ══════════════════════════════════════════════════════════════

// POST /api/bridge-in — 다른 L1에서 이 L1 소속 판매자에게 들어오는 크레딧.
// tx_hash 기준 멱등 — 같은 tx_hash로 여러 번 호출돼도 한 번만 반영된다.
routerAdd("POST", "/api/bridge-in", (c) => {
  try {
    const body = $apis.requestInfo(c).data;
    const { tx_hash, source_node, guid, amount, bridge_secret } = body;
    if (!tx_hash || !source_node || !guid || !(Number(amount) > 0)) {
      return c.json(400, { ok: false, error: "MISSING_FIELD" });
    }
    // ── 2026-07-07 신설: 인증 없이 열려 있던 구멍 — 시뮬레이션 중 발견 ──
    // 대응하는 bridge_out 없이도 누구나 임의 guid에 임의 금액을 크레딧할
    // 수 있었다(sentinel 설계상 로컬 발행==잔액 불변식은 깨지지 않아
    // supply/verify로는 못 잡아냄 — "정당한 거래인가"는 별개 문제).
    const BRIDGE_SECRET = $os.getenv("BRIDGE_SECRET"); // 2026-07-19: 하드코딩 제거, 환경변수로 이관(공개 저장소 노출 방지)
    if (bridge_secret !== BRIDGE_SECRET) {
      return c.json(403, { ok: false, error: "FORBIDDEN", detail: "bridge_secret 불일치 — 이 엔드포인트는 Worker(허브)만 호출할 수 있습니다" });
    }
    delete body.bridge_secret; // 로그/응답에 새어나가지 않게

    try {
      const existing = $app.dao().findFirstRecordByFilter("bridge_in", "tx_hash = '" + tx_hash + "'");
      if (existing) {
        return c.json(200, { ok: true, applied: false, reason: "ALREADY_APPLIED", tx_hash });
      }
    } catch (e) { /* 없음 — 최초 호출, 정상 진행 */ }

    function sha256hex(str) {
      // 2026-07-18 버그 수정: 이 함수는 charCodeAt()이 256 이상(한글 등 비ASCII
      // 문자)이면 조용히 빈 문자열을 반환했다 — 코드포인트를 UTF-8 멀티바이트로
      // 인코딩하지 않고 1바이트로 취급하던 게 원인. 실제 GDC 이체 item_name
      // 기본값("GDC 이체") 하나만으로도 재현됨(sortedStringify(tx)에 포함되어
      // tx_hash 서버측 재계산이 매번 ''가 되고, 클라이언트가 보낸 진짜
      // tx_hash와 항상 달라 TX_HASH_MISMATCH로 거부됨 — 한글 상품명이 있는
      // 모든 K-Market 구매가 이 서명 검증 도입과 함께 깨질 뻔했다). 먼저
      // 문자열을 UTF-8 바이트열(각 char가 0~255인 문자열)로 변환한 뒤 기존
      // 알고리즘에 그대로 넘긴다 — Node TextEncoder와 결과 동일함을 실측
      // 검증(ASCII/한글/이모지 서로게이트쌍/혼합 문자 전부 일치).
      str = (function(s) {
        var o = '';
        for (var i = 0; i < s.length; i++) {
          var c = s.charCodeAt(i);
          if (c < 0x80) {
            o += String.fromCharCode(c);
          } else if (c < 0x800) {
            o += String.fromCharCode(0xc0 | (c >> 6));
            o += String.fromCharCode(0x80 | (c & 0x3f));
          } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
            var c2 = s.charCodeAt(i + 1);
            if (c2 >= 0xdc00 && c2 <= 0xdfff) {
              var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
              o += String.fromCharCode(0xf0 | (cp >> 18));
              o += String.fromCharCode(0x80 | ((cp >> 12) & 0x3f));
              o += String.fromCharCode(0x80 | ((cp >> 6) & 0x3f));
              o += String.fromCharCode(0x80 | (cp & 0x3f));
              i++;
              continue;
            }
            o += String.fromCharCode(0xef, 0xbf, 0xbd);
          } else {
            o += String.fromCharCode(0xe0 | (c >> 12));
            o += String.fromCharCode(0x80 | ((c >> 6) & 0x3f));
            o += String.fromCharCode(0x80 | (c & 0x3f));
          }
        }
        return o;
      })(str);
      const mathPow = Math.pow;
      const maxWord = mathPow(2, 32);
      let result = '';
      const words = [];
      const asciiBitLength = str.length * 8;
      let hash = [], k = [];
      let primeCounter = 0;
      const isComposite = {};
      for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
        }
      }
      let s = str + '\x80';
      while (s.length % 64 - 56) s += '\x00';
      for (let i = 0; i < s.length; i++) {
        const j = s.charCodeAt(i);
        if (j >> 8) return '';
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
      }
      words[words.length] = ((asciiBitLength / maxWord) | 0);
      words[words.length] = (asciiBitLength | 0);
      for (let j = 0; j < words.length;) {
        const w = words.slice(j, j += 16);
        const oldHash = hash.slice(0);
        for (let i = 0; i < 64; i++) {
          const w15 = w[i-15], w2 = w[i-2];
          const a = hash[0], e = hash[4];
          const temp1 = hash[7]
            + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7))
            + ((e & hash[5]) ^ (~e & hash[6]))
            + k[i]
            + (w[i] = (i < 16) ? w[i] : (
              w[i-16]
              + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3))
              + w[i-7]
              + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10))
            ) | 0);
          const temp2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1+temp2)|0].concat(hash);
          hash[4] = (hash[4]+temp1)|0;
          hash.length = 8;
        }
        hash = hash.map((v,i) => (v+oldHash[i])|0);
      }
      hash.forEach(val => {
        for (let i = 3; i+1; i--) {
          const byte = (val>>(i*8))&255;
          result += ((byte<16)?'0':'') + byte.toString(16);
        }
      });
      return result;
    }

    // 블록 생성 — buyer_guid를 sentinel("bridge-in:{source_node}")로 두어
    // 이 L1의 발행==잔액합 불변식이 그대로 유지된다(실제 신규 발행이
    // 아니라 다른 L1에서 넘어온 금액이므로 totalMinted는 안 늘린다).
    const contentHash = sha256hex("bridge-in:" + tx_hash + ":" + guid + ":" + Date.now());
    const col = $app.dao().findCollectionByNameOrId("blocks");
    const rec = new Record(col);
    rec.set("block_type",       "bridge_in");
    rec.set("tx_hash",          tx_hash);
    rec.set("buyer_guid",       "bridge-in:" + source_node);
    rec.set("seller_guid",      guid);
    rec.set("buyer_sig",        "");
    rec.set("outputs",          JSON.stringify([{ recipient_guid: guid, amount: Number(amount) }]));
    rec.set("prev_block_hash",  "");
    rec.set("content_hash",     contentHash);
    rec.set("height",           0);
    rec.set("prev_settle_hash", "");
    $app.dao().saveRecord(rec);

    const biCol = $app.dao().findCollectionByNameOrId("bridge_in");
    const biRec = new Record(biCol);
    biRec.set("tx_hash",     tx_hash);
    biRec.set("source_node", source_node);
    biRec.set("guid",        guid);
    biRec.set("amount",      Number(amount));
    biRec.set("status",      "applied");
    biRec.set("applied_at",  new Date().toISOString());
    $app.dao().saveRecord(biRec);

    console.log("[BRIDGE-IN]", guid.slice(0,20), "+" + amount + "T ←", source_node);
    return c.json(200, { ok: true, applied: true, tx_hash, block_id: rec.getId() });
  } catch (e) {
    return c.json(500, { ok: false, error: "BRIDGE_IN_FAILED", detail: e.message });
  }
});

// GET /api/bridge-out/pending — Worker가 폴링해 재시도 대상을 찾는다.
// L1이 다른 L1을 직접 부르지 않으므로(P1), 재시도 오케스트레이션은 항상
// Worker 쪽 책임이다 — 이 엔드포인트는 그 폴링을 위한 조회 창구일 뿐이다.
routerAdd("GET", "/api/bridge-out/pending", (c) => {
  try {
    const bridge_secret = $apis.requestInfo(c).query.bridge_secret;
    const BRIDGE_SECRET = $os.getenv("BRIDGE_SECRET"); // 2026-07-19: 하드코딩 제거, 환경변수로 이관(공개 저장소 노출 방지)
    if (bridge_secret !== BRIDGE_SECRET) {
      return c.json(403, { ok: false, error: "FORBIDDEN", detail: "bridge_secret 불일치 — 이 엔드포인트는 Worker(허브)만 호출할 수 있습니다" });
    }
    const recs = $app.dao().findRecordsByFilter("bridge_out", "status = 'pending'", "-created", 500, 0);
    const pending = recs.map(r => ({
      tx_hash:     r.getString("tx_hash"),
      target_node: r.getString("target_node"),
      guid:        r.getString("guid"),
      amount:      r.getFloat("amount"),
      created_at:  r.getString("created_at"),
    }));
    return c.json(200, { ok: true, count: pending.length, pending });
  } catch (e) {
    return c.json(500, { ok: false, error: "BRIDGE_OUT_QUERY_FAILED", detail: e.message });
  }
});

// POST /api/bridge-out/complete — Worker가 대상 L1의 /api/bridge-in 성공을
// 확인한 뒤 호출. body: { tx_hash }
routerAdd("POST", "/api/bridge-out/complete", (c) => {
  try {
    const body = $apis.requestInfo(c).data;
    const { tx_hash, bridge_secret } = body;
    if (!tx_hash) return c.json(400, { ok: false, error: "MISSING_FIELD" });
    const BRIDGE_SECRET = $os.getenv("BRIDGE_SECRET"); // 2026-07-19: 하드코딩 제거, 환경변수로 이관(공개 저장소 노출 방지)
    if (bridge_secret !== BRIDGE_SECRET) {
      return c.json(403, { ok: false, error: "FORBIDDEN", detail: "bridge_secret 불일치 — 이 엔드포인트는 Worker(허브)만 호출할 수 있습니다" });
    }

    const rec = $app.dao().findFirstRecordByFilter("bridge_out", "tx_hash = '" + tx_hash + "'");
    if (!rec) return c.json(404, { ok: false, error: "NOT_FOUND" });
    rec.set("status", "completed");
    rec.set("completed_at", new Date().toISOString());
    $app.dao().saveRecord(rec);
    return c.json(200, { ok: true, tx_hash, status: "completed" });
  } catch (e) {
    return c.json(500, { ok: false, error: "BRIDGE_OUT_COMPLETE_FAILED", detail: e.message });
  }
});

// POST /api/bridge-out/refund — §5.1 유예시간(예: 1시간) 초과 시 Worker가
// 호출하는 보상 트랜잭션. sentinel("bridge-out:{target}")에서 원 구매자
// 에게 되돌리는 블록을 만들어, 실패한 브릿지 시도를 상쇄한다.
// body: { tx_hash, buyer_guid }
routerAdd("POST", "/api/bridge-out/refund", (c) => {
  try {
    const body = $apis.requestInfo(c).data;
    const { tx_hash, buyer_guid, bridge_secret } = body;
    if (!tx_hash || !buyer_guid) return c.json(400, { ok: false, error: "MISSING_FIELD" });
    const BRIDGE_SECRET = $os.getenv("BRIDGE_SECRET"); // 2026-07-19: 하드코딩 제거, 환경변수로 이관(공개 저장소 노출 방지)
    if (bridge_secret !== BRIDGE_SECRET) {
      return c.json(403, { ok: false, error: "FORBIDDEN", detail: "bridge_secret 불일치 — 이 엔드포인트는 Worker(허브)만 호출할 수 있습니다" });
    }

    const rec = $app.dao().findFirstRecordByFilter("bridge_out", "tx_hash = '" + tx_hash + "'");
    if (!rec) return c.json(404, { ok: false, error: "NOT_FOUND" });
    if (rec.getString("status") === "completed") {
      return c.json(409, { ok: false, error: "ALREADY_COMPLETED", detail: "이미 정상 완료된 브릿지는 환불할 수 없습니다" });
    }
    if (rec.getString("status") === "refunded") {
      return c.json(200, { ok: true, tx_hash, status: "refunded", already: true });
    }
    const targetNode = rec.getString("target_node");
    const amount     = rec.getFloat("amount");

    function sha256hex(str) {
      // 2026-07-18 버그 수정: 이 함수는 charCodeAt()이 256 이상(한글 등 비ASCII
      // 문자)이면 조용히 빈 문자열을 반환했다 — 코드포인트를 UTF-8 멀티바이트로
      // 인코딩하지 않고 1바이트로 취급하던 게 원인. 실제 GDC 이체 item_name
      // 기본값("GDC 이체") 하나만으로도 재현됨(sortedStringify(tx)에 포함되어
      // tx_hash 서버측 재계산이 매번 ''가 되고, 클라이언트가 보낸 진짜
      // tx_hash와 항상 달라 TX_HASH_MISMATCH로 거부됨 — 한글 상품명이 있는
      // 모든 K-Market 구매가 이 서명 검증 도입과 함께 깨질 뻔했다). 먼저
      // 문자열을 UTF-8 바이트열(각 char가 0~255인 문자열)로 변환한 뒤 기존
      // 알고리즘에 그대로 넘긴다 — Node TextEncoder와 결과 동일함을 실측
      // 검증(ASCII/한글/이모지 서로게이트쌍/혼합 문자 전부 일치).
      str = (function(s) {
        var o = '';
        for (var i = 0; i < s.length; i++) {
          var c = s.charCodeAt(i);
          if (c < 0x80) {
            o += String.fromCharCode(c);
          } else if (c < 0x800) {
            o += String.fromCharCode(0xc0 | (c >> 6));
            o += String.fromCharCode(0x80 | (c & 0x3f));
          } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
            var c2 = s.charCodeAt(i + 1);
            if (c2 >= 0xdc00 && c2 <= 0xdfff) {
              var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
              o += String.fromCharCode(0xf0 | (cp >> 18));
              o += String.fromCharCode(0x80 | ((cp >> 12) & 0x3f));
              o += String.fromCharCode(0x80 | ((cp >> 6) & 0x3f));
              o += String.fromCharCode(0x80 | (cp & 0x3f));
              i++;
              continue;
            }
            o += String.fromCharCode(0xef, 0xbf, 0xbd);
          } else {
            o += String.fromCharCode(0xe0 | (c >> 12));
            o += String.fromCharCode(0x80 | ((c >> 6) & 0x3f));
            o += String.fromCharCode(0x80 | (c & 0x3f));
          }
        }
        return o;
      })(str);
      const mathPow = Math.pow; const maxWord = mathPow(2, 32);
      let result = ''; const words = []; const asciiBitLength = str.length * 8;
      let hash = [], k = []; let primeCounter = 0; const isComposite = {};
      for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
        }
      }
      let s = str + '\x80';
      while (s.length % 64 - 56) s += '\x00';
      for (let i = 0; i < s.length; i++) {
        const j = s.charCodeAt(i); if (j >> 8) return '';
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
      }
      words[words.length] = ((asciiBitLength / maxWord) | 0);
      words[words.length] = (asciiBitLength | 0);
      for (let j = 0; j < words.length;) {
        const w = words.slice(j, j += 16); const oldHash = hash.slice(0);
        for (let i = 0; i < 64; i++) {
          const w15 = w[i-15], w2 = w[i-2]; const a = hash[0], e = hash[4];
          const temp1 = hash[7]
            + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7))
            + ((e & hash[5]) ^ (~e & hash[6])) + k[i]
            + (w[i] = (i < 16) ? w[i] : (
              w[i-16]
              + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3))
              + w[i-7]
              + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10))
            ) | 0);
          const temp2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1+temp2)|0].concat(hash);
          hash[4] = (hash[4]+temp1)|0; hash.length = 8;
        }
        hash = hash.map((v,i) => (v+oldHash[i])|0);
      }
      hash.forEach(val => { for (let i = 3; i+1; i--) {
        const byte = (val>>(i*8))&255; result += ((byte<16)?'0':'') + byte.toString(16);
      }});
      return result;
    }

    const contentHash = sha256hex("bridge-refund:" + tx_hash + ":" + Date.now());
    const col = $app.dao().findCollectionByNameOrId("blocks");
    const refundRec = new Record(col);
    refundRec.set("block_type",       "bridge_refund");
    refundRec.set("tx_hash",          tx_hash + ":refund");
    refundRec.set("buyer_guid",       "bridge-out:" + targetNode); // sentinel에서 차감
    refundRec.set("seller_guid",      buyer_guid);
    refundRec.set("buyer_sig",        "");
    refundRec.set("outputs",          JSON.stringify([{ recipient_guid: buyer_guid, amount }]));
    refundRec.set("prev_block_hash",  "");
    refundRec.set("content_hash",     contentHash);
    refundRec.set("height",           0);
    refundRec.set("prev_settle_hash", "");
    $app.dao().saveRecord(refundRec);

    rec.set("status", "refunded");
    rec.set("refunded_at", new Date().toISOString());
    $app.dao().saveRecord(rec);

    console.warn("[BRIDGE-REFUND]", tx_hash, "→", buyer_guid, "+" + amount + "T (원 대상:", targetNode, ")");
    return c.json(200, { ok: true, tx_hash, status: "refunded", block_id: refundRec.getId() });
  } catch (e) {
    return c.json(500, { ok: false, error: "BRIDGE_REFUND_FAILED", detail: e.message });
  }
});

routerAdd("GET", "/health", (c) => {
const NODE_CONFIG = {
  "hanlim": { id: "KR-JEJU-JEJU-HANLIM", layer: 1, port: 8091, parentUrl: "http://127.0.0.1:8092" },
  "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL", layer: 1, port: 8101, parentUrl: "http://127.0.0.1:8092" },
  "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON", layer: 1, port: 8102, parentUrl: "http://127.0.0.1:8092" },
  "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA", layer: 1, port: 8103, parentUrl: "http://127.0.0.1:8092" },
  "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG", layer: 1, port: 8104, parentUrl: "http://127.0.0.1:8092" },
  "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA", layer: 1, port: 8105, parentUrl: "http://127.0.0.1:8092" },
  "l1-udo": { id: "KR-JEJU-JEJU-UDO", layer: 1, port: 8106, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1", layer: 1, port: 8107, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2", layer: 1, port: 8108, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido1": { id: "KR-JEJU-JEJU-IDO1", layer: 1, port: 8109, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido2": { id: "KR-JEJU-JEJU-IDO2", layer: 1, port: 8110, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1", layer: 1, port: 8111, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2", layer: 1, port: 8112, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1", layer: 1, port: 8113, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2", layer: 1, port: 8114, parentUrl: "http://127.0.0.1:8092" },
  "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP", layer: 1, port: 8115, parentUrl: "http://127.0.0.1:8092" },
  "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK", layer: 1, port: 8116, parentUrl: "http://127.0.0.1:8092" },
  "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG", layer: 1, port: 8117, parentUrl: "http://127.0.0.1:8092" },
  "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE", layer: 1, port: 8118, parentUrl: "http://127.0.0.1:8092" },
  "l1-ara": { id: "KR-JEJU-JEJU-ARA", layer: 1, port: 8119, parentUrl: "http://127.0.0.1:8092" },
  "l1-ora": { id: "KR-JEJU-JEJU-ORA", layer: 1, port: 8120, parentUrl: "http://127.0.0.1:8092" },
  "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG", layer: 1, port: 8121, parentUrl: "http://127.0.0.1:8092" },
  "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG", layer: 1, port: 8122, parentUrl: "http://127.0.0.1:8092" },
  "l1-oedo": { id: "KR-JEJU-JEJU-OEDO", layer: 1, port: 8123, parentUrl: "http://127.0.0.1:8092" },
  "l1-iho": { id: "KR-JEJU-JEJU-IHO", layer: 1, port: 8124, parentUrl: "http://127.0.0.1:8092" },
  "l1-dodu": { id: "KR-JEJU-JEJU-DODU", layer: 1, port: 8125, parentUrl: "http://127.0.0.1:8092" },
  "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG", layer: 1, port: 8126, parentUrl: "http://127.0.0.1:8093" },
  "l1-namwon": { id: "KR-JEJU-SGP-NAMWON", layer: 1, port: 8127, parentUrl: "http://127.0.0.1:8093" },
  "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN", layer: 1, port: 8128, parentUrl: "http://127.0.0.1:8093" },
  "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK", layer: 1, port: 8129, parentUrl: "http://127.0.0.1:8093" },
  "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON", layer: 1, port: 8130, parentUrl: "http://127.0.0.1:8093" },
  "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN", layer: 1, port: 8131, parentUrl: "http://127.0.0.1:8093" },
  "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG", layer: 1, port: 8132, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP", layer: 1, port: 8133, parentUrl: "http://127.0.0.1:8093" },
  "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI", layer: 1, port: 8134, parentUrl: "http://127.0.0.1:8093" },
  "l1-hyodon": { id: "KR-JEJU-SGP-HYODON", layer: 1, port: 8135, parentUrl: "http://127.0.0.1:8093" },
  "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON", layer: 1, port: 8136, parentUrl: "http://127.0.0.1:8093" },
  "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG", layer: 1, port: 8137, parentUrl: "http://127.0.0.1:8093" },
  "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG", layer: 1, port: 8138, parentUrl: "http://127.0.0.1:8093" },
  "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN", layer: 1, port: 8139, parentUrl: "http://127.0.0.1:8093" },
  "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON", layer: 1, port: 8140, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN", layer: 1, port: 8141, parentUrl: "http://127.0.0.1:8093" },
  "l1-yerae": { id: "KR-JEJU-SGP-YERAE", layer: 1, port: 8142, parentUrl: "http://127.0.0.1:8093" },
  "l2-jeju": { id: "KR-JEJU-JEJU-SI", layer: 2, port: 8092, parentUrl: "http://127.0.0.1:8094" },
  "l2-seogwipo": { id: "KR-JEJU-SGP-SI", layer: 2, port: 8093, parentUrl: "http://127.0.0.1:8094" },
  "l3-jejudo": { id: "KR-JEJU", layer: 3, port: 8094, parentUrl: "http://127.0.0.1:8095" },
  "l4-kr": { id: "KR", layer: 4, port: 8095, parentUrl: "http://127.0.0.1:8096" },
  "l5-global": { id: "GLOBAL", layer: 5, port: 8096, parentUrl: null },
};
  const name = $app.dataDir().split("/").pop();
  const self = NODE_CONFIG[name] || NODE_CONFIG["hanlim"];
  return c.json(200, { ok: true, node: self.id, layer: self.layer, type: "real", timestamp: new Date().toISOString() });
});

routerAdd("GET", "/merkle", (c) => {
  let chainLength = 0, recent = [], myRoot = null;
  try {
    const all    = $app.dao().findRecordsByFilter("node_ledger", "1=1", "-created", 0, 0);
    const hashes = all.map(r => r.getString("child_root")).filter(Boolean);
    chainLength  = hashes.length;
    let layer = [...hashes];
    if (layer.length === 0) { myRoot = "GENESIS"; }
    else if (layer.length === 1) { myRoot = layer[0]; }
    else {
      while (layer.length > 1) {
        const next = [];
        for (let i = 0; i < layer.length; i += 2)
          next.push($security.md5(layer[i] + (layer[i+1] || layer[i])));
        layer = next;
      }
      myRoot = layer[0];
    }
    recent = all.slice(0, 10).map(r => ({
      child_node:  r.getString("child_node"),
      child_root:  r.getString("child_root"),
      merkle_root: r.getString("merkle_root"),
      parent_root: r.getString("parent_root"),
      propagated:  r.getBool("propagated"),
      created:     r.getString("created"),
    }));
  } catch {
    try {
      const all    = $app.dao().findRecordsByFilter("l1_ledger", "1=1", "-created", 0, 0);
      const hashes = all.map(r => r.getString("leaf_hash")).filter(Boolean);
      chainLength  = hashes.length;
      let layer = [...hashes];
      if (layer.length === 0) { myRoot = "GENESIS"; }
      else if (layer.length === 1) { myRoot = layer[0]; }
      else {
        while (layer.length > 1) {
          const next = [];
          for (let i = 0; i < layer.length; i += 2)
            next.push($security.md5(layer[i] + (layer[i+1] || layer[i])));
          layer = next;
        }
        myRoot = layer[0];
      }
      recent = all.slice(0, 10).map(r => ({
        tx_id:       r.getString("tx_id"),
        leaf_hash:   r.getString("leaf_hash"),
        parent_root: r.getString("parent_root"),
        created:     r.getString("created"),
      }));
    } catch {}
  }
  return c.json(200, { ok: true, chain_length: chainLength, merkle_root: myRoot, recent, timestamp: new Date().toISOString() });
});

routerAdd("POST", "/tx", (c) => {
  const body = $apis.requestInfo(c).data;
  const { tx_id, leaf_hash, from_guid, tx_type, signature, pubkey } = body;
  if (!tx_id || !leaf_hash) return c.json(400, { ok: false, error: "MISSING_FIELD" });
  let rec;
  try {
    const col = $app.dao().findCollectionByNameOrId("l1_ledger");
    rec = new Record(col);
    rec.set("tx_id",      tx_id);
    rec.set("tx_type",    tx_type   || "TX");
    rec.set("from_guid",  from_guid || "");
    rec.set("leaf_hash",  leaf_hash);
    rec.set("signature",  signature || "");
    rec.set("pubkey",     pubkey    || "");
    rec.set("l1_node",    NODE_ID);
    rec.set("parent_root", "");
    $app.dao().saveRecord(rec);
  } catch(e) {
    return c.json(500, { ok: false, error: "l1_ledger 저장 실패: " + e.message });
  }
  let myRoot = leaf_hash;
  try {
    const all = $app.dao().findRecordsByFilter("l1_ledger", "leaf_hash != ''", "-created", 10000, 0);
    let layer = all.map(r => r.getString("leaf_hash")).filter(Boolean);
    if (layer.length > 1) {
      while (layer.length > 1) {
        const next = [];
        for (let i = 0; i < layer.length; i += 2)
          next.push($security.md5(layer[i] + (layer[i+1] || layer[i])));
        layer = next;
      }
    }
    myRoot = layer[0] || leaf_hash;
  } catch(e) { console.log("[L1] Merkle 실패:", e.message); }
  let parentRoot = null;
  try {
    const resp = $http.send({
      url: "http://127.0.0.1:8092/push_root",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ child_node: NODE_ID, child_root: myRoot }),
    });
    parentRoot = JSON.parse(resp.raw).parent_root || null;
  } catch(e) { console.log("[L1] L2 전파 실패:", e.message); }
  if (parentRoot && rec) {
    try { rec.set("parent_root", parentRoot); $app.dao().saveRecord(rec); } catch(e) {}
  }
  return c.json(200, { ok: true, node: NODE_ID, tx_id, leaf_hash, merkle_root: myRoot, parent_root: parentRoot });
});

routerAdd("POST", "/push_root", (c) => {
  const body = $apis.requestInfo(c).data;
  const { child_node, child_root } = body;
  if (!child_node || !child_root) return c.json(400, { ok: false, error: "MISSING_FIELD" });
const NODE_CONFIG = {
  "hanlim": { id: "KR-JEJU-JEJU-HANLIM", layer: 1, port: 8091, parentUrl: "http://127.0.0.1:8092" },
  "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL", layer: 1, port: 8101, parentUrl: "http://127.0.0.1:8092" },
  "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON", layer: 1, port: 8102, parentUrl: "http://127.0.0.1:8092" },
  "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA", layer: 1, port: 8103, parentUrl: "http://127.0.0.1:8092" },
  "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG", layer: 1, port: 8104, parentUrl: "http://127.0.0.1:8092" },
  "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA", layer: 1, port: 8105, parentUrl: "http://127.0.0.1:8092" },
  "l1-udo": { id: "KR-JEJU-JEJU-UDO", layer: 1, port: 8106, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1", layer: 1, port: 8107, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2", layer: 1, port: 8108, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido1": { id: "KR-JEJU-JEJU-IDO1", layer: 1, port: 8109, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido2": { id: "KR-JEJU-JEJU-IDO2", layer: 1, port: 8110, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1", layer: 1, port: 8111, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2", layer: 1, port: 8112, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1", layer: 1, port: 8113, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2", layer: 1, port: 8114, parentUrl: "http://127.0.0.1:8092" },
  "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP", layer: 1, port: 8115, parentUrl: "http://127.0.0.1:8092" },
  "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK", layer: 1, port: 8116, parentUrl: "http://127.0.0.1:8092" },
  "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG", layer: 1, port: 8117, parentUrl: "http://127.0.0.1:8092" },
  "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE", layer: 1, port: 8118, parentUrl: "http://127.0.0.1:8092" },
  "l1-ara": { id: "KR-JEJU-JEJU-ARA", layer: 1, port: 8119, parentUrl: "http://127.0.0.1:8092" },
  "l1-ora": { id: "KR-JEJU-JEJU-ORA", layer: 1, port: 8120, parentUrl: "http://127.0.0.1:8092" },
  "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG", layer: 1, port: 8121, parentUrl: "http://127.0.0.1:8092" },
  "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG", layer: 1, port: 8122, parentUrl: "http://127.0.0.1:8092" },
  "l1-oedo": { id: "KR-JEJU-JEJU-OEDO", layer: 1, port: 8123, parentUrl: "http://127.0.0.1:8092" },
  "l1-iho": { id: "KR-JEJU-JEJU-IHO", layer: 1, port: 8124, parentUrl: "http://127.0.0.1:8092" },
  "l1-dodu": { id: "KR-JEJU-JEJU-DODU", layer: 1, port: 8125, parentUrl: "http://127.0.0.1:8092" },
  "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG", layer: 1, port: 8126, parentUrl: "http://127.0.0.1:8093" },
  "l1-namwon": { id: "KR-JEJU-SGP-NAMWON", layer: 1, port: 8127, parentUrl: "http://127.0.0.1:8093" },
  "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN", layer: 1, port: 8128, parentUrl: "http://127.0.0.1:8093" },
  "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK", layer: 1, port: 8129, parentUrl: "http://127.0.0.1:8093" },
  "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON", layer: 1, port: 8130, parentUrl: "http://127.0.0.1:8093" },
  "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN", layer: 1, port: 8131, parentUrl: "http://127.0.0.1:8093" },
  "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG", layer: 1, port: 8132, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP", layer: 1, port: 8133, parentUrl: "http://127.0.0.1:8093" },
  "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI", layer: 1, port: 8134, parentUrl: "http://127.0.0.1:8093" },
  "l1-hyodon": { id: "KR-JEJU-SGP-HYODON", layer: 1, port: 8135, parentUrl: "http://127.0.0.1:8093" },
  "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON", layer: 1, port: 8136, parentUrl: "http://127.0.0.1:8093" },
  "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG", layer: 1, port: 8137, parentUrl: "http://127.0.0.1:8093" },
  "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG", layer: 1, port: 8138, parentUrl: "http://127.0.0.1:8093" },
  "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN", layer: 1, port: 8139, parentUrl: "http://127.0.0.1:8093" },
  "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON", layer: 1, port: 8140, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN", layer: 1, port: 8141, parentUrl: "http://127.0.0.1:8093" },
  "l1-yerae": { id: "KR-JEJU-SGP-YERAE", layer: 1, port: 8142, parentUrl: "http://127.0.0.1:8093" },
  "l2-jeju": { id: "KR-JEJU-JEJU-SI", layer: 2, port: 8092, parentUrl: "http://127.0.0.1:8094" },
  "l2-seogwipo": { id: "KR-JEJU-SGP-SI", layer: 2, port: 8093, parentUrl: "http://127.0.0.1:8094" },
  "l3-jejudo": { id: "KR-JEJU", layer: 3, port: 8094, parentUrl: "http://127.0.0.1:8095" },
  "l4-kr": { id: "KR", layer: 4, port: 8095, parentUrl: "http://127.0.0.1:8096" },
  "l5-global": { id: "GLOBAL", layer: 5, port: 8096, parentUrl: null },
};
  const name = $app.dataDir().split("/").pop();
  const self = NODE_CONFIG[name] || NODE_CONFIG["hanlim"];
  let rec;
  try {
    const col = $app.dao().findCollectionByNameOrId("node_ledger");
    try { rec = $app.dao().findFirstRecordByFilter("node_ledger", "child_node = '" + child_node + "'"); }
    catch { rec = new Record(col); }
    rec.set("child_node",  child_node);
    rec.set("child_root",  child_root);
    rec.set("layer",       self.layer);
    rec.set("propagated",  false);
    rec.set("parent_root", "");
    $app.dao().saveRecord(rec);
  } catch(e) {
    return c.json(500, { ok: false, error: "저장 실패: " + e.message });
  }
  let myRoot = child_root;
  try {
    const all = $app.dao().findRecordsByFilter("node_ledger", "1=1", "-created", 0, 0);
    let layer = all.map(r => r.getString("child_root")).filter(Boolean);
    if (layer.length > 1) {
      while (layer.length > 1) {
        const next = [];
        for (let i = 0; i < layer.length; i += 2)
          next.push($security.md5(layer[i] + (layer[i+1] || layer[i])));
        layer = next;
      }
    }
    myRoot = layer[0] || child_root;
  } catch(e) { console.log("[" + self.id + "] Merkle 실패:", e.message); }
  let parentRoot = null;
  if (self.parentUrl) {
    try {
      const resp = $http.send({
        url: self.parentUrl + "/push_root",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ child_node: self.id, child_root: myRoot }),
      });
      parentRoot = JSON.parse(resp.raw).parent_root || null;
    } catch(e) { console.log("[" + self.id + "] 상위 전파 실패:", e.message); }
  } else {
    parentRoot = myRoot;
  }
  try {
    rec.set("merkle_root", myRoot);
    rec.set("parent_root", parentRoot || "");
    rec.set("propagated",  true);
    $app.dao().saveRecord(rec);
  } catch(e) {}
  return c.json(200, { ok: true, node: self.id, child_node, merkle_root: myRoot, parent_root: parentRoot });
});

// ── 전화번호 소유 검증 훅 (2026-07-15 신설) ──────────────────────
// worker.js POST /biz/phone-otp-verify가 발급한 phone_verify_token을
// 재검증한다. profiles 생성 요청에 e164가 있는데 토큰이 없거나
// 위조/번호불일치/만료면 생성 자체를 거부한다 — 이게 없으면
// 누구나 타인의 전화번호를 자칭해 가입할 수 있다(대화 중 발견①).
//
// 토큰 형식: '{e164}:{만료ms}' + '.' + hex(HMAC-SHA256(그 앞부분, secret))
// worker.js의 handlePhoneOtpVerify()와 정확히 동일한 방식이어야 함.
//
// 필요한 환경변수: PHONE_VERIFY_SECRET
//   systemd unit(Environment=PHONE_VERIFY_SECRET=...) 또는 .env로 설정.
//   worker.js의 wrangler secret PHONE_VERIFY_SECRET과 반드시 동일한 값.
//   (실제 PocketBase v0.22.14 바이너리로 $security.hs256()이 Node의
//   crypto.createHmac('sha256',...)와 동일한 hex를 내는 것까지 검증 완료.)
onRecordBeforeCreateRequest((e) => {
  if (e.collection.name !== "profiles") return;

  const info = $apis.requestInfo(e.httpContext);
  const e164 = info.data.e164;
  if (!e164) return; // 전화번호 없는 생성(게스트 등)은 검증 대상 아님

  const secret = $os.getenv("PHONE_VERIFY_SECRET");
  if (!secret) {
    throw new BadRequestError("PHONE_VERIFY_SECRET 미설정 — 관리자에게 문의하세요");
  }

  const token = info.data.phone_verify_token;
  if (!token || typeof token !== "string" || token.indexOf(".") === -1) {
    throw new BadRequestError("전화번호 인증이 필요합니다(phone_verify_token 누락)");
  }

  const dotIdx = token.indexOf(".");
  const payload = token.substring(0, dotIdx);
  const signature = token.substring(dotIdx + 1);

  const expectedSig = $security.hs256(payload, secret);
  if (!$security.equal(expectedSig, signature)) {
    throw new BadRequestError("인증 토큰 서명이 유효하지 않습니다");
  }

  const segs = payload.split(":");
  const tokenE164 = segs[0];
  const exp = parseInt(segs[1], 10);

  if (tokenE164 !== e164) {
    throw new BadRequestError("인증된 번호와 가입 요청 번호가 일치하지 않습니다");
  }
  if (!exp || Date.now() > exp) {
    throw new BadRequestError("인증 토큰이 만료됐습니다. 인증번호를 다시 요청해 주세요");
  }

  // ── 번호 재활용(재클레임) 시 "덮어쓰기" 처리 (2026-09-06 신설) ──────
  // 전화번호 소유는 방금 phone_verify_token으로 검증됐다. 하지만 이 번호로
  // 이미 클레임된 profiles 레코드가 있을 수 있다 — 통신사가 해지된 번호를
  // 다른 사람에게 재배정한 경우가 대표적이다.
  //
  // 배경: 기존엔 guid = SHA-256('gopang-phone:'+e164)로 전화번호에서
  // 결정론적으로 계산됐다 — 같은 번호로 재가입하면 항상 같은 guid가
  // 나왔고, 그 guid에 연결된 ledger/blocks의 예전 잔액·거래이력을 새
  // 소유자가 그대로 물려받는 결함이 있었다(2026-09-06 실사로 발견).
  // 클라이언트(src/gopang/core/auth.js의 _e164ToIPv6)는 이제 전화번호와
  // 무관한 CSPRNG로 guid를 생성하도록 고쳤다 — 이 훅은 그 짝으로,
  // "같은 e164를 가리키는 레코드는 항상 최신 클레임 하나만"을 보장한다.
  //
  // 처리: 기존 레코드가 있으면 삭제하지 않고 claim_status를
  // "superseded"로 표시하고 e164/handle을 비워 더 이상 로그인 조회에
  // 안 걸리게 한다 — 예전 guid에 연결된 ledger/blocks 등 이력은 감사
  // 추적용으로 그대로 남지만, 새로 클레임한 사람에게 자동으로 다시
  // 연결되지는 않는다(이게 이번 수정의 핵심 — 데이터를 지우는 게 아니라
  // "더 이상 이 전화번호로는 못 찾게" 끊어내는 것).
  try {
    const dupes = $app.dao().findRecordsByFilter(
      "profiles",
      `e164 = '${e164}' && claim_status != 'superseded'`,
      "",
      10,
      0
    );
    for (const old of dupes) {
      const oldGuid = old.getString("guid");
      old.set("claim_status", "superseded");
      old.set("e164", "");
      old.set("handle", (old.getString("handle") || "") + "_superseded_" + Date.now());
      let extra = {};
      try { extra = JSON.parse(old.getString("extra") || "{}"); } catch (_) {}
      extra.superseded_at = new Date().toISOString();
      extra.superseded_reason = "phone_reclaimed";
      extra.superseded_guid = oldGuid;
      old.set("extra", JSON.stringify(extra));
      $app.dao().saveRecord(old);
      console.log(`[PHONE-RECLAIM] e164=${e164} 이전 guid=${oldGuid} → superseded 처리 완료`);
    }
  } catch (err) {
    // 조회/저장이 실패해도 신규 가입 자체를 막지는 않는다 — best-effort
    // 방어이며, TOFU(pubkey 최초 등록)가 여전히 최소한의 방어선이다.
    console.log(`[PHONE-RECLAIM] 처리 중 오류(무시하고 가입 계속): ${err.message}`);
  }

  // ── 서버측 pubkey 재사용 탐지 (2026-09-06 신설, §2.4) ────────────────
  // 정상적인 새 키페어는 이 세상에 유일해야 한다 — 클라이언트가 매번
  // crypto.getRandomValues()로 새로 생성하기 때문이다(auth.js
  // _generateRandomGuid와 별개로, Ed25519 키페어 자체도 매 기기·매
  // 가입마다 새로 만들어지는 게 정상). 그런데 이 pubkey가 이미 "다른"
  // guid에 등록된 적이 있다면, 그건 새 키페어가 아니라 이 기기에 남아있던
  // 누군가의 기존 키를 그대로 재사용했다는 뜻이다 — 중고폰에 이전
  // 소유자의 지갑이 남아있는 상태에서 신규가입한 경우가 대표적이다
  // (실사로 확인된 시나리오: wallet.load()가 "이 기기엔 이미 지갑이
  // 있다"고 판단해 이전 소유자의 키페어를 그대로 재사용하고, 그 위에
  // 새 신원만 얹는 결함 — docs/BIOMETRIC_WALLET_SECURITY_REDESIGN_
  // 2026-09-06.md §2.2가 클라이언트 쪽 근본 해법이고, 이건 그게 뚫려도
  // (구버전 캐시된 JS, 버그 등) 걸리는 마지막 안전망이다).
  //
  // 이 검사는 정상적인 새 키페어라면 이론상 절대 안 걸린다 — 걸린다는
  // 사실 자체가 강한 이상 신호다. superseded된 과거 레코드도 포함해서
  // 검사한다(superseded라고 그 pubkey가 안전해지는 건 아니다 — 그
  // 키를 쥔 사람이 여전히 서명 가능하다는 사실은 안 바뀐다).
  try {
    const newPubkey = e.record.getString("pubkey_ed25519");
    if (newPubkey) {
      const newGuid = e.record.getString("guid");
      const dupPubkey = $app.dao().findRecordsByFilter(
        "profiles",
        `pubkey_ed25519 = '${newPubkey}' && guid != '${newGuid}'`,
        "", 1, 0
      );
      if (dupPubkey.length > 0) {
        throw new BadRequestError(
          "이 공개키는 이미 다른 계정에 등록된 적이 있습니다(REUSED_PUBKEY) — " +
          "이 기기에 이전 사용자의 지갑이 남아있을 수 있습니다. 앱에서 기기를 " +
          "초기화한 뒤 다시 시도해 주세요."
        );
      }
    }
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    // 조회 자체가 실패한 경우는 best-effort 원칙대로 가입을 막지 않는다.
    console.log(`[PUBKEY-REUSE-CHECK] 처리 중 오류(무시하고 가입 계속): ${err.message}`);
  }
}, "profiles");

// ── 잔액/거래이력 공용 유틸 (2026-09-06 신설) ───────────────────────
// computeBalance 로직을 여러 훅(삭제 방어, PATCH 최초 바인딩 방어)에서
// 재사용하기 위해 여기로 뺐다. 주의: 이 프로젝트의 PocketBase Goja
// 엔진은 콜백 바깥의 "최상위 function 이름(){} 선언"을 조용히 무시하는
// 제약이 실사로 확인됐다(파일 상단 _sigVerify 관련 기존 주석 참고) —
// 하지만 "최상위 var에 즉시실행함수(IIFE)의 반환값(객체)을 담는" 패턴은
// 실제로 동작한다(_sigVerify 자체가 그 증거). 그래서 같은 패턴으로
// 감싼다 — bare function 선언이 아니라 var 대입이라는 게 핵심이다.
var _balanceUtils = (function() {
  function computeBalance(guid) {
    const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 10000, 0);
    let balance = 0;
    for (const b of allBlocks) {
      let blkOutputs;
      try { blkOutputs = JSON.parse(b.getString("outputs") || "[]"); } catch (_) { continue; }
      for (const o of blkOutputs) {
        if (o.recipient_guid === guid) balance += (o.amount || 0);
      }
      if (b.getString("buyer_guid") === guid) {
        const total = blkOutputs.reduce((s, o) => s + (o.amount || 0), 0);
        balance -= total;
      }
    }
    return balance;
  }

  function hasHistory(guid) {
    const anyBlock = $app.dao().findRecordsByFilter(
      "blocks",
      `buyer_guid = '${guid}' || seller_guid = '${guid}'`,
      "",
      1,
      0
    );
    return anyBlock.length > 0;
  }

  // 삭제/PATCH 훅 둘 다 "잔액도 확인하고 이력도 확인"하는 동일한 순회를
  // 두 번(computeBalance + hasHistory 각각 findRecordsByFilter 전체
  // 스캔) 하게 되는 비효율을 피하려고, 한 번의 순회로 둘 다 구하는
  // 조합 함수도 같이 제공한다. 호출부는 필요에 맞게 골라 쓰면 된다.
  function computeBalanceAndHistory(guid) {
    const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 10000, 0);
    let balance = 0;
    let hasHist = false;
    for (const b of allBlocks) {
      let blkOutputs;
      try { blkOutputs = JSON.parse(b.getString("outputs") || "[]"); } catch (_) { continue; }
      for (const o of blkOutputs) {
        if (o.recipient_guid === guid) balance += (o.amount || 0);
      }
      const buyerGuid = b.getString("buyer_guid");
      const sellerGuid = b.getString("seller_guid");
      if (buyerGuid === guid) {
        const total = blkOutputs.reduce((s, o) => s + (o.amount || 0), 0);
        balance -= total;
      }
      if (buyerGuid === guid || sellerGuid === guid) hasHist = true;
    }
    return { balance: balance, hasHistory: hasHist };
  }

  return {
    computeBalance: computeBalance,
    hasHistory: hasHistory,
    computeBalanceAndHistory: computeBalanceAndHistory,
  };
})();

// ── 프로필 하드 삭제 방어 훅 (2026-09-06 신설) ──────────────────────
// 배경: 테스트/봇 계정 정리 스크립트가 profiles를 DELETE API로 직접
// 지우는 걸 실사로 확인했는데, 이 API는 guid에 잔액이나 거래이력이
// 있는지 전혀 확인하지 않는다 — 실사용자 계정이 실수로 같은 방식으로
// 지워지면, ledger/blocks엔 그 guid의 거래 기록이 계속 남아있는데
// 정작 신원(프로필) 레코드만 사라지는 상태가 된다(오늘 실제로 겪은
// "레코드가 통째로 사라진" 사고와 같은 유형의 위험).
//
// 처리: 잔액이 0이 아니거나 blocks에 거래이력이 있는 계정은 하드
// 삭제를 거부한다. 정말 지워야 한다면(예: 사용자 본인 요청에 의한
// 계정 삭제) 요청 바디/쿼리에 force_delete=true를 명시해야 한다 —
// 이 경우에도 삭제 자체를 막지는 않지만, 최소한 "잔액/이력이 있는
// 걸 알고도 삭제한다"는 명시적 의사표시를 요구한다.
//
// admin(superuser) 인증 요청은 예외 없이 이 검사를 그대로 받는다 —
// 오늘 사고가 정확히 admin 토큰으로 실행된 스크립트였기 때문이다.
onRecordBeforeDeleteRequest((e) => {
  if (e.collection.name !== "profiles") return;

  const info = $apis.requestInfo(e.httpContext);
  const guid = e.record.getString("guid");
  if (!guid) return; // guid 없는(비정상) 레코드는 기존 동작 유지

  const forced = info.data.force_delete === true || info.data.force_delete === "true"
    || info.query.force_delete === "true";

  // computeBalance/hasHistory는 이제 파일 상단의 _balanceUtils(top-level
  // var + IIFE 패턴)로 공용화했다 — 이 콜백 안에서 중복 재정의하지 않는다.
  let balance = 0;
  let hasHistory = false;
  try {
    const result = _balanceUtils.computeBalanceAndHistory(guid);
    balance = result.balance;
    hasHistory = result.hasHistory;
  } catch (err) {
    // 조회 자체가 실패하면 안전한 쪽(삭제 차단)으로 판단한다 —
    // "확인 못 했으니 통과시킨다"가 아니라 "확인 못 했으니 막는다".
    if (!forced) {
      throw new BadRequestError(
        `삭제 전 잔액/이력 확인에 실패했습니다(${err.message}). ` +
        `그래도 삭제하려면 force_delete=true를 명시하세요.`
      );
    }
    return;
  }

  if (!forced && (balance !== 0 || hasHistory)) {
    throw new BadRequestError(
      `이 계정은 잔액(${balance}) 또는 거래이력이 있어 하드 삭제할 수 없습니다. ` +
      `정말 삭제해야 한다면 요청에 force_delete=true를 명시하세요(비가역 — 신중히 결정하세요).`
    );
  }
}, "profiles");

// ── 프로필 수정(PATCH) 서명 검증 훅 (2026-07-19 신설) ───────────────
// 생성(onRecordBeforeCreateRequest)에는 phone_verify_token 검증이 있었지만
// 수정에는 그런 훅이 전혀 없었다(실사로 발견) — 그리고 profiles 컬렉션의
// PocketBase updateRule("guid = @request.data.guid")은 요청 바디에 담긴
// guid를 레코드 자신의 guid와 비교하는 조건인데, guid는 프로필을 한 번이라도
// 스캔/조회하면 누구나 아는 공개 정보라 사실상 아무 인증도 아니다. 게다가
// L1_URL(PocketBase REST API)이 클라이언트 코드(core/state.js)에 그대로
// 하드코딩돼 브라우저에서 직접 접근 가능하므로, worker.js의
// handleProfilePost() Ed25519 서명 검증을 완전히 우회해 이 API에 직접
// PATCH를 보내는 경로가 열려 있었다 — 이 훅이 그 공백을 메운다.
//
// 서명 대상은 worker.js handleProfilePost()와 정확히 동일한 포맷이다:
//   sigMsg = `${guid}:${pubkey}:${ts}`
// 클라이언트는 기존과 동일한 서명 로직을 그대로 쓰면 되고 별도 변경이
// 필요 없다 — 이 훅은 서버측 재검증(defense-in-depth)이며, worker.js가
// 이미 하는 검증(TOFU pubkey 고정, handleProfilePost 11858행 부근
// PUBKEY_MISMATCH 체크)을 PocketBase 계층에서도 동일하게 강제한다.
//
// e.record는 이미 요청 바디 값이 바인딩된 상태일 수 있어 TOFU 비교
// 기준으로 신뢰할 수 없다 — 반드시 DB에서 갱신 전 원본을 별도로 다시
// 읽어와 비교한다.
onRecordBeforeUpdateRequest((e) => {
  if (e.collection.name !== "profiles") return;

  const info = $apis.requestInfo(e.httpContext);

  // 2026-07-19 긴급 수정: admin(superuser) 인증 요청은 서명 검증을 건너뛴다.
  // admin 토큰은 hondi-proxy Worker만 보유 — 이미 자체 Ed25519 검증을
  // 거쳤거나(handleProfilePost 주 경로) 사용자 서명 개념이 없는 신뢰된
  // 서버 내부 작업(SP 병합·미청구 프로필 생성·업종 자동갱신 등)이다.
  // 이 예외가 없으면 그 경로들이 전부 깨진다(실사로 발견 — 2026-07-19,
  // l1-hanlim에서 재현·수정·검증 완료).
  if (info.admin) return;

  const { guid, pubkey, signature } = info.data;
  const ts = info.data.ts || "";

  if (!guid || !pubkey || !signature) {
    throw new BadRequestError("프로필 수정에는 guid, pubkey, signature가 필요합니다");
  }

  let original;
  try {
    original = $app.dao().findRecordById("profiles", e.record.getId());
  } catch (err) {
    throw new BadRequestError("원본 레코드 조회 실패: " + err.message);
  }

  if (guid !== original.getString("guid")) {
    throw new BadRequestError("guid가 대상 레코드와 일치하지 않습니다");
  }

  // TOFU: 최초 등록 시 핀(pin)된 pubkey와 다른 키로는 이 프로필을
  // 수정할 수 없다 — worker.js handleProfilePost()와 동일한 정책.
  const registeredPubkey = original.getString("pubkey_ed25519");
  if (registeredPubkey && registeredPubkey !== pubkey) {
    throw new BadRequestError("공개키가 이 계정에 등록된 키와 일치하지 않습니다(PUBKEY_MISMATCH)");
  }

  // ── 최초 키 바인딩 추가 방어 (2026-09-06 신설) ─────────────────────
  // registeredPubkey가 비어있으면 위 TOFU 검사는 그냥 통과한다 — "아직
  // 아무도 이 프로필의 키를 등록 안 한 상태"이기 때문이다. 문제: guid는
  // 공개 정보다(GET /profile?guid=는 인증 불필요, 부록 A 참고). 이
  // guid에 이미 잔액/거래이력이 쌓여 있는데 pubkey만 비어있다면, 그
  // 사실을 아는 누구나 자기 키페어로 서명만 만들어 PATCH를 보내 최초
  // 바인딩을 가로챌 수 있다 — 전화번호 소유 검증이 전혀 없다(TOFU는
  // "키 연속성"만 보장하지 "이 사람이 원래 신청자인가"는 보장 못 함).
  // → 잔액/이력이 있는 guid의 최초 바인딩은 phone_verify_token으로
  //   전화번호 소유까지 재확인해야 통과하도록 막는다.
  if (!registeredPubkey) {
    let balance = 0;
    let hasHistory = false;
    try {
      const result = _balanceUtils.computeBalanceAndHistory(guid);
      balance = result.balance;
      hasHistory = result.hasHistory;
    } catch (_) {
      // 확인 자체가 실패하면 안전한 쪽(재확인 요구)으로 판단한다.
      hasHistory = true;
    }

    if (balance !== 0 || hasHistory) {
      const e164 = original.getString("e164");
      const secret = $os.getenv("PHONE_VERIFY_SECRET");
      const token = info.data.phone_verify_token;
      let phoneOk = false;
      if (e164 && secret && token && typeof token === "string" && token.indexOf(".") !== -1) {
        const dotIdx = token.indexOf(".");
        const payload = token.substring(0, dotIdx);
        const tokenSig = token.substring(dotIdx + 1);
        const expectedSig = $security.hs256(payload, secret);
        if ($security.equal(expectedSig, tokenSig)) {
          const segs = payload.split(":");
          const tokenE164 = segs[0];
          const exp = parseInt(segs[segs.length - 1], 10);
          if (tokenE164 === e164 && exp && Date.now() <= exp) phoneOk = true;
        }
      }
      if (!phoneOk) {
        throw new BadRequestError(
          "이 계정은 잔액 또는 거래이력이 있어 최초 키 등록 시 전화번호 재인증이 필요합니다(phone_verify_token 필요)"
        );
      }
    }
  }

  const sigMsg = `${guid}:${pubkey}:${ts}`;
  let sigValid = false;
  try {
    const pubBytes = _sigVerify.b64uToBytes(pubkey);
    const sigBytes = _sigVerify.b64uToBytes(signature);
    if (pubBytes.length !== 32 || sigBytes.length !== 64) {
      throw new Error("키/서명 길이 오류");
    }
    sigValid = _sigVerify.ed25519Verify(_sigVerify.asciiToBytes(sigMsg), sigBytes, pubBytes);
  } catch (err) {
    throw new BadRequestError("서명 검증 실패: " + err.message);
  }
  if (!sigValid) {
    throw new BadRequestError("서명이 유효하지 않습니다(INVALID_SIGNATURE)");
  }
}, "profiles");
