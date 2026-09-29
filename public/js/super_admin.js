/* =========================================================
   super_admin.js — لوحة الإدارة العليا لشركة كودكس للبرمجيات
   ========================================================= */
let allOrgs = [];
let allSuperReports = [];
let activeSuperReport = null;
let superReportSearchDebounce = null;
let currentSuperHeaderConfig = null;
let currentSuperUser = null;

(async function () {
  let me = null;
  try {
    me = await currentMe();
    currentSuperUser = me.user;
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
  const tabs = ['orgs', 'reports', 'smartAi', 'users', 'settings', 'profile'];
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
  else if (tab === 'smartAi') loadSmartCorrelation();
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
      // فحص سريع لتحديث عداد التنبيهات الذكية
      api('/super/smart-correlation?minScore=45&days=30').then(r => {
        if (r && r.clusters) {
          const b = document.getElementById('smartAiTabBadge');
          if (b) { b.textContent = r.clusters.length; b.style.display = r.clusters.length > 0 ? 'inline-block' : 'none'; }
        }
      }).catch(() => {});
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

// تحديث وتعبئة القوائم المنسدلة للفرز (الوحدات والمستخدمين)
function updateSuperFilterDropdowns(filterOptions, selectedOrgId) {
  if (!filterOptions) return;

  // 1. قائمة الوحدات
  const unitSelect = document.getElementById('filterSuperReportUnit');
  if (unitSelect && filterOptions.units) {
    const currentUnitVal = unitSelect.value;
    unitSelect.innerHTML = '<option value="">-- كافة الوحدات --</option>';
    
    // إدراج الوحدات
    const unitsList = filterOptions.units;
    unitsList.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.unitId || u.unitName;
      opt.textContent = selectedOrgId ? u.unitName : `${u.unitName} (${u.orgName})`;
      unitSelect.appendChild(opt);
    });
    unitSelect.value = currentUnitVal;
  }

  // 2. قائمة المستخدمين / المحررين
  const userSelect = document.getElementById('filterSuperReportUser');
  if (userSelect && filterOptions.users) {
    const currentUserVal = userSelect.value;
    userSelect.innerHTML = '<option value="">-- كافة المستخدمين --</option>';
    
    const usersList = filterOptions.users;
    usersList.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.enteredBy;
      opt.textContent = selectedOrgId ? u.enteredBy : `${u.enteredBy} (${u.orgName})`;
      userSelect.appendChild(opt);
    });
    userSelect.value = currentUserVal;
  }
}

// حدث تغيير فرع المنظومة
function onSuperOrgFilterChange() {
  loadSuperReports();
}

// إعادة ضبط وتفريغ جميع فلاتر التقارير
function resetSuperReportFilters() {
  if (document.getElementById('filterSuperReportOrg')) document.getElementById('filterSuperReportOrg').value = '';
  if (document.getElementById('filterSuperReportUnit')) document.getElementById('filterSuperReportUnit').value = '';
  if (document.getElementById('filterSuperReportUser')) document.getElementById('filterSuperReportUser').value = '';
  if (document.getElementById('filterSuperReportRating')) document.getElementById('filterSuperReportRating').value = '';
  if (document.getElementById('filterSuperReportAttachment')) document.getElementById('filterSuperReportAttachment').value = '';
  if (document.getElementById('filterSuperReportFrom')) document.getElementById('filterSuperReportFrom').value = '';
  if (document.getElementById('filterSuperReportTo')) document.getElementById('filterSuperReportTo').value = '';
  if (document.getElementById('filterSuperReportQuery')) document.getElementById('filterSuperReportQuery').value = '';
  loadSuperReports();
  toast('تم تفريغ جميع الفلاتر وعرض كافة التقارير ✔');
}

// تحميل التقارير الشاملة من الفروع مع الفرز المتقدم
async function loadSuperReports() {
  const tbody = document.getElementById('superReportsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--muted)">جارٍ جلب التقارير وتطبيق الفرز...</td></tr>';

  try {
    const orgId = document.getElementById('filterSuperReportOrg')?.value || '';
    const unitId = document.getElementById('filterSuperReportUnit')?.value || '';
    const user = document.getElementById('filterSuperReportUser')?.value || '';
    const rating = document.getElementById('filterSuperReportRating')?.value || '';
    const hasAttachments = document.getElementById('filterSuperReportAttachment')?.value || '';
    const from = document.getElementById('filterSuperReportFrom')?.value || '';
    const to = document.getElementById('filterSuperReportTo')?.value || '';
    const q = document.getElementById('filterSuperReportQuery')?.value.trim() || '';

    const params = new URLSearchParams();
    if (orgId) params.append('orgId', orgId);
    if (unitId) params.append('unitId', unitId);
    if (user) params.append('user', user);
    if (rating) params.append('rating', rating);
    if (hasAttachments !== '') params.append('hasAttachments', hasAttachments);
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (q) params.append('q', q);

    const res = await api('/super/reports?' + params.toString());
    
    // تحديث خيارات القوائم المنسدلة بناءً على الاستجابة
    if (res.filterOptions) {
      updateSuperFilterDropdowns(res.filterOptions, orgId);
    }

    allSuperReports = (res.reports || []).map(r => {
      if (r.isEncrypted && r.encryptedPayload && r.orgEncKey) {
        const branchKey = 'CODEX_E2EE_' + r.orgCode + '_' + r.orgEncKey;
        return typeof decryptReportData === 'function' ? decryptReportData(r, branchKey) : r;
      }
      return r;
    });

    const countBadge = document.getElementById('superReportsTabCount');
    if (countBadge) countBadge.textContent = allSuperReports.length;

    const filteredCountEl = document.getElementById('superReportsFilteredCount');
    if (filteredCountEl) filteredCountEl.textContent = allSuperReports.length;

    // تحديث شارات الفلاتر النشطة
    const tagsContainer = document.getElementById('superReportsActiveFiltersTags');
    if (tagsContainer) {
      const activeTags = [];
      if (orgId) {
        const orgText = document.getElementById('filterSuperReportOrg')?.selectedOptions[0]?.text;
        activeTags.push(`<span class="badge blue" style="font-size:11px">🏢 ${esc(orgText)}</span>`);
      }
      if (unitId) {
        const unitText = document.getElementById('filterSuperReportUnit')?.selectedOptions[0]?.text;
        activeTags.push(`<span class="badge purple" style="font-size:11px">🏛️ ${esc(unitText)}</span>`);
      }
      if (user) {
        activeTags.push(`<span class="badge" style="background:#e0e7ff;color:#3730a3;font-size:11px">👤 ${esc(user)}</span>`);
      }
      if (rating) {
        activeTags.push(`<span class="badge" style="background:#fef3c7;color:#92400e;font-size:11px">⭐ ${esc(rating)}</span>`);
      }
      if (hasAttachments !== '') {
        activeTags.push(`<span class="badge" style="background:#ecfdf5;color:#065f46;font-size:11px">📎 ${hasAttachments === '1' ? 'بمرفقات' : 'بدون مرفقات'}</span>`);
      }
      if (from || to) {
        activeTags.push(`<span class="badge" style="background:#f1f5f9;color:#334155;font-size:11px">📅 ${esc(from || 'البداية')} إلى ${esc(to || 'الآن')}</span>`);
      }
      if (q) {
        activeTags.push(`<span class="badge" style="background:#fee2e2;color:#991b1b;font-size:11px">🔍 "${esc(q)}"</span>`);
      }
      tagsContainer.innerHTML = activeTags.join(' ');
    }

    if (allSuperReports.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--muted)">لا توجد تقارير مطابقة للفلاتر المحددة حالياً. حاول تعديل معايير الفرز أو تفريغ الفلاتر.</td></tr>';
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

      // شارة التقييم
      let ratingBadge = '<span style="color:#64748b;font-size:12px">عادي</span>';
      const rat = (r.rating || '').trim();
      if (rat === 'سري' || rat === 'خاص وسري') {
        ratingBadge = '<span class="badge red" style="font-size:11px;font-weight:800">🔒 سري</span>';
      } else if (rat === 'عاجل' || rat === 'طارئ') {
        ratingBadge = '<span class="badge" style="background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:800">⚡ عاجل</span>';
      } else if (rat === 'مهم' || rat === 'هام') {
        ratingBadge = '<span class="badge yellow" style="font-size:11px;font-weight:800">⭐ مهم</span>';
      } else if (rat) {
        ratingBadge = `<span class="badge" style="background:#f1f5f9;color:#334155;font-size:11px">${esc(rat)}</span>`;
      }

      return `
        <tr style="border-bottom:1px solid var(--line)">
          <td style="padding:12px">
            <span style="font-weight:800;color:#0284c7;font-size:13.5px">${esc(r.orgName || 'فرع')}</span>
            <div style="font-size:11px;color:#64748b;font-family:monospace">${esc(r.orgCode || '')}</div>
            ${r.unitName ? `<span class="badge purple" style="font-size:10.5px;padding:2px 6px;margin-top:3px;display:inline-block">🏛️ ${esc(r.unitName)}</span>` : ''}
          </td>
          <td style="padding:12px">
            <span style="font-family:monospace;font-weight:800;background:#f1f5f9;padding:2px 6px;border-radius:4px">${esc(r.reportNumber || '#' + r.id)}</span>${encBadge}
          </td>
          <td style="padding:12px;font-size:12.5px">
            <div>${esc(r.reportDate || '')}</div>
            <div style="font-size:11px;color:#64748b">${esc(r.reportTime || '')}</div>
          </td>
          <td style="padding:12px">
            <div style="font-weight:800;color:var(--text);font-size:13.5px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.subject || '')}">
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
            ${ratingBadge}
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
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:#dc2626">تعذر جلب التقارير: ${esc(err.message)}</td></tr>`;
  }
}

function normalizeAttachment(p, idx) {
  if (!p) return { id: 'att_' + (idx || 0), name: 'مرفق ' + ((idx || 0) + 1), type: 'application/octet-stream', size: 0, data: '' };
  if (typeof p === 'string') {
    if (p.startsWith('data:image')) {
      return { id: 'att_' + (idx || 0), name: 'صورة ' + ((idx || 0) + 1), type: 'image/jpeg', size: Math.round(p.length * 0.75), data: p };
    }
    if (p.startsWith('data:video')) {
      return { id: 'att_' + (idx || 0), name: 'فيديو ' + ((idx || 0) + 1), type: 'video/mp4', size: Math.round(p.length * 0.75), data: p };
    }
    if (p.startsWith('data:audio')) {
      return { id: 'att_' + (idx || 0), name: 'تسجيل صوتي ' + ((idx || 0) + 1), type: 'audio/mp3', size: Math.round(p.length * 0.75), data: p };
    }
    if (p.startsWith('data:')) {
      const match = p.match(/^data:([^;]+);/);
      const mime = match ? match[1] : 'application/octet-stream';
      return { id: 'att_' + (idx || 0), name: 'مرفق ' + ((idx || 0) + 1), type: mime, size: Math.round(p.length * 0.75), data: p };
    }
    return { id: 'att_' + (idx || 0), name: 'مرفق ' + ((idx || 0) + 1), type: 'image/jpeg', size: 0, data: p };
  }
  const data = p.data || p.url || p.src || p.path || '';
  const type = p.type || (data.startsWith('data:image') ? 'image/jpeg' : (data.startsWith('data:video') ? 'video/mp4' : (data.startsWith('data:audio') ? 'audio/mp3' : 'application/octet-stream')));
  return {
    id: p.id || ('att_' + (idx || 0)),
    name: p.name || ('مرفق ' + ((idx || 0) + 1)),
    type: type,
    size: p.size || (data ? Math.round(data.length * 0.75) : 0),
    data: data
  };
}

function getAttachmentIcon(mime = '', name = '') {
  const m = (mime || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(n)) return '🖼️';
  if (m.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|3gp)$/i.test(n)) return '🎬';
  if (m.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|amr)$/i.test(n)) return '🎵';
  if (m.includes('pdf') || n.endsWith('.pdf')) return '📄';
  if (m.includes('word') || m.includes('document') || /\.(doc|docx)$/i.test(n)) return '📝';
  if (m.includes('sheet') || m.includes('excel') || /\.(xls|xlsx)$/i.test(n)) return '📊';
  return '📎';
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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

  // الصور والمرفقات
  const gallery = document.getElementById('srdImagesGallery');
  const sec = document.getElementById('srdImagesSection');
  if (gallery && sec) {
    gallery.innerHTML = '';
    let rawList = [];
    if (r.images) {
      try {
        rawList = typeof r.images === 'string' ? JSON.parse(r.images) : r.images;
      } catch(e) { rawList = []; }
    }
    if (!Array.isArray(rawList)) rawList = [];

    const attachments = rawList.map((p, i) => normalizeAttachment(p, i));

    if (attachments.length > 0) {
      sec.style.display = 'block';
      gallery.innerHTML = attachments.map((att, idx) => {
        const isImg = att.type.startsWith('image/') || (!att.type && att.data && att.data.startsWith('data:image'));
        const isVid = att.type.startsWith('video/') || (!att.type && att.data && att.data.startsWith('data:video'));
        const isAud = att.type.startsWith('audio/') || (!att.type && att.data && att.data.startsWith('data:audio'));
        const icon = getAttachmentIcon(att.type, att.name);
        const sizeStr = formatBytes(att.size);

        if (isImg) {
          return `
            <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#f8fafc;display:flex;flex-direction:column;width:160px;box-shadow:0 1px 4px rgba(0,0,0,0.05)">
              <a href="${att.data}" target="_blank" download="${esc(att.name)}" style="display:block;height:120px;overflow:hidden;background:#000" title="اضغط للتكبير أو التنزيل">
                <img src="${att.data}" alt="${esc(att.name)}" style="width:100%;height:100%;object-fit:cover" />
              </a>
              <div style="padding:6px 8px;display:flex;justify-content:space-between;align-items:center;font-size:11px;background:#fff">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;max-width:100px" title="${esc(att.name)}">${esc(att.name)}</span>
                <a href="${att.data}" download="${esc(att.name)}" class="btn btn-outline btn-xs" style="padding:2px 6px;font-size:11px" title="تنزيل">⬇️</a>
              </div>
            </div>`;
        } else if (isVid) {
          return `
            <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#0f172a;color:#fff;display:flex;flex-direction:column;width:180px">
              <video src="${att.data}" controls style="width:100%;height:120px;background:#000;object-fit:contain"></video>
              <div style="padding:6px 8px;display:flex;justify-content:space-between;align-items:center;font-size:11px;background:#1e293b">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;max-width:110px" title="${esc(att.name)}">🎬 ${esc(att.name)}</span>
                <a href="${att.data}" download="${esc(att.name)}" class="btn btn-primary btn-xs" style="padding:2px 6px;font-size:11px" title="تنزيل الفيديو">⬇️</a>
              </div>
            </div>`;
        } else if (isAud) {
          return `
            <div style="border:1px solid var(--line);border-radius:10px;padding:8px;background:#f8fafc;display:flex;flex-direction:column;gap:6px;width:180px">
              <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:11.5px">
                <span style="font-size:16px">🎵</span>
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px" title="${esc(att.name)}">${esc(att.name)}</span>
              </div>
              <audio src="${att.data}" controls style="width:100%;height:30px"></audio>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:var(--muted)">
                <span>${sizeStr}</span>
                <a href="${att.data}" download="${esc(att.name)}" class="btn btn-outline btn-xs" style="padding:2px 6px;font-size:10px">⬇️ تنزيل</a>
              </div>
            </div>`;
        } else {
          return `
            <div style="border:1px solid var(--line);border-radius:10px;padding:10px;background:#ffffff;display:flex;flex-direction:column;justify-content:space-between;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,0.04);width:160px">
              <div style="display:flex;align-items:flex-start;gap:8px">
                <span style="font-size:24px;line-height:1">${icon}</span>
                <div style="flex:1;overflow:hidden">
                  <div style="font-size:12px;font-weight:800;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(att.name)}">${esc(att.name)}</div>
                  <div style="font-size:10.5px;color:var(--muted);margin-top:2px">${sizeStr}</div>
                </div>
              </div>
              <a href="${att.data}" download="${esc(att.name)}" class="btn btn-outline btn-xs" style="width:100%;justify-content:center;font-size:11px;gap:4px">
                <span>⬇️ تنزيل الملف</span>
              </a>
            </div>`;
        }
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
function printSuperReport(reportToPrint, includeMedia) {
  const r = reportToPrint || activeSuperReport;
  if (!r) return;

  if (includeMedia === undefined) {
    const chk = document.getElementById('srdIncludeMediaCheck');
    includeMedia = chk ? chk.checked : true;
  }

  let rawList = [];
  if (r.images) {
    try {
      rawList = typeof r.images === 'string' ? JSON.parse(r.images) : (r.images || []);
    } catch(e) { rawList = []; }
  }
  if (!Array.isArray(rawList)) rawList = [];

  const attachments = rawList.map((p, i) => normalizeAttachment(p, i));
  const imgList = attachments.filter(a => a.type.startsWith('image/') || (!a.type && a.data && a.data.startsWith('data:image')));
  const otherList = attachments.filter(a => !imgList.includes(a));

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

  const imgHtml = imgList.length ? `
    <div style="margin-top:14px">
      <h4 style="border-bottom:1.5px solid #cbd5e1;padding-bottom:6px;color:#1e3a8a;margin-bottom:10px;font-size:14px">📷 الصور الميدانية المرفقة (${imgList.length}):</h4>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${imgList.map(img => `<div style="border:1px solid #cbd5e1;border-radius:8px;padding:4px;background:#fff"><img src="${img.data}" alt="${esc(img.name)}" style="max-width:240px;max-height:180px;border-radius:6px;display:block" /></div>`).join('')}
      </div>
    </div>` : '';

  const otherDocsHtml = otherList.length ? `
    <div style="margin-top:14px">
      <h4 style="border-bottom:1.5px solid #cbd5e1;padding-bottom:6px;color:#1e3a8a;margin-bottom:10px;font-size:14px">📎 المستندات والملفات المرفقة (${otherList.length}):</h4>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;background:#fff">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="width:40px;text-align:center;border:1px solid #cbd5e1;padding:6px">#</th>
            <th style="border:1px solid #cbd5e1;padding:6px">اسم الملف</th>
            <th style="width:130px;text-align:center;border:1px solid #cbd5e1;padding:6px">النوع</th>
            <th style="width:100px;text-align:center;border:1px solid #cbd5e1;padding:6px">الحجم</th>
          </tr>
        </thead>
        <tbody>
          ${otherList.map((doc, idx) => `
            <tr>
              <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${idx + 1}</td>
              <td style="border:1px solid #cbd5e1;padding:6px"><b>${getAttachmentIcon(doc.type, doc.name)} ${esc(doc.name)}</b></td>
              <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${esc(doc.type.split('/')[1] || doc.type)}</td>
              <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${formatBytes(doc.size)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : '';

  const mediaSectionHtml = (imgHtml || otherDocsHtml) ? `
    <div id="printMediaSection" style="margin-top:16px;${includeMedia ? '' : 'display:none;'}">
      ${imgHtml}
      ${otherDocsHtml}
    </div>` : '';

  const printDateStr = new Date().toISOString().slice(0, 10);
  const printedByName = (currentSuperUser && (currentSuperUser.fullName || currentSuperUser.userName)) || 'إدارة المركز الرئيسي';

  const w = window.open('', '_blank', 'width=850,height=950');
  w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>&lrm;</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400;1,700&family=Aref+Ruqaa:wght@400;700&family=Cairo:wght@400;600;700;800;900&display=swap" />
<style>
  @page { size: A4 portrait; margin: 12mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #0f172a; margin: 0; padding: 20px 24px; direction: rtl; font-size: 13.5px; }
  .header-wrap { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; width: 100%; }
  .header-right { flex: 0 0 auto; min-width: 200px; text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 2px; margin: 0; }
  .hdr-line-main { font-family: 'Aref Ruqaa', 'Amiri', 'Traditional Arabic', serif; font-size: 20px; font-weight: 800; color: #0f172a; line-height: 1.35; letter-spacing: 0.5px; text-align: center; width: 100%; margin: 0 auto 3px auto; display: block; }
  .hdr-line-sub { font-size: 13px; font-weight: 700; color: #334155; line-height: 1.4; text-align: center; width: 100%; margin: 0 auto; display: block; }
  .header-center { flex: 1 1 auto; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 12px; margin: 0; }
  .header-center img { max-height: 70px; max-width: 120px; object-fit: contain; margin-top: 2px; display: block; }
  .header-center .basmala { font-family: 'Aref Ruqaa', 'Amiri', 'Traditional Arabic', serif; font-size: 15px; font-weight: 800; color: #0f172a; margin-bottom: 4px; letter-spacing: 0.5px; text-align: center; line-height: 1.25; display: block; }
  .header-left { flex: 0 0 auto; min-width: 160px; text-align: left; font-size: 13px; line-height: 1.8; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; gap: 4px; margin: 0; font-family: 'Cairo', sans-serif; }
  .meta-card { background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 14px 18px; margin-bottom: 18px; }
  .box { background: #fff; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin-bottom: 18px; }
  .box-title { font-weight: 800; font-size: 14px; color: #1e3a8a; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  .details-content { line-height: 2; font-size: 13.5px; white-space: pre-wrap; color: #1e293b; }
  .signatures-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; text-align: center; margin-top: 32px; padding-top: 18px; border-top: 1.5px dashed #cbd5e1; gap: 14px; }
  .sig-title { font-weight: 800; font-size: 13px; color: #0f172a; margin-bottom: 6px; }
  .sig-name { font-size: 12px; color: #64748b; }
  .no-print { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 18px; background: #f1f5f9; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; }
  .no-print button { background: #1e3a8a; color: #fff; border: none; padding: 8px 20px; font-size: 13.5px; font-weight: 800; border-radius: 6px; cursor: pointer; font-family: inherit; }
  @media print {
    body { padding: 0; margin: 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">🖨️ طباعة التقرير</button>
    ${mediaSectionHtml ? `
      <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:700;font-size:13px;color:#1e3a8a;background:#fff;padding:6px 12px;border-radius:6px;border:1px solid #cbd5e1">
        <input type="checkbox" id="toggleMediaCheck" ${includeMedia ? 'checked' : ''} onchange="var sec = document.getElementById('printMediaSection'); if(sec) sec.style.display = this.checked ? 'block' : 'none';" />
        📷 تضمين المرفقات والوسائط في الطباعة
      </label>` : ''}
    <button onclick="window.close()" style="background:#fff;color:#0f172a;border:1px solid #cbd5e1;padding:8px 18px;border-radius:6px;font-size:13.5px;cursor:pointer;margin-right:auto">✕ إغلاق</button>
  </div>

  <div class="header-wrap">
    <div class="header-right">
      ${headerLinesHtml}
    </div>
    <div class="header-center">
      ${showBasmala ? `<div class="basmala">${esc(basmalaText)}</div>` : ''}
      <img src="${logoUrl}" alt="شعار" />
    </div>
    <div class="header-left">
      <div><b>التاريخ:</b> <span>${esc(r.reportDate || printDateStr)}</span></div>
      ${confidential ? `<div style="font-weight:800;color:#dc2626;border:1.5px solid #dc2626;padding:3px 8px;border-radius:6px;font-size:11.5px;margin-top:2px">${esc(confidential)}</div>` : ''}
    </div>
  </div>

  <div class="meta-card">
    <div style="text-align:center;border-bottom:1.5px dashed #cbd5e1;padding-bottom:10px;margin-bottom:14px">
      <span style="font-size:16px;font-weight:900;color:#1e3a8a">📌 موضوع التقرير: </span>
      <span style="font-size:16.5px;font-weight:900;color:#0f172a;text-decoration:underline">${esc(r.subject || 'بدون موضوع')}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13.5px">
      <div><span style="color:#64748b">🔢 رقم التقرير:</span> <b style="color:#1e3a8a;font-family:monospace;font-size:14.5px">#${esc(r.reportNumber || r.id)}</b></div>
      <div><span style="color:#64748b">🏢 الفرع / المؤسسة:</span> <b style="color:#0284c7">${esc(r.orgName || 'فرع')} (${esc(r.orgCode || '')})</b></div>
      <div><span style="color:#64748b">👤 محرر التقرير / الموظف:</span> <b>${esc(r.enteredBy || '—')}</b></div>
      <div><span style="color:#64748b">📍 الجهة المستهدفة / الموقع:</span> <b>${esc(r.target || r.targetSector || r.location || '—')}</b></div>
      <div><span style="color:#64748b">📅 تاريخ التحرير:</span> <b>${esc(r.reportDate || '—')}</b></div>
      <div><span style="color:#64748b">⏰ وقت التحرير:</span> <b>${esc(r.reportTime || '—')}</b></div>
    </div>
  </div>

  <div class="box">
    <div class="box-title">📝 بيان وتفاصيل التقرير:</div>
    <div class="details-content">${esc(r.details || r.notes || 'لا يوجد نص تفصيلي')}</div>
  </div>

  ${mediaSectionHtml}

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

  <div style="margin-top:30px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#64748b">
    <div>👤 طُبع بواسطة: <b>${esc(printedByName)}</b></div>
    <div>📅 تاريخ الطباعة: <b>${esc(printDateStr)}</b></div>
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
        <div class="footer-line">طُبع بواسطة: ${esc(currentSuperUser?.fullName || currentSuperUser?.userName || 'إدارة المركز الرئيسي')} • تاريخ الطباعة: ${new Date().toISOString().slice(0, 10)}</div>
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

let filterSuperReportQueryTimeout = null;
document.addEventListener('DOMContentLoaded', () => {
  const queryInput = document.getElementById('filterSuperReportQuery');
  if (queryInput) {
    queryInput.addEventListener('input', () => {
      clearTimeout(filterSuperReportQueryTimeout);
      filterSuperReportQueryTimeout = setTimeout(() => {
        loadSuperReports();
      }, 350);
    });
  }
});


/* =========================================================
   محرك التحليل والربط الذكي للأحداث في واجهة الإدارة المركزية
   ========================================================= */
let allSmartClusters = [];

async function loadSmartCorrelation() {
  const container = document.getElementById('smartAiClustersContainer');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:40px;color:#db2777;font-weight:700"><span style="font-size:28px">🧠</span><br>جارٍ قراءة وفحص كافة التقارير وربط الأنماط والأهداف المشتركة...</div>';

  try {
    const minScore = document.getElementById('smartAiSensitivity')?.value || '45';
    const days = document.getElementById('smartAiDays')?.value || '30';
    const orgId = document.getElementById('smartAiOrgFilter')?.value || '';

    // تعبئة قائمة الفروع في الفلتر إذا كانت فارغة
    const orgSelect = document.getElementById('smartAiOrgFilter');
    if (orgSelect && orgSelect.options.length <= 1 && allOrgs && allOrgs.length > 0) {
      orgSelect.innerHTML = '<option value="">-- كافة الفروع والمؤسسات --</option>';
      allOrgs.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = `${o.orgName} (${o.orgCode})`;
        orgSelect.appendChild(opt);
      });
      orgSelect.value = orgId;
    }

    const params = new URLSearchParams();
    params.append('minScore', minScore);
    if (days) params.append('days', days);
    if (orgId) params.append('orgId', orgId);

    const res = await api('/super/smart-correlation?' + params.toString());
    const summary = res.summary || {};
    allSmartClusters = res.clusters || [];

    // تحديث بطاقات المؤشرات
    if (document.getElementById('aiKpiTotalReports')) document.getElementById('aiKpiTotalReports').textContent = summary.totalReportsAnalyzed || 0;
    if (document.getElementById('aiKpiTotalClusters')) document.getElementById('aiKpiTotalClusters').textContent = summary.totalClustersFound || 0;
    if (document.getElementById('aiKpiHighPriority')) document.getElementById('aiKpiHighPriority').textContent = summary.highPriorityClusters || 0;
    if (document.getElementById('aiKpiCorrelatedReports')) document.getElementById('aiKpiCorrelatedReports').textContent = summary.totalCorrelatedReports || 0;

    // تحديث شارة التنبيه في القائمة العلوية
    const badge = document.getElementById('smartAiTabBadge');
    if (badge) {
      badge.textContent = allSmartClusters.length;
      badge.style.display = allSmartClusters.length > 0 ? 'inline-block' : 'none';
    }

    renderSmartClusters(allSmartClusters);
  } catch(err) {
    container.innerHTML = `<div style="text-align:center;padding:30px;color:#dc2626">تعذر إكمال التحليل الذكي: ${esc(err.message)}</div>`;
  }
}

function filterRenderedClusters() {
  const q = (document.getElementById('smartAiKeywordFilter')?.value || '').trim().toLowerCase();
  if (!q) {
    renderSmartClusters(allSmartClusters);
    return;
  }
  const filtered = allSmartClusters.filter(c => {
    return c.title.toLowerCase().includes(q) ||
           c.commonTarget.toLowerCase().includes(q) ||
           c.commonLocation.toLowerCase().includes(q) ||
           c.matchedKeywords.some(kw => kw.toLowerCase().includes(q)) ||
           c.involvedOrgs.some(o => o.toLowerCase().includes(q)) ||
           c.involvedUsers.some(u => u.toLowerCase().includes(q));
  });
  renderSmartClusters(filtered);
}

function renderSmartClusters(clusters) {
  const container = document.getElementById('smartAiClustersContainer');
  if (!container) return;

  if (!clusters || clusters.length === 0) {
    container.innerHTML = `
      <div style="background:#fff;border:1.5px dashed #cbd5e1;border-radius:14px;padding:40px 20px;text-align:center">
        <div style="font-size:40px;margin-bottom:10px">🟢</div>
        <h4 style="font-size:16px;font-weight:800;color:#0f172a;margin:0 0 6px">لم يتم رصد أي تكرار أو أحداث متشابهة مشبوهة</h4>
        <p style="font-size:13px;color:#64748b;margin:0">كافة التقارير المرفوعة في هذه الفترة مستقلة ولا يوجد تطابق أو ترابط في الأهداف أو المواقع بنسبة الحساسية المحددة.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = clusters.map((c, idx) => {
    const isHigh = c.severity === 'high';
    const isMed = c.severity === 'medium';
    const borderCol = isHigh ? '#fca5a5' : (isMed ? '#fed7aa' : '#bfdbfe');
    const bgHeader = isHigh ? '#fef2f2' : (isMed ? '#fffbeb' : '#f0f9ff');
    const sevBadge = isHigh
      ? '<span class="badge red" style="font-size:12px;font-weight:800;padding:4px 10px">🚨 تنبيه عالي الأهمية والترابط</span>'
      : (isMed ? '<span class="badge yellow" style="font-size:12px;font-weight:800;padding:4px 10px">⚠️ ارتباط ملحوظ</span>' : '<span class="badge blue" style="font-size:12px;font-weight:800;padding:4px 10px">ℹ️ تقارب معلوماتي</span>');

    const scoreColor = c.score >= 80 ? '#dc2626' : (c.score >= 60 ? '#d97706' : '#2563eb');

    const keywordsBadges = (c.matchedKeywords || []).map(kw => `<span class="badge" style="background:#fff;border:1px solid #cbd5e1;color:#1e293b;font-size:11.5px;padding:2px 8px">🔑 ${esc(kw)}</span>`).join(' ');
    const orgsBadges = (c.involvedOrgs || []).map(o => `<span class="badge blue" style="font-size:11px">🏢 ${esc(o)}</span>`).join(' ');
    const usersBadges = (c.involvedUsers || []).map(u => `<span class="badge purple" style="font-size:11px">👤 ${esc(u)}</span>`).join(' ');
    const reasonsList = (c.reasons || []).map(r => `<li style="margin-bottom:3px">${esc(r)}</li>`).join('');

    const reportsRows = (c.reports || []).map(r => `
      <tr style="border-bottom:1px solid #e2e8f0;background:#fff">
        <td style="padding:10px 12px;font-weight:800;color:#0284c7">${esc(r.orgName || 'فرع')}</td>
        <td style="padding:10px 12px;font-family:monospace;font-weight:800">#${esc(r.reportNumber || r.id)}</td>
        <td style="padding:10px 12px;font-size:12px">${esc(r.reportDate || '')}</td>
        <td style="padding:10px 12px;font-weight:700">${esc(r.subject || 'بدون موضوع')}</td>
        <td style="padding:10px 12px">${esc(r.target || r.targetSector || '—')}</td>
        <td style="padding:10px 12px">${esc(r.location || '—')}</td>
        <td style="padding:10px 12px">👤 ${esc(r.enteredBy || '—')}</td>
        <td style="padding:10px 12px;text-align:center">
          <button class="btn btn-outline btn-xs" onclick="showSuperReportDetail('${esc(r.id)}')" style="padding:3px 8px;font-size:11px">👁️ تفاصيل</button>
        </td>
      </tr>
    `).join('');

    return `
      <div style="background:#fff;border:1.5px solid ${borderCol};border-radius:14px;overflow:hidden;box-shadow:0 3px 12px rgba(0,0,0,0.04)">
        <!-- رأس كرت الحدث المترابط -->
        <div style="background:${bgHeader};padding:14px 18px;border-bottom:1px solid ${borderCol};display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px">${isHigh ? '🔥' : '🔗'}</span>
            <div>
              <div style="font-size:15.5px;font-weight:900;color:#0f172a">${esc(c.title)}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">
                📅 الفترة: <b>${esc(c.firstDate || '—')}</b> إلى <b>${esc(c.lastDate || '—')}</b> • عدد التقارير المترابطة: <b>${c.reportCount}</b> تقارير
              </div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="text-align:center;background:#fff;border:1.5px solid ${borderCol};padding:4px 12px;border-radius:10px">
              <div style="font-size:10.5px;font-weight:800;color:#64748b">نسبة التطابق</div>
              <div style="font-size:16px;font-weight:900;color:${scoreColor}">${c.score}%</div>
            </div>
            ${sevBadge}
          </div>
        </div>

        <!-- ملخص الأدلة والرابط المشترك -->
        <div style="padding:14px 18px;background:#fafcff;border-bottom:1px solid #e2e8f0;display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;font-size:12.5px">
          <div>
            <div style="font-weight:800;color:#1e3a8a;margin-bottom:4px">🎯 الجهة / الشخص المشترك:</div>
            <div style="font-weight:700;color:#0f172a">${esc(c.commonTarget)}</div>
          </div>
          <div>
            <div style="font-weight:800;color:#1e3a8a;margin-bottom:4px">📍 الموقع المشترك / المتقارب:</div>
            <div style="font-weight:700;color:#0f172a">${esc(c.commonLocation)}</div>
          </div>
          <div>
            <div style="font-weight:800;color:#1e3a8a;margin-bottom:4px">🏢 الفروع الراصدة (${c.involvedOrgs.length}):</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap">${orgsBadges}</div>
          </div>
          <div>
            <div style="font-weight:800;color:#1e3a8a;margin-bottom:4px">👥 المستخدمون الراصدون (${c.involvedUsers.length}):</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap">${usersBadges}</div>
          </div>
        </div>

        <!-- الكلمات المفتاحية وأسباب الربط -->
        <div style="padding:12px 18px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:12px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:800;color:#64748b">الكلمات المشتركة:</span>
            ${keywordsBadges}
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-outline btn-xs" onclick="printClusterAnalysis('${c.clusterId}')" style="font-weight:800;padding:4px 12px;color:#1e3a8a;border-color:#1e3a8a">
              🖨️ طباعة تقرير تحليلي لهذا الحدث
            </button>
            <button class="btn btn-outline btn-xs" onclick="toggleClusterAccordion('${c.clusterId}')" id="btnAcc_${c.clusterId}" style="font-weight:800;padding:4px 12px">
              📂 استعراض التقارير (${c.reportCount}) ⬇️
            </button>
          </div>
        </div>

        <!-- جدول التقارير المترابطة (قابل للطي) -->
        <div id="acc_${c.clusterId}" style="display:none;padding:12px 18px;background:#f8fafc">
          <div style="margin-bottom:8px;font-size:12.5px;font-weight:800;color:#334155">
            📋 التقارير الفردية المكونة لهذا الحدث المشترك:
          </div>
          <div class="tbl-wrap" style="background:#fff;border:1px solid #cbd5e1;border-radius:8px">
            <table style="width:100%;border-collapse:collapse;font-size:12.5px;text-align:right">
              <thead>
                <tr style="background:#f1f5f9;border-bottom:1.5px solid #cbd5e1">
                  <th style="padding:8px 12px">الفرع</th>
                  <th style="padding:8px 12px">رقم التقرير</th>
                  <th style="padding:8px 12px">التاريخ</th>
                  <th style="padding:8px 12px">الموضوع</th>
                  <th style="padding:8px 12px">الجهة المستهدفة</th>
                  <th style="padding:8px 12px">الموقع</th>
                  <th style="padding:8px 12px">مدخل التقرير</th>
                  <th style="padding:8px 12px;text-align:center">معاينة</th>
                </tr>
              </thead>
              <tbody>
                ${reportsRows}
              </tbody>
            </table>
          </div>
          <div style="margin-top:10px;padding:8px 12px;background:#fff;border-radius:6px;border:1px solid #e2e8f0;font-size:11.5px;color:#64748b">
            <b>تحليل أسباب الارتباط:</b>
            <ul style="margin:4px 0 0 18px;padding:0">
              ${reasonsList}
            </ul>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleClusterAccordion(clusterId) {
  const el = document.getElementById('acc_' + clusterId);
  const btn = document.getElementById('btnAcc_' + clusterId);
  if (!el) return;
  const isHidden = el.style.display === 'none';
  el.style.display = isHidden ? 'block' : 'none';
  if (btn) {
    btn.textContent = isHidden ? '📂 إخفاء التقارير ⬆️' : '📂 استعراض التقارير ⬇️';
  }
}

// طباعة تقرير تحليلي استخباراتي لحدث مشترك محدد
function printClusterAnalysis(clusterId) {
  const c = allSmartClusters.find(x => x.clusterId === clusterId);
  if (!c) return alert('لم يتم العثور على مجموعة الحدث المحددة.');

  const printDateStr = new Date().toISOString().slice(0, 10);
  const superName = (currentSuperUser && (currentSuperUser.fullName || currentSuperUser.userName)) || 'إدارة المركز الرئيسي';

  const reportsHtml = (c.reports || []).map((r, i) => `
    <div style="border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-bottom:14px;background:#fafcff">
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-bottom:8px">
        <b style="color:#1e3a8a">تقرير #${i + 1} — فرع: ${esc(r.orgName || 'فرع')} (${esc(r.orgCode || '')})</b>
        <span style="font-family:monospace;font-weight:700">رقم التقرير: #${esc(r.reportNumber || r.id)} • ${esc(r.reportDate || '')}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px">
        <tr><th style="width:120px;text-align:right;background:#f1f5f9;padding:4px 8px;border:1px solid #cbd5e1">الموضوع</th><td style="padding:4px 8px;border:1px solid #cbd5e1">${esc(r.subject || '—')}</td><th style="width:100px;text-align:right;background:#f1f5f9;padding:4px 8px;border:1px solid #cbd5e1">مدخل البيانات</th><td style="padding:4px 8px;border:1px solid #cbd5e1">${esc(r.enteredBy || '—')}</td></tr>
        <tr><th style="text-align:right;background:#f1f5f9;padding:4px 8px;border:1px solid #cbd5e1">الجهة المستهدفة</th><td style="padding:4px 8px;border:1px solid #cbd5e1">${esc(r.target || r.targetSector || '—')}</td><th style="text-align:right;background:#f1f5f9;padding:4px 8px;border:1px solid #cbd5e1">الموقع</th><td style="padding:4px 8px;border:1px solid #cbd5e1">${esc(r.location || '—')}</td></tr>
      </table>
      <div style="font-size:12px;background:#fff;padding:8px;border-radius:6px;border:1px solid #e2e8f0;white-space:pre-wrap;line-height:1.7">${esc(r.details || 'لا يوجد نص تفصيلي')}</div>
    </div>
  `).join('');

  const reasonsHtml = (c.reasons || []).map(r => `<li>${esc(r)}</li>`).join('');

  const w = window.open('', '_blank', 'width=900,height=800');
  w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>تقرير تحليلي استخباراتي — ${esc(c.title)}</title>
<style>
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; direction: rtl; font-size: 13px; line-height: 1.6; }
  .header-box { border: 2px solid #0f172a; border-radius: 10px; padding: 18px 22px; margin-bottom: 22px; background: #f8fafc; text-align: center; }
  .header-box h1 { margin: 0 0 6px; font-size: 20px; color: #1e3a8a; }
  .tag-danger { display: inline-block; background: #fee2e2; color: #b91c1c; border: 1px solid #f87171; padding: 3px 12px; border-radius: 12px; font-weight: 800; font-size: 12px; margin-top: 6px; }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; background: #f8fafc; }
  .no-print { text-align: center; margin-bottom: 20px; background: #f1f5f9; padding: 10px; border-radius: 8px; }
  @media print { body { padding: 0; } .no-print { display: none !important; } }
</style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()" style="padding:10px 24px;background:#1e3a8a;color:#fff;border:none;border-radius:6px;font-weight:800;cursor:pointer;font-family:inherit">🖨️ طباعة التقرير التحليلي</button>
    <button onclick="window.close()" style="padding:10px 18px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;margin-right:8px;font-family:inherit">✕ إغلاق</button>
  </div>
  <div class="header-box">
    <h1>📋 تقرير تحليلي استخباراتي — رصد نمط / حدث مترابط</h1>
    <div style="font-size:14px;font-weight:800;color:#0f172a">${esc(c.title)}</div>
    <div><span class="tag-danger">نسبة التطابق الدلالي: ${c.score}% • مستوى الأهمية: ${c.severity === 'high' ? 'عالي / حرج' : 'متوسط'}</span></div>
  </div>
  <div class="summary-grid">
    <div><b>🎯 الهدف / الكيان المشترك:</b> ${esc(c.commonTarget)}</div>
    <div><b>📍 الموقع المشترك:</b> ${esc(c.commonLocation)}</div>
    <div><b>🏢 الفروع المشاركة (${c.involvedOrgs.length}):</b> ${esc(c.involvedOrgs.join(' ، '))}</div>
    <div><b>👥 المستخدمون الراصدون (${c.involvedUsers.length}):</b> ${esc(c.involvedUsers.join(' ، '))}</div>
    <div><b>📅 الفترة الزمنية:</b> من ${esc(c.firstDate || '—')} إلى ${esc(c.lastDate || '—')}</div>
    <div><b>🔢 عدد التقارير المترابطة:</b> ${c.reportCount} تقارير</div>
  </div>
  <div style="background:#fefce8;border:1px solid #fef08a;border-radius:8px;padding:12px;margin-bottom:20px">
    <b>🔍 مبررات وأسباب اكتشاف الربط الذكي:</b>
    <ul style="margin:4px 0 0 20px">${reasonsHtml}</ul>
  </div>
  <h3 style="font-size:15px;color:#1e3a8a;border-bottom:2px solid #cbd5e1;padding-bottom:6px;margin-bottom:14px">📑 تفاصيل التقارير الفردية المترابطة بالحدث:</h3>
  ${reportsHtml}
  <div style="margin-top:30px;border-top:1px solid #cbd5e1;padding-top:10px;display:flex;justify-content:space-between;font-size:12px;color:#64748b">
    <span>👤 معد التقرير التحليلي: <b>${esc(superName)}</b></span>
    <span>📅 تاريخ الاستخراج: <b>${esc(printDateStr)}</b></span>
  </div>
</body>
</html>`);
  w.document.close();
}

// طباعة إجمالية لكافة الأحداث المترابطة
function printAllCorrelationAnalysis() {
  if (!allSmartClusters || allSmartClusters.length === 0) {
    return alert('لا توجد مجموعات أحداث مترابطة لطباعتها.');
  }

  const printDateStr = new Date().toISOString().slice(0, 10);
  const superName = (currentSuperUser && (currentSuperUser.fullName || currentSuperUser.userName)) || 'إدارة المركز الرئيسي';

  const clustersHtml = allSmartClusters.map((c, idx) => `
    <div style="border:1.5px solid #0f172a;border-radius:8px;padding:16px;margin-bottom:24px;background:#fff;page-break-inside:avoid">
      <div style="display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:8px;margin-bottom:10px">
        <b style="font-size:15px;color:#1e3a8a">نمط #${idx + 1}: ${esc(c.title)}</b>
        <span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:6px;font-weight:800">تطابق: ${c.score}%</span>
      </div>
      <div style="font-size:12.5px;line-height:1.8;margin-bottom:10px">
        <div><b>🎯 الهدف المشترك:</b> ${esc(c.commonTarget)} • <b>📍 الموقع:</b> ${esc(c.commonLocation)}</div>
        <div><b>🏢 الفروع:</b> ${esc(c.involvedOrgs.join(' ، '))} • <b>👥 الراصدون:</b> ${esc(c.involvedUsers.join(' ، '))}</div>
        <div><b>🔢 عدد التقارير المترابطة:</b> ${c.reportCount} تقارير • <b>📅 الفترة:</b> ${esc(c.firstDate || '—')} إلى ${esc(c.lastDate || '—')}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="border:1px solid #cbd5e1;padding:6px">الفرع</th>
            <th style="border:1px solid #cbd5e1;padding:6px">رقم التقرير</th>
            <th style="border:1px solid #cbd5e1;padding:6px">التاريخ</th>
            <th style="border:1px solid #cbd5e1;padding:6px">الموضوع</th>
            <th style="border:1px solid #cbd5e1;padding:6px">مدخل البيانات</th>
          </tr>
        </thead>
        <tbody>
          ${(c.reports || []).map(r => `
            <tr>
              <td style="border:1px solid #cbd5e1;padding:6px">${esc(r.orgName || '')}</td>
              <td style="border:1px solid #cbd5e1;padding:6px">#${esc(r.reportNumber || r.id)}</td>
              <td style="border:1px solid #cbd5e1;padding:6px">${esc(r.reportDate || '')}</td>
              <td style="border:1px solid #cbd5e1;padding:6px">${esc(r.subject || '')}</td>
              <td style="border:1px solid #cbd5e1;padding:6px">${esc(r.enteredBy || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('');

  const w = window.open('', '_blank', 'width=950,height=850');
  w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>كشف الأحداث والأنماط المترابطة الشامل</title>
<style>
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; direction: rtl; font-size: 13px; }
  .cover { border: 2px solid #0f172a; border-radius: 10px; padding: 18px 24px; margin-bottom: 24px; background: #f8fafc; text-align: center; }
  @media print { body { padding: 0; } .no-print { display: none !important; } }
</style>
</head>
<body>
  <div class="no-print" style="text-align:center;margin-bottom:20px">
    <button onclick="window.print()" style="padding:10px 24px;background:#1e3a8a;color:#fff;border:none;border-radius:6px;font-weight:800;cursor:pointer;font-family:inherit">🖨️ طباعة الكشف الشامل</button>
    <button onclick="window.close()" style="padding:10px 18px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;margin-right:8px;font-family:inherit">✕ إغلاق</button>
  </div>
  <div class="cover">
    <h1 style="margin:0 0 6px;color:#1e3a8a;font-size:20px">📋 الكشف الشامل للتحليل والربط الذكي للأحداث والأنماط</h1>
    <div style="font-size:13px;color:#64748b">إجمالي الأنماط المترابطة المكتشفة: <b>${allSmartClusters.length}</b> نمط • تاريخ الاستخراج: <b>${esc(printDateStr)}</b></div>
  </div>
  ${clustersHtml}
  <div style="margin-top:24px;border-top:1px solid #cbd5e1;padding-top:10px;display:flex;justify-content:space-between;font-size:12px;color:#64748b">
    <span>👤 الإدارة المركزية: <b>${esc(superName)}</b></span>
    <span>📅 تاريخ الطباعة: <b>${esc(printDateStr)}</b></span>
  </div>
</body>
</html>`);
  w.document.close();
}
