/* =========================================================
   super_admin.js — لوحة الإدارة العليا لشركة كودكس للبرمجيات
   ========================================================= */
let allOrgs = [];
let allSuperReports = [];
let activeSuperReport = null;
let superReportSearchDebounce = null;

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

  // فحص والبحث في الفروع
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

  // البحث في التقارير الشاملة
  const reportQueryInput = document.getElementById('filterSuperReportQuery');
  if (reportQueryInput) {
    reportQueryInput.addEventListener('input', () => {
      clearTimeout(superReportSearchDebounce);
      superReportSearchDebounce = setTimeout(() => {
        loadSuperReports();
      }, 350);
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
      const allowHqAccess = document.getElementById('newOrgAllowHq') ? (document.getElementById('newOrgAllowHq').checked ? 1 : 0) : 1;
      const adminUserName = document.getElementById('newAdminUser').value.trim();
      const adminPassword = document.getElementById('newAdminPassword').value.trim();
      const adminFullName = document.getElementById('newAdminFullName').value.trim();

      const btn = document.getElementById('btnSaveNewOrg');
      btn.disabled = true; btn.textContent = 'جارٍ الإنشاء...';

      try {
        const res = await api('/super/organizations', {
          method: 'POST',
          body: JSON.stringify({
            orgName, orgCode, phone, allowHqAccess,
            adminUserName, adminPassword, adminFullName
          })
        });

        toast('تم إنشاء الجهة (' + orgName + ') وتجهيز حساب المدير بنجاح ✔');
        closeAddOrgModal();
        showOrgQrModal(orgCode, orgName);
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

// التبديل بين قسم الفروع وقسم التقارير الشاملة
function switchSuperTab(tab) {
  const orgsTab = document.getElementById('orgsTabSection');
  const reportsTab = document.getElementById('reportsTabSection');
  const tabBtnOrgs = document.getElementById('tabBtnOrgs');
  const tabBtnReports = document.getElementById('tabBtnReports');

  if (tab === 'reports') {
    if (orgsTab) orgsTab.style.display = 'none';
    if (reportsTab) reportsTab.style.display = 'block';

    if (tabBtnOrgs) {
      tabBtnOrgs.classList.remove('btn-primary');
      tabBtnOrgs.classList.add('btn-outline');
    }
    if (tabBtnReports) {
      tabBtnReports.classList.remove('btn-outline');
      tabBtnReports.classList.add('btn-primary');
    }

    loadSuperReports();
  } else {
    if (orgsTab) orgsTab.style.display = 'block';
    if (reportsTab) reportsTab.style.display = 'none';

    if (tabBtnOrgs) {
      tabBtnOrgs.classList.remove('btn-outline');
      tabBtnOrgs.classList.add('btn-primary');
    }
    if (tabBtnReports) {
      tabBtnReports.classList.remove('btn-primary');
      tabBtnReports.classList.add('btn-outline');
    }
  }
}

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
      populateSuperOrgDropdown(allOrgs);

      // تحديث عداد التقارير المتاحة للمركز
      const repCountBadge = document.getElementById('superReportsTabCount');
      if (repCountBadge) {
        repCountBadge.textContent = data.totalReports || 0;
      }
    }
  } catch(e) {
    toast('تعذر جلب بيانات لوحة التحكم: ' + e.message, 'err');
  }
}

function populateSuperOrgDropdown(orgs) {
  const select = document.getElementById('filterSuperReportOrg');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="">-- كافة الفروع المتاحة للمركز --</option>';

  (orgs || []).forEach(org => {
    // إدراج الفروع التي يتاح وصول المركز لها
    if (org.allowHqAccess === undefined || org.allowHqAccess === null || Number(org.allowHqAccess) === 1) {
      const opt = document.createElement('option');
      opt.value = org.id;
      opt.textContent = `${org.orgName} (${org.orgCode})`;
      select.appendChild(opt);
    }
  });

  select.value = currentVal;
}

function renderOrgsTable(orgs) {
  const tbody = document.getElementById('orgsTableBody');
  if (!tbody) return;
  if (!orgs || orgs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--muted)">لا توجد جهات مسجلة حتى الآن. اضغط على زر إضافة جهة للبدء.</td></tr>';
    return;
  }

  tbody.innerHTML = orgs.map(org => {
    const isActive = org.status === 'active';
    const statusBadge = isActive
      ? '<span style="background:#ecfdf5;color:#047857;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px">🟢 نشط</span>'
      : '<span style="background:#fef2f2;color:#b91c1c;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px">⛔ مجمّد</span>';

    const adminInfo = org.adminUser
      ? `<div style="font-size:12px;line-height:1.4"><b>${esc(org.adminUser.userName)}</b><br><span style="color:#64748b">${esc(org.adminUser.plainPassword || 'Admin@123')}</span></div>`
      : '<span style="color:#94a3b8">—</span>';

    const hasHqAccess = (org.allowHqAccess === undefined || org.allowHqAccess === null || Number(org.allowHqAccess) === 1);
    const hqBadge = hasHqAccess
      ? `<button class="btn btn-sm" onclick="toggleOrgHqAccess('${org.id}', 1)" style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-size:11.5px;padding:3px 8px;border-radius:6px;font-weight:800;cursor:pointer" title="وصول المركز مفعّل. انقر لتعديل الصلاحية وحجب وصول المركز لتقارير هذا الفرع">🟢 متاح للمركز</button>`
      : `<button class="btn btn-sm" onclick="toggleOrgHqAccess('${org.id}', 0)" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:11.5px;padding:3px 8px;border-radius:6px;font-weight:800;cursor:pointer" title="وصول المركز محجوب. انقر لتمكين المركز من استلام نسخ التقارير">⛔ محجوب عن المركز</button>`;

    return `
      <tr style="border-bottom:1px solid var(--line)">
        <td style="padding:12px"><span class="badge-code">${esc(org.orgCode)}</span></td>
        <td style="padding:12px">
          <div style="font-weight:800;color:var(--text);font-size:14px">${esc(org.orgName)}</div>
          <div style="font-size:12px;color:var(--muted)">هاتف: ${esc(org.phone || 'غير مسجل')}</div>
        </td>
        <td style="padding:12px">${adminInfo}</td>
        <td style="padding:12px;font-weight:800;color:#2563eb">${org.usersCount || 0}</td>
        <td style="padding:12px;font-weight:800;color:#0d9488">${org.reportsCount || 0}</td>
        <td style="padding:12px;font-weight:800;color:#d97706">${org.devicesCount || 0}</td>
        <td style="padding:12px">${statusBadge}</td>
        <td style="padding:12px;text-align:center">${hqBadge}</td>
        <td style="padding:12px;text-align:center">
          <div style="display:flex;gap:6px;justify-content:center">
            <button class="btn btn-secondary btn-sm" onclick="showOrgQrModal('${org.orgCode}', '${esc(org.orgName)}')" style="font-size:11.5px;padding:4px 8px" title="عرض وطباعة باركود وQR الجهة">📱 باركود</button>
            <button class="btn btn-outline btn-sm" onclick="toggleOrgStatus('${org.id}', '${org.status}')" style="font-size:11.5px;padding:4px 8px" title="تفعيل / تجميد">
              ${isActive ? '⛔ تجميد' : '🟢 تفعيل'}
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteOrg('${org.id}', '${esc(org.orgName)}')" style="font-size:11.5px;padding:4px 8px" title="حذف الجهة">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// تبديل إمكانية وصول المركز لتقارير الفرع سراً
async function toggleOrgHqAccess(orgId, currentAccess) {
  const newAction = currentAccess === 1 ? 'حجب' : 'تمكين';
  if (!confirm(`هل أنت متأكد من ${newAction} وصول إدارة المركز الرئيسي لتقارير هذا الفرع؟\n\n(ملاحظة: هذا الإجراء سري ولن يظهر لمدير الفرع).`)) return;

  try {
    const res = await api('/super/organizations/' + orgId + '/toggle-hq-access', { method: 'POST' });
    toast(res.message || 'تم تحديث صلاحية وصول المركز بنجاح ✔');
    await loadDashboard();
    const reportsTab = document.getElementById('reportsTabSection');
    if (reportsTab && reportsTab.style.display !== 'none') {
      await loadSuperReports();
    }
  } catch (err) {
    alert(err.message);
  }
}

// تحميل التقارير الشاملة من الفروع
async function loadSuperReports() {
  const tbody = document.getElementById('superReportsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">جارٍ جلب التقارير من الفروع...</td></tr>';

  try {
    const orgId = document.getElementById('filterSuperReportOrg')?.value || '';
    const from = document.getElementById('filterSuperReportFrom')?.value || '';
    const to = document.getElementById('filterSuperReportTo')?.value || '';
    const q = document.getElementById('filterSuperReportQuery')?.value.trim() || '';

    const params = new URLSearchParams();
    if (orgId) params.append('orgId', orgId);
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (q) params.append('q', q);

    const res = await api('/super/reports?' + params.toString());
    allSuperReports = (res.reports || []).map(r => {
      if (r.isEncrypted && r.encryptedPayload && r.orgEncKey) {
        const branchKey = 'CODEX_E2EE_' + r.orgCode + '_' + r.orgEncKey;
        return typeof decryptReportData === 'function' ? decryptReportData(r, branchKey) : r;
      }
      return r;
    });

    const countBadge = document.getElementById('superReportsTabCount');
    if (countBadge) countBadge.textContent = allSuperReports.length;

    if (allSuperReports.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">لا توجد تقارير مطابقة للفلاتر الحالية من الفروع المصرح للمركز بالوصول إليها.</td></tr>';
      return;
    }

    tbody.innerHTML = allSuperReports.map(r => {
      let imagesCount = 0;
      if (r.images) {
        try {
          const arr = typeof r.images === 'string' ? JSON.parse(r.images) : r.images;
          if (Array.isArray(arr)) imagesCount = arr.length;
        } catch(e) {}
      }

      const encBadge = r._wasEncrypted || r.isEncrypted ? ' <span style="color:#10b981;font-size:12px" title="تقرير مشفر E2EE">🔒</span>' : '';

      return `
        <tr style="border-bottom:1px solid var(--line)">
          <td style="padding:12px">
            <span style="font-weight:800;color:#0284c7;font-size:13.5px">${esc(r.orgName || 'فرع')}</span>
            <div style="font-size:11px;color:#64748b;font-family:monospace">${esc(r.orgCode || '')}</div>
          </td>
          <td style="padding:12px">
            <span style="font-family:monospace;font-weight:800;background:#f1f5f9;padding:2px 6px;border-radius:4px">${esc(r.reportNumber || '#' + r.id)}</span>${encBadge}
          </td>
          <td style="padding:12px;font-size:12.5px">
            <div>${esc(r.reportDate || '')}</div>
            <div style="font-size:11px;color:#64748b">${esc(r.reportTime || '')}</div>
          </td>
          <td style="padding:12px">
            <div style="font-weight:800;color:var(--text);font-size:13.5px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.subject || '')}">
              ${esc(r.subject || 'بدون موضوع')}
            </div>
          </td>
          <td style="padding:12px;font-size:13px;color:#334155">
            ${esc(r.targetSector || r.location || '—')}
          </td>
          <td style="padding:12px;font-size:13px">
            👤 <b>${esc(r.enteredBy || '—')}</b>
          </td>
          <td style="padding:12px;text-align:center">
            ${imagesCount > 0 ? `<span class="badge blue" style="font-size:11px">📷 ${imagesCount} صور</span>` : '<span style="color:#94a3b8">—</span>'}
          </td>
          <td style="padding:12px;text-align:center">
            <button class="btn btn-outline btn-sm" onclick="showSuperReportDetail(${r.id})" style="font-size:12px;padding:4px 10px;font-weight:700">
              👁️ عرض
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:#dc2626">تعذر جلب التقارير: ${esc(err.message)}</td></tr>`;
  }
}

// عرض تفاصيل التقرير في نافذة منبثقة
function showSuperReportDetail(reportId) {
  const r = allSuperReports.find(x => Number(x.id) === Number(reportId));
  if (!r) return alert('لم يتم العثور على التقرير المطلوب.');

  activeSuperReport = r;

  document.getElementById('srdTitle').textContent = `📄 تفاصيل التقرير (${r.reportNumber || '#' + r.id})`;
  document.getElementById('srdOrgName').textContent = `${r.orgName || 'فرع'} (${r.orgCode || ''})`;
  document.getElementById('srdReportNumber').textContent = r.reportNumber || '#' + r.id;
  document.getElementById('srdDateTime').textContent = `${r.reportDate || ''} ${r.reportTime || ''}`;
  document.getElementById('srdEnteredBy').textContent = r.enteredBy || '—';
  document.getElementById('srdTarget').textContent = r.targetSector || r.location || '—';
  document.getElementById('srdSubject').textContent = r.subject || 'بدون موضوع';
  document.getElementById('srdDetails').textContent = r.details || r.notes || 'لا يوجد نص تفصيلي للتقرير.';

  // الصور المرفقة
  const gallery = document.getElementById('srdImagesGallery');
  const sec = document.getElementById('srdImagesSection');
  gallery.innerHTML = '';

  let imgList = [];
  if (r.images) {
    try {
      imgList = typeof r.images === 'string' ? JSON.parse(r.images) : r.images;
    } catch(e) {}
  }

  if (Array.isArray(imgList) && imgList.length > 0) {
    sec.style.display = 'block';
    gallery.innerHTML = imgList.map((imgSrc, idx) => {
      return `
        <a href="${imgSrc}" target="_blank" style="display:inline-block;border:2px solid var(--line);border-radius:8px;overflow:hidden;background:#fff">
          <img src="${imgSrc}" alt="مرفق ${idx + 1}" style="width:110px;height:110px;object-fit:cover;display:block" />
        </a>
      `;
    }).join('');
  } else {
    sec.style.display = 'none';
  }

  document.getElementById('superReportDetailModal').classList.add('show');
}

function closeSuperReportDetailModal() {
  document.getElementById('superReportDetailModal').classList.remove('show');
}

// طباعة التقرير من لوحة المركز
function printSuperReport() {
  if (!activeSuperReport) return;
  const r = activeSuperReport;

  let imgList = [];
  if (r.images) {
    try {
      imgList = typeof r.images === 'string' ? JSON.parse(r.images) : r.images;
    } catch(e) {}
  }

  const imagesHtml = (Array.isArray(imgList) && imgList.length > 0)
    ? `<div style="margin-top:20px">
        <h4 style="border-bottom:1px solid #cbd5e1;padding-bottom:6px">📷 المرفقات والصور الميدانية:</h4>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">
          ${imgList.map(src => `<img src="${src}" style="max-width:240px;max-height:180px;border-radius:8px;border:1px solid #cbd5e1" />`).join('')}
        </div>
       </div>`
    : '';

  const w = window.open('', '_blank', 'width=800,height=900');
  w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>تقرير — ${esc(r.subject || r.reportNumber)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #0f172a; margin: 0; padding: 24px; direction: rtl; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 20px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; margin-bottom: 20px; }
  .box { background: #fff; border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; margin-bottom: 16px; }
  .box-title { font-weight: 800; font-size: 14px; color: #1e3a8a; margin-bottom: 8px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h2 style="margin:0;color:#1e3a8a">منظومة التقارير الميدانية — الإدارة المركزية</h2>
      <div style="color:#64748b;font-size:13px;margin-top:4px">الفرع: <b>${esc(r.orgName || 'فرع')}</b> (${esc(r.orgCode || '')})</div>
    </div>
    <div style="text-align:left">
      <div style="font-family:monospace;font-size:16px;font-weight:900">رقم: ${esc(r.reportNumber || '#' + r.id)}</div>
      <div style="font-size:12px;color:#64748b">${esc(r.reportDate || '')} ${esc(r.reportTime || '')}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div><b>الموظف / مدخل البيانات:</b> ${esc(r.enteredBy || '—')}</div>
    <div><b>الجهة المستهدفة / الموقع:</b> ${esc(r.targetSector || r.location || '—')}</div>
    <div><b>موضوع التقرير:</b> ${esc(r.subject || '—')}</div>
    <div><b>تاريخ الرفع:</b> ${esc(r.reportDate || '')}</div>
  </div>

  <div class="box">
    <div class="box-title">📝 بيان وتفاصيل التقرير:</div>
    <div style="line-height:1.9;font-size:14px;white-space:pre-wrap">${esc(r.details || r.notes || '—')}</div>
  </div>

  ${imagesHtml}

  <div style="margin-top:30px;padding-top:14px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8">
    تم إصدار هذا التقرير عبر منظومة كودكس السحابية لإدارة التقارير
  </div>
  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`);
  w.document.close();
}

function generateRandomOrgCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let randPrefix = '';
  for (let i = 0; i < 3; i++) {
    randPrefix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const code = randPrefix + '-' + randNum;
  
  const input = document.getElementById('newOrgCode');
  if (input) {
    input.value = code;
    updateNewOrgQrPreview();
  }
  return code;
}

function updateNewOrgQrPreview() {
  const input = document.getElementById('newOrgCode');
  const previewBox = document.getElementById('newOrgQrPreview');
  const displayBadge = document.getElementById('newOrgCodeDisplay');
  if (!input || !previewBox) return;

  const code = (input.value || '').trim().toUpperCase();
  if (displayBadge) displayBadge.textContent = code || '—';

  if (!code) {
    previewBox.innerHTML = '<span style="color:#94a3b8;font-size:12px">اكتب أو ولّد رمزاً لعرض الباركود</span>';
    return;
  }

  previewBox.innerHTML = '';
  const baseUrl = getServerBaseUrl() || location.origin;
  const directUrl = baseUrl + '/login.html?org=' + encodeURIComponent(code);

  if (typeof QRCode !== 'undefined') {
    new QRCode(previewBox, {
      text: directUrl,
      width: 105,
      height: 105
    });
  }
}

function openAddOrgModal() {
  document.getElementById('addOrgModal').classList.add('show');
  const orgCodeInput = document.getElementById('newOrgCode');
  if (orgCodeInput && !orgCodeInput.value.trim()) {
    generateRandomOrgCode();
  } else {
    updateNewOrgQrPreview();
  }
  if (orgCodeInput && !orgCodeInput._boundPreview) {
    orgCodeInput._boundPreview = true;
    orgCodeInput.addEventListener('input', updateNewOrgQrPreview);
  }
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
