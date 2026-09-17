/* =========================================================
   app.js — أدوات منظومة كودكس للمنظومات المتعددة (Multi-Tenant)
   ========================================================= */
const TOKEN_KEY = 'codex_mt_session_token';
const ORG_CODE_KEY = 'codex_mt_org_code';
const SERVER_URL_KEY = 'codex_mt_custom_server_url';
const DEVICE_ID_KEY = 'codex_mt_device_id_v1';
const DEVICE_NAME_KEY = 'codex_mt_device_name_v1';
const CACHED_USER_KEY = 'codex_mt_cached_session_user';
const OFFLINE_AUTH_KEY = 'codex_mt_offline_auth';

let __me = null;

function isMobileApp() {
  return (typeof window.Capacitor !== 'undefined' && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : true)) || location.protocol === 'capacitor:';
}

function getOrgCode() {
  return (localStorage.getItem(ORG_CODE_KEY) || sessionStorage.getItem(ORG_CODE_KEY) || '').trim().toUpperCase();
}

function setOrgCode(code) {
  if (code) {
    const clean = code.trim().toUpperCase();
    localStorage.setItem(ORG_CODE_KEY, clean);
    sessionStorage.setItem(ORG_CODE_KEY, clean);
  }
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token) {
  if (token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch(e) {}
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(CACHED_USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CACHED_USER_KEY);
  } catch(e) {}
  __me = null;
}

async function logout() {
  try {
    await api('/logout', { method: 'POST' });
  } catch(e) {}
  clearSession();
  location.replace('login.html');
}

function getCachedMe() {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY) || sessionStorage.getItem(CACHED_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setMe(m, passwordHash = null) {
  __me = m;
  if (m) {
    try {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(m));
      sessionStorage.setItem(CACHED_USER_KEY, JSON.stringify(m));
    } catch (e) {}
  }
}

async function currentMe() {
  if (__me) return __me;
  const token = getToken();
  const cached = getCachedMe();

  if (!token && (!cached || !cached.user)) {
    clearSession();
    throw new Error('لا توجد جلسة نشطة');
  }

  if (!navigator.onLine && cached && cached.user) {
    __me = cached;
    return __me;
  }

  try {
    const d = await api('/me');
    setMe(d);
    return __me;
  } catch (err) {
    if (err && (err.message.includes('انتهت الجلسة') || err.message.includes('401') || err.message.includes('غير مصرح'))) {
      clearSession();
      throw err;
    }
    if (cached && cached.user) {
      __me = cached;
      return __me;
    }
    clearSession();
    throw err;
  }
}

/* ---------- معرّف وبصمة الجهاز ---------- */
function getHardwareFingerprint() {
  try {
    const nav = window.navigator || {};
    const scr = window.screen || {};
    const str = [nav.userAgent || '', nav.platform || '', nav.language || '', scr.width || 0, scr.height || 0, new Date().getTimezoneOffset()].join('###');
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return 'DEV-FP-' + Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
  } catch(e) {
    return 'DEV-FP-DEVICE';
  }
}

function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_ID_KEY); } catch(e){}
  if (!id) id = getHardwareFingerprint();
  try { localStorage.setItem(DEVICE_ID_KEY, id); } catch(e){}
  return id;
}

function getDeviceName() {
  let name = null;
  try { name = localStorage.getItem(DEVICE_NAME_KEY); } catch(e){}
  if (!name) {
    const ua = navigator.userAgent || '';
    let detected = 'هاتف ميداني';
    if (/Android/i.test(ua)) detected = 'هاتف أندرويد';
    else if (/iPhone/i.test(ua)) detected = 'هاتف آيفون';
    else if (/Windows/i.test(ua)) detected = 'كمبيوتر ويندوز';
    name = detected;
    try { localStorage.setItem(DEVICE_NAME_KEY, name); } catch(e){}
  }
  return name;
}

function formatServerUrl(raw) {
  let url = (raw || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    if (/^(localhost|127\.|192\.168\.|10\.|172\.)/i.test(url)) url = 'http://' + url;
    else url = 'https://' + url;
  }
  return url.replace(/\/+$/, '');
}

function getServerBaseUrl() {
  const custom = (localStorage.getItem(SERVER_URL_KEY) || '').trim();
  if (custom) return formatServerUrl(custom);
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.defaultServerUrl) {
    if (location.protocol === 'file:' || location.protocol === 'capacitor:' || location.port === '5500' || location.origin.includes('localhost') === false) {
      return formatServerUrl(APP_CONFIG.defaultServerUrl);
    }
  }
  return '';
}

/* ---------- الشبكة والاتصال بالسيرفر ---------- */
async function api(pathname, opts = {}) {
  const token = getToken() || '';
  const headers = {
    'Content-Type': 'application/json',
    'X-Org-Code': getOrgCode(),
    'X-Device-Id': getDeviceId(),
    'X-Device-Name': encodeURIComponent(getDeviceName()),
    ...(opts.headers || {})
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const baseUrl = getServerBaseUrl();
  const fullUrl = (baseUrl ? baseUrl : '') + '/api' + pathname;

  let res;
  try {
    res = await fetch(fullUrl, { ...opts, headers });
  } catch (e) {
    throw new Error('تعذر الاتصال بالخادم المركزي (' + (baseUrl || location.origin) + '). تأكد من تشغيل الخادم واتصال الإنترنت.');
  }

  let data = null;
  const raw = await res.text();
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (e) {
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('⏳ الخادم السحابي قيد الاستيقاظ الآن (Cold Start)... يرجى الانتظار بضع ثوانٍ.');
    }
    if (res.status === 404) {
      throw new Error('⚠️ المسار المطلوب غير موجود في الخادم (404).');
    }
    throw new Error('الخادم أرسل استجابة غير متوقعة (كود ' + res.status + ').');
  }

  if (res.status === 401) {
    clearSession();
    if (!location.pathname.endsWith('login.html')) {
      location.replace('login.html');
    }
    throw new Error('انتهت الجلسة');
  }

  if (!res.ok) throw new Error((data && data.error) || 'حدث خطأ (' + res.status + ')');
  return data;
}

/* ---------- التشفير والتجزئة ---------- */
function jsSha256(ascii) {
  function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
  var mathPow = Math.pow, maxWord = mathPow(2, 32), lengthProperty = 'length', i, j, result = '';
  var words = [];
  var utf8 = unescape(encodeURIComponent(ascii));
  var asciiLength = utf8[lengthProperty] * 8;
  var hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  utf8 += '\x80';
  while (utf8[lengthProperty] % 64 - 56) utf8 += '\x00';
  for (i = 0; i < utf8[lengthProperty]; i++) {
    j = utf8.charCodeAt(i);
    words[i >> 2] |= j << ((3 - i % 4) * 8);
  }
  words[words[lengthProperty]] = ((asciiLength / maxWord) | 0);
  words[words[lengthProperty]] = (asciiLength);
  for (j = 0; j < words[lengthProperty];) {
    var w = words.slice(j, j += 16);
    var oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2];
      var s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      var s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = (i < 16) ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      var ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      var maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      var t1 = hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) + ch + k[i] + w[i];
      var t2 = (rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj;
      hash = [(t1 + t2) | 0, hash[0], hash[1], hash[2], (hash[3] + t1) | 0, hash[4], hash[5], hash[6]];
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (i = 0; i < 8; i++) {
    for (var b = 3; b >= 0; b--) {
      var v = (hash[i] >> (b * 8)) & 255;
      result += (v < 16 ? '0' : '') + v.toString(16);
    }
  }
  return result;
}

const SALT_CONST = 'spa_static_salt_2026';
async function sha256Hex(plain) {
  try {
    if (window.crypto && window.crypto.subtle) {
      const buf = new TextEncoder().encode(SALT_CONST + plain);
      const hash = await window.crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch(e) {}
  return jsSha256(SALT_CONST + plain);
}

/* إشعار عائم Toast */
function toast(msg, type = 'ok') {
  let t = document.getElementById('globalToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'globalToast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:12px;font-size:14px;font-weight:800;z-index:99999;box-shadow:0 10px 25px rgba(0,0,0,0.25);transition:all .3s ease;display:none;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = type === 'err' ? '#ef4444' : '#10b981';
  t.style.color = '#ffffff';
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 4000);
}
