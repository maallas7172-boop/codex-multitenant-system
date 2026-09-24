/* =========================================================
   super_admin.js — لوحة الإدارة العليا لشركة كودكس للبرمجيات
   ========================================================= */
let allOrgs = [];
let allSuperReports = [];
let activeSuperReport = null;
let superReportSearchDebounce = null;
let currentSuperHeaderConfig = null;

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

// التبديل بين كافة أقسام الإدارة المركزية
function switchSuperTab(tab) {
  const tabs = ['orgs', 'reports', 'users', 'settings', 'profile'];
  tabs.forEach(t => {
    const sec = document.getElementById(t + 'TabSection');
    const btn = document.getElementById('tabBtn' + t.charAt(0).toUpperCase() + t.slice(1));
    if (sec) sec.style.display = (t === tab) ? 'block' : 'none';
    if (btn) {
      if (t === tab) {
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-primary');
      } else {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
      }
    }
  });

  if (tab === 'reports') loadSuperReports();
  else if (tab === 'users') loadSuperUsers();
  else if (tab === 'settings') loadSuperSettings();
  else if (tab === 'profile') loadSuperProfile();
  else if (tab === 'orgs') loadDashboard();
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
            <button class="btn btn-primary btn-sm" onclick="openEditOrgModal('${org.id}')" style="font-size:11.5px;padding:4px 8px" title="تعديل بيانات الفرع وحسابه وصلاحياته">✏️ تعديل</button>
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
            <div style="display:flex;gap:6px;justify-content:center;align-items:center">
              <button class="btn btn-outline btn-sm" onclick="showSuperReportDetail('${esc(r.id)}')" style="font-size:12px;padding:4px 10px;font-weight:700" title="عرض تفاصيل التقرير">
                👁️ عرض
              </button>
              <button class="btn btn-primary btn-sm" onclick="printSuperReportById('${esc(r.id)}')" style="font-size:12px;padding:4px 10px;font-weight:700;background:#0284c7;border-color:#0284c7;color:#fff" title="طباعة هذا التقرير">
                🖨️ طباعة
              </button>
            </div>
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
  const r = allSuperReports.find(x => String(x.id) === String(reportId) || String(x.reportNumber) === String(reportId));
  if (!r) return alert('لم يتم العثور على التقرير المطلوب.');

  activeSuperReport = r;

  const titleEl = document.getElementById('srdTitle');
  if (titleEl) titleEl.textContent = `📄 تفاصيل التقرير (${r.reportNumber || '#' + r.id})`;
  const orgNameEl = document.getElementById('srdOrgName');
  if (orgNameEl) orgNameEl.textContent = `${r.orgName || 'فرع'} (${r.orgCode || ''})`;
  const repNumEl = document.getElementById('srdReportNumber');
  if (repNumEl) repNumEl.textContent = r.reportNumber || '#' + r.id;
  const dtEl = document.getElementById('srdDateTime');
  if (dtEl) dtEl.textContent = `${r.reportDate || ''} ${r.reportTime || ''}`.trim() || '—';
  const entEl = document.getElementById('srdEnteredBy');
  if (entEl) entEl.textContent = r.enteredBy || '—';
  const targetEl = document.getElementById('srdTarget');
  if (targetEl) targetEl.textContent = r.target || r.targetSector || r.location || '—';
  const subjEl = document.getElementById('srdSubject');
  if (subjEl) subjEl.textContent = r.subject || 'بدون موضوع';
  const detEl = document.getElementById('srdDetails');
  if (detEl) detEl.textContent = r.details || r.notes || 'لا يوجد نص تفصيلي للتقرير.';

  // الصور المرفقة
  const gallery = document.getElementById('srdImagesGallery');
  const sec = document.getElementById('srdImagesSection');
  if (gallery && sec) {
    gallery.innerHTML = '';
    let imgList = [];
    if (r.images) {
      try {
        imgList = typeof r.images === 'string' ? JSON.parse(r.images) : r.images;
      } catch(e) { imgList = []; }
    }

    if (Array.isArray(imgList) && imgList.length > 0) {
      sec.style.display = 'block';
      gallery.innerHTML = imgList.map((imgSrc, idx) => {
        return `
          <a href="${imgSrc}" target="_blank" rel="noopener noreferrer" style="display:inline-block;border:2px solid var(--line);border-radius:8px;overflow:hidden;background:#fff;box-shadow:var(--shadow-soft)" title="عرض الصورة بالحجم الكامل">
            <img src="${imgSrc}" alt="مرفق ${idx + 1}" style="width:110px;height:110px;object-fit:cover;display:block" />
          </a>
        `;
      }).join('');
    } else {
      sec.style.display = 'none';
    }
  }

  const modal = document.getElementById('superReportDetailModal');
  if (modal) {
    modal.classList.add('show');
    modal.style.display = 'flex';
  }
}

function closeSuperReportDetailModal() {
  const modal = document.getElementById('superReportDetailModal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
}

// طباعة تقرير محدد بواسطة الـ ID مباشرة
function printSuperReportById(reportId) {
  const r = allSuperReports.find(x => String(x.id) === String(reportId) || String(x.reportNumber) === String(reportId));
  if (!r) return alert('لم يتم العثور على التقرير المطلوب.');
  activeSuperReport = r;
  printSuperReport(r);
}

// طباعة التقرير من لوحة المركز بتنسيق رسمي متكامل
function printSuperReport(reportToPrint) {
  const r = reportToPrint || activeSuperReport;
  if (!r) return;

  let imgList = [];
  if (r.images) {
    try {
      imgList = typeof r.images === 'string' ? JSON.parse(r.images) : (r.images || []);
    } catch(e) { imgList = []; }
  }

  const cfg = currentSuperHeaderConfig || {};
  const lines = (cfg.lines && cfg.lines.length > 0 && cfg.lines.some(Boolean)) ? cfg.lines : [
    'الجمهورية اليمنية',
    'وزارة النقل',
    'الهيئة العامة لتنظيم شؤون النقل البري',
    'الإدارة العامة للعمليات والمتابعة',
    'المركز الرئيسي'
  ];
  const headerLinesHtml = lines.filter(Boolean).map((l, idx) => {
    return idx === 0 
      ? `<div class="hdr-line-main">${esc(l)}</div>` 
      : `<div class="hdr-line-sub">${esc(l)}</div>`;
  }).join('');
  const logoUrl = cfg.logoUrl || 'Image/1754379379088.jpg';
  const showBasmala = cfg.showBasmala !== false;
  const basmalaText = cfg.basmalaText || 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
  const confidential = cfg.confidential || '';

  const sigs = cfg.signatures || {};
  const sig1Title = sigs.sig1Title || 'توقيع ضابط التقييم';
  const sig1Name = sigs.sig1Name !== undefined ? sigs.sig1Name : 'محمد صالح';
  const sig2Title = sigs.sig2Title || 'اعتماد مدير العمليات';
  const sig2Name = sigs.sig2Name !== undefined ? sigs.sig2Name : '';
  const sig3Title = sigs.sig3Title || 'الختم الرسمي للمركز';
  const sig3Name = sigs.sig3Name !== undefined ? sigs.sig3Name : '[....................]';

  const imagesHtml = (Array.isArray(imgList) && imgList.length > 0)
    ? `<div style="margin-top:20px">
        <h4 style="border-bottom:1.5px solid #cbd5e1;padding-bottom:6px;color:#1e3a8a;margin-bottom:12px">📷 المرفقات والصور الميدانية:</h4>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">
          ${imgList.map(src => `<div style="border:1px solid #cbd5e1;border-radius:8px;padding:4px;background:#fff"><img src="${src}" style="max-width:240px;max-height:180px;border-radius:6px;display:block" /></div>`).join('')}
        </div>
       </div>`
    : '';

  const w = window.open('', '_blank', 'width=850,height=950');
  w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>تقرير — ${esc(r.subject || r.reportNumber || 'تقرير')}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400;1,700&family=Aref+Ruqaa:wght@400;700&family=Cairo:wght@400;600;700;800;900&display=swap" />
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #0f172a; margin: 0; padding: 24px; direction: rtl; font-size: 13.5px; }
  .header-wrap { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; width: 100%; box-sizing: border-box; }
  .header-right { flex: 0 0 auto; min-width: 220px; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 2px; margin: 0; }
  .hdr-line-main { font-family: 'Aref Ruqaa', 'Amiri', 'Traditional Arabic', serif; font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1.35; letter-spacing: 0.5px; text-align: center; width: 100%; margin: 0 auto 3px auto; display: block; }
  .hdr-line-sub { font-size: 13.5px; font-weight: 700; color: #334155; line-height: 1.4; text-align: center; width: 100%; margin: 0 auto; display: block; }
  .header-center { flex: 1 1 auto; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 12px; margin: 0; }
  .header-center img { max-height: 75px; max-width: 130px; object-fit: contain; margin-bottom: 4px; display: block; }
  .header-center .basmala { font-family: 'Aref Ruqaa', 'Amiri', 'Traditional Arabic', serif; font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 6px; letter-spacing: 0.5px; text-align: center; line-height: 1.25; display: block; }
  .header-left { flex: 0 0 auto; min-width: 160px; text-align: left; font-size: 13px; line-height: 1.8; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; gap: 3px; margin: 0; font-family: 'Cairo', sans-serif; }
  .meta-card { background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 14px 18px; margin-bottom: 18px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 18px; border-radius: 8px; margin-bottom: 18px; }
  .box { background: #fff; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin-bottom: 18px; }
  .box-title { font-weight: 800; font-size: 14px; color: #1e3a8a; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  .details-content { line-height: 2; font-size: 13.5px; white-space: pre-wrap; color: #1e293b; }
  .signatures-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; text-align: center; margin-top: 36px; padding-top: 20px; border-top: 1.5px dashed #cbd5e1; gap: 14px; }
  .sig-title { font-weight: 800; font-size: 13.5px; color: #0f172a; margin-bottom: 6px; }
  .sig-name { font-size: 12.5px; color: #64748b; }
  .no-print { text-align: center; margin-bottom: 18px; }
  .no-print button { background: #1e3a8a; color: #fff; border: none; padding: 10px 24px; font-size: 14px; font-weight: 800; border-radius: 8px; cursor: pointer; font-family: inherit; }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">🖨️ طباعة التقرير</button>
    <button onclick="window.close()" style="background:#f1f5f9;color:#0f172a;border:1px solid #cbd5e1;margin-right:10px">✕ إغلاق</button>
  </div>

  <div class="header-wrap">
    <div class="header-right">
      ${headerLinesHtml}
    </div>
    <div class="header-center">
      ${showBasmala ? `<div class="basmala">${esc(basmalaText)}</div>` : ''}
      <img src="${logoUrl}" alt="شعار" />
      ${confidential ? `<div style="font-size:11px;font-weight:800;color:#dc2626;background:#fef2f2;border:1px solid #fca5a5;padding:2px 10px;border-radius:10px;margin-top:4px">${esc(confidential)}</div>` : ''}
    </div>
    <div class="header-left">
      <div><b>التاريخ:</b> <span>${esc(r.reportDate || '')}</span></div>
      <div><b>الوقت:</b> <span>${esc(r.reportTime || '')}</span></div>
    </div>
  </div>

  <div class="meta-card">
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1.5px dashed #cbd5e1;padding-bottom:10px;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:15.5px;font-weight:900;color:#1e3a8a;display:flex;align-items:center;gap:8px">
        <span>📌 موضوع التقرير:</span>
        <span style="color:#0f172a">${esc(r.subject || 'بدون موضوع')}</span>
      </div>
      <div style="font-family:monospace;font-size:14px;font-weight:900;background:#1e3a8a;color:#fff;padding:4px 14px;border-radius:6px">
        رقم التقرير: #${esc(r.reportNumber || r.id)}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
      <div><span style="color:#64748b">🏢 الفرع / المؤسسة:</span> <b style="color:#0284c7">${esc(r.orgName || 'فرع')} (${esc(r.orgCode || '')})</b></div>
      <div><span style="color:#64748b">👤 محرر التقرير / الموظف:</span> <b>${esc(r.enteredBy || '—')}</b></div>
      <div><span style="color:#64748b">📍 الجهة المستهدفة / الموقع:</span> <b>${esc(r.target || r.targetSector || r.location || '—')}</b></div>
      <div><span style="color:#64748b">📅 تاريخ ووقت التحرير:</span> <b>${esc(r.reportDate || '—')} &nbsp; ${esc(r.reportTime || '')}</b></div>
    </div>
  </div>

  <div class="box">
    <div class="box-title">📝 بيان وتفاصيل التقرير:</div>
    <div class="details-content">${esc(r.details || r.notes || 'لا يوجد نص تفصيلي')}</div>
  </div>

  ${imagesHtml}

  <div class="signatures-grid">
    <div>
      <div class="sig-title">${esc(sig1Title)}</div>
      <div class="sig-name">${esc(sig1Name)}</div>
    </div>
    <div>
      <div class="sig-title">${esc(sig2Title)}</div>
      <div class="sig-name">${esc(sig2Name)}</div>
    </div>
    <div>
      <div class="sig-title">${esc(sig3Title)}</div>
      <div class="sig-name">${esc(sig3Name)}</div>
    </div>
  </div>

  <div style="margin-top:30px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:11.5px;color:#94a3b8">
    منظومة كودكس السحابية لإدارة التقارير الموحدة • تاريخ الطباعة: ${new Date().toLocaleDateString('ar-YE')}
  </div>

  <script>
    window.addEventListener('load', () => setTimeout(() => window.print(), 350));
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

/* =========================================================
   إدارة وتعديل بيانات المؤسسة (Edit Organization)
   ========================================================= */
function openEditOrgModal(orgId) {
  const org = allOrgs.find(o => o.id === orgId);
  if (!org) return;

  document.getElementById('editOrgId').value = org.id;
  document.getElementById('editOrgName').value = org.orgName || '';
  document.getElementById('editOrgCode').value = org.orgCode || '';
  document.getElementById('editOrgPhone').value = org.phone || '';
  document.getElementById('editOrgStatus').value = org.status || 'active';
  document.getElementById('editOrgMaxUsers').value = org.maxUsers || 50;

  const hasHqAccess = (org.allowHqAccess === undefined || org.allowHqAccess === null || Number(org.allowHqAccess) === 1);
  const allowHqChk = document.getElementById('editOrgAllowHq');
  if (allowHqChk) allowHqChk.checked = hasHqAccess;

  const adminUserInput = document.getElementById('editAdminUser');
  const adminPwdInput = document.getElementById('editAdminPassword');
  if (adminUserInput) adminUserInput.value = org.adminUser ? org.adminUser.userName : '';
  if (adminPwdInput) adminPwdInput.value = '';

  const modal = document.getElementById('editOrgModal');
  if (modal) modal.style.display = 'flex';
}

function closeEditOrgModal() {
  const modal = document.getElementById('editOrgModal');
  if (modal) modal.style.display = 'none';
}

async function saveEditOrg(e) {
  e.preventDefault();
  const orgId = document.getElementById('editOrgId').value;
  const orgName = document.getElementById('editOrgName').value.trim();
  const phone = document.getElementById('editOrgPhone').value.trim();
  const status = document.getElementById('editOrgStatus').value;
  const maxUsers = parseInt(document.getElementById('editOrgMaxUsers').value, 10) || 50;
  const allowHqAccess = document.getElementById('editOrgAllowHq') ? (document.getElementById('editOrgAllowHq').checked ? 1 : 0) : 1;
  const adminUserName = document.getElementById('editAdminUser') ? document.getElementById('editAdminUser').value.trim() : '';
  const adminPassword = document.getElementById('editAdminPassword') ? document.getElementById('editAdminPassword').value.trim() : '';

  const btn = document.getElementById('btnSaveEditOrg');
  btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';

  try {
    const res = await api(`/super/organizations/${orgId}`, {
      method: 'PUT',
      body: JSON.stringify({
        orgName, phone, status, maxUsers, allowHqAccess,
        adminUserName, adminPassword
      })
    });
    toast(res.message || 'تم حفظ تعديلات الفرع بنجاح ✔');
    closeEditOrgModal();
    await loadDashboard();
  } catch (err) {
    alert('تعذر تحديث بيانات الفرع: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'حفظ التعديلات ✔';
  }
}

/* =========================================================
   إدارة مستخدمي الإدارة المركزية والصلاحيات
   ========================================================= */
let allSuperUsers = [];

async function loadSuperUsers() {
  const tbody = document.getElementById('superUsersTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">جارٍ تحميل المستخدمين...</td></tr>';
  try {
    const res = await api('/super/users');
    allSuperUsers = (res && res.users) || [];
    renderSuperUsersTable(allSuperUsers);
  } catch(e) {
    toast('تعذر جلب مستخدمي الإدارة: ' + e.message, 'err');
  }
}

function renderSuperUsersTable(users) {
  const tbody = document.getElementById('superUsersTableBody');
  if (!tbody) return;
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">لا يوجد مستخدمون مضافون حالياً. اضغط على زر إضافة مستخدم للبدء.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const isMainAdmin = u.role === 'SuperAdmin';
    const statusBadge = u.isActive
      ? '<span style="background:#ecfdf5;color:#047857;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px">🟢 نشط</span>'
      : '<span style="background:#fef2f2;color:#b91c1c;padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px">⛔ موقوف</span>';

    const perms = [];
    if (isMainAdmin) {
      perms.push('👑 كامل الصلاحيات المطلقة');
    } else {
      if (u.canDash) perms.push('الفروع');
      if (u.canReports) perms.push('استعراض التقارير');
      if (u.canReportsPrint) perms.push('طباعة');
      if (u.canReportsDelete) perms.push('حذف التقارير');
      if (u.canUsers) perms.push('المستخدمين');
      if (u.canSettings) perms.push('الإعدادات');
    }
    const permsText = perms.length > 0 ? perms.join(' • ') : 'بدون صلاحيات';

    const actions = isMainAdmin
      ? '<span style="color:#64748b;font-size:12px">الحساب الرئيسي</span>'
      : `
        <div style="display:flex;gap:6px;justify-content:center">
          <button class="btn btn-outline btn-sm" onclick="openAddSuperUserModal('${u.id}')" style="font-size:11.5px;padding:4px 8px" title="تعديل المستخدم والصلاحيات">✏️ تعديل</button>
          <button class="btn btn-outline btn-sm" onclick="toggleSuperUserStatus('${u.id}', ${u.isActive ? 1 : 0})" style="font-size:11.5px;padding:4px 8px">
            ${u.isActive ? '⛔ إيقاف' : '🟢 تفعيل'}
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteSuperUser('${u.id}', '${esc(u.userName)}')" style="font-size:11.5px;padding:4px 8px" title="حذف المستخدم">
            🗑️
          </button>
        </div>
      `;

    return `
      <tr style="border-bottom:1px solid var(--line)">
        <td style="padding:12px"><b style="color:#0f172a">${esc(u.userName)}</b></td>
        <td style="padding:12px">${esc(u.fullName)}</td>
        <td style="padding:12px"><span style="background:#f1f5f9;color:#334155;padding:3px 8px;border-radius:6px;font-weight:700;font-size:12px">${isMainAdmin ? 'مدير عام المركز' : 'مشرف إدارة مركزية'}</span></td>
        <td style="padding:12px;font-size:12.5px;color:#2563eb;font-weight:700">${permsText}</td>
        <td style="padding:12px">${statusBadge}</td>
        <td style="padding:12px;text-align:center">${actions}</td>
      </tr>
    `;
  }).join('');
}

function openAddSuperUserModal(userId = null) {
  const form = document.getElementById('superUserForm');
  if (form) form.reset();

  const title = document.getElementById('superUserModalTitle');
  const suIdInput = document.getElementById('suId');
  const suUserInput = document.getElementById('suUserName');
  const suPwdInput = document.getElementById('suPassword');

  if (userId) {
    const user = allSuperUsers.find(u => u.id === userId);
    if (!user) return;
    if (title) title.textContent = '✏️ تعديل مستخدم المركز والصلاحيات';
    if (suIdInput) suIdInput.value = user.id;
    if (suUserInput) {
      suUserInput.value = user.userName;
      suUserInput.disabled = true;
    }
    document.getElementById('suFullName').value = user.fullName || '';
    if (suPwdInput) suPwdInput.required = false;
    document.getElementById('suIsActive').checked = !!user.isActive;

    document.getElementById('suCanDash').checked = !!user.canDash;
    document.getElementById('suCanReports').checked = !!user.canReports;
    document.getElementById('suCanReportsPrint').checked = !!user.canReportsPrint;
    document.getElementById('suCanReportsDelete').checked = !!user.canReportsDelete;
    document.getElementById('suCanUsers').checked = !!user.canUsers;
    document.getElementById('suCanSettings').checked = !!user.canSettings;
  } else {
    if (title) title.textContent = '➕ إضافة مستخدم جديد للمركز';
    if (suIdInput) suIdInput.value = '';
    if (suUserInput) {
      suUserInput.value = '';
      suUserInput.disabled = false;
    }
    if (suPwdInput) suPwdInput.required = true;
    document.getElementById('suIsActive').checked = true;

    document.getElementById('suCanDash').checked = true;
    document.getElementById('suCanReports').checked = true;
    document.getElementById('suCanReportsPrint').checked = true;
    document.getElementById('suCanReportsDelete').checked = false;
    document.getElementById('suCanUsers').checked = false;
    document.getElementById('suCanSettings').checked = false;
  }

  const modal = document.getElementById('superUserModal');
  if (modal) modal.style.display = 'flex';
}

function closeSuperUserModal() {
  const modal = document.getElementById('superUserModal');
  if (modal) modal.style.display = 'none';
}

async function saveSuperUser(e) {
  e.preventDefault();
  const userId = document.getElementById('suId').value;
  const userName = document.getElementById('suUserName').value.trim();
  const fullName = document.getElementById('suFullName').value.trim();
  const password = document.getElementById('suPassword').value.trim();
  const isActive = document.getElementById('suIsActive').checked ? 1 : 0;

  const canDash = document.getElementById('suCanDash').checked ? 1 : 0;
  const canReports = document.getElementById('suCanReports').checked ? 1 : 0;
  const canReportsPrint = document.getElementById('suCanReportsPrint').checked ? 1 : 0;
  const canReportsDelete = document.getElementById('suCanReportsDelete').checked ? 1 : 0;
  const canUsers = document.getElementById('suCanUsers').checked ? 1 : 0;
  const canSettings = document.getElementById('suCanSettings').checked ? 1 : 0;

  const btn = document.getElementById('btnSaveSuperUser');
  btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';

  try {
    if (userId) {
      await api(`/super/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          fullName, password, isActive,
          canDash, canReports, canReportsPrint, canReportsDelete,
          canUsers, canSettings
        })
      });
      toast('تم تحديث بيانات المستخدم وصلاحياته بنجاح ✔');
    } else {
      await api('/super/users', {
        method: 'POST',
        body: JSON.stringify({
          userName, fullName, password, isActive,
          canDash, canReports, canReportsPrint, canReportsDelete,
          canUsers, canSettings
        })
      });
      toast('تم إنشاء مستخدم الإدارة المركزية بنجاح ✔');
    }
    closeSuperUserModal();
    await loadSuperUsers();
  } catch (err) {
    alert('خطأ: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'حفظ المستخدم ✔';
  }
}

async function toggleSuperUserStatus(userId, currentActive) {
  try {
    await api(`/super/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ isActive: currentActive ? 0 : 1 })
    });
    toast('تم تغيير حالة الحساب ✔');
    await loadSuperUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteSuperUser(userId, userName) {
  if (!confirm(`هل أنت متأكد من حذف المستخدم (${userName})؟`)) return;
  try {
    await api(`/super/users/${userId}`, { method: 'DELETE' });
    toast('تم حذف المستخدم بنجاح ✔');
    await loadSuperUsers();
  } catch (err) {
    alert(err.message);
  }
}

/* =========================================================
   إعدادات الترويسة والختوم والنسخ الاحتياطي
   ========================================================= */
let superCustomLogoBase64 = null;

async function loadSuperSettings() {
  try {
    const res = await api('/super/settings');
    if (!res) return;

    if (res.masterOrgCode) {
      const spInput = document.getElementById('spMasterCode');
      if (spInput) spInput.value = res.masterOrgCode;
    }
    if (res.superAdminUserName) {
      const uInput = document.getElementById('spUserName');
      if (uInput) uInput.value = res.superAdminUserName;
    }

    const cfg = res.reportHeaderConfig || {};
    currentSuperHeaderConfig = cfg;
    if (cfg.lines) {
      if (cfg.lines[0] !== undefined) document.getElementById('shHeaderLine1').value = cfg.lines[0];
      if (cfg.lines[1] !== undefined) document.getElementById('shHeaderLine2').value = cfg.lines[1];
      if (cfg.lines[2] !== undefined) document.getElementById('shHeaderLine3').value = cfg.lines[2];
      if (cfg.lines[3] !== undefined) document.getElementById('shHeaderLine4').value = cfg.lines[3];
      if (cfg.lines[4] !== undefined) document.getElementById('shHeaderLine5').value = cfg.lines[4];
    }
    if (cfg.confidential !== undefined) document.getElementById('shConfidential').value = cfg.confidential;
    if (cfg.font) document.getElementById('shFontSel').value = cfg.font;
    if (cfg.showBasmala !== undefined) document.getElementById('shShowBasmala').checked = !!cfg.showBasmala;
    if (cfg.basmalaText) document.getElementById('shBasmalaText').value = cfg.basmalaText;

    if (cfg.logoUrl) {
      if (cfg.logoUrl.startsWith('data:')) {
        superCustomLogoBase64 = cfg.logoUrl;
        document.getElementById('shLogoSel').value = 'custom';
      } else {
        document.getElementById('shLogoSel').value = cfg.logoUrl;
      }
    }

    if (cfg.signatures) {
      if (cfg.signatures.sig1Title) document.getElementById('shSig1').value = cfg.signatures.sig1Title;
      if (cfg.signatures.sig1Name !== undefined) document.getElementById('shSig1Name').value = cfg.signatures.sig1Name;
      if (cfg.signatures.sig2Title) document.getElementById('shSig2').value = cfg.signatures.sig2Title;
      if (cfg.signatures.sig2Name !== undefined) document.getElementById('shSig2Name').value = cfg.signatures.sig2Name;
      if (cfg.signatures.sig3Title) document.getElementById('shSig3').value = cfg.signatures.sig3Title;
      if (cfg.signatures.sig3Name !== undefined) document.getElementById('shSig3Name').value = cfg.signatures.sig3Name;
    }

    updateSuperHeaderLivePreview();
  } catch(e) {
    toast('تعذر جلب إعدادات الترويسة: ' + e.message, 'err');
  }
}

function onSuperLogoSelChange() {
  const sel = document.getElementById('shLogoSel');
  const fileInput = document.getElementById('shLogoFile');
  if (sel && sel.value === 'custom') {
    if (fileInput) fileInput.click();
  }
  updateSuperHeaderLivePreview();
}

function handleSuperLogoUpload(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function (e) {
      superCustomLogoBase64 = e.target.result;
      updateSuperHeaderLivePreview();
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function updateSuperHeaderLivePreview() {
  const preview = document.getElementById('shLivePreview');
  if (!preview) return;

  const l1 = document.getElementById('shHeaderLine1')?.value || '';
  const l2 = document.getElementById('shHeaderLine2')?.value || '';
  const l3 = document.getElementById('shHeaderLine3')?.value || '';
  const l4 = document.getElementById('shHeaderLine4')?.value || '';
  const l5 = document.getElementById('shHeaderLine5')?.value || '';
  const conf = document.getElementById('shConfidential')?.value || '';
  const showBasmala = document.getElementById('shShowBasmala')?.checked;
  const basmalaText = document.getElementById('shBasmalaText')?.value || '';

  const logoSel = document.getElementById('shLogoSel')?.value;
  let logoSrc = 'Image/1754379379088.jpg';
  if (logoSel === 'custom' && superCustomLogoBase64) {
    logoSrc = superCustomLogoBase64;
  } else if (logoSel && logoSel !== 'custom') {
    logoSrc = logoSel;
  }

  const sig1 = document.getElementById('shSig1')?.value || '';
  const sig1N = document.getElementById('shSig1Name')?.value || '';
  const sig2 = document.getElementById('shSig2')?.value || '';
  const sig2N = document.getElementById('shSig2Name')?.value || '';
  const sig3 = document.getElementById('shSig3')?.value || '';
  const sig3N = document.getElementById('shSig3Name')?.value || '';

  preview.innerHTML = `
    <div style="border:1px solid #cbd5e1;padding:16px;border-radius:8px;background:#fff;font-family:inherit">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0f172a;padding-bottom:12px">
        <div style="text-align:right;font-size:12px;line-height:1.6;font-weight:700">
          <div>${esc(l1)}</div>
          <div>${esc(l2)}</div>
          <div>${esc(l3)}</div>
          <div>${esc(l4)}</div>
          <div>${esc(l5)}</div>
        </div>
        <div style="text-align:center">
          ${showBasmala ? `<div style="font-size:11px;font-weight:700;margin-bottom:4px">${esc(basmalaText)}</div>` : ''}
          <img src="${logoSrc}" style="width:64px;height:64px;object-fit:contain" alt="Logo" />
        </div>
        <div style="text-align:left;font-size:11px;line-height:1.6;color:#64748b">
          <div>التاريخ: ${new Date().toISOString().slice(0, 10)}</div>
          <div>الرقم: 001/م</div>
          ${conf ? `<div style="display:inline-block;padding:2px 6px;border:1px solid #ef4444;color:#ef4444;border-radius:4px;font-weight:800;font-size:10px;margin-top:4px">${esc(conf)}</div>` : ''}
        </div>
      </div>

      <div style="height:40px;display:grid;place-items:center;color:#94a3b8;font-size:12px;border-bottom:1px dashed #e2e8f0;margin-bottom:12px">
        [ مساحة موضوع وبيان التقرير الرسمي ]
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center;font-size:11.5px;margin-top:10px;gap:8px">
        <div>
          <b>${esc(sig1)}</b><br/>
          <span style="color:#64748b">${esc(sig1N)}</span>
        </div>
        <div>
          <b>${esc(sig2)}</b><br/>
          <span style="color:#64748b">${esc(sig2N)}</span>
        </div>
        <div>
          <b>${esc(sig3)}</b><br/>
          <span style="color:#64748b">${esc(sig3N)}</span>
        </div>
      </div>
    </div>
  `;
}

async function saveSuperHeaderSettings() {
  const logoSel = document.getElementById('shLogoSel')?.value;
  let logoUrl = logoSel === 'custom' ? superCustomLogoBase64 : logoSel;

  const reportHeaderConfig = {
    lines: [
      document.getElementById('shHeaderLine1')?.value || '',
      document.getElementById('shHeaderLine2')?.value || '',
      document.getElementById('shHeaderLine3')?.value || '',
      document.getElementById('shHeaderLine4')?.value || '',
      document.getElementById('shHeaderLine5')?.value || ''
    ],
    confidential: document.getElementById('shConfidential')?.value || '',
    logoUrl,
    font: document.getElementById('shFontSel')?.value || 'diwani',
    showBasmala: document.getElementById('shShowBasmala')?.checked,
    basmalaText: document.getElementById('shBasmalaText')?.value || '',
    signatures: {
      sig1Title: document.getElementById('shSig1')?.value || '',
      sig1Name: document.getElementById('shSig1Name')?.value || '',
      sig2Title: document.getElementById('shSig2')?.value || '',
      sig2Name: document.getElementById('shSig2Name')?.value || '',
      sig3Title: document.getElementById('shSig3')?.value || '',
      sig3Name: document.getElementById('shSig3Name')?.value || ''
    }
  };

  try {
    await api('/super/settings', {
      method: 'POST',
      body: JSON.stringify({ reportHeaderConfig })
    });
    currentSuperHeaderConfig = reportHeaderConfig;
    toast('تم حفظ بيانات الترويسة والختوم بنجاح ✔');
  } catch (e) {
    alert('تعذر حفظ الترويسة: ' + e.message);
  }
}

/* =========================================================
   النسخ الاحتياطي والاستعادة لقاعدة بيانات SQLite للإدارة المركزية
   ========================================================= */
async function downloadSuperBackup() {
  try {
    toast('جارٍ استخراج وتجهيز ملف قاعدة بيانات SQLite (.db)...');
    const tok = getToken();
    const res = await fetch(getServerBaseUrl() + '/api/super/backup?format=sqlite', {
      headers: { 'Authorization': 'Bearer ' + tok }
    });
    if (!res.ok) throw new Error('فشل توليد قاعدة البيانات (كود ' + res.status + ')');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Central_Database_${new Date().toISOString().slice(0, 10)}.db`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    toast('تم تنزيل ملف قاعدة بيانات SQLite بنجاح ✔');
  } catch(e) {
    alert('تعذر تنزيل قاعدة البيانات: ' + e.message);
  }
}

async function restoreSuperBackup(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (!confirm(`تحذير: هل أنت متأكد من استعادة قاعدة البيانات من الملف (${file.name})؟\nسيتم دمج وتحديث بيانات النظام والفروع بدقة.`)) {
    input.value = '';
    return;
  }

  try {
    toast('جارٍ استعادة ودمج البيانات...');
    const isDb = file.name.endsWith('.db') || file.name.endsWith('.sqlite');
    if (isDb) {
      const arrayBuf = await file.arrayBuffer();
      const res = await fetch(getServerBaseUrl() + '/api/super/restore', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + getToken(),
          'Content-Type': 'application/x-sqlite3'
        },
        body: arrayBuf
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشلت الاستعادة');
      toast(data.message || 'تمت استعادة قاعدة بيانات SQLite بنجاح ✔');
    } else {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await api('/super/restore', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      toast(res.message || 'تمت استعادة النسخة الاحتياطية بنجاح ✔');
    }
    await loadDashboard();
  } catch(err) {
    alert('فشل استعادة البيانات: ' + err.message);
  } finally {
    input.value = '';
  }
}

/* =========================================================
   حساب الإدارة المركزية وتغيير الرمز الماستر
   ========================================================= */
async function loadSuperProfile() {
  try {
    const res = await api('/super/settings');
    if (res) {
      if (res.superAdminUserName) document.getElementById('spUserName').value = res.superAdminUserName;
      if (res.masterOrgCode) document.getElementById('spMasterCode').value = res.masterOrgCode;
    }
  } catch(e){}
}

async function saveSuperProfile(e) {
  e.preventDefault();
  const userName = document.getElementById('spUserName').value.trim();
  const password = document.getElementById('spPassword').value.trim();
  const masterOrgCode = document.getElementById('spMasterCode').value.trim().toUpperCase();

  const btn = document.getElementById('btnSaveSuperProfile');
  btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';

  try {
    const res = await api('/super/profile', {
      method: 'PUT',
      body: JSON.stringify({ userName, password, masterOrgCode })
    });
    toast(res.message || 'تم حفظ وتحديث بيانات حساب الإدارة والرمز بنجاح ✔');
    document.getElementById('spPassword').value = '';
  } catch(err) {
    alert('خطأ: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '💾 حفظ التغييرات وتحديث البيانات ✔';
  }
}

function togglePassVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
}

/* =========================================================
   طباعة كافة التقارير المعروضة حسب الفلترة (Bulk Print)
   ========================================================= */
function printAllSuperReports() {
  if (!allSuperReports || allSuperReports.length === 0) {
    toast('لا توجد تقارير لطباعتها في القائمة الحالية', 'err');
    return;
  }

  // جمع بيانات الفلاتر الحالية لعرضها في عنوان الطباعة
  const orgFilter = document.getElementById('filterSuperReportOrg');
  const orgName = orgFilter && orgFilter.value ? orgFilter.options[orgFilter.selectedIndex]?.text : 'كافة الفروع';
  const fromDate = document.getElementById('filterSuperReportFrom')?.value || '';
  const toDate = document.getElementById('filterSuperReportTo')?.value || '';
  const query = document.getElementById('filterSuperReportQuery')?.value?.trim() || '';

  let filterDesc = `الفرع: ${orgName}`;
  if (fromDate) filterDesc += ` | من: ${fromDate}`;
  if (toDate) filterDesc += ` | إلى: ${toDate}`;
  if (query) filterDesc += ` | بحث: "${query}"`;

  const reportsHtml = allSuperReports.map((r, idx) => {
    let imgList = [];
    try {
      imgList = typeof r.images === 'string' ? JSON.parse(r.images) : (r.images || []);
    } catch(e) {}

    const imagesHtml = (Array.isArray(imgList) && imgList.length > 0)
      ? `<div class="imgs-row">${imgList.map(src => `<img src="${src}" />`).join('')}</div>`
      : '';

    return `
      <div class="report-block" style="${idx > 0 ? 'page-break-before:always;' : ''}">
        <div class="report-header">
          <div>
            <div class="report-title">${esc(r.subject || 'بدون موضوع')}</div>
            <div class="report-branch">🏢 ${esc(r.orgName || 'فرع')} (${esc(r.orgCode || '')})</div>
          </div>
          <div style="text-align:left;font-family:monospace">
            <div style="font-size:16px;font-weight:900">رقم: ${esc(r.reportNumber || '#' + r.id)}</div>
            <div style="font-size:12px;color:#64748b">${esc(r.reportDate || '')} ${esc(r.reportTime || '')}</div>
          </div>
        </div>
        <div class="meta-grid">
          <div><b>المدخل:</b> ${esc(r.enteredBy || '—')}</div>
          <div><b>الجهة المستهدفة:</b> ${esc(r.targetSector || r.location || '—')}</div>
          <div><b>الموقع:</b> ${esc(r.location || r.targetSector || '—')}</div>
          <div><b>التاريخ:</b> ${esc(r.reportDate || '—')}</div>
        </div>
        <div class="details-box">
          <div class="section-title">📝 بيان وتفاصيل التقرير:</div>
          <div class="details-text">${esc(r.details || r.notes || '—')}</div>
        </div>
        ${imagesHtml}
        <div class="footer-line">تم إصدار هذا التقرير عبر منظومة الإدارة المركزية (كودكس للبرمجيات • ${new Date().toLocaleDateString('ar-YE')})</div>
      </div>
    `;
  }).join('');

  const w = window.open('', '_blank', 'width=900,height=900');
  w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>تقارير الإدارة المركزية — ${allSuperReports.length} تقرير</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #0f172a; margin: 0; padding: 24px; direction: rtl; font-size: 13px; }
  .print-cover { border: 2px solid #0f172a; border-radius: 12px; padding: 20px 28px; margin-bottom: 28px; background: #f8fafc; }
  .print-cover h1 { font-size: 20px; color: #1e3a8a; margin: 0 0 8px; }
  .print-cover .meta { font-size: 12px; color: #64748b; line-height: 1.8; }
  .report-block { margin-bottom: 40px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 22px; background: #fff; }
  .report-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 14px; gap: 14px; }
  .report-title { font-size: 16px; font-weight: 800; color: #1e3a8a; }
  .report-branch { font-size: 12px; color: #0284c7; margin-top: 4px; font-weight: 700; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; margin-bottom: 14px; font-size: 12.5px; }
  .details-box { background: #fff; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; margin-bottom: 14px; }
  .section-title { font-weight: 800; color: #1e3a8a; font-size: 13px; margin-bottom: 6px; }
  .details-text { line-height: 1.9; white-space: pre-wrap; font-size: 13px; }
  .imgs-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
  .imgs-row img { max-width: 200px; max-height: 150px; border-radius: 8px; border: 1px solid #cbd5e1; }
  .footer-line { margin-top: 14px; padding-top: 10px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8; }
  @media print {
    body { padding: 0; }
    .report-block { border: 1px solid #000; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="no-print" style="text-align:center;margin-bottom:20px">
    <button onclick="window.print()" style="background:#1e3a8a;color:#fff;border:none;padding:12px 28px;font-size:15px;font-weight:800;border-radius:10px;cursor:pointer;font-family:inherit">🖨️ طباعة الكل</button>
    <button onclick="window.close()" style="background:#f1f5f9;color:#0f172a;border:1px solid #cbd5e1;padding:12px 20px;font-size:15px;font-weight:800;border-radius:10px;cursor:pointer;margin-right:10px;font-family:inherit">✕ إغلاق</button>
  </div>
  <div class="print-cover">
    <h1>📋 تقارير الإدارة المركزية — المعتمدة حسب الفلترة</h1>
    <div class="meta">
      <div>🔢 عدد التقارير: <b>${allSuperReports.length}</b></div>
      <div>🔍 معايير الفلترة: <b>${esc(filterDesc)}</b></div>
      <div>📅 تاريخ الاستخراج: <b>${new Date().toLocaleString('ar-YE')}</b></div>
    </div>
  </div>
  ${reportsHtml}
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));<\/script>
</body>
</html>`);
  w.document.close();
}

/* =========================================================
   تصدير التقارير المعروضة حسب الفلترة إلى Excel / CSV
   ========================================================= */
function exportSuperReportsCsv() {
  if (!allSuperReports || allSuperReports.length === 0) {
    toast('لا توجد تقارير لتصديرها في القائمة الحالية', 'err');
    return;
  }

  const headers = ['الفرع', 'رمز_الفرع', 'رقم_التقرير', 'التاريخ', 'الوقت', 'الموضوع', 'الجهة_المستهدفة', 'الموقع', 'مدخل_البيانات', 'التفاصيل'];
  const rows = allSuperReports.map(r => [
    r.orgName || '',
    r.orgCode || '',
    r.reportNumber || ('#' + r.id),
    r.reportDate || '',
    r.reportTime || '',
    r.subject || '',
    r.targetSector || '',
    r.location || '',
    r.enteredBy || '',
    (r.details || r.notes || '').replace(/\n/g, ' ').replace(/\r/g, '')
  ]);

  const csvContent = '\uFEFF' + [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `تقارير_الإدارة_المركزية_${today}_${allSuperReports.length}تقرير.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`✅ تم تصدير ${allSuperReports.length} تقرير إلى Excel (CSV) بنجاح`);
}

/* =========================================================
   تصدير قالب إدخال وتوريد بيانات التقارير المعتمد
   ========================================================= */
function openReportsTemplateModal() {
  const m = document.getElementById('reportsTemplateModal');
  if (m) m.classList.add('show');
}

function closeReportsTemplateModal() {
  const m = document.getElementById('reportsTemplateModal');
  if (m) m.classList.remove('show');
}

function downloadReportsCsvTemplate() {
  const headers = ['رقم_التقرير', 'موضوع_التقرير', 'الجهة_المستهدفة', 'تاريخ_التقرير', 'وقت_التقرير', 'الموقع', 'تفاصيل_التقرير', 'التقييم', 'اسم_المدخل'];
  const row1 = ['1001', 'تقرير زيارة تدقيق مالي وإداري', 'إدارة الرقابة والمتابعة', '2026-09-20', '10:30', 'المقر الرئيسي - مبنى 1', 'تمت مراجعة القيود وسير العمل الميداني بنجاح تام وفق الخطة المعمول بها', 'عادي', 'أحمد محمد'];
  const row2 = ['1002', 'تقرير صيانة ومتابعة فنية عاجلة', 'فرع المدينة', '2026-09-20', '14:15', 'صالة الفرع', 'تم فحص أجهزة الشبكة ومعالجة العطل بالكامل واستئناف العمل', 'عاجل', 'سالم علي'];
  
  const csvContent = '\uFEFF' + [headers, row1, row2]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'قالب_تعبئة_التقارير_المعتمد.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('تم تنزيل قالب Excel (CSV) بنجاح ✔');
  closeReportsTemplateModal();
}

function downloadReportsJsonTemplate() {
  const templateData = {
    system: 'منظومة إدارة الحسابات والتقارير الموحدة',
    version: '3.0',
    description: 'قالب إدخال وتوريد بيانات التقارير المعتمد لتجنب تعارض الحقول والأنواع',
    fieldDefinitions: {
      reportNumber: { description: 'رقم التقرير الفريد', type: 'string / number', example: '1001', required: true },
      subject: { description: 'موضوع وعنوان التقرير', type: 'string', example: 'تقرير جرد سنوي', required: true },
      target: { description: 'الجهة أو الشخص المستهدف', type: 'string', example: 'الإدارة العامة', required: false },
      reportDate: { description: 'تاريخ التقرير بصيغة YYYY-MM-DD', type: 'string', example: '2026-09-20', required: true },
      reportTime: { description: 'وقت التقرير بصيغة HH:MM', type: 'string', example: '10:30', required: false },
      location: { description: 'موقع أو مكان الحدث', type: 'string', example: 'الفرع الرئيسي', required: false },
      details: { description: 'شرح وتفاصيل التقرير الكاملة', type: 'string', example: 'تم إنجاز كافة المهام الميدانية والمحاسبية...', required: true },
      rating: { description: 'مستوى الأهمية', type: 'string', allowedValues: ['عادي', 'هام', 'سري', 'عاجل'], default: 'عادي' },
      enteredBy: { description: 'اسم الموظف أو محرر التقرير', type: 'string', example: 'محمد أحمد', required: false }
    },
    reports: [
      {
        reportNumber: '1001',
        subject: 'تقرير زيارة تدقيق مالي وإداري',
        target: 'إدارة الرقابة والمتابعة',
        reportDate: '2026-09-20',
        reportTime: '10:30',
        location: 'المقر الرئيسي - مبنى 1',
        details: 'تمت مراجعة القيود وسير العمل الميداني بنجاح تام وفق الخطة المعمول بها',
        rating: 'عادي',
        enteredBy: 'أحمد محمد'
      },
      {
        reportNumber: '1002',
        subject: 'تقرير صيانة ومتابعة فنية عاجلة',
        target: 'فرع المدينة',
        reportDate: '2026-09-20',
        reportTime: '14:15',
        location: 'صالة الفرع',
        details: 'تم فحص أجهزة الشبكة ومعالجة العطل بالكامل واستئناف العمل',
        rating: 'عاجل',
        enteredBy: 'سالم علي'
      }
    ]
  };
  const blob = new Blob([JSON.stringify(templateData, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'قالب_تعبئة_التقارير_المعتمد.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('تم تنزيل قالب JSON المهيكل بنجاح ✔');
  closeReportsTemplateModal();
}
