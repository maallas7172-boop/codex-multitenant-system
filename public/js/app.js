/* =========================================================
   app.js — أدوات منظومة كودكس للمنظومات المتعددة (Multi-Tenant)
   - شركة كودكس للبرمجيات (Codex Software)
   ========================================================= */
const TOKEN_KEY = 'codex_mt_session_token';
const ORG_CODE_KEY = 'codex_mt_org_code';
const SERVER_URL_KEY = 'codex_mt_custom_server_url';
const DEVICE_ID_KEY = 'codex_mt_device_id_v1';
const DEVICE_NAME_KEY = 'codex_mt_device_name_v1';
const CACHED_USER_KEY = 'codex_mt_cached_session_user';
const OFFLINE_AUTH_KEY = 'codex_mt_offline_auth';
const DRAFT_KEY = 'codex_mt_local_drafts_v1';

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

function getOfflineAuth() {
  try {
    const raw = localStorage.getItem(OFFLINE_AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setMe(m, passwordHash = null) {
  __me = m;
  if (m) {
    try {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(m));
      sessionStorage.setItem(CACHED_USER_KEY, JSON.stringify(m));
      if (m.user && m.user.userName) {
        const existing = getOfflineAuth();
        const toSave = {
          userName: m.user.userName,
          fullName: m.user.fullName,
          role: m.user.role,
          orgCode: getOrgCode(),
          passwordHash: passwordHash || (existing && existing.userName && existing.userName.toLowerCase() === m.user.userName.toLowerCase() ? existing.passwordHash : null),
          user: m.user,
          organization: m.organization,
          token: m.token || getToken() || 'offline-token',
          savedAt: new Date().toISOString()
        };
        localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(toSave));
      }
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

function setCustomServerUrl(url) {
  const clean = formatServerUrl(url);
  if (!clean) {
    localStorage.removeItem(SERVER_URL_KEY);
  } else {
    localStorage.setItem(SERVER_URL_KEY, clean);
  }
}

async function testServerConnection(url) {
  const base = formatServerUrl(url);
  const orgCode = getOrgCode();
  const target = (base ? base : '') + '/api/public/org-info?orgCode=' + encodeURIComponent(orgCode || 'DEMO');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(target, {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'X-Org-Code': orgCode,
        'X-Device-Id': getDeviceId(),
        'X-Device-Name': encodeURIComponent(getDeviceName())
      }
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('الخادم استجاب بكود ' + res.status);
    const data = await res.json();
    return { ok: true, org: data.org };
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === 'AbortError' ? 'انتهت مهلة الاتصال بالخادم' : err.message);
  }
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
    if (pathname !== '/login') {
      clearSession();
      if (!location.pathname.endsWith('login.html')) {
        location.replace('login.html');
      }
      throw new Error((data && data.error) || 'انتهت الجلسة، يرجى إعادة تسجيل الدخول');
    }
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

/* ---------- مكونات مشتركة ودوال مساعدة ---------- */
function toast(msg, type = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 3800);
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (e) { return iso; }
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('ar-EG', { hour12: false }); }
  catch (e) { return iso; }
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const b = Number(bytes);
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

function getAttachmentIcon(type, name) {
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (t.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(n)) return '🖼️';
  if (t.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|3gp)$/i.test(n)) return '🎬';
  if (t.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|amr)$/i.test(n)) return '🎵';
  if (t.includes('pdf') || n.endsWith('.pdf')) return '📕';
  if (t.includes('word') || t.includes('officedocument.wordprocessingml') || /\.(doc|docx)$/i.test(n)) return '📝';
  if (t.includes('excel') || t.includes('spreadsheetml') || /\.(xls|xlsx|csv)$/i.test(n)) return '📊';
  if (t.includes('powerpoint') || t.includes('presentation') || /\.(ppt|pptx)$/i.test(n)) return '📽️';
  if (t.includes('zip') || t.includes('rar') || t.includes('7z') || t.includes('tar') || t.includes('compressed') || /\.(zip|rar|7z|tar|gz)$/i.test(n)) return '📦';
  if (t.includes('text') || /\.(txt|rtf|log|json|xml)$/i.test(n)) return '📄';
  return '📎';
}

function normalizeAttachment(att, idx = 0) {
  if (!att) return { id: 'att_' + idx, name: 'ملف ' + (idx + 1), type: 'application/octet-stream', size: 0, data: '' };
  if (typeof att === 'string') {
    let mime = 'image/jpeg';
    const m = att.match(/^data:([^;]+);base64,/);
    if (m && m[1]) mime = m[1];
    const isImg = mime.startsWith('image/');
    const isVid = mime.startsWith('video/');
    const isAud = mime.startsWith('audio/');
    let ext = mime.split('/')[1] || 'bin';
    if (ext === 'jpeg') ext = 'jpg';
    let defaultName = isImg ? `صورة_${idx + 1}.${ext}` : (isVid ? `فيديو_${idx + 1}.${ext}` : (isAud ? `تسجيل_صوتي_${idx + 1}.${ext}` : `مرفق_${idx + 1}.${ext}`));
    return {
      id: 'att_' + idx + '_' + Date.now().toString(36),
      name: defaultName,
      type: mime,
      size: Math.round(att.length * 0.75),
      data: att
    };
  }
  return {
    id: att.id || ('att_' + idx + '_' + Date.now().toString(36)),
    name: att.name || ('ملف ' + (idx + 1)),
    type: att.type || 'application/octet-stream',
    size: att.size || (att.data ? Math.round(att.data.length * 0.75) : 0),
    data: att.data || ''
  };
}

function combo(id, options, value, ph) {
  const listId = id + '_list';
  const opts = options.map(o => `<option value="${esc(o)}"></option>`).join('');
  return (
    `<div class="combo-wrap">
       <input type="text" id="${id}" list="${listId}" value="${esc(value || '')}" placeholder="${esc(ph || 'اختر أو اكتب...')}" autocomplete="off" />
       <datalist id="${listId}">${opts}</datalist>
     </div>`
  );
}

function badgeStatus(status) {
  const map = {
    'نشط': 'green', 'متقطع': 'warn', 'غير نشط': 'red',
    'عالية': 'green', 'متوسط': 'warn', 'منخفض': 'red',
    'مهم جدا': 'red', 'مهم': 'blue', 'متوسط': 'gold', 'عادي': 'gray', 'غير مهم': 'gray'
  };
  const c = map[status] || 'gray';
  return `<span class="badge ${c}">${esc(status || '—')}</span>`;
}

function permBadges(u) {
  if (!u) return '';
  if (u.role === 'Admin') return `<span class="badge blue">👑 مدير النظام (كافة الصلاحيات)</span>`;
  const p = [
    ['canDash', 'لوحة التحكم'], ['canEntry', 'الإدخال'], ['canAdd', 'إضافة تقارير'],
    ['canReports', 'التقارير'], ['canEdit', 'تعديل'], ['canDelete', 'حذف'], ['canPrint', 'طباعة'],
    ['canEvents', 'المهام والأحداث'], ['canUsers', 'المستخدمين'], ['canSettings', 'الإعدادات']
  ];
  return p.filter(([k]) => u[k]).map(([k, label]) => `<span class="badge green">${label}</span>`).join(' ') || '<span class="badge gray">بدون صلاحيات</span>';
}

async function triggerInstantBackup() {
  try {
    const res = await api('/backup/now', { method: 'POST' });
    toast(res.message || 'تم تحديث النسخة الاحتياطية بنجاح ✔', 'ok');
  } catch (err) {
    toast('تعذر عمل النسخة الاحتياطية: ' + err.message, 'err');
  }
}

function openServerConfigModal() {
  let m = document.getElementById('serverConfigModalBack');
  if (!m) {
    const div = document.createElement('div');
    div.id = 'serverConfigModalBack';
    div.className = 'modal-back';
    div.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-h">
          <h3>🌐 ضبط عنوان الخادم المركزي (Server Connection)</h3>
          <button class="modal-x" type="button" onclick="document.getElementById('serverConfigModalBack').classList.remove('show')">✕</button>
        </div>
        <div style="padding:16px 20px 24px">
          <p style="font-size:13px;color:var(--muted);line-height:1.8;margin-bottom:14px">
            إذا كنت تستخدم التطبيق من هاتف أندرويد أو كمبيوتر آخر، أدخل عنوان IP أو رابط السيرفر السحابي.
          </p>
          <div class="field" style="margin-bottom:12px">
            <span style="font-weight:700;font-size:13px">عنوان الخادم (URL / IP):</span>
            <input type="text" id="cfgServerUrlInput" placeholder="مثال: https://codex-multitenant-system.onrender.com" style="direction:ltr;text-align:left;font-family:monospace;font-size:14px" />
          </div>
          <div style="display:flex;gap:8px;margin-bottom:14px">
            <button class="btn btn-secondary btn-sm" style="flex:1;font-size:12px" type="button" onclick="document.getElementById('cfgServerUrlInput').value='http://' + (location.hostname || 'localhost') + (location.port ? ':' + location.port : '')">📍 العنوان الحالي</button>
            <button class="btn btn-outline btn-sm" style="flex:1;font-size:12px" type="button" onclick="document.getElementById('cfgServerUrlInput').value=''">🔄 افتراضي</button>
          </div>
          <div id="cfgServerTestStatus" style="font-size:13px;font-weight:700;min-height:24px;margin-bottom:14px;padding:8px 12px;border-radius:6px;display:none;line-height:1.6"></div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-secondary" style="flex:1" type="button" id="cfgTestServerBtn">🔍 فحص الاتصال</button>
            <button class="btn btn-primary" style="flex:1" type="button" id="cfgSaveServerBtn">💾 حفظ وتطبيق</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    m = div;

    document.getElementById('cfgTestServerBtn').onclick = async () => {
      const url = document.getElementById('cfgServerUrlInput').value.trim();
      const statusDiv = document.getElementById('cfgServerTestStatus');
      statusDiv.style.display = 'block';
      statusDiv.style.background = 'var(--surface-soft)';
      statusDiv.style.color = 'var(--text)';
      statusDiv.textContent = '⏳ جارٍ اختبار الاتصال بالخادم...';
      try {
        const res = await testServerConnection(url);
        statusDiv.style.background = '#dcfce7';
        statusDiv.style.color = '#15803d';
        statusDiv.textContent = '🟢 تم الاتصال بالخادم المركزي بنجاح!';
      } catch (err) {
        statusDiv.style.background = '#fee2e2';
        statusDiv.style.color = '#b91c1c';
        statusDiv.textContent = '🔴 تعذر الاتصال: ' + err.message;
      }
    };

    document.getElementById('cfgSaveServerBtn').onclick = () => {
      const url = document.getElementById('cfgServerUrlInput').value.trim();
      setCustomServerUrl(url);
      toast('تم حفظ إعدادات الخادم المركزي بنجاح ✔', 'ok');
      m.classList.remove('show');
      setTimeout(() => location.reload(), 600);
    };
  }

  const defaultUrl = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.defaultServerUrl) ? APP_CONFIG.defaultServerUrl : '';
  const current = getServerBaseUrl() || defaultUrl;
  const inputEl = document.getElementById('cfgServerUrlInput');
  if (inputEl) inputEl.value = current;
  const statusDiv = document.getElementById('cfgServerTestStatus');
  if (statusDiv) statusDiv.style.display = 'none';
  m.classList.add('show');
}

let _logoClicks = 0, _logoTimer = null;
function initSecretAdminConfigTrigger() {
  const logos = document.querySelectorAll('.login-logo, .brand .logo, #userAv');
  logos.forEach(el => {
    el.addEventListener('click', () => {
      _logoClicks++;
      clearTimeout(_logoTimer);
      _logoTimer = setTimeout(() => { _logoClicks = 0; }, 1800);
      if (_logoClicks >= 5) {
        _logoClicks = 0;
        openServerConfigModal();
      }
    });
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSecretAdminConfigTrigger);
} else {
  initSecretAdminConfigTrigger();
}

if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
