#!/usr/bin/env node
'use strict';
/* =========================================================
   local_relay_sync.js — محرك المزامنة التلقائية مع طابور السحابة
   - يعمل على كمبيوتر المدير في الخلفية
   - يسحب التقارير المعلقة في طابور السحابة ويحفظها في القرص الصلب
   - يفرغ طابور السحابة فور التأكد من حفظ التقارير محلياً
   - يرفع المهام الجديدة المنشأة من المدير إلى السحابة للموظفين
   ========================================================= */
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'multitenant.db');
const CLOUD_URL = process.env.CLOUD_RELAY_URL || 'https://codex-multitenant-system.onrender.com';
const POLL_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '10000', 10);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function httpRequest(targetUrl, opts = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      },
      timeout: 12000
    };

    const req = client.request(reqOpts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json });
        } catch(e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Connection timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function loginToCloud(orgCode, userName, password) {
  try {
    const res = await httpRequest(CLOUD_URL + '/api/login', { method: 'POST' }, {
      orgCode, userName, password
    });
    if (res.status === 200 && res.data.token) {
      return res.data.token;
    }
  } catch(e) {}
  return null;
}

async function syncOrgQueue(db, org, cloudToken) {
  try {
    // 1. Pull queued items from cloud
    const pullRes = await httpRequest(CLOUD_URL + '/api/relay/pull', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + cloudToken,
        'X-Org-Code': org.orgCode
      }
    });

    if (pullRes.status === 200 && Array.isArray(pullRes.data.items) && pullRes.data.items.length > 0) {
      const items = pullRes.data.items;
      const ackIds = [];

      for (const item of items) {
        if (item.itemType === 'report' && item.payload) {
          const r = item.payload;
          try {
            db.prepare(`INSERT OR REPLACE INTO reports(
              id, orgId, reportNumber, subject, target, reportDate, reportTime, location, details, images,
              enteredBy, enteredByUserId, rating, logoId, createdAt, updatedAt, syncedAt
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(
                r.id, org.id, r.reportNumber, r.subject || '', r.target || '',
                r.reportDate || '', r.reportTime || '', r.location || '', r.details || '',
                JSON.stringify(r.images || []), r.enteredBy || '', r.enteredByUserId || null,
                r.rating || 'عادي', r.logoId || 'logo1', r.createdAt || new Date().toISOString(),
                r.updatedAt || new Date().toISOString(), new Date().toISOString()
              );
            ackIds.push(item.id);
            console.log(`[💾 HardDisk Sync] تم حفظ التقرير (${r.reportNumber} - ${r.subject}) بنجاح على القرص الصلب للجهة (${org.orgName})`);
          } catch(err) {
            console.error('Error saving report to local DB:', err.message);
          }
        } else if (item.itemType === 'event_feedback' && item.payload) {
          const f = item.payload;
          try {
            db.prepare(`UPDATE events SET status=?, receivedAt=?, completedAt=?, feedbackNotes=? WHERE id=? AND orgId=?`)
              .run(f.status, f.receivedAt || null, f.completedAt || null, f.feedbackNotes || '', f.eventId, org.id);
            ackIds.push(item.id);
            console.log(`[💾 HardDisk Sync] تم تحديث تغذية المهمة (${f.eventId}) على القرص الصلب`);
          } catch(err) {}
        } else if (item.itemType === 'device_registration' && item.payload) {
          const dev = item.payload;
          try {
            const existing = db.prepare('SELECT id FROM devices WHERE orgId=? AND deviceId=?').get(org.id, dev.deviceId);
            if (!existing) {
              db.prepare(`INSERT INTO devices(
                id, orgId, deviceId, deviceName, userId, userName, userFullName, status, registeredAt, lastSeenAt, approvedAt, approvedBy
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
                .run(
                  dev.id, org.id, dev.deviceId, dev.deviceName || '', dev.userId || '', dev.userName || '',
                  dev.userFullName || '', dev.status || 'pending', dev.registeredAt || new Date().toISOString(),
                  dev.lastSeenAt || new Date().toISOString(), dev.approvedAt || null, dev.approvedBy || ''
                );
            }
            ackIds.push(item.id);
            console.log(`[📱 Device Sync] تم مزامنة الهاتف الجديد (${dev.deviceName || dev.deviceId}) إلى قاعدة بيانات المدير محلياً ✔`);
          } catch(err) {
            console.error('Error saving device to local DB:', err.message);
          }
        }
      }

      // 2. Acknowledge and clear from Cloud
      if (ackIds.length > 0) {
        await httpRequest(CLOUD_URL + '/api/relay/ack', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + cloudToken,
            'X-Org-Code': org.orgCode
          }
        }, { itemIds: ackIds });
        console.log(`[🗑️ Cloud Purge] تم تأكيد حفظ (${ackIds.length}) عناصر وتفريغها من السحابة تماماً ✔`);
      }
    }

    // 3. Push any local events to cloud
    try {
      const localEvents = db.prepare("SELECT * FROM events WHERE orgId=? ORDER BY createdDate DESC LIMIT 50").all(org.id);
      if (localEvents.length > 0) {
        await httpRequest(CLOUD_URL + '/api/relay/push-events', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + cloudToken,
            'X-Org-Code': org.orgCode
          }
        }, { events: localEvents });
      }
    } catch(e){}

    // 4. Push any local approved devices to cloud
    try {
      const localDevices = db.prepare("SELECT * FROM devices WHERE orgId=? ORDER BY lastSeenAt DESC LIMIT 50").all(org.id);
      if (localDevices.length > 0) {
        await httpRequest(CLOUD_URL + '/api/relay/push-devices', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + cloudToken,
            'X-Org-Code': org.orgCode
          }
        }, { devices: localDevices });
      }
    } catch(e){}

  } catch(err) {
    // offline or timeout
  }
}

async function runSyncCycle() {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new DatabaseSync(DB_PATH);
  try {
    const orgs = db.prepare("SELECT * FROM organizations WHERE status='active'").all();
    for (const org of orgs) {
      const admin = db.prepare("SELECT * FROM users WHERE orgId=? AND role='Admin'").get(org.id);
      if (admin && admin.plainPassword) {
        const token = await loginToCloud(org.orgCode, admin.userName, admin.plainPassword);
        if (token) {
          await syncOrgQueue(db, org, token);
        }
      }
    }
  } catch(e) {
  } finally {
    try { db.close(); } catch(e){}
  }
}

console.log('========================================================');
console.log('  محرك المزامنة التلقائية مع طابور السحابة (Local Hard Drive Sync)');
console.log('  شركة كودكس للبرمجيات (Codex Software)');
console.log(`  الرابط السحابي: ${CLOUD_URL}`);
console.log(`  فترة الفحص: كل ${POLL_INTERVAL_MS / 1000} ثوانٍ`);
console.log('========================================================');

runSyncCycle();
setInterval(runSyncCycle, POLL_INTERVAL_MS);
