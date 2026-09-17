/* =========================================================
   super_admin.js — لوحة الإدارة العليا لشركة كودكس للبرمجيات
   ========================================================= */
let allOrgs = [];

(async function () {
  let me = null;
  try {
    me = await currentMe();
  } catch (e) {
    location.replace('login.html');
    return;
  }

  if (!me.user || me.user.role !== 'SuperAdmin') {
    alert('غير مصرح لك بالدخول إلى هذه اللوحة.');
    location.replace('login.html');
    return;
  }

  await loadDashboard();

  const searchInput = document.getElementById('orgSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = allOrgs.filter(o =>
        (o.orgName && o.orgName.toLowerCase().includes(q)) ||
        (o.orgCode && o.orgCode.toLowerCase().includes(q)) ||
        (o.phone && o.phone.includes(q))
      );
      renderOrgsTable(filtered);
    });
  }

  // إضافة جهة جديدة
  const addForm = document.getElementById('addOrgForm');
  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const orgName = document.getElementById('newOrgName').value.trim();
      const orgCode = document.getElementById('newOrgCode').value.trim().toUpperCase();
      const phone = document.getElementById('newOrgPhone').value.trim();
      const adminUserName = document.getElementById('newAdminUser').value.trim();
      const adminPassword = document.getElementById('newAdminPassword').value.trim();
      const adminFullName = document.getElementById('newAdminFullName').value.trim();

      const btn = document.getElementById('btnSaveNewOrg');
      btn.disabled = true; btn.textContent = 'جارٍ الإنشاء...';

      try {
        const res = await api('/super/organizations', {
          method: 'POST',
          body: JSON.stringify({
            orgName, orgCode, phone,
            adminUserName, adminPassword, adminFullName
          })
        });

        toast('تم إنشاء الجهة (' + orgName + ') وتجهيز حساب المدير بنجاح ✔');
        closeAddOrgModal();
        addForm.reset();
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false; btn.textContent = 'حفظ وإنشاء الجهة ✔';
      }
    });
  }
})();

async function loadDashboard() {
  try {
    const data = await api('/super/dashboard');
    if (data) {
      document.getElementById('kpiTotalOrgs').textContent = data.totalOrgs || 0;
      document.getElementById('kpiTotalUsers').textContent = data.totalUsers || 0;
      document.getElementById('kpiTotalReports').textContent = data.totalReports || 0;
      document.getElementById('kpiTotalEvents').textContent = data.totalEvents || 0;

      allOrgs = data.organizations || [];
      renderOrgsTable(allOrgs);
    }
  } catch(e) {
    toast('تعذر جلب بيانات لوحة التحكم: ' + e.message, 'err');
  }
}

function renderOrgsTable(orgs) {
  const tbody = document.getElementById('orgsTableBody');
  if (!tbody) return;
  if (!orgs || orgs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">لا توجد جهات مسجلة حتى الآن. اضغط على زر إضافة جهة للبدء.</td></tr>';
    return;
  }

  tbody.innerHTML = orgs.map(org => {
    const isActive = org.status === 'active';
    const statusBadge = isActive
      ? '<span style="background:#ecfdf5;color:#047857;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px">🟢 نشط</span>'
      : '<span style="background:#fef2f2;color:#b91c1c;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px">⛔ مجمّد</span>';

    const adminInfo = org.adminUser
      ? `<div style="font-size:12px;line-height:1.4"><b>${org.adminUser.userName}</b><br><span style="color:#64748b">${org.adminUser.plainPassword || 'Admin@123'}</span></div>`
      : '<span style="color:#94a3b8">—</span>';

    return `
      <tr style="border-bottom:1px solid var(--line)">
        <td style="padding:12px"><span class="badge-code">${org.orgCode}</span></td>
        <td style="padding:12px">
          <div style="font-weight:800;color:var(--text);font-size:14px">${org.orgName}</div>
          <div style="font-size:12px;color:var(--muted)">هاتف: ${org.phone || 'غير مسجل'}</div>
        </td>
        <td style="padding:12px">${adminInfo}</td>
        <td style="padding:12px;font-weight:800;color:#2563eb">${org.usersCount || 0}</td>
        <td style="padding:12px;font-weight:800;color:#0d9488">${org.reportsCount || 0}</td>
        <td style="padding:12px;font-weight:800;color:#d97706">${org.devicesCount || 0}</td>
        <td style="padding:12px">${statusBadge}</td>
        <td style="padding:12px;text-align:center">
          <div style="display:flex;gap:6px;justify-content:center">
            <button class="btn btn-secondary btn-sm" onclick="showOrgQrModal('${org.orgCode}', '${esc(org.orgName)}')" style="font-size:11.5px;padding:4px 8px" title="عرض وطباعة باركود وQR الجهة">📱 باركود</button>
   <button class="btn btn-outline btn-sm" onclick="toggleOrgStatus('${org.id}', '${org.status}')" style="font-size:11.5px;padding:4px 8px" title="تفعيل / تجميد">
              ${isActive ? '⛔ تجميد' : '🟢 تفعيل'}
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteOrg('${org.id}', '${org.orgName}')" style="font-size:11.5px;padding:4px 8px" title="حذف الجهة">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openAddOrgModal() {
  document.getElementById('addOrgModal').classList.add('show');
}
function closeAddOrgModal() {
  document.getElementById('addOrgModal').classList.remove('show');
}

async function toggleOrgStatus(orgId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
  const label = newStatus === 'active' ? 'تفعيل' : 'تجميد';
  if (!confirm(`هل أنت متأكد من ${label} اشتراك هذه الجهة؟`)) return;
  try {
    await api('/super/organizations/' + orgId, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
    });
    toast(`تم ${label} اشتراك الجهة بنجاح ✔`);
    await loadDashboard();
  } catch(e) {
    alert(e.message);
  }
}

async function deleteOrg(orgId, orgName) {
  if (!confirm(`تحذير هام جداً:\nهل أنت متأكد من حذف الجهة (${orgName}) بالكامل مع كافة تقاريرها ومستخدميها؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;
  try {
    await api('/super/organizations/' + orgId, { method: 'DELETE' });
    toast(`تم حذف الجهة بنجاح ✔`);
    await loadDashboard();
  } catch(e) {
    alert(e.message);
  }
}

let currentQrData = null;

function showOrgQrModal(orgCode, orgName) {
  currentQrData = { orgCode, orgName };
  document.getElementById('qrOrgBadge').textContent = orgName;
  document.getElementById('qrOrgCodeText').textContent = orgCode;
  const container = document.getElementById('qrCanvasContainer');
  container.innerHTML = '';
  
  const baseUrl = getServerBaseUrl() || location.origin;
  const directUrl = baseUrl + '/login.html?org=' + encodeURIComponent(orgCode);
  
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: directUrl,
      width: 190,
      height: 190
    });
  }
  document.getElementById('orgQrModal').classList.add('show');
}

function closeOrgQrModal() {
  document.getElementById('orgQrModal').classList.remove('show');
}

function printOrgCard() {
  if (!currentQrData) return;
  const { orgCode, orgName } = currentQrData;
  const baseUrl = getServerBaseUrl() || location.origin;
  const directUrl = baseUrl + '/login.html?org=' + encodeURIComponent(orgCode);
  
  const canvas = document.querySelector('#qrCanvasContainer canvas');
  const qrDataUrl = canvas ? canvas.toDataURL() : '';

  const w = window.open('', '_blank', 'width=650,height=750');
  w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>بطاقة ربط المنظومة — ${orgName}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
  .card { background: #fff; border: 2px solid #0f172a; border-radius: 20px; padding: 32px 28px; width: 100%; max-width: 420px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.15); }
  .header { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 14px; }
  .header img { width: 42px; height: 42px; border-radius: 10px; }
  .header h2 { margin: 0; font-size: 16px; color: #0f172a; }
  .org-title { font-size: 18px; font-weight: 900; color: #1e3a8a; margin: 10px 0 16px; }
  .qr-box { background: #f8fafc; border: 2px dashed #94a3b8; border-radius: 16px; padding: 16px; display: inline-block; margin-bottom: 14px; }
  .qr-box img { width: 200px; height: 200px; display: block; }
  .code-badge { background: #0f172a; color: #38bdf8; font-family: monospace; font-size: 24px; font-weight: 900; padding: 8px 24px; border-radius: 10px; display: inline-block; letter-spacing: 2px; margin-bottom: 14px; }
  .steps { text-align: right; background: #f8fafc; border-radius: 12px; padding: 14px 18px; font-size: 13px; color: #334155; line-height: 1.8; margin-top: 10px; }
  .footer { margin-top: 18px; font-size: 11.5px; color: #64748b; font-weight: 700; }
  @media print { body { background: #fff; padding: 0; } .card { box-shadow: none; border: 2px solid #000; } .no-print { display: none; } }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <img src="Image/codex_logo.jpg" alt="Codex" />
    <div>
      <h2>منظومة كودكس السحابية لإدارة التقارير</h2>
      <small style="color:#64748b">بطاقة ربط واعتماد الهواتف الميدانية</small>
    </div>
  </div>
  
  <div class="org-title">${orgName}</div>
  
  <div class="qr-box">
    <img src="${qrDataUrl}" alt="QR Code" />
  </div>
  
  <div>
    <div style="font-size:12px;color:#64748b;margin-bottom:4px;font-weight:700">رمز الجهة الرسمي:</div>
    <div class="code-badge">${orgCode}</div>
  </div>

  <div class="steps">
    <b>طريقة ربط الهاتف بالمنظومة:</b><br/>
    1. افتح تطبيق المنظومة أو كاميرا الهاتف وامسح رمز الـ QR أعلاه.<br/>
    2. أو افتح التطبيق واكتب رمز الجهة: <b>${orgCode}</b><br/>
    3. أدخل اسم المستخدم وكلمة المرور الخاصة بك.
  </div>

  <div class="footer">
    تطوير ودعم: شركة كودكس للبرمجيات • هاتف: 783745550
  </div>
</div>
<script>
  window.onload = function() { window.print(); };
</script>
</body>
</html>`);
  w.document.close();
}
