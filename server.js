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

/* ------------------------- قاعدة البيانات (SQLite3) ------------------------- */
const db = new DatabaseSync(DB_PATH);
try {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 10000;
    PRAGMA foreign_keys = ON;
  `);
} catch (e) {
  console.warn('SQLite PRAGMA Notice:', e.message);
}

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
  allowHqAccess INTEGER DEFAULT 1,
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

// ترحيل تلقائي للأعمدة الجديدة في قواعد البيانات القائمة
try { db.exec("ALTER TABLE organizations ADD COLUMN allowHqAccess INTEGER DEFAULT 1;"); } catch(e){}
try { db.exec("ALTER TABLE organizations ADD COLUMN encKey TEXT;"); } catch(e){}
try { db.exec("ALTER TABLE reports ADD COLUMN isEncrypted INTEGER DEFAULT 0;"); } catch(e){}
try { db.exec("ALTER TABLE reports ADD COLUMN encryptedPayload TEXT;"); } catch(e){}
try { db.exec("ALTER TABLE reports ADD COLUMN encryptedIv TEXT;"); } catch(e){}

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function runAutoSqliteBackup() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const targetPath = path.join(BACKUP_DIR, `multitenant_auto_${today}.db`);
    if (!fs.existsSync(targetPath)) {
      const safeTarget = targetPath.replace(/\\/g, '/').replace(/'/g, "''");
      db.exec(`VACUUM INTO '${safeTarget}'`);
      console.log('✓ Created automatic daily SQLite snapshot:', path.basename(targetPath));
    }
  } catch(e) {
    console.warn('Auto SQLite backup notice:', e.message);
  }
}
setTimeout(runAutoSqliteBackup, 2000);
setInterval(runAutoSqliteBackup, 6 * 3600 * 1000);

function uid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function hashHex(str) { return crypto.createHash('sha256').update(SALT + str).digest('hex'); }

/**
 * حساب الرقم المتسلسل الرسمي الحقيقي التالي لتقارير الفرع (آخر رقم + 1)
 */
function getNextReportNumber(orgId) {
  try {
    const rows = db.prepare('SELECT reportNumber FROM reports WHERE orgId=?').all(orgId);
    let maxNum = 0;
    for (const r of rows) {
      if (!r || !r.reportNumber) continue;
      const str = String(r.reportNumber).trim();
      // استبعاد نصوص المسودات المؤقتة
      if (str.includes('مسودة') || str.toLowerCase().includes('draft') || str.startsWith('#')) continue;
      const match = str.match(/\d+/g);
      if (match) {
        const lastNum = parseInt(match[match.length - 1], 10);
        if (!isNaN(lastNum) && lastNum > maxNum && lastNum < 100000000) {
          maxNum = lastNum;
        }
      }
    }
    return String(maxNum > 0 ? maxNum + 1 : 1);
  } catch(e) {
    return String(Date.now().toString().slice(-4));
  }
}

/**
 * تصحيح وإعادة ترقيم أي تقارير قديمة في قاعدة البيانات كانت محفوظة بأرقام مسودات مؤقتة
 */
function repairExistingDraftReportNumbers() {
  try {
    const orgs = db.prepare('SELECT id FROM organizations').all();
    for (const org of orgs) {
      const badReports = db.prepare(`
        SELECT id, reportNumber, createdAt 
        FROM reports 
        WHERE orgId=? AND (reportNumber LIKE '%مسودة%' OR reportNumber LIKE '%draft%' OR reportNumber IS NULL OR reportNumber = '')
        ORDER BY createdAt ASC
      `).all(org.id);

      if (badReports && badReports.length > 0) {
        for (const rep of badReports) {
          const nextNum = getNextReportNumber(org.id);
          db.prepare('UPDATE reports SET reportNumber=? WHERE id=?').run(nextNum, rep.id);
          console.log(`[Auto-Repair] تم تصحيح رقم التقرير (${rep.reportNumber}) إلى الرقم الرسمي #${nextNum}`);
        }
      }
    }
  } catch(e) {
    console.warn('Draft report number auto-repair notice:', e.message);
  }
}
setTimeout(repairExistingDraftReportNumbers, 1500);

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
    const demoEncKey = crypto.randomBytes(32).toString('hex');
    db.prepare(`INSERT INTO organizations(id, orgCode, orgName, logoUrl, phone, status, maxUsers, allowHqAccess, encKey, createdAt)
      VALUES(?, 'DEMO', 'المؤسسة النموذجية الأولى', 'Image/codex_logo.jpg', '783745550', 'active', 50, 1, ?, ?)`)
      .run(demoOrgId, demoEncKey, nowIso());
    setSetting(demoOrgId, 'enforceDeviceAuth', '1');
    console.log('✓ Created Demo Organization: DEMO with E2EE key');
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

  // ضمان توليد مفتاح تشفير طرفي وتفعيل اعتماد الأجهزة لجميع الجهات القائمة
  try {
    const allOrgs = db.prepare('SELECT id, encKey FROM organizations').all();
    for (const o of allOrgs) {
      if (!o.encKey) {
        const k = crypto.randomBytes(32).toString('hex');
        db.prepare('UPDATE organizations SET encKey=? WHERE id=?').run(k, o.id);
      }
      const currentEnforce = getSetting(o.id, 'enforceDeviceAuth', '');
      if (!currentEnforce) {
        setSetting(o.id, 'enforceDeviceAuth', '1');
      }
    }
  } catch(e){}
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
  if (!r) return null;
  let images = [];
  try { images = JSON.parse(r.images || '[]'); } catch (e) { images = []; }
  return {
    ...r,
    images,
    imageCount: images.length,
    isEncrypted: r.isEncrypted ? 1 : 0,
    encryptedPayload: r.encryptedPayload || '',
    encryptedIv: r.encryptedIv || ''
  };
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

    try {
      db.prepare(`INSERT INTO cloud_relay_queue(id, orgId, itemType, payload, createdAt, status) VALUES(?,?,?,?,?,?)`)
        .run(uid(), user.orgId, 'device_registration', JSON.stringify({
          id, orgId: user.orgId, deviceId, deviceName, userId: user.id, userName: user.userName, userFullName: user.fullName,
          status: initialStatus, registeredAt: t, lastSeenAt: t, approvedAt: enforce ? null : t, approvedBy: enforce ? null : 'تلقائي'
        }), t, 'pending');
    } catch(e){}

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
    if (org && !org.encKey) {
      const k = crypto.randomBytes(32).toString('hex');
      try { db.prepare('UPDATE organizations SET encKey=? WHERE id=?').run(k, org.id); org.encKey = k; } catch(e){}
    }
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
      status: org.status,
      encKey: org.encKey || ''
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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('الحجم كبير جداً')); }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.db': 'application/x-sqlite3',
  '.sqlite': 'application/x-sqlite3',
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
    if (method === 'GET' && (p === '/api/ping' || p === '/api/health')) {
      send(res, 200, { ok: true, status: 'alive', message: 'Codex Server is active and running', time: new Date().toISOString() });
      return;
    }

    if (method === 'GET' && p === '/api/public/org-info') {
      const code = (u.searchParams.get('orgCode') || '').trim().toUpperCase();
      if (!code) { send(res, 200, { found: false, error: 'رمز الجهة مطلوب' }); return; }
      const masterCode = getSetting('GLOBAL', 'masterOrgCode', 'CODEX').toUpperCase();
      if (code === 'CODEX' || code === 'SUPER' || code === masterCode) {
        send(res, 200, { found: true, isSuper: true, org: { orgCode: masterCode, orgName: 'الإدارة المركزية (Super Admin)' } });
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
      const masterCode = getSetting('GLOBAL', 'masterOrgCode', 'CODEX').toUpperCase();
      if (code && code !== 'CODEX' && code !== 'SUPER' && code !== masterCode) {
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

      const lowerUser = userName.toLowerCase();
      const masterCode = getSetting('GLOBAL', 'masterOrgCode', 'CODEX').toUpperCase();
      if (lowerUser === 'superadmin' || orgCode === 'CODEX' || orgCode === 'SUPER' || orgCode === masterCode) {
        const superUser = db.prepare("SELECT * FROM users WHERE LOWER(userName)=? AND role IN ('SuperAdmin', 'SuperSupervisor', 'CentralUser')").get(lowerUser);
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

    // فحص إلزامي لاعتماد الأجهزة لجميع مستخدمي الإدخال الميداني
    if (me.role !== 'Admin' && me.role !== 'SuperAdmin') {
      const org = db.prepare('SELECT * FROM organizations WHERE id=?').get(me.orgId);
      const devAuth = checkDeviceAuth(me, org, req);
      if (!devAuth.ok) {
        send(res, 403, { error: devAuth.message, code: devAuth.code, deviceId: req.headers['x-device-id'] });
        return;
      }
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
          const allowHq = (org.allowHqAccess === 0 || org.allowHqAccess === false) ? 0 : 1;
          return {
            ...org,
            usersCount: uCount,
            reportsCount: rCount,
            eventsCount: eCount,
            devicesCount: dCount,
            queueCount: qCount,
            adminUser: adminUser || null,
            allowHqAccess: allowHq,
            encKey: allowHq ? (org.encKey || '') : null
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

        const allowHqAccess = b.allowHqAccess !== undefined ? (b.allowHqAccess ? 1 : 0) : 1;
        const encKey = crypto.randomBytes(32).toString('hex');
        const orgId = uid();
        db.prepare(`INSERT INTO organizations(id, orgCode, orgName, logoUrl, phone, status, maxUsers, allowHqAccess, encKey, createdAt)
          VALUES(?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
          .run(orgId, orgCode, orgName, b.logoUrl || 'Image/codex_logo.jpg', b.phone || '', b.maxUsers || 50, allowHqAccess, encKey, nowIso());

        setSetting(orgId, 'enforceDeviceAuth', '1');

        const adminId = uid();
        db.prepare(`INSERT INTO users(
          id, orgId, userName, fullName, passwordHash, plainPassword, role, isActive,
          canDash, canEntry, canReports, canReportsEdit, canReportsDelete, canReportsPrint, canEvents, canUsers, canSettings, createdAt
        ) VALUES(?, ?, ?, ?, ?, ?, 'Admin', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ?)`)
          .run(adminId, orgId, adminUserName, adminFullName, hashHex(adminPassword), adminPassword, nowIso());

        send(res, 200, {
          ok: true,
          message: 'تم إنشاء الجهة وتجهيز حساب المدير بنجاح ✔',
          org: { id: orgId, orgCode, orgName, adminUserName, adminPassword, allowHqAccess, encKey }
        });
        return;
      }

      const toggleHqMatch = p.match(/^\/api\/super\/organizations\/([^/]+)\/toggle-hq-access$/);
      if (toggleHqMatch && (method === 'POST' || method === 'PUT')) {
        const targetOrgId = toggleHqMatch[1];
        const org = db.prepare('SELECT id, allowHqAccess FROM organizations WHERE id=?').get(targetOrgId);
        if (!org) { sendError(res, 404, 'الجهة غير موجودة'); return; }
        const currentHq = (org.allowHqAccess === null || org.allowHqAccess === undefined) ? 1 : org.allowHqAccess;
        const newAccess = currentHq ? 0 : 1;
        db.prepare('UPDATE organizations SET allowHqAccess=? WHERE id=?').run(newAccess, targetOrgId);
        send(res, 200, {
          ok: true,
          allowHqAccess: newAccess,
          message: newAccess ? 'تم تمكين وصول المركز الرئيسي لتقارير الفرع بنجاح 🟢' : 'تم حجب تقارير الفرع عن المركز الرئيسي ⛔'
        });
        return;
      }

      if (method === 'GET' && p === '/api/super/reports') {
        const filterOrgId = (u.searchParams.get('orgId') || '').trim();
        const fromDate = (u.searchParams.get('from') || '').trim();
        const toDate = (u.searchParams.get('to') || '').trim();
        const q = (u.searchParams.get('q') || '').trim().toLowerCase();

        let sql = `
          SELECT r.*, o.orgName, o.orgCode, o.encKey as orgEncKey
          FROM reports r
          JOIN organizations o ON r.orgId = o.id
          WHERE (o.allowHqAccess IS NULL OR o.allowHqAccess = 1)
        `;
        const params = [];

        if (filterOrgId) {
          sql += ' AND r.orgId = ?';
          params.push(filterOrgId);
        }
        if (fromDate) {
          sql += ' AND r.reportDate >= ?';
          params.push(fromDate);
        }
        if (toDate) {
          sql += ' AND r.reportDate <= ?';
          params.push(toDate);
        }
        if (q) {
          sql += ' AND (LOWER(r.subject) LIKE ? OR LOWER(r.reportNumber) LIKE ? OR LOWER(r.enteredBy) LIKE ? OR LOWER(r.target) LIKE ?)';
          const term = '%' + q + '%';
          params.push(term, term, term, term);
        }

        sql += ' ORDER BY r.reportDate DESC, r.createdAt DESC LIMIT 500';
        const rows = db.prepare(sql).all(...params).map(r => {
          const rep = parseReportRow(r);
          rep.orgName = r.orgName;
          rep.orgCode = r.orgCode;
          rep.orgEncKey = r.orgEncKey;
          return rep;
        });

        send(res, 200, { ok: true, count: rows.length, reports: rows });
        return;
      }

      const orgMatch = p.match(/^\/api\/super\/organizations\/([^/]+)$/);
      if (orgMatch) {
        const targetOrgId = orgMatch[1];
        const org = db.prepare('SELECT * FROM organizations WHERE id=?').get(targetOrgId);
        if (!org) { sendError(res, 404, 'الجهة غير موجودة'); return; }

        if (method === 'PUT') {
          const b = await readBody(req);
          const newHq = b.allowHqAccess !== undefined ? (b.allowHqAccess ? 1 : 0) : ((org.allowHqAccess === null || org.allowHqAccess === undefined) ? 1 : org.allowHqAccess);
          db.prepare(`UPDATE organizations SET orgName=?, status=?, phone=?, maxUsers=?, allowHqAccess=? WHERE id=?`)
            .run(String(b.orgName || org.orgName), String(b.status || org.status), String(b.phone ?? org.phone), b.maxUsers || org.maxUsers, newHq, targetOrgId);

          if (b.adminUserName || b.adminPassword) {
            const adminUser = db.prepare("SELECT * FROM users WHERE orgId=? AND role='Admin'").get(targetOrgId);
            if (adminUser) {
              const newAdminUserName = String(b.adminUserName || adminUser.userName).trim();
              let newAdminHash = adminUser.passwordHash;
              let newAdminPlain = adminUser.plainPassword;
              if (b.adminPassword) {
                newAdminPlain = String(b.adminPassword);
                newAdminHash = hashHex(newAdminPlain);
              }
              db.prepare('UPDATE users SET userName=?, passwordHash=?, plainPassword=? WHERE id=?')
                .run(newAdminUserName, newAdminHash, newAdminPlain, adminUser.id);
            }
          }

          send(res, 200, { ok: true, message: 'تم تحديث بيانات الجهة وحسابها بنجاح ✔' });
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

      /* ---------------- مسارات إدارة حساب وبيانات الإدارة المركزية ---------------- */
      // 1. تعديل بيانات حساب الإدارة المركزية والرمز الماستر
      if (method === 'PUT' && p === '/api/super/profile') {
        const b = await readBody(req);
        const newUserName = String(b.userName || '').trim();
        const newPassword = String(b.password || '').trim();
        const newMasterCode = String(b.masterOrgCode || '').trim().toUpperCase();

        if (newUserName) {
          db.prepare('UPDATE users SET userName=? WHERE id=?').run(newUserName, me.id);
        }
        if (newPassword) {
          const hash = hashHex(newPassword);
          db.prepare('UPDATE users SET passwordHash=?, plainPassword=? WHERE id=?').run(hash, newPassword, me.id);
        }
        if (newMasterCode) {
          setSetting('GLOBAL', 'masterOrgCode', newMasterCode);
        }
        send(res, 200, { ok: true, message: 'تم تحديث بيانات حساب الإدارة المركزية والرمز بنجاح ✔' });
        return;
      }

      // 2. إدارة مستخدمي الإدارة المركزية
      if (method === 'GET' && p === '/api/super/users') {
        const list = db.prepare("SELECT * FROM users WHERE orgId IS NULL OR role IN ('SuperAdmin', 'SuperSupervisor', 'CentralUser') ORDER BY role='SuperAdmin' DESC, createdAt DESC").all();
        send(res, 200, { ok: true, users: list.map(publicUser) });
        return;
      }

      if (method === 'POST' && p === '/api/super/users') {
        const b = await readBody(req);
        const uName = String(b.userName || '').trim();
        const fName = String(b.fullName || '').trim();
        const pwd = String(b.password || '').trim();
        if (!uName || !pwd) { sendError(res, 400, 'اسم المستخدم وكلمة المرور مطلوبة'); return; }
        const existing = db.prepare("SELECT id FROM users WHERE userName=?").get(uName);
        if (existing) { sendError(res, 400, 'اسم المستخدم مستخدم مسبقاً'); return; }
        const uId = uid();
        const hash = hashHex(pwd);
        db.prepare(`INSERT INTO users(id, orgId, userName, fullName, passwordHash, plainPassword, role, isActive,
          canDash, canEntry, canReports, canReportsEdit, canReportsDelete, canReportsPrint, canEvents, canUsers, canSettings, createdAt)
          VALUES(?, NULL, ?, ?, ?, ?, 'SuperSupervisor', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            uId, uName, fName || uName, hash, pwd, b.isActive !== false ? 1 : 0,
            b.canDash ? 1 : 0, b.canEntry ? 1 : 0, b.canReports ? 1 : 0, b.canReportsEdit ? 1 : 0,
            b.canReportsDelete ? 1 : 0, b.canReportsPrint ? 1 : 0, b.canEvents ? 1 : 0,
            b.canUsers ? 1 : 0, b.canSettings ? 1 : 0, nowIso()
          );
        send(res, 200, { ok: true, message: 'تم إنشاء مستخدم الإدارة المركزية بنجاح ✔' });
        return;
      }

      const superUserMatch = p.match(/^\/api\/super\/users\/([^/]+)$/);
      if (superUserMatch) {
        const targetUId = superUserMatch[1];
        if (method === 'PUT') {
          const b = await readBody(req);
          const target = db.prepare("SELECT * FROM users WHERE id=?").get(targetUId);
          if (!target) { sendError(res, 404, 'المستخدم غير موجود'); return; }
          let hash = target.passwordHash;
          let plain = target.plainPassword;
          if (b.password) {
            plain = String(b.password);
            hash = hashHex(plain);
          }
          const fName = String(b.fullName || target.fullName);
          const isActive = b.isActive !== undefined ? (b.isActive ? 1 : 0) : target.isActive;
          db.prepare(`UPDATE users SET fullName=?, passwordHash=?, plainPassword=?, isActive=?,
            canDash=?, canReports=?, canReportsEdit=?, canReportsDelete=?, canReportsPrint=?, canEvents=?, canUsers=?, canSettings=?
            WHERE id=?`).run(
              fName, hash, plain, isActive,
              b.canDash ? 1 : 0, b.canReports ? 1 : 0, b.canReportsEdit ? 1 : 0,
              b.canReportsDelete ? 1 : 0, b.canReportsPrint ? 1 : 0, b.canEvents ? 1 : 0,
              b.canUsers ? 1 : 0, b.canSettings ? 1 : 0, targetUId
            );
          send(res, 200, { ok: true, message: 'تم تحديث بيانات المستخدم بنجاح ✔' });
          return;
        }
        if (method === 'DELETE') {
          if (targetUId === me.id) { sendError(res, 400, 'لا يمكنك حذف حسابك الحالي'); return; }
          db.prepare("DELETE FROM users WHERE id=?").run(targetUId);
          send(res, 200, { ok: true, message: 'تم حذف المستخدم بنجاح ✔' });
          return;
        }
      }

      // 3. إعدادات الإدارة المركزية والترويسة والختوم
      if (method === 'GET' && p === '/api/super/settings') {
        let headerCfg = null;
        try { headerCfg = JSON.parse(getSetting('GLOBAL', 'reportHeaderConfig', 'null')); } catch(e){}
        const masterOrgCode = getSetting('GLOBAL', 'masterOrgCode', 'CODEX');
        send(res, 200, {
          ok: true,
          masterOrgCode,
          superAdminUserName: me.userName,
          superAdminPlainPassword: me.plainPassword,
          reportHeaderConfig: headerCfg
        });
        return;
      }

      if (method === 'POST' && p === '/api/super/settings') {
        const b = await readBody(req);
        if (b.reportHeaderConfig !== undefined) {
          setSetting('GLOBAL', 'reportHeaderConfig', JSON.stringify(b.reportHeaderConfig));
        }
        if (b.masterOrgCode) {
          setSetting('GLOBAL', 'masterOrgCode', String(b.masterOrgCode).trim().toUpperCase());
        }
        send(res, 200, { ok: true, message: 'تم حفظ إعدادات الإدارة المركزية بنجاح ✔' });
        return;
      }

      // 4. النسخ الاحتياطي لقاعدة بيانات SQLite الشاملة للنظام
      if (method === 'GET' && (p === '/api/super/backup' || p === '/api/super/backup/db')) {
        const format = u.searchParams.get('format');
        if (format === 'json') {
          const allOrgs = db.prepare("SELECT * FROM organizations").all();
          const allUsers = db.prepare("SELECT * FROM users").all();
          const allReports = db.prepare("SELECT * FROM reports").all();
          const allEvents = db.prepare("SELECT * FROM events").all();
          const allDevices = db.prepare("SELECT * FROM devices").all();
          const allSettings = db.prepare("SELECT * FROM settings").all();
          const backupData = {
            version: '3.0',
            system: 'CentralAdmin_FullBackup',
            databaseEngine: 'SQLite3',
            date: nowIso(),
            organizations: allOrgs,
            users: allUsers,
            reports: allReports,
            events: allEvents,
            devices: allDevices,
            settings: allSettings
          };
          const out = JSON.stringify(backupData, null, 2);
          const fileName = `Central_Backup_${new Date().toISOString().slice(0, 10)}.json`;
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Access-Control-Allow-Origin': '*'
          });
          res.end(out);
          return;
        }

        // التنزيل المباشر لقاعدة بيانات SQLite الأصلية (.db) عبر لقطة VACUUM الآمنة
        const tempBackupPath = path.join(DATA_DIR, `temp_super_backup_${Date.now()}.db`);
        const safePath = tempBackupPath.replace(/\\/g, '/').replace(/'/g, "''");
        try {
          if (fs.existsSync(tempBackupPath)) fs.unlinkSync(tempBackupPath);
          db.exec(`VACUUM INTO '${safePath}'`);
          const fileBuf = fs.readFileSync(tempBackupPath);
          try { fs.unlinkSync(tempBackupPath); } catch(e){}
          const fileName = `Central_Database_${new Date().toISOString().slice(0, 10)}.db`;
          res.writeHead(200, {
            'Content-Type': 'application/x-sqlite3',
            'Content-Length': fileBuf.length,
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Access-Control-Allow-Origin': '*'
          });
          res.end(fileBuf);
          return;
        } catch(err) {
          console.error('Vacuum backup error:', err);
          sendError(res, 500, 'تعذر توليد ملف قاعدة بيانات SQLite: ' + err.message);
          return;
        }
      }

      // 5. استعادة النسخة الاحتياطية (ملف SQLite .db مباشر أو ملف JSON)
      if (method === 'POST' && p === '/api/super/restore') {
        const rawBuf = await readRawBody(req);
        if (!rawBuf || rawBuf.length === 0) {
          sendError(res, 400, 'لم يتم إرسال أي ملف للاستعادة');
          return;
        }

        const isSqlite = rawBuf.length >= 16 && rawBuf.subarray(0, 16).toString('utf8').startsWith('SQLite format 3');
        if (isSqlite) {
          const tempRestorePath = path.join(DATA_DIR, `temp_restore_${Date.now()}.db`);
          fs.writeFileSync(tempRestorePath, rawBuf);
          try {
            const safeAttach = tempRestorePath.replace(/\\/g, '/').replace(/'/g, "''");
            db.exec(`ATTACH DATABASE '${safeAttach}' AS src;`);
            const srcTables = db.prepare("SELECT name FROM src.sqlite_master WHERE type='table'").all().map(r => r.name);
            db.exec('BEGIN TRANSACTION;');
            for (const tbl of ['organizations', 'users', 'reports', 'events', 'devices', 'settings']) {
              if (srcTables.includes(tbl)) {
                try {
                  db.exec(`INSERT OR REPLACE INTO ${tbl} SELECT * FROM src.${tbl};`);
                } catch (e) {
                  console.warn(`Restore notice for ${tbl}:`, e.message);
                }
              }
            }
            db.exec('COMMIT;');
            db.exec('DETACH DATABASE src;');
            try { fs.unlinkSync(tempRestorePath); } catch(e){}
            send(res, 200, { ok: true, message: 'تمت استعادة ودمج قاعدة بيانات SQLite بنجاح ✔' });
            return;
          } catch(err) {
            try { db.exec('ROLLBACK;'); } catch(e){}
            try { db.exec('DETACH DATABASE src;'); } catch(e){}
            try { if (fs.existsSync(tempRestorePath)) fs.unlinkSync(tempRestorePath); } catch(e){}
            sendError(res, 400, 'فشلت استعادة ملف قاعدة بيانات SQLite: ' + err.message);
            return;
          }
        }

        let b;
        try {
          b = JSON.parse(rawBuf.toString('utf8'));
        } catch(e) {
          sendError(res, 400, 'الملف المرفوع ليس ملف قاعدة بيانات SQLite (.db) ولا ملف JSON صالح');
          return;
        }

        if (!b || (!b.organizations && !b.reports)) {
          sendError(res, 400, 'ملف النسخة الاحتياطية غير صالح');
          return;
        }
        if (Array.isArray(b.organizations)) {
          for (const o of b.organizations) {
            db.prepare(`INSERT OR REPLACE INTO organizations(id, orgCode, orgName, logoUrl, phone, status, maxUsers, allowHqAccess, encKey, createdAt)
              VALUES(?,?,?,?,?,?,?,?,?,?)`).run(o.id, o.orgCode, o.orgName, o.logoUrl || '', o.phone || '', o.status || 'active', o.maxUsers || 50, o.allowHqAccess ?? 1, o.encKey || null, o.createdAt || nowIso());
          }
        }
        if (Array.isArray(b.users)) {
          for (const u of b.users) {
            db.prepare(`INSERT OR REPLACE INTO users(id, orgId, userName, fullName, passwordHash, plainPassword, role, isActive,
              canDash, canEntry, canReports, canReportsEdit, canReportsDelete, canReportsPrint, canEvents, canUsers, canSettings, createdAt)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
                u.id, u.orgId || null, u.userName, u.fullName, u.passwordHash, u.plainPassword, u.role, u.isActive ? 1 : 0,
                u.canDash ? 1 : 0, u.canEntry ? 1 : 0, u.canReports ? 1 : 0, u.canReportsEdit ? 1 : 0,
                u.canReportsDelete ? 1 : 0, u.canReportsPrint ? 1 : 0, u.canEvents ? 1 : 0,
                u.canUsers ? 1 : 0, u.canSettings ? 1 : 0, u.createdAt || nowIso()
              );
          }
        }
        if (Array.isArray(b.reports)) {
          for (const r of b.reports) {
            db.prepare(`INSERT OR REPLACE INTO reports(id, orgId, reportNumber, subject, target, reportDate, reportTime, location, details, images, enteredBy, enteredByUserId, rating, logoId, createdAt, updatedAt, syncedAt)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
                r.id, r.orgId, r.reportNumber, r.subject, r.target || '', r.reportDate, r.reportTime || '', r.location || '', r.details || '',
                typeof r.images === 'string' ? r.images : JSON.stringify(r.images || []),
                r.enteredBy || '', r.enteredByUserId || '', r.rating || '', r.logoId || '', r.createdAt || nowIso(), r.updatedAt || null, r.syncedAt || null
              );
          }
        }
        send(res, 200, { ok: true, message: 'تم استعادة النسخة الاحتياطية بنجاح ✔' });
        return;
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

    // 4. دفع وتحديث الأجهزة المعتمدة من كمبيوتر المدير إلى السحابة (Push Devices to Cloud)
    if (method === 'POST' && p === '/api/relay/push-devices') {
      if (!isOrgAdmin(me)) { sendError(res, 403, 'غير مصرح'); return; }
      const b = await readBody(req);
      const devices = Array.isArray(b.devices) ? b.devices : [];
      let upsertedCount = 0;
      for (const dev of devices) {
        if (!dev.id || !dev.deviceId) continue;
        db.prepare(`INSERT OR REPLACE INTO devices(
          id, orgId, deviceId, deviceName, userId, userName, userFullName, status, registeredAt, lastSeenAt, approvedAt, approvedBy
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            dev.id, orgId, dev.deviceId, dev.deviceName || '', dev.userId || '', dev.userName || '',
            dev.userFullName || '', dev.status || 'approved', dev.registeredAt || nowIso(), dev.lastSeenAt || nowIso(),
            dev.approvedAt || nowIso(), dev.approvedBy || me.fullName
          );
        upsertedCount++;
      }
      send(res, 200, { ok: true, syncedDevices: upsertedCount });
      return;
    }

    // 5. دفع وتحديث المستخدمين والصلاحيات من كمبيوتر المدير إلى السحابة (Push Users & Permissions to Cloud)
    if (method === 'POST' && p === '/api/relay/push-users') {
      if (!isOrgAdmin(me)) { sendError(res, 403, 'غير مصرح'); return; }
      const b = await readBody(req);
      const users = Array.isArray(b.users) ? b.users : [];
      let upsertedCount = 0;
      for (const u of users) {
        if (!u.id || !u.userName) continue;
        db.prepare(`INSERT OR REPLACE INTO users(
          id, orgId, userName, fullName, passwordHash, plainPassword, role, isActive,
          canOpen, canAdd, canDelete, canEdit, canPrint,
          canDash, canEntry, canReports, canReportsEdit, canReportsDelete, canReportsPrint,
          canEvents, canUsers, canSettings, createdAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            u.id, orgId, u.userName, u.fullName || u.userName, u.passwordHash, u.plainPassword || '', u.role || 'EntryUser', u.isActive ? 1 : 0,
            u.canOpen ? 1 : 0, u.canAdd ? 1 : 0, u.canDelete ? 1 : 0, u.canEdit ? 1 : 0, u.canPrint ? 1 : 0,
            u.canDash ? 1 : 0, u.canEntry ? 1 : 0, u.canReports ? 1 : 0, u.canReportsEdit ? 1 : 0, u.canReportsDelete ? 1 : 0, u.canReportsPrint ? 1 : 0,
            u.canEvents ? 1 : 0, u.canUsers ? 1 : 0, u.canSettings ? 1 : 0, u.createdAt || nowIso()
          );
        upsertedCount++;
      }
      send(res, 200, { ok: true, syncedUsers: upsertedCount });
      return;
    }

    // 6. دفع وتحديث الإعدادات من كمبيوتر المدير إلى السحابة (Push Settings to Cloud)
    if (method === 'POST' && p === '/api/relay/push-settings') {
      if (!isOrgAdmin(me)) { sendError(res, 403, 'غير مصرح'); return; }
      const b = await readBody(req);
      if (b.settings && typeof b.settings === 'object') {
        for (const [k, v] of Object.entries(b.settings)) {
          setSetting(orgId, k, v);
        }
      }
      send(res, 200, { ok: true });
      return;
    }

    // 7. المزامنة الفورية مع السحابة من واجهة المدير (Trigger Sync Now)
    if (method === 'POST' && p === '/api/relay/sync-now') {
      if (!isOrgAdmin(me)) { sendError(res, 403, 'غير مصرح'); return; }
      try {
        const syncRes = await performCloudRelaySync(orgId);
        send(res, 200, { ok: true, ...syncRes, message: 'تمت المزامنة مع السحابة وجلب التقارير بنجاح ✔' });
      } catch(e) {
        send(res, 200, { ok: false, error: e.message, message: 'تعذر الاتصال بالسحابة: ' + e.message });
      }
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

        const exists = db.prepare('SELECT id FROM users WHERE orgId=? AND LOWER(userName)=LOWER(?)').get(orgId, userName);
        if (exists) { sendError(res, 409, `اسم مدخل البيانات (${userName}) مسجل مسبقاً في هذا الفرع، يرجى اختيار اسم فريد`); return; }

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
        if (b.userName) {
          const newU = String(b.userName).trim();
          if (newU && newU.toLowerCase() !== user.userName.toLowerCase()) {
            const dup = db.prepare('SELECT id FROM users WHERE orgId=? AND LOWER(userName)=LOWER(?) AND id<>?').get(orgId, newU, user.id);
            if (dup) { sendError(res, 409, `اسم مدخل البيانات (${newU}) مسجل مسبقاً في هذا الفرع، يرجى اختيار اسم فريد`); return; }
            db.prepare('UPDATE users SET userName=? WHERE id=?').run(newU, user.id);
          }
        }
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
        
        let repNum = String(repData.reportNumber || '').trim();
        if (!repNum || repNum.includes('مسودة') || repNum.toLowerCase().includes('draft') || repNum.startsWith('#') || repNum === 'undefined' || repNum === 'null') {
          repNum = getNextReportNumber(orgId);
        }
        const isEnc = repData.isEncrypted ? 1 : 0;
        const encPayload = String(repData.encryptedPayload || '');
        const encIv = String(repData.encryptedIv || '');
        
        db.prepare(`INSERT OR REPLACE INTO reports(
          id, orgId, reportNumber, subject, target, reportDate, reportTime, location, details, images,
          enteredBy, enteredByUserId, rating, logoId, isEncrypted, encryptedPayload, encryptedIv, createdAt, updatedAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            id, orgId, repNum, String(repData.subject || ''), String(repData.target || ''),
            String(repData.reportDate || t.slice(0, 10)), String(repData.reportTime || t.slice(11, 16)),
            String(repData.location || ''), String(repData.details || ''), JSON.stringify(repData.images || []),
            me.fullName, me.id, String(repData.rating || 'عادي'), String(repData.logoId || 'logo1'),
            isEnc, encPayload, encIv, t, t
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
          message: `تم ترحيل وحفظ التقرير بنجاح برقم رسمي (#${repNum}) ✔`
        });
        return;
      }
    }

    /* استيراد تقارير دفعة واحدة من ملف */
    if (p === '/api/reports/import' && method === 'POST') {
      if (!can(me, 'canAdd') && !isOrgAdmin(me) && !can(me, 'canReports')) { sendError(res, 403, 'غير مصرح باستيراد التقارير'); return; }
      const b = await readBody(req);
      let incoming = [];
      if (Array.isArray(b.reports)) {
        incoming = b.reports;
      } else if (Array.isArray(b)) {
        incoming = b;
      } else if (b.backup && Array.isArray(b.backup.reports)) {
        incoming = b.backup.reports;
      } else {
        sendError(res, 400, 'صيغة الاستيراد غير صالحة، يجب تمرير قائمة التقارير');
        return;
      }

      if (!incoming.length) {
        sendError(res, 400, 'الملف أو البيانات لا تحتوي على أي تقارير للاستيراد');
        return;
      }

      let importedCount = 0;
      const t = nowIso();
      for (const r of incoming) {
        if (!r || typeof r !== 'object') continue;
        const subject = String(r.subject || '').trim();
        if (!subject) continue;

        const id = (r.id && String(r.id).trim()) || uid();
        let repNum = String(r.reportNumber || '').trim();
        if (!repNum || repNum.includes('مسودة') || repNum.toLowerCase().includes('draft') || repNum.startsWith('#')) {
          repNum = getNextReportNumber(orgId);
        }
        const target = String(r.target || '');
        const repDate = String(r.reportDate || t.slice(0, 10));
        const repTime = String(r.reportTime || t.slice(11, 16));
        const loc = String(r.location || '');
        const details = String(r.details || '');
        const rating = String(r.rating || 'عادي');
        const logoId = String(r.logoId || 'logo1');
        const enteredBy = String(r.enteredBy || me.fullName);
        const enteredByUserId = String(r.enteredByUserId || me.id);
        const images = Array.isArray(r.images) ? JSON.stringify(r.images) : (typeof r.images === 'string' ? r.images : '[]');

        db.prepare(`INSERT OR REPLACE INTO reports(
          id, orgId, reportNumber, subject, target, reportDate, reportTime, location, details, images,
          enteredBy, enteredByUserId, rating, logoId, isEncrypted, encryptedPayload, encryptedIv, createdAt, updatedAt, syncedAt
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            id, orgId, repNum, subject, target, repDate, repTime, loc, details, images,
            enteredBy, enteredByUserId, rating, logoId, 0, '', '', r.createdAt || t, t, t
          );
        importedCount++;
      }

      send(res, 200, { ok: true, importedCount, message: `تم استيراد (${importedCount}) تقرير بنجاح ✔` });
      return;
    }

    /* حذف تقارير متعددة دفعة واحدة */
    if (p === '/api/reports/batch-delete' && method === 'POST') {
      if (!can(me, 'canReportsDelete') && !isOrgAdmin(me)) { sendError(res, 403, 'غير مصرح بحذف التقارير'); return; }
      const b = await readBody(req);
      const ids = Array.isArray(b.ids) ? b.ids : [];
      let deleted = 0;
      for (const rid of ids) {
        try {
          const resDel = db.prepare('DELETE FROM reports WHERE orgId=? AND id=?').run(orgId, rid);
          if (resDel.changes > 0) deleted++;
        } catch(e){}
      }
      send(res, 200, { ok: true, deletedCount: deleted, message: `تم حذف (${deleted}) تقرير بنجاح ✔` });
      return;
    }

    const rm = p.match(/^\/api\/reports\/([^/]+)$/);
    if (rm) {
      const rep = db.prepare('SELECT * FROM reports WHERE orgId=? AND id=?').get(orgId, rm[1]);
      if (!rep) { sendError(res, 404, 'التقرير غير موجود'); return; }
      if (method === 'GET') { send(res, 200, { report: parseReportRow(rep) }); return; }
      if (method === 'PUT') {
        if (!can(me, 'canReportsEdit') && rep.enteredByUserId !== me.id) { sendError(res, 403, 'غير مصرح بتعديل هذا التقرير'); return; }
        const b = await readBody(req);
        const isEnc = b.isEncrypted !== undefined ? (b.isEncrypted ? 1 : 0) : (rep.isEncrypted ? 1 : 0);
        const encPayload = b.encryptedPayload !== undefined ? String(b.encryptedPayload) : (rep.encryptedPayload || '');
        const encIv = b.encryptedIv !== undefined ? String(b.encryptedIv) : (rep.encryptedIv || '');

        db.prepare(`UPDATE reports SET
          subject=?, target=?, reportDate=?, reportTime=?, location=?, details=?, images=?, rating=?, isEncrypted=?, encryptedPayload=?, encryptedIv=?, updatedAt=?
          WHERE id=?`)
          .run(
            String(b.subject ?? rep.subject), String(b.target ?? rep.target),
            String(b.reportDate ?? rep.reportDate), String(b.reportTime ?? rep.reportTime),
            String(b.location ?? rep.location), String(b.details ?? rep.details),
            JSON.stringify(b.images ?? JSON.parse(rep.images || '[]')),
            String(b.rating ?? rep.rating), isEnc, encPayload, encIv, nowIso(), rep.id
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
    if (p === '/api/events' || p === '/api/events/mine') {
      if (method === 'GET') {
        if (p === '/api/events' && !can(me, 'canEvents') && !can(me, 'canReports') && !can(me, 'canDash')) {
          sendError(res, 403, 'غير مصرح');
          return;
        }

        if (p === '/api/events/mine') {
          // جلب كافة المهام غير المؤرشفة للجهة ثم تصفيتها بدقة فائقة
          const allOrgEvents = db.prepare('SELECT * FROM events WHERE orgId=? AND isArchived=0 ORDER BY eventDate DESC, createdDate DESC').all(orgId);

          const norm = (s) => (s || '').toLowerCase()
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي')
            .replace(/[^\u0621-\u064A\w]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const myId = String(me.id || '').trim();
          const myUserNorm = norm(me.userName);
          const myFullNorm = norm(me.fullName);

          const myEvents = allOrgEvents.filter(ev => {
            const evUserId = String(ev.assignedUserId || '').trim();
            const evNameNorm = norm(ev.assignedUserName);

            // 1. تكليف عام لجميع الموظفين
            if (!evUserId || evUserId === 'all' || evUserId === '0' || evUserId === 'null' || evUserId === 'undefined') return true;
            if (!evNameNorm || evNameNorm === 'الكل' || evNameNorm === 'جميع الموظفين' || evNameNorm === 'all') return true;

            // 2. مطابقة المعرف المباشر
            if (evUserId === myId) return true;

            // 3. مطابقة اسم المستخدم أو الاسم الكامل بالتقارب الذكي
            if (myUserNorm && (evNameNorm === myUserNorm || evNameNorm.includes(myUserNorm) || myUserNorm.includes(evNameNorm))) return true;
            if (myFullNorm && (evNameNorm === myFullNorm || evNameNorm.includes(myFullNorm) || myFullNorm.includes(evNameNorm))) return true;

            // 4. مطابقة الكلمات المشتركة (مثال: "أحمد محمد" مع "أحمد محمد علي")
            const evWords = evNameNorm.split(' ').filter(w => w.length > 2);
            const myWords = myFullNorm.split(' ').filter(w => w.length > 2);
            const commonWords = evWords.filter(w => myWords.includes(w));
            if (commonWords.length >= 2 || (evWords.length === 1 && commonWords.length === 1)) return true;

            // 5. فحص ما إذا كان المعرف المسند في الفعالية يطابق مستخدماً في جدول المستخدمين له نفس اسم المستخدم أو الاسم الكامل
            try {
              const u = db.prepare('SELECT userName, fullName FROM users WHERE orgId=? AND id=?').get(orgId, evUserId);
              if (u && (norm(u.userName) === myUserNorm || norm(u.fullName) === myFullNorm)) return true;
            } catch(e){}

            return false;
          });

          send(res, 200, { ok: true, events: myEvents });
          return;
        }

        // لوحة تحكم المدير: جلب جميع المهام
        let sql = 'SELECT * FROM events WHERE orgId=?';
        const params = [orgId];
        sql += ' ORDER BY eventDate DESC, createdDate DESC';
        const events = db.prepare(sql).all(...params);
        send(res, 200, { ok: true, events });
        return;
      }
      if (method === 'POST') {
        if (!can(me, 'canEvents')) { sendError(res, 403, 'غير مصرح بتكليف مهام'); return; }
        const b = await readBody(req);
        const id = uid();
        const t = nowIso();
        const assignedUserId = b.assignedUserId ? String(b.assignedUserId) : me.id;
        let assignedUser = null;
        if (assignedUserId && assignedUserId !== 'all' && assignedUserId !== '0') {
          try { assignedUser = db.prepare('SELECT * FROM users WHERE orgId=? AND id=?').get(orgId, assignedUserId); } catch(e){}
        }
        const assignedUserName = (assignedUserId === 'all' || assignedUserId === '0')
          ? 'جميع الموظفين'
          : (assignedUser ? assignedUser.fullName : (b.assignedUserName || me.fullName));

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

        // دفع التكليفات فوراً إلى السحابة إن كنا محلياً
        if (!process.env.RENDER && typeof performCloudRelaySync === 'function') {
          setTimeout(() => performCloudRelaySync(orgId).catch(() => {}), 100);
        }

        send(res, 200, { ok: true, message: 'تم إرسال وتكليف المهمة بنجاح ✔', event: db.prepare('SELECT * FROM events WHERE id=?').get(id) });
        return;
      }
    }

    const em = p.match(/^\/api\/events\/([^/]+)(?:\/status)?$/);
    if (em && em[1] !== 'mine') {
      const event = db.prepare('SELECT * FROM events WHERE orgId=? AND id=?').get(orgId, em[1]);
      if (!event) { sendError(res, 404, 'المهمة غير موجودة'); return; }
      if (method === 'PUT') {
        const b = await readBody(req);
        const newStatus = String(b.status || event.status);
        const now = nowIso();
        const receivedAt = b.receivedAt !== undefined ? b.receivedAt : (newStatus === 'received' && !event.receivedAt ? now : event.receivedAt);
        const completedAt = b.completedAt !== undefined ? b.completedAt : (newStatus === 'completed' && !event.completedAt ? now : event.completedAt);
        const feedbackNotes = b.feedbackNotes !== undefined ? String(b.feedbackNotes) : (event.feedbackNotes || '');

        db.prepare(`UPDATE events SET
          status=?, receivedAt=?, completedAt=?, feedbackNotes=? WHERE id=?`)
          .run(newStatus, receivedAt, completedAt, feedbackNotes, event.id);

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

    /* ---- الإعدادات والنسخ الاحتياطي داخل الجهة ---- */
    if (p === '/api/settings') {
      if (!can(me, 'canSettings') && !can(me, 'canUsers')) { sendError(res, 403, 'غير مصرح'); return; }
      if (method === 'GET') {
        let hdrCfg = null;
        try {
          const rawHdr = getSetting(orgId, 'reportHeaderConfig', '');
          if (rawHdr) hdrCfg = JSON.parse(rawHdr);
        } catch(e){}
        const settings = {
          baseUrl: (req.headers['host'] ? ('http://' + req.headers['host']) : ('http://localhost:' + PORT)),
          enforceDeviceAuth: getSetting(orgId, 'enforceDeviceAuth', '1') === '1',
          consumeAddAfterSync: getSetting(orgId, 'consumeAddAfterSync', '0') === '1',
          reportHeaderConfig: hdrCfg
        };
        send(res, 200, { ok: true, settings });
        return;
      }
      if (method === 'PUT') {
        const b = await readBody(req);
        if (b.reportHeaderConfig !== undefined) {
          setSetting(orgId, 'reportHeaderConfig', JSON.stringify(b.reportHeaderConfig));
        }
        if (b.enforceDeviceAuth !== undefined) {
          setSetting(orgId, 'enforceDeviceAuth', b.enforceDeviceAuth ? '1' : '0');
        }
        if (b.consumeAddAfterSync !== undefined) {
          setSetting(orgId, 'consumeAddAfterSync', b.consumeAddAfterSync ? '1' : '0');
        }
        send(res, 200, { ok: true, message: 'تم حفظ الإعدادات بنجاح' });
        return;
      }
    }

    if (method === 'GET' && p === '/api/backup') {
      if (!can(me, 'canSettings') && !isOrgAdmin(me)) { sendError(res, 403, 'غير مصرح'); return; }
      const format = u.searchParams.get('format');
      if (format === 'json') {
        const org = db.prepare('SELECT * FROM organizations WHERE id=?').get(orgId);
        const reports = db.prepare('SELECT * FROM reports WHERE orgId=?').all(orgId).map(parseReportRow);
        const events = db.prepare('SELECT * FROM events WHERE orgId=?').all(orgId);
        const users = db.prepare('SELECT id, userName, fullName, role, isActive, plainPassword, createdAt FROM users WHERE orgId=?').all(orgId);
        const settings = db.prepare('SELECT key, value FROM settings WHERE orgId=?').all(orgId);
        const backupData = {
          version: '2026.1',
          databaseEngine: 'SQLite3',
          exportedAt: nowIso(),
          organization: org,
          reports,
          events,
          users,
          settings
        };
        send(res, 200, backupData);
        return;
      }

      // الصيغة الافتراضية: ملف قاعدة بيانات SQLite (.db) مستقل وخاص بالفرع
      const org = db.prepare('SELECT * FROM organizations WHERE id=?').get(orgId);
      const orgCode = (org ? org.orgCode : 'BRANCH').toUpperCase();
      const tempBranchPath = path.join(DATA_DIR, `temp_branch_${orgId}_${Date.now()}.db`);
      if (fs.existsSync(tempBranchPath)) fs.unlinkSync(tempBranchPath);
      const bDb = new DatabaseSync(tempBranchPath);
      try {
        bDb.exec(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE organizations (id TEXT PRIMARY KEY, orgCode TEXT, orgName TEXT, logoUrl TEXT, phone TEXT, email TEXT, status TEXT, maxUsers INTEGER, allowHqAccess INTEGER, encKey TEXT, createdAt TEXT);
          CREATE TABLE users (id TEXT PRIMARY KEY, orgId TEXT, userName TEXT, fullName TEXT, passwordHash TEXT, plainPassword TEXT, role TEXT, isActive INTEGER, canDash INTEGER, canEntry INTEGER, canReports INTEGER, canReportsEdit INTEGER, canReportsDelete INTEGER, canReportsPrint INTEGER, canEvents INTEGER, canUsers INTEGER, canSettings INTEGER, createdAt TEXT);
          CREATE TABLE reports (id TEXT PRIMARY KEY, orgId TEXT, reportNumber TEXT, subject TEXT, target TEXT, reportDate TEXT, reportTime TEXT, location TEXT, details TEXT, images TEXT, enteredBy TEXT, enteredByUserId TEXT, rating TEXT, logoId TEXT, isEncrypted INTEGER, encryptedPayload TEXT, encryptedIv TEXT, createdAt TEXT, updatedAt TEXT, syncedAt TEXT);
          CREATE TABLE events (id TEXT PRIMARY KEY, orgId TEXT, title TEXT, eventType TEXT, notes TEXT, eventDate TEXT, eventTime TEXT, location TEXT, assignedUserId TEXT, assignedUserName TEXT, createdBy TEXT, createdById TEXT, createdDate TEXT, status TEXT, receivedAt TEXT, completedAt TEXT, feedbackNotes TEXT, isArchived INTEGER);
          CREATE TABLE devices (id TEXT PRIMARY KEY, orgId TEXT, deviceId TEXT, deviceName TEXT, userId TEXT, userName TEXT, userFullName TEXT, status TEXT, registeredAt TEXT, approvedAt TEXT, lastSeenAt TEXT, approvedBy TEXT);
          CREATE TABLE settings (orgId TEXT, key TEXT, value TEXT, PRIMARY KEY(orgId, key));
        `);
        if (org) {
          bDb.prepare('INSERT INTO organizations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
            org.id, org.orgCode, org.orgName, org.logoUrl||'', org.phone||'', org.email||'', org.status||'active', org.maxUsers||50, org.allowHqAccess??1, org.encKey||null, org.createdAt||nowIso()
          );
        }
        const users = db.prepare('SELECT * FROM users WHERE orgId=?').all(orgId);
        for (const u of users) {
          bDb.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
            u.id, u.orgId, u.userName, u.fullName, u.passwordHash, u.plainPassword||'', u.role, u.isActive?1:0,
            u.canDash?1:0, u.canEntry?1:0, u.canReports?1:0, u.canReportsEdit?1:0, u.canReportsDelete?1:0, u.canReportsPrint?1:0,
            u.canEvents?1:0, u.canUsers?1:0, u.canSettings?1:0, u.createdAt||nowIso()
          );
        }
        const reports = db.prepare('SELECT * FROM reports WHERE orgId=?').all(orgId);
        for (const r of reports) {
          bDb.prepare('INSERT INTO reports VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
            r.id, r.orgId, r.reportNumber, r.subject||'', r.target||'', r.reportDate||'', r.reportTime||'', r.location||'', r.details||'',
            typeof r.images === 'string' ? r.images : JSON.stringify(r.images||[]), r.enteredBy||'', r.enteredByUserId||'', r.rating||'عادي',
            r.logoId||'logo1', r.isEncrypted?1:0, r.encryptedPayload||'', r.encryptedIv||'', r.createdAt||nowIso(), r.updatedAt||nowIso(), r.syncedAt||''
          );
        }
        const events = db.prepare('SELECT * FROM events WHERE orgId=?').all(orgId);
        for (const e of events) {
          bDb.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
            e.id, e.orgId, e.title, e.eventType, e.notes||'', e.eventDate||'', e.eventTime||'', e.location||'', e.assignedUserId||'',
            e.assignedUserName||'', e.createdBy||'', e.createdById||'', e.createdDate||nowIso(), e.status||'pending', e.receivedAt||null,
            e.completedAt||null, e.feedbackNotes||'', e.isArchived?1:0
          );
        }
        const devices = db.prepare('SELECT * FROM devices WHERE orgId=?').all(orgId);
        for (const d of devices) {
          bDb.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
            d.id, d.orgId, d.deviceId, d.deviceName||'', d.userId||'', d.userName||'', d.userFullName||'', d.status||'pending',
            d.registeredAt||nowIso(), d.approvedAt||null, d.lastSeenAt||nowIso(), d.approvedBy||''
          );
        }
        const settings = db.prepare('SELECT * FROM settings WHERE orgId=?').all(orgId);
        for (const s of settings) {
          bDb.prepare('INSERT INTO settings VALUES(?,?,?)').run(s.orgId, s.key, s.value);
        }
      } finally {
        bDb.close();
      }

      const fileBuf = fs.readFileSync(tempBranchPath);
      try { fs.unlinkSync(tempBranchPath); } catch(e){}
      const fileName = `Branch_${orgCode}_${new Date().toISOString().slice(0,10)}.db`;
      res.writeHead(200, {
        'Content-Type': 'application/x-sqlite3',
        'Content-Length': fileBuf.length,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(fileBuf);
      return;
    }

    if (method === 'POST' && p === '/api/restore') {
      if (!can(me, 'canSettings') && !isOrgAdmin(me)) { sendError(res, 403, 'غير مصرح'); return; }
      const rawBuf = await readRawBody(req);
      if (!rawBuf || rawBuf.length === 0) {
        sendError(res, 400, 'لم يتم إرسال أي ملف للاستعادة');
        return;
      }

      const isSqlite = rawBuf.length >= 16 && rawBuf.subarray(0, 16).toString('utf8').startsWith('SQLite format 3');
      if (isSqlite) {
        const tempBranchRestore = path.join(DATA_DIR, `temp_b_restore_${orgId}_${Date.now()}.db`);
        fs.writeFileSync(tempBranchRestore, rawBuf);
        try {
          const safeAttach = tempBranchRestore.replace(/\\/g, '/').replace(/'/g, "''");
          db.exec(`ATTACH DATABASE '${safeAttach}' AS bsrc;`);
          const srcTables = db.prepare("SELECT name FROM bsrc.sqlite_master WHERE type='table'").all().map(r => r.name);
          db.exec('BEGIN TRANSACTION;');
          if (srcTables.includes('settings')) {
            const srcSettings = db.prepare('SELECT * FROM bsrc.settings').all();
            for (const s of srcSettings) setSetting(orgId, s.key, s.value);
          }
          if (srcTables.includes('reports')) {
            const srcReports = db.prepare('SELECT * FROM bsrc.reports').all();
            for (const r of srcReports) {
              const exists = db.prepare('SELECT id FROM reports WHERE orgId=? AND id=?').get(orgId, r.id);
              if (!exists) {
                db.prepare(`INSERT INTO reports(id, orgId, reportNumber, subject, target, reportDate, reportTime, location, details, images, enteredBy, enteredByUserId, rating, logoId, isEncrypted, encryptedPayload, encryptedIv, createdAt, updatedAt)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
                    r.id, orgId, r.reportNumber, r.subject||'', r.target||'', r.reportDate||nowIso().slice(0,10), r.reportTime||nowIso().slice(11,16),
                    r.location||'', r.details||'', typeof r.images === 'string' ? r.images : JSON.stringify(r.images||[]),
                    r.enteredBy||me.fullName, r.enteredByUserId||me.id, r.rating||'عادي', r.logoId||'logo1',
                    r.isEncrypted?1:0, r.encryptedPayload||'', r.encryptedIv||'', r.createdAt||nowIso(), r.updatedAt||nowIso()
                  );
              }
            }
          }
          if (srcTables.includes('events')) {
            const srcEvents = db.prepare('SELECT * FROM bsrc.events').all();
            for (const e of srcEvents) {
              const exists = db.prepare('SELECT id FROM events WHERE orgId=? AND id=?').get(orgId, e.id);
              if (!exists) {
                db.prepare(`INSERT INTO events(id, orgId, title, eventType, notes, eventDate, eventTime, location, assignedUserId, assignedUserName, createdBy, createdById, createdDate, status, receivedAt, completedAt, feedbackNotes, isArchived)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
                    e.id, orgId, e.title, e.eventType, e.notes||'', e.eventDate||'', e.eventTime||'', e.location||'', e.assignedUserId||'',
                    e.assignedUserName||'', e.createdBy||'', e.createdById||'', e.createdDate||nowIso(), e.status||'pending', e.receivedAt||null,
                    e.completedAt||null, e.feedbackNotes||'', e.isArchived?1:0
                  );
              }
            }
          }
          db.exec('COMMIT;');
          db.exec('DETACH DATABASE bsrc;');
          try { fs.unlinkSync(tempBranchRestore); } catch(e){}
          send(res, 200, { ok: true, message: 'تمت استعادة قاعدة بيانات SQLite بنجاح ✔' });
          return;
        } catch(err) {
          try { db.exec('ROLLBACK;'); } catch(e){}
          try { db.exec('DETACH DATABASE bsrc;'); } catch(e){}
          try { if (fs.existsSync(tempBranchRestore)) fs.unlinkSync(tempBranchRestore); } catch(e){}
          sendError(res, 400, 'فشلت استعادة ملف قاعدة بيانات SQLite: ' + err.message);
          return;
        }
      }

      let b;
      try {
        b = JSON.parse(rawBuf.toString('utf8'));
      } catch(e) {
        sendError(res, 400, 'الملف المرفوع ليس ملف قاعدة بيانات SQLite (.db) ولا ملف JSON صالح');
        return;
      }
      const backup = b.backup || b;
      if (!backup || !backup.organization) { sendError(res, 400, 'ملف النسخة الاحتياطية غير صالح'); return; }

      if (Array.isArray(backup.settings)) {
        for (const s of backup.settings) {
          setSetting(orgId, s.key, s.value);
        }
      }

      if (Array.isArray(backup.reports)) {
        for (const r of backup.reports) {
          const exists = db.prepare('SELECT id FROM reports WHERE orgId=? AND id=?').get(orgId, r.id);
          if (!exists) {
            db.prepare(`INSERT INTO reports(
              id, orgId, reportNumber, subject, target, reportDate, reportTime, location, details, images,
              enteredBy, enteredByUserId, rating, logoId, isEncrypted, encryptedPayload, encryptedIv, createdAt, updatedAt
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(
                r.id, orgId, r.reportNumber, r.subject || '', r.target || '',
                r.reportDate || nowIso().slice(0, 10), r.reportTime || nowIso().slice(11, 16),
                r.location || '', r.details || '', JSON.stringify(r.images || []),
                r.enteredBy || me.fullName, r.enteredByUserId || me.id, r.rating || 'عادي', r.logoId || 'logo1',
                r.isEncrypted ? 1 : 0, r.encryptedPayload || '', r.encryptedIv || '', r.createdAt || nowIso(), r.updatedAt || nowIso()
              );
          }
        }
      }

      send(res, 200, { ok: true, message: 'تمت استعادة البيانات بنجاح ✔' });
      return;
    }

    /* ---- إدارة الأجهزة داخل الجهة ---- */
    if (method === 'GET' && p === '/api/devices') {
      if (!can(me, 'canUsers')) { sendError(res, 403, 'غير مصرح'); return; }
      const devices = db.prepare('SELECT * FROM devices WHERE orgId=? ORDER BY lastSeenAt DESC').all(orgId);
      send(res, 200, { devices });
      return;
    }

    if (method === 'POST' && p === '/api/devices/approve-all') {
      if (!can(me, 'canUsers')) { sendError(res, 403, 'غير مصرح'); return; }
      const info = db.prepare("UPDATE devices SET status='approved', approvedAt=?, approvedBy=? WHERE orgId=? AND status='pending'")
        .run(nowIso(), me.fullName, orgId);
      send(res, 200, { ok: true, count: info.changes, message: `تم اعتماد وتفعيل ${info.changes} أجهزة بنجاح ✔` });
      return;
    }

    const devApprove = p.match(/^\/api\/devices\/([^/]+)\/(approve|block)$/);
    if (devApprove && (method === 'POST' || method === 'PUT')) {
      if (!can(me, 'canUsers')) { sendError(res, 403, 'غير مصرح'); return; }
      const action = devApprove[2];
      const devId = devApprove[1];
      const newStatus = action === 'approve' ? 'approved' : 'blocked';
      db.prepare('UPDATE devices SET status=?, approvedAt=?, approvedBy=? WHERE orgId=? AND id=?')
        .run(newStatus, nowIso(), me.fullName, orgId, devId);
      send(res, 200, { ok: true, status: newStatus, message: newStatus === 'approved' ? 'تم اعتماد الهاتف بنجاح 🟢' : 'تم حظر الهاتف ⛔' });
      return;
    }

    const devDel = p.match(/^\/api\/devices\/([^/]+)$/);
    if (devDel && method === 'DELETE') {
      if (!can(me, 'canUsers')) { sendError(res, 403, 'غير مصرح'); return; }
      db.prepare('DELETE FROM devices WHERE orgId=? AND id=?').run(orgId, devDel[1]);
      send(res, 200, { ok: true, message: 'تم حذف الجهاز من السجل' });
      return;
    }

    sendError(res, 404, 'المسار غير موجود (404)');
  } catch(err) {
    console.error('Server error:', err);
    sendError(res, 500, 'خطأ في معالجة الخادم: ' + err.message);
  }
});

/* ------------------------- محرك المزامنة السحابية للنسخة المحلية ------------------------- */
const CLOUD_URL = process.env.CLOUD_RELAY_URL || 'https://codex-multitenant-system.onrender.com';

function httpJsonRequest(targetUrl, opts = {}, body = null) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(targetUrl);
      const isHttps = u.protocol === 'https:';
      const client = isHttps ? https : http;
      const req = client.request({
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(opts.headers || {})
        },
        timeout: 10000
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch(e) { resolve({ status: res.statusCode, raw: data }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('انتهت مهلة الاتصال بالسحابة')); });
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    } catch(err) {
      reject(err);
    }
  });
}

async function performCloudRelaySync(targetOrgId) {
  const org = db.prepare('SELECT * FROM organizations WHERE id=?').get(targetOrgId);
  if (!org) return { pulledReports: 0, pulledDevices: 0, pushedDevices: 0 };

  const admin = db.prepare("SELECT * FROM users WHERE orgId=? AND role='Admin'").get(targetOrgId);
  if (!admin) return { pulledReports: 0, pulledDevices: 0, pushedDevices: 0 };

  // 1. تسجيل الدخول بالسحابة كمدير للجهة
  const loginRes = await httpJsonRequest(CLOUD_URL + '/api/login', { method: 'POST' }, {
    orgCode: org.orgCode,
    userName: admin.userName,
    password: admin.plainPassword || 'Admin@123'
  });

  if (loginRes.status !== 200 || !loginRes.data || !loginRes.data.token) {
    throw new Error('فشل تسجيل الدخول بالسحابة (كود ' + loginRes.status + ')');
  }

  const cloudToken = loginRes.data.token;
  let pulledReports = 0, pulledDevices = 0, pushedDevices = 0;

  // 2. سحب التقارير والأجهزة من طابور السحابة
  const pullRes = await httpJsonRequest(CLOUD_URL + '/api/relay/pull', {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + cloudToken,
      'X-Org-Code': org.orgCode
    }
  });

  if (pullRes.status === 200 && Array.isArray(pullRes.data.items) && pullRes.data.items.length > 0) {
    const ackIds = [];
    for (const item of pullRes.data.items) {
      if (item.itemType === 'report' && item.payload) {
        const r = item.payload;
        try {
          let repNum = String(r.reportNumber || '').trim();
          if (!repNum || repNum.includes('مسودة') || repNum.toLowerCase().includes('draft') || repNum.startsWith('#')) {
            repNum = getNextReportNumber(org.id);
          }
          db.prepare(`INSERT OR REPLACE INTO reports(
            id, orgId, reportNumber, subject, target, reportDate, reportTime, location, details, images,
            enteredBy, enteredByUserId, rating, logoId, isEncrypted, encryptedPayload, encryptedIv, createdAt, updatedAt, syncedAt
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(
              r.id, org.id, repNum, r.subject || '', r.target || '',
              r.reportDate || '', r.reportTime || '', r.location || '', r.details || '',
              typeof r.images === 'string' ? r.images : JSON.stringify(r.images || []),
              r.enteredBy || '', r.enteredByUserId || null,
              r.rating || 'عادي', r.logoId || 'logo1',
              r.isEncrypted ? 1 : 0, r.encryptedPayload || '', r.encryptedIv || '',
              r.createdAt || nowIso(), r.updatedAt || nowIso(), nowIso()
            );
          ackIds.push(item.id);
          pulledReports++;
          console.log(`[💾 HardDisk Sync] تم حفظ التقرير (${repNum} - ${r.subject}) بنجاح على القرص الصلب`);
        } catch(e){}
      } else if (item.itemType === 'device_registration' && item.payload) {
        const dev = item.payload;
        try {
          const exists = db.prepare('SELECT id FROM devices WHERE orgId=? AND deviceId=?').get(org.id, dev.deviceId);
          if (!exists) {
            db.prepare(`INSERT INTO devices(
              id, orgId, deviceId, deviceName, userId, userName, userFullName, status, registeredAt, lastSeenAt, approvedAt, approvedBy
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(
                dev.id, org.id, dev.deviceId, dev.deviceName || '', dev.userId || '', dev.userName || '',
                dev.userFullName || '', dev.status || 'pending', dev.registeredAt || nowIso(),
                dev.lastSeenAt || nowIso(), dev.approvedAt || null, dev.approvedBy || ''
              );
          }
          ackIds.push(item.id);
          pulledDevices++;
          console.log(`[📱 Device Sync] تم مزامنة الهاتف الجديد (${dev.deviceName || dev.deviceId}) محلياً`);
        } catch(e){}
      } else if (item.itemType === 'event_feedback' && item.payload) {
        const f = item.payload;
        try {
          db.prepare(`UPDATE events SET status=?, receivedAt=?, completedAt=?, feedbackNotes=? WHERE id=? AND orgId=?`)
            .run(f.status, f.receivedAt || null, f.completedAt || null, f.feedbackNotes || '', f.eventId, org.id);
          ackIds.push(item.id);
        } catch(e){}
      }
    }

    // تأكيد الحفظ وتفريغ الطابور السحابي
    if (ackIds.length > 0) {
      await httpJsonRequest(CLOUD_URL + '/api/relay/ack', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + cloudToken,
          'X-Org-Code': org.orgCode
        }
      }, { itemIds: ackIds });
    }
  }

  // 3. رفع الأجهزة المعتمدة محلياً إلى السحابة
  const localApprovedDevices = db.prepare("SELECT * FROM devices WHERE orgId=? AND status='approved'").all(org.id);
  if (localApprovedDevices.length > 0) {
    const pushDevRes = await httpJsonRequest(CLOUD_URL + '/api/relay/push-devices', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cloudToken,
        'X-Org-Code': org.orgCode
      }
    }, { devices: localApprovedDevices });
    if (pushDevRes.status === 200 && pushDevRes.data) {
      pushedDevices = pushDevRes.data.syncedDevices || 0;
    }
  }

  // 4. رفع المستخدمين والصلاحيات من الكمبيوتر المحلي إلى السحابة
  const localUsers = db.prepare("SELECT * FROM users WHERE orgId=?").all(org.id);
  if (localUsers.length > 0) {
    await httpJsonRequest(CLOUD_URL + '/api/relay/push-users', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cloudToken,
        'X-Org-Code': org.orgCode
      }
    }, { users: localUsers }).catch(() => {});
  }

  // 5. رفع الإعدادات من الكمبيوتر المحلي إلى السحابة
  const enforceAuth = getSetting(org.id, 'enforceDeviceAuth', '1');
  const consumeAdd = getSetting(org.id, 'consumeAddAfterSync', '0');
  await httpJsonRequest(CLOUD_URL + '/api/relay/push-settings', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + cloudToken,
      'X-Org-Code': org.orgCode
    }
  }, { settings: { enforceDeviceAuth: enforceAuth, consumeAddAfterSync: consumeAdd } }).catch(() => {});

  // 6. رفع المهام والتكليفات من الكمبيوتر المحلي إلى السحابة
  const localEvents = db.prepare("SELECT * FROM events WHERE orgId=? AND isArchived=0").all(org.id);
  if (localEvents.length > 0) {
    await httpJsonRequest(CLOUD_URL + '/api/relay/push-events', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cloudToken,
        'X-Org-Code': org.orgCode
      }
    }, { events: localEvents }).catch(() => {});
  }

  return { pulledReports, pulledDevices, pushedDevices };
}

server.listen(PORT, HOST, () => {
  console.log('========================================================');
  console.log('  منظومة كودكس السحابية والمحلية — (Multi-Tenant Hybrid Relay)');
  console.log('  شركة كودكس للبرمجيات (Codex Software)');
  console.log(`  الخادم يعمل بنجاح على: http://localhost:${PORT}/`);
  console.log('  حساب Super Admin: superadmin / CodexSuper@2026');
  console.log('  الجهة الافتراضية: DEMO (Admin: admin/Admin@123)');
  console.log('========================================================');

  // تفعيل المزامنة التلقائية مع السحابة في الخلفية عند العمل محلياً
  if (!process.env.RENDER) {
    setInterval(async () => {
      try {
        const orgs = db.prepare("SELECT id FROM organizations WHERE status='active'").all();
        for (const o of orgs) {
          await performCloudRelaySync(o.id).catch(() => {});
        }
      } catch(e){}
    }, 12000);
  }
});
