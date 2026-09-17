#!/usr/bin/env node
'use strict';
/* =========================================================
   منظومة كودكس السحابية والمحلية — خادم المنظومات والجهات المتعددة (Multi-Tenant)
   - شركة كودكس للبرمجيات (Codex Software) — هاتف: 783745550
   - عزل صارم ومحكم لبيانات كل جهة ومؤسسة بنسبة 100%
   - دعم طابور الترحيل السحابي المؤقت والتخزين الدائم على القرص الصلب (Hybrid Relay Queue)
   - دعم لوحة Super Admin لإدارة كافة الجهات والاشتراكات
   - دعم الجلسات الرقمية الموقعة مشفرة (30 يوماً)
   ========================================================= */
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'multitenant.db');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SALT = 'spa_static_salt_2026';
const SERVER_AUTH_SECRET = 'codex_multitenant_hmac_secret_2026';
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 يوماً
const MAX_BODY = 60 * 1024 * 1024;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------- قاعدة البيانات ------------------------- */
const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  orgCode TEXT UNIQUE NOT NULL,
  orgName TEXT NOT NULL,
  logoUrl TEXT,
  phone TEXT,
  email TEXT,
  status TEXT DEFAULT 'active',
  maxUsers INTEGER DEFAULT 50,
  subscriptionPlan TEXT DEFAULT 'standard',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  orgId TEXT,
  userName TEXT NOT NULL,
  fullName TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  plainPassword TEXT,
  role TEXT NOT NULL,
  isActive INTEGER DEFAULT 1,
  canOpen INTEGER DEFAULT 0,
  canAdd INTEGER DEFAULT 0,
  canDelete INTEGER DEFAULT 0,
  canEdit INTEGER DEFAULT 0,
  canPrint INTEGER DEFAULT 0,
  canDash INTEGER DEFAULT 0,
  canEntry INTEGER DEFAULT 0,
  canReports INTEGER DEFAULT 0,
  canReportsEdit INTEGER DEFAULT 0,
  canReportsDelete INTEGER DEFAULT 0,
  canReportsPrint INTEGER DEFAULT 0,
  canEvents INTEGER DEFAULT 0,
  canUsers INTEGER DEFAULT 0,
  canSettings INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL,
  reportNumber TEXT NOT NULL,
  subject TEXT NOT NULL,
  target TEXT,
  reportDate TEXT,
  reportTime TEXT,
  location TEXT,
  details TEXT,
  images TEXT DEFAULT '[]',
  enteredBy TEXT,
  enteredByUserId TEXT,
  rating TEXT,
  logoId TEXT DEFAULT 'logo1',
  createdAt TEXT NOT NULL,
  updatedAt TEXT,
  syncedAt TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL,
  title TEXT NOT NULL,
  eventType TEXT NOT NULL,
  notes TEXT,
  eventDate TEXT,
  eventTime TEXT,
  location TEXT,
  assignedUserId TEXT,
  assignedUserName TEXT,
  createdBy TEXT,
  createdById TEXT,
  createdDate TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  receivedAt TEXT,
  completedAt TEXT,
  feedbackNotes TEXT,
  isArchived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  deviceName TEXT,
  userId TEXT,
  userName TEXT,
  userFullName TEXT,
  status TEXT DEFAULT 'pending',
  registeredAt TEXT NOT NULL,
  approvedAt TEXT,
  lastSeenAt TEXT,
  approvedBy TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  orgId TEXT,
  expires INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  orgId TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (orgId, key)
);

-- طابور الترحيل السحابي المؤقت (Cloud Relay Buffer Queue)
CREATE TABLE IF NOT EXISTS cloud_relay_queue (
  id TEXT PRIMARY KEY,
  orgId TEXT NOT NULL,
  itemType TEXT NOT NULL,
  payload TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  status TEXT DEFAULT 'pending'
);
`);

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function uid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function hashHex(str) { return crypto.createHash('sha256').update(SALT + str).digest('hex'); }

function getSetting(orgId, key, fallback = '') {
  if (!orgId) return fallback;
  try {
    const row = db.prepare('SELECT value FROM settings WHERE orgId=? AND key=?').get(orgId, key);
    return row ? row.value : fallback;
  } catch(e) { return fallback; }
}

function setSetting(orgId, key, value) {
  if (!orgId) return;
  db.prepare('INSERT OR REPLACE INTO settings(orgId, key, value) VALUES(?,?,?)').run(orgId, key, String(value));
}

/* ------------------------- التهيئة التلقائية ------------------------- */
(function seedDefaultData() {
  const superCount = db.prepare("SELECT COUNT(*) c FROM users WHERE role='SuperAdmin'").get().c;
  if (superCount === 0) {
    const sId = uid();
    db.prepare(`INSERT INTO users(id, orgId, userName, fullName, passwordHash, plainPassword, role, isActive,
      canDash, canEntry, canReports, canReportsEdit, canReportsDelete, canReportsPrint, canEvents, canUsers, canSettings, createdAt)
      VALUES(?, NULL, 'superadmin', 'إدارة كودكس العليا', ?, 'CodexSuper@2026', 'SuperAdmin', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ?)`)
      .run(sId, hashHex('CodexSuper@2026'), nowIso());
    console.log('✓ Created SuperAdmin: superadmin / CodexSuper@2026');
  }

  const demoOrg = db.prepare("SELECT * FROM organizations WHERE orgCode='DEMO'").get();
  let demoOrgId;
  if (!demoOrg) {
    demoOrgId = uid();
    db.prepare(`INSERT INTO organizations(id, orgCode, orgName, logoUrl, phone, status, maxUsers, createdAt)
      VALUES(?, 'DEMO', 'المؤسسة النموذجية الأولى', 'Image/codex_logo.jpg', '783745550', 'active', 50, ?)`)
      .run(demoOrgId, nowIso());
    console.log('✓ Created Demo Organization: DEMO');
  } else {
    demoOrgId = demoOrg.id;
  }

  const demoAdmin = db.prepare("SELECT * FROM users WHERE orgId=? AND userName='admin'").get(demoOrgId);
  if (!demoAdmin) {
    const aId = uid();
    db.prepare(`INSERT INTO users(id, orgId, userName, fullName, passwordHash, plainPassword, role, isActive,
      canDash, canEntry, canReports, canReportsEdit, canReportsDelete, canReportsPrint, canEvents, canUsers, canSettings, createdAt)
      VALUES(?, ?, 'admin', 'مدير الجهة النموذجية', ?, 'Admin@123', 'Admin', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ?)`)
      .run(aId, demoOrgId, hashHex('Admin@123'), nowIso());
  }

  const demoUser = db.prepare("SELECT * FROM users WHERE orgId=? AND userName='ahmed'").get(demoOrgId);
  if (!demoUser) {
    const uId = uid();
    db.prepare(`INSERT INTO users(id, orgId, userName, fullName, passwordHash, plainPassword, role, isActive,
      canDash, canEntry, canReports, canReportsEdit, canReportsDelete, canReportsPrint, canEvents, canUsers, canSettings, createdAt)
      VALUES(?, ?, 'ahmed', 'أحمد محمد (موظف ميداني)', ?, '123456', 'EntryUser', 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, ?)`)
      .run(uId, demoOrgId, hashHex('123456'), nowIso());
  }
})();

function publicUser(u) {
  const isAdminUser = u.role === 'Admin' || u.role === 'SuperAdmin';
  return {
    id: u.id,
    orgId: u.orgId,
    userName: u.userName,
    fullName: u.fullName,
    role: u.role,
    plainPassword: u.plainPassword || '',
    isActive: !!u.isActive,
    canOpen: isAdminUser || !!u.canOpen || !!u.canReports || !!u.canEntry,
    canAdd: isAdminUser || !!u.canAdd,
    canDelete: isAdminUser || !!u.canDelete || !!u.canReportsDelete,
    canEdit: isAdminUser || !!u.canEdit || !!u.canReportsEdit,
    canPrint: isAdminUser || !!u.canPrint || !!u.canReportsPrint,
    canDash: isAdminUser || !!u.canDash,
    canEntry: isAdminUser || !!u.canEntry,
    canReports: isAdminUser || !!u.canReports,
    canReportsEdit: isAdminUser || !!u.canReportsEdit || !!u.canEdit,
    canReportsDelete: isAdminUser || !!u.canReportsDelete || !!u.canDelete,
    canReportsPrint: isAdminUser || !!u.canReportsPrint || !!u.canPrint,
    canEvents: isAdminUser || !!u.canEvents || !!u.canDash || !!u.canReports,
    canUsers: isAdminUser || !!u.canUsers,
    canSettings: isAdminUser || !!u.canSettings,
    createdAt: u.createdAt
  };
}

function parseReportRow(r) {
  let images = [];
  try { images = JSON.parse(r.images || '[]'); } catch (e) { images = []; }
  return { ...r, images, imageCount: images.length };
}

/* ------------------------- الجلسات المشفرة ------------------------- */
function createSession(userId, orgId) {
  const expires = Date.now() + SESSION_TTL;
  const sig = crypto.createHmac('sha256', SERVER_AUTH_SECRET).update(`${userId}.${orgId || 'none'}.${expires}`).digest('hex');
  const token = `${userId}.${orgId || 'none'}.${expires}.${sig}`;
  try {
    db.prepare('INSERT OR REPLACE INTO sessions(token, userId, orgId, expires, createdAt) VALUES(?,?,?,?,?)')
      .run(token, userId, orgId, expires, nowIso());
  } catch(e){}
  return token;
}

function auth(req) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!tok) return null;

  try {
    const row = db.prepare('SELECT userId, orgId, expires FROM sessions WHERE token=?').get(tok);
    if (row) {
      if (row.expires < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE token=?').run(tok);
        return null;
      }
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.userId);
      if (user && user.isActive) return user;
    }
  } catch(e) {}

  try {
    const parts = tok.split('.');
    if (parts.length === 4) {
      const [userId, orgIdStr, expiresStr, sig] = parts;
      const expires = parseInt(expiresStr, 10);
      if (!isNaN(expires) && expires > Date.now()) {
        const expectedSig = crypto.createHmac('sha256', SERVER_AUTH_SECRET).update(`${userId}.${orgIdStr}.${expiresStr}`).digest('hex');
        if (sig === expectedSig) {
          const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
          if (user && user.isActive) {
            const orgId = orgIdStr === 'none' ? null : orgIdStr;
            try {
              db.prepare('INSERT OR REPLACE INTO sessions(token, userId, orgId, expires, createdAt) VALUES(?,?,?,?,?)')
                .run(tok, userId, orgId, expires, nowIso());
            } catch(e){}
            return user;
          }
        }
      }
    }
  } catch(e) {}

  return null;
}

function isSuperAdmin(u) { return u && u.role === 'SuperAdmin'; }
function isOrgAdmin(u) { return u && (u.role === 'Admin' || u.role === 'SuperAdmin'); }
function can(u, p) { return isSuperAdmin(u) || isOrgAdmin(u) || (u && !!u[p]); }

function checkDeviceAuth(user, org, req) {
  if (!user || user.role === 'Admin' || user.role === 'SuperAdmin') return { ok: true };
  const enforce = getSetting(user.orgId, 'enforceDeviceAuth', '1') === '1';

  const deviceId = (req.headers['x-device-id'] || '').trim();
  let deviceName = '';
  try { deviceName = decodeURIComponent(req.headers['x-device-name'] || ''); } catch (e) { deviceName = req.headers['x-device-name'] || ''; }
  if (!deviceName) deviceName = 'هاتف (' + (req.headers['user-agent'] || 'ميداني').slice(0, 35) + ')';

  if (!deviceId) {
    if (!enforce) return { ok: true };
    return { ok: false, code: 'DEVICE_MISSING', message: 'لم يتم إرسال معرّف الجهاز (Device ID).' };
  }

  const dev = db.prepare('SELECT * FROM devices WHERE orgId=? AND deviceId=?').get(user.orgId, deviceId);
  if (!dev) {
    const id = uid();
    const t = nowIso();
    const initialStatus = enforce ? 'pending' : 'approved';
    db.prepare('INSERT INTO devices(id, orgId, deviceId, deviceName, userId, userName, userFullName, status, registeredAt, lastSeenAt, approvedAt, approvedBy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, user.orgId, deviceId, deviceName, user.id, user.userName, user.fullName, initialStatus, t, t, enforce ? null : t, enforce ? null : 'تلقائي');
    if (enforce) {
      return { ok: false, code: 'DEVICE_PENDING', message: '📱 هذا الهاتف جديد وقيد المراجعة بانتظار اعتماد مدير الجهة (' + org.orgName + ').' };
    }
    return { ok: true };
  }

  db.prepare('UPDATE devices SET lastSeenAt=?, userId=?, userName=?, userFullName=?, deviceName=? WHERE id=?')
    .run(nowIso(), user.id, user.userName, user.fullName, deviceName, dev.id);

  if (dev.status === 'blocked') {
    return { ok: false, code: 'DEVICE_BLOCKED', message: '🚫 تم حظر هذا الهاتف من الاتصال بالنظام من قِبل إدارة الجهة.' };
  }
  if (enforce && dev.status === 'pending') {
    return { ok: false, code: 'DEVICE_PENDING', message: '📱 هذا الهاتف قيد المراجعة وبانتظار اعتماد مدير الجهة (' + org.orgName + ').' };
  }

  return { ok: true, device: dev };
}

function buildMe(user) {
  let org = null;
  if (user.orgId) {
    org = db.prepare('SELECT * FROM organizations WHERE id=?').get(user.orgId);
  }
  const entryUsers = user.orgId ? db.prepare("SELECT id, userName, fullName, role FROM users WHERE orgId=? AND role='EntryUser' ORDER BY fullName").all() : [];
  return {
    user: publicUser(user),
    organization: org ? {
      id: org.id,
      orgCode: org.orgCode,
      orgName: org.orgName,
      logoUrl: org.logoUrl || 'Image/codex_logo.jpg',
      phone: org.phone,
      status: org.status
    } : null,
    users: entryUsers,
    settings: user.orgId ? {
      consumeAddAfterSync: getSetting(user.orgId, 'consumeAddAfterSync', '0') === '1',
      enforceDeviceAuth: getSetting(user.orgId, 'enforceDeviceAuth', '1') === '1',
      reportHeaderConfig: null
    } : {}
  };
}

function buildStats(orgId) {
  const usersTotal = db.prepare('SELECT COUNT(*) c FROM users WHERE orgId=?').get(orgId).c;
  const usersActive = db.prepare('SELECT COUNT(*) c FROM users WHERE orgId=? AND isActive=1').get(orgId).c;
  const reportsTotal = db.prepare('SELECT COUNT(*) c FROM reports WHERE orgId=?').get(orgId).c;
  const today = new Date().toISOString().slice(0, 10);
  const reportsToday = db.prepare('SELECT COUNT(*) c FROM reports WHERE orgId=? AND reportDate=?').get(orgId, today).c;

  let devicesPending = 0, devicesApproved = 0, devicesTotal = 0;
  try {
    devicesPending = db.prepare("SELECT COUNT(*) c FROM devices WHERE orgId=? AND status='pending'").get(orgId).c;
    devicesApproved = db.prepare("SELECT COUNT(*) c FROM devices WHERE orgId=? AND status='approved'").get(orgId).c;
    devicesTotal = db.prepare('SELECT COUNT(*) c FROM devices WHERE orgId=?').get(orgId).c;
  } catch(e){}

  let eventsTotal = 0, eventsPending = 0, eventsReceived = 0, eventsCompleted = 0;
  try {
    eventsTotal = db.prepare('SELECT COUNT(*) c FROM events WHERE orgId=? AND isArchived=0').get(orgId).c;
    eventsPending = db.prepare("SELECT COUNT(*) c FROM events WHERE orgId=? AND status='pending' AND isArchived=0").get(orgId).c;
    eventsReceived = db.prepare("SELECT COUNT(*) c FROM events WHERE orgId=? AND status IN ('received', 'in_progress') AND isArchived=0").get(orgId).c;
    eventsCompleted = db.prepare("SELECT COUNT(*) c FROM events WHERE orgId=? AND status='completed' AND isArchived=0").get(orgId).c;
  } catch(e){}

  let queuePending = 0;
  try {
    queuePending = db.prepare("SELECT COUNT(*) c FROM cloud_relay_queue WHERE orgId=? AND status='pending'").get(orgId).c;
  } catch(e){}

  return {
    usersTotal, usersActive, reportsTotal, reportsToday,
    devicesPending, devicesApproved, devicesTotal,
    eventsTotal, eventsPending, eventsReceived, eventsCompleted,
    queuePending
  };
}

/* ------------------------- مساعدات HTTP ------------------------- */
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  });
  res.end(body);
}

function sendError(res, code, msg) {
  send(res, code, { error: msg, ok: false });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('الحجم كبير جداً')); }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/login.html' : pathname;
  let fullPath = path.join(PUBLIC, file);
  if (!fs.existsSync(fullPath)) {
    fullPath = path.join(PUBLIC, 'login.html');
  }
  const ext = path.extname(fullPath).toLowerCase();
  const mime = MIME_MAP[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(fullPath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': data.length,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  } catch(e) {
    res.writeHead(404);
    res.end('Not Found');
  }
}

/* ------------------------- خادم المعالجة الرئيسي ------------------------- */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const u = new URL(req.url, 'http://localhost');
  const p = (u.pathname.length > 1 && u.pathname.endsWith('/')) ? u.pathname.slice(0, -1) : u.pathname;
  const method = req.method;

  if (!p.startsWith('/api')) {
    serveStatic(req, res, p);
    return;
  }

  try {
    /* ------------------------- المسارات العامة ------------------------- */
    if (method === 'GET' && p === '/api/public/org-info') {
      const code = (u.searchParams.get('orgCode') || '').trim().toUpperCase();
      if (!code) { send(res, 200, { found: false, error: 'رمز الجهة مطلوب' }); return; }
      if (code === 'CODEX' || code === 'SUPER') {
        send(res, 200, { found: true, isSuper: true, org: { orgCode: 'CODEX', orgName: 'شركة كودكس للبرمجيات (Super Admin)' } });
        return;
      }
      const org = db.prepare('SELECT id, orgCode, orgName, logoUrl, status FROM organizations WHERE orgCode=?').get(code);
      if (!org) { send(res, 200, { found: false, error: 'رمز الجهة غير صحيح أو غير مسجل' }); return; }
      if (org.status === 'suspended') {
        send(res, 200, { found: true, suspended: true, org, error: 'حساب هذه الجهة موقف حالياً. يرجى مراجعة إدارة كودكس.' });
        return;
      }
      send(res, 200, { found: true, org });
      return;
    }

    if (method === 'GET' && p === '/api/public/users') {
      const code = (u.searchParams.get('orgCode') || '').trim().toUpperCase();
      let orgId = null;
      if (code && code !== 'CODEX' && code !== 'SUPER') {
        const org = db.prepare('SELECT id FROM organizations WHERE orgCode=?').get(code);
        if (org) orgId = org.id;
      }
      if (!orgId) { send(res, 200, { users: [] }); return; }
      const list = db.prepare('SELECT id, userName, fullName, role FROM users WHERE orgId=? AND isActive=1 ORDER BY role DESC, fullName ASC').all(orgId);
      send(res, 200, { users: list });
      return;
    }

    if (method === 'GET' && p === '/api/public/device-status') {
      const devId = (req.headers['x-device-id'] || u.searchParams.get('deviceId') || '').trim();
      const orgCode = (u.searchParams.get('orgCode') || '').trim().toUpperCase();
      if (!devId) { send(res, 200, { registered: false, status: 'none' }); return; }
      let orgId = null;
      if (orgCode) {
        const org = db.prepare('SELECT id FROM organizations WHERE orgCode=?').get(orgCode);
        if (org) orgId = org.id;
      }
      const dev = orgId ? db.prepare('SELECT * FROM devices WHERE orgId=? AND deviceId=?').get(orgId, devId) : null;
      send(res, 200, { registered: !!dev, status: dev ? dev.status : 'none', dev });
      return;
    }

    if (method === 'POST' && p === '/api/login') {
      const b = await readBody(req);
      const userName = String(b.userName || '').trim();
      const orgCode = String(b.orgCode || '').trim().toUpperCase();
      let hashToCompare = b.passwordHash;
      if (!hashToCompare && b.password) hashToCompare = hashHex(b.password);

      if (userName === 'superadmin' || orgCode === 'CODEX' || orgCode === 'SUPER') {
        const superUser = db.prepare("SELECT * FROM users WHERE userName=? AND role='SuperAdmin'").get(userName);
        if (superUser && superUser.isActive && superUser.passwordHash === hashToCompare) {
          const token = createSession(superUser.id, null);
          send(res, 200, { token, isSuperAdmin: true, ...buildMe(superUser) });
          return;
        }
      }

      if (!orgCode) { sendError(res, 400, 'يرجى إدخال رمز الجهة (Organization Code)'); return; }
      const org = db.prepare('SELECT * FROM organizations WHERE orgCode=?').get(orgCode);
      if (!org) { sendError(res, 404, 'رمز الجهة غير صحيح أو غير مسجل في النظام'); return; }
      if (org.status === 'suspended') {
        sendError(res, 403, '⛔ تم تجميد اشتراك هذه الجهة. يرجى التواصل مع إدارة شركة كودكس للبرمجيات.');
        return;
      }

      const user = db.prepare('SELECT * FROM users WHERE orgId=? AND userName=?').get(org.id, userName);
      if (!user || !user.isActive || !hashToCompare || hashToCompare !== user.passwordHash) {
        sendError(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
        return;
      }

      const devAuth = checkDeviceAuth(user, org, req);
      if (!devAuth.ok) {
        send(res, 403, { error: devAuth.message, code: devAuth.code, deviceId: req.headers['x-device-id'] });
        return;
      }

      const token = createSession(user.id, org.id);
      send(res, 200, { token, isSuperAdmin: false, ...buildMe(user) });
      return;
    }

    if (method === 'POST' && p === '/api/logout') {
      const h = req.headers.authorization || '';
      const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
      if (tok) {
        try { db.prepare('DELETE FROM sessions WHERE token=?').run(tok); } catch(e){}
      }
      send(res, 200, { ok: true, message: 'تم الخروج بنجاح' });
      return;
    }

    /* ------------------------- التحقق من المستخدم ------------------------- */
    const me = auth(req);
    if (!me) {
      sendError(res, 401, 'انتهت الجلسة، يرجى تسجيل الدخول');
      return;
    }

    if (method === 'GET' && p === '/api/me') {
      send(res, 200, buildMe(me));
      return;
    }

    /* ------------------------- Super Admin ------------------------- */
    if (p.startsWith('/api/super/')) {
      if (!isSuperAdmin(me)) { sendError(res, 403, 'غير مصرح: مخصص للإدارة العليا لكودكس.'); return; }

      if (method === 'GET' && p === '/api/super/dashboard') {
        const orgs = db.prepare('SELECT * FROM organizations ORDER BY createdAt DESC').all();
        const orgsList = orgs.map(org => {
          const uCount = db.prepare('SELECT COUNT(*) c FROM users WHERE orgId=?').get(org.id).c;
          const rCount = db.prepare('SELECT COUNT(*) c FROM reports WHERE orgId=?').get(org.id).c;
          const eCount = db.prepare('SELECT COUNT(*) c FROM events WHERE orgId=?').get(org.id).c;
          const dCount = db.prepare("SELECT COUNT(*) c FROM devices WHERE orgId=? AND status='approved'").get(org.id).c;
          const qCount = db.prepare("SELECT COUNT(*) c FROM cloud_relay_queue WHERE orgId=? AND status='pending'").get(org.id).c;
          const adminUser = db.prepare("SELECT userName, fullName, plainPassword FROM users WHERE orgId=? AND role='Admin'").get(org.id);
          return {
            ...org,
            usersCount: uCount,
            reportsCount: rCount,
            eventsCount: eCount,
            devicesCount: dCount,
            queueCount: qCount,
            adminUser: adminUser || null
          };
        });

        send(res, 200, {
          totalOrgs: orgs.length,
          totalUsers: db.prepare("SELECT COUNT(*) c FROM users WHERE role<>'SuperAdmin'").get().c,
          totalReports: db.prepare('SELECT COUNT(*) c FROM reports').get().c,
          totalEvents: db.prepare('SELECT COUNT(*) c FROM events').get().c,
          organizations: orgsList
        });
        return;
      }

      if (method === 'POST' && p === '/api/super/organizations') {
        const b = await readBody(req);
        const orgCode = String(b.orgCode || '').trim().toUpperCase();
        const orgName = String(b.orgName || '').trim();
        const adminUserName = String(b.adminUserName || 'admin').trim();
        const adminPassword = String(b.adminPassword || 'Admin@123').trim();
        const adminFullName = String(b.adminFullName || ('مدير ' + orgName)).trim();

        if (!orgCode || !orgName) { sendError(res, 400, 'رمز الجهة واسم الجهة مطلوبان'); return; }
        const exists = db.prepare('SELECT id FROM organizations WHERE orgCode=?').get(orgCode);
        if (exists) { sendError(res, 409, 'رمز الجهة موجود مسبقاً، يرجى اختيار رمز آخر'); return; }

        const orgId = uid();
        db.prepare(`INSERT INTO organizations(id, orgCode, orgName, logoUrl, phone, status, maxUsers, createdAt)
          VALUES(?, ?, ?, ?, ?, 'active', ?, ?)`)
          .run(orgId, orgCode, orgName, b.logoUrl || 'Image/codex_logo.jpg', b.phone || '', b.maxUsers || 50, nowIso());

        const adminId = uid();
        db.prepare(`INSERT INTO users(
          id, orgId, userName, fullName, passwordHash, plainPassword, role, isActive,
          canDash, canEntry, canReports, canReportsEdit, canReportsDelete, canReportsPrint, canEvents, canUsers, canSettings, createdAt
        ) VALUES(?, ?, ?, ?, ?, ?, 'Admin', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ?)`)
          .run(adminId, orgId, adminUserName, adminFullName, hashHex(adminPassword), adminPassword, nowIso());

        send(res, 200, {
          ok: true,
          message: 'تم إنشاء الجهة وتجهيز حساب المدير بنجاح ✔',
          org: { id: orgId, orgCode, orgName, adminUserName, adminPassword }
        });
        return;
      }

      const orgMatch = p.match(/^\/api\/super\/organizations\/([^/]+)$/);
      if (orgMatch) {
        const targetOrgId = orgMatch[1];
        const org = db.prepare('SELECT * FROM organizations WHERE id=?').get(targetOrgId);
        if (!org) { sendError(res, 404, 'الجهة غير موجودة'); return; }

        if (method === 'PUT') {
          const b = await readBody(req);
          db.prepare(`UPDATE organizations SET orgName=?, status=?, phone=?, maxUsers=? WHERE id=?`)
            .run(String(b.orgName || org.orgName), String(b.status || org.status), String(b.phone ?? org.phone), b.maxUsers || org.maxUsers, targetOrgId);
          send(res, 200, { ok: true, message: 'تم تحديث بيانات الجهة بنجاح' });
          return;
        }

        if (method === 'DELETE') {
          db.prepare('DELETE FROM reports WHERE orgId=?').run(targetOrgId);
          db.prepare('DELETE FROM events WHERE orgId=?').run(targetOrgId);
          db.prepare('DELETE FROM devices WHERE orgId=?').run(targetOrgId);
          db.prepare('DELETE FROM users WHERE orgId=?').run(targetOrgId);
          db.prepare('DELETE FROM settings WHERE orgId=?').run(targetOrgId);
          db.prepare('DELETE FROM cloud_relay_queue WHERE orgId=?').run(targetOrgId);
          db.prepare('DELETE FROM organizations WHERE id=?').run(targetOrgId);
          send(res, 200, { ok: true, message: 'تم حذف الجهة وبياناتها بالكامل' });
          return;
        }
      }
    }

    const orgId = me.orgId;
    if (!orgId && !isSuperAdmin(me)) { sendError(res, 403, 'غير مصرح'); return; }

    /* =========================================================================
       مسارات طابور الترحيل السحابي والمزامنة الذكية (Cloud Relay Queue API)
       ========================================================================= */
    // 1. سحب التقارير المعلقة في طابور السحابة إلى كمبيوتر المدير (Pull Queue)
    if (method === 'GET' && p === '/api/relay/pull') {
      if (!isOrgAdmin(me)) { sendError(res, 403, 'غير مصرح بسحب الطابور'); return; }
      const rows = db.prepare("SELECT * FROM cloud_relay_queue WHERE orgId=? AND status='pending' ORDER BY createdAt ASC").all(orgId);
      const items = rows.map(r => {
        let payload = {};
        try { payload = JSON.parse(r.payload); } catch(e){}
        return { id: r.id, orgId: r.orgId, itemType: r.itemType, payload, createdAt: r.createdAt };
      });
      send(res, 200, { ok: true, count: items.length, items });
      return;
    }

    // 2. تأكيد استلام وحفظ التقارير على القرص الصلب وتفريغها من السحابة (Acknowledge & Clear)
    if (method === 'POST' && p === '/api/relay/ack') {
      if (!isOrgAdmin(me)) { sendError(res, 403, 'غير مصرح'); return; }
      const b = await readBody(req);
      const itemIds = Array.isArray(b.itemIds) ? b.itemIds : [];
      let deletedCount = 0;
      for (const id of itemIds) {
        try {
          db.prepare('DELETE FROM cloud_relay_queue WHERE orgId=? AND id=?').run(orgId, id);
          deletedCount++;
        } catch(e){}
      }
      send(res, 200, { ok: true, clearedCount: deletedCount, message: 'تم تأكيد الحفظ وتفريغ الطابور السحابي بنجاح ✔' });
      return;
    }

    // 3. دفع وتحديث المهام من كمبيوتر المدير إلى السحابة لهواتف الموظفين (Push Events to Cloud)
    if (method === 'POST' && p === '/api/relay/push-events') {
      if (!isOrgAdmin(me)) { sendError(res, 403, 'غير مصرح'); return; }
      const b = await readBody(req);
      const events = Array.isArray(b.events) ? b.events : [];
      let upsertedCount = 0;
      for (const ev of events) {
        if (!ev.id) continue;
        db.prepare(`INSERT OR REPLACE INTO events(
          id, orgId, title, eventType, notes, eventDate, eventTime, location,
          assignedUserId, assignedUserName, createdBy, createdById, createdDate, status, receivedAt, completedAt, feedbackNotes, isArchived
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            ev.id, orgId, String(ev.title || ''), String(ev.eventType || 'مهمة'), String(ev.notes || ''),
            String(ev.eventDate || ''), String(ev.eventTime || ''), String(ev.location || ''),
            ev.assignedUserId || null, String(ev.assignedUserName || ''), String(ev.createdBy || ''),
            String(ev.createdById || ''), String(ev.createdDate || nowIso()), String(ev.status || 'pending'),
            ev.receivedAt || null, ev.completedAt || null, String(ev.feedbackNotes || ''), ev.isArchived ? 1 : 0
          );
        upsertedCount++;
      }
      send(res, 200, { ok: true, syncedEvents: upsertedCount });
      return;
    }

    /* ---- إحصائيات لوحة تحكم الجهة ---- */
    if (method === 'GET' && p === '/api/stats') {
      if (!can(me, 'canDash')) { sendError(res, 403, 'غير مصرح'); return; }
      send(res, 200, buildStats(orgId));
      return;
    }

    /* ---- إدارة المستخدمين داخل الجهة ---- */
    if (p === '/api/users') {
      if (!can(me, 'canUsers')) { sendError(res, 403, 'غير مصرح'); return; }
      if (method === 'GET') {
        const users = db.prepare('SELECT * FROM users WHERE orgId=? ORDER BY role DESC, fullName ASC').all(orgId).map(publicUser);
        send(res, 200, { users });
        return;
      }
      if (method === 'POST') {
        const b = await readBody(req);
        const userName = String(b.userName || '').trim();
        const fullName = String(b.fullName || '').trim();
        if (!userName || !fullName) { sendError(res, 400, 'اسم المستخدم والاسم الكامل مطلوبان'); return; }

        const exists = db.prepare('SELECT id FROM users WHERE orgId=? AND userName=?').get(orgId, userName);
        if (exists) { sendError(res, 409, 'اسم المستخدم موجود مسبقاً في هذه الجهة'); return; }

        const pPlain = String(b.plainPassword || b.password || '123456').trim();
        const pHash = hashHex(pPlain);
        const id = uid();

        db.prepare(`INSERT INTO users(
          id, orgId, userName, fullName, passwordHash, plainPassword, role, isActive,
          canOpen, canAdd, canDelete, canEdit, canPrint,
          canDash, canEntry, canReports, canReportsEdit, canReportsDelete, canReportsPrint,
          canEvents, canUsers, canSettings, createdAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            id, orgId, userName, fullName, pHash, pPlain, 'EntryUser', b.isActive ? 1 : 0,
            b.canOpen ? 1 : 0, b.canAdd ? 1 : 0, b.canReportsDelete ? 1 : 0, b.canReportsEdit ? 1 : 0, b.canReportsPrint ? 1 : 0,
            b.canDash ? 1 : 0, b.canEntry ? 1 : 0, b.canReports ? 1 : 0, b.canReportsEdit ? 1 : 0, b.canReportsDelete ? 1 : 0, b.canReportsPrint ? 1 : 0,
            b.canEvents ? 1 : 0, b.canUsers ? 1 : 0, b.canSettings ? 1 : 0, nowIso()
          );

        send(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
        return;
      }
    }

    const um = p.match(/^\/api\/users\/([^/]+)$/);
    if (um) {
      if (!can(me, 'canUsers')) { sendError(res, 403, 'غير مصرح'); return; }
      const user = db.prepare('SELECT * FROM users WHERE orgId=? AND id=?').get(orgId, um[1]);
      if (!user) { sendError(res, 404, 'المستخدم غير موجود'); return; }

      if (method === 'PUT') {
        const b = await readBody(req);
        db.prepare(`UPDATE users SET
          fullName=?, isActive=?, canDash=?, canEntry=?, canReports=?, canReportsEdit=?, canReportsDelete=?, canReportsPrint=?, canEvents=?, canUsers=?, canSettings=?
          WHERE id=?`)
          .run(
            String(b.fullName ?? user.fullName),
            b.isActive !== undefined ? (b.isActive ? 1 : 0) : user.isActive,
            b.canDash ? 1 : 0, b.canEntry ? 1 : 0, b.canReports ? 1 : 0,
            b.canReportsEdit ? 1 : 0, b.canReportsDelete ? 1 : 0, b.canReportsPrint ? 1 : 0,
            b.canEvents ? 1 : 0, b.canUsers ? 1 : 0, b.canSettings ? 1 : 0,
            user.id
          );

        const newPlain = b.plainPassword !== undefined ? String(b.plainPassword).trim() : null;
        if (newPlain) {
          db.prepare('UPDATE users SET passwordHash=?, plainPassword=? WHERE id=?').run(hashHex(newPlain), newPlain, user.id);
        }
        send(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
        return;
      }

      if (method === 'DELETE') {
        if (user.role === 'Admin') { sendError(res, 400, 'لا يمكن حذف حساب مدير الجهة'); return; }
        db.prepare('DELETE FROM users WHERE id=?').run(user.id);
        send(res, 200, { ok: true });
        return;
      }
    }

    /* ---- إدارة التقارير داخل الجهة ---- */
    if (p === '/api/reports') {
      if (method === 'GET') {
        if (!can(me, 'canReports') && !can(me, 'canEntry')) { sendError(res, 403, 'غير مصرح'); return; }
        let sql = 'SELECT * FROM reports WHERE orgId=?';
        const params = [orgId];
        if (me.role !== 'Admin' && !me.canReports) {
          sql += ' AND enteredByUserId=?';
          params.push(me.id);
        }
        sql += ' ORDER BY reportDate DESC, createdAt DESC';
        const reports = db.prepare(sql).all(...params).map(parseReportRow);
        send(res, 200, { reports });
        return;
      }
      if (method === 'POST') {
        if (!can(me, 'canEntry')) { sendError(res, 403, 'غير مصرح بإدخال التقارير'); return; }
        const b = await readBody(req);
        const repData = b.report || b;
        const id = repData.id || uid();
        const t = nowIso();
        const repNum = String(repData.reportNumber || Date.now().toString().slice(-6));
        
        db.prepare(`INSERT OR REPLACE INTO reports(
          id, orgId, reportNumber, subject, target, reportDate, reportTime, location, details, images,
          enteredBy, enteredByUserId, rating, logoId, createdAt, updatedAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            id, orgId, repNum, String(repData.subject || ''), String(repData.target || ''),
            String(repData.reportDate || t.slice(0, 10)), String(repData.reportTime || t.slice(11, 16)),
            String(repData.location || ''), String(repData.details || ''), JSON.stringify(repData.images || []),
            me.fullName, me.id, String(repData.rating || 'عادي'), String(repData.logoId || 'logo1'), t, t
          );

        // إدراج التقرير تلقائياً في طابور الترحيل السحابي المؤقت لينتقل لكمبيوتر المدير
        const queueId = uid();
        const fullReport = parseReportRow(db.prepare('SELECT * FROM reports WHERE id=?').get(id));
        try {
          db.prepare(`INSERT INTO cloud_relay_queue(id, orgId, itemType, payload, createdAt, status) VALUES(?,?,?,?,?,?)`)
            .run(queueId, orgId, 'report', JSON.stringify(fullReport), t, 'pending');
        } catch(e){}

        send(res, 200, {
          ok: true,
          report: fullReport,
          reportNumber: repNum,
          queueId: queueId,
          message: 'تم استلام التقرير في طابور الانتظار بنجاح ✔'
        });
        return;
      }
    }

    const rm = p.match(/^\/api\/reports\/([^/]+)$/);
    if (rm) {
      const rep = db.prepare('SELECT * FROM reports WHERE orgId=? AND id=?').get(orgId, rm[1]);
      if (!rep) { sendError(res, 404, 'التقرير غير موجود'); return; }
      if (method === 'GET') { send(res, 200, { report: parseReportRow(rep) }); return; }
      if (method === 'PUT') {
        if (!can(me, 'canReportsEdit') && rep.enteredByUserId !== me.id) { sendError(res, 403, 'غير مصرح بتعديل هذا التقرير'); return; }
        const b = await readBody(req);
        db.prepare(`UPDATE reports SET
          subject=?, target=?, reportDate=?, reportTime=?, location=?, details=?, images=?, rating=?, updatedAt=?
          WHERE id=?`)
          .run(
            String(b.subject ?? rep.subject), String(b.target ?? rep.target),
            String(b.reportDate ?? rep.reportDate), String(b.reportTime ?? rep.reportTime),
            String(b.location ?? rep.location), String(b.details ?? rep.details),
            JSON.stringify(b.images ?? JSON.parse(rep.images || '[]')),
            String(b.rating ?? rep.rating), nowIso(), rep.id
          );
        send(res, 200, { report: parseReportRow(db.prepare('SELECT * FROM reports WHERE id=?').get(rep.id)) });
        return;
      }
      if (method === 'DELETE') {
        if (!can(me, 'canReportsDelete')) { sendError(res, 403, 'غير مصرح بحذف التقارير'); return; }
        db.prepare('DELETE FROM reports WHERE id=?').run(rep.id);
        send(res, 200, { ok: true });
        return;
      }
    }

    /* ---- إدارة المهام والتكليفات داخل الجهة ---- */
    if (p === '/api/events') {
      if (method === 'GET') {
        if (!can(me, 'canEvents') && !can(me, 'canEntry')) { sendError(res, 403, 'غير مصرح'); return; }
        let sql = 'SELECT * FROM events WHERE orgId=?';
        const params = [orgId];
        if (me.role !== 'Admin' && !me.canEvents) {
          sql += ' AND assignedUserId=?';
          params.push(me.id);
        }
        sql += ' ORDER BY eventDate DESC, createdDate DESC';
        const events = db.prepare(sql).all(...params);
        send(res, 200, { events });
        return;
      }
      if (method === 'POST') {
        if (!can(me, 'canEvents')) { sendError(res, 403, 'غير مصرح بتكليف مهام'); return; }
        const b = await readBody(req);
        const id = uid();
        const t = nowIso();
        const assignedUserId = b.assignedUserId ? String(b.assignedUserId) : me.id;
        let assignedUser = null;
        if (assignedUserId) {
          try { assignedUser = db.prepare('SELECT * FROM users WHERE orgId=? AND id=?').get(orgId, assignedUserId); } catch(e){}
        }
        const assignedUserName = assignedUser ? assignedUser.fullName : (b.assignedUserName || me.fullName);
        db.prepare(`INSERT INTO events(
          id, orgId, title, eventType, notes, eventDate, eventTime, location,
          assignedUserId, assignedUserName, createdBy, createdById, createdDate, status
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            id, orgId, String(b.title || ''), String(b.eventType || 'مهمة'), String(b.notes || ''),
            String(b.eventDate || t.slice(0, 10)), String(b.eventTime || t.slice(11, 16)),
            String(b.location || ''), assignedUserId, assignedUserName,
            me.fullName, me.id, t, 'pending'
          );
        send(res, 200, { event: db.prepare('SELECT * FROM events WHERE id=?').get(id) });
        return;
      }
    }

    const em = p.match(/^\/api\/events\/([^/]+)$/);
    if (em) {
      const event = db.prepare('SELECT * FROM events WHERE orgId=? AND id=?').get(orgId, em[1]);
      if (!event) { sendError(res, 404, 'المهمة غير موجودة'); return; }
      if (method === 'PUT') {
        const b = await readBody(req);
        db.prepare(`UPDATE events SET
          status=?, receivedAt=?, completedAt=?, feedbackNotes=? WHERE id=?`)
          .run(
            String(b.status || event.status),
            b.receivedAt ?? event.receivedAt,
            b.completedAt ?? event.completedAt,
            String(b.feedbackNotes ?? event.feedbackNotes ?? ''),
            event.id
          );

        // إدراج التغذية الراجعة في طابور السحب لكمبيوتر المدير
        try {
          db.prepare(`INSERT INTO cloud_relay_queue(id, orgId, itemType, payload, createdAt, status) VALUES(?,?,?,?,?,?)`)
            .run(uid(), orgId, 'event_feedback', JSON.stringify({
              eventId: event.id,
              status: b.status || event.status,
              receivedAt: b.receivedAt ?? event.receivedAt,
              completedAt: b.completedAt ?? event.completedAt,
              feedbackNotes: b.feedbackNotes ?? event.feedbackNotes
            }), nowIso(), 'pending');
        } catch(e){}

        send(res, 200, { event: db.prepare('SELECT * FROM events WHERE id=?').get(event.id) });
        return;
      }
      if (method === 'DELETE') {
        if (!can(me, 'canEvents')) { sendError(res, 403, 'غير مصرح'); return; }
        db.prepare('DELETE FROM events WHERE id=?').run(event.id);
        send(res, 200, { ok: true });
        return;
      }
    }

    /* ---- إدارة الأجهزة داخل الجهة ---- */
    if (method === 'GET' && p === '/api/devices') {
      if (!can(me, 'canUsers')) { sendError(res, 403, 'غير مصرح'); return; }
      const devices = db.prepare('SELECT * FROM devices WHERE orgId=? ORDER BY lastSeenAt DESC').all(orgId);
      send(res, 200, { devices });
      return;
    }

    const devApprove = p.match(/^\/api\/devices\/([^/]+)\/(approve|block)$/);
    if (devApprove && method === 'PUT') {
      if (!can(me, 'canUsers')) { sendError(res, 403, 'غير مصرح'); return; }
      const action = devApprove[2];
      const devId = devApprove[1];
      const newStatus = action === 'approve' ? 'approved' : 'blocked';
      db.prepare('UPDATE devices SET status=?, approvedAt=?, approvedBy=? WHERE orgId=? AND id=?')
        .run(newStatus, nowIso(), me.fullName, orgId, devId);
      send(res, 200, { ok: true, status: newStatus });
      return;
    }

    const devDel = p.match(/^\/api\/devices\/([^/]+)$/);
    if (devDel && method === 'DELETE') {
      if (!can(me, 'canUsers')) { sendError(res, 403, 'غير مصرح'); return; }
      db.prepare('DELETE FROM devices WHERE orgId=? AND id=?').run(orgId, devDel[1]);
      send(res, 200, { ok: true });
      return;
    }

    sendError(res, 404, 'المسار غير موجود (404)');
  } catch(err) {
    console.error('Server error:', err);
    sendError(res, 500, 'خطأ في معالجة الخادم: ' + err.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log('========================================================');
  console.log('  منظومة كودكس السحابية والمحلية — (Multi-Tenant Hybrid Relay)');
  console.log('  شركة كودكس للبرمجيات (Codex Software)');
  console.log(`  الخادم يعمل بنجاح على: http://localhost:${PORT}/`);
  console.log('  حساب Super Admin: superadmin / CodexSuper@2026');
  console.log('  الجهة الافتراضية: DEMO (Admin: admin/Admin@123)');
  console.log('========================================================');
});
