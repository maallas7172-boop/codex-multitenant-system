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
  document.getElementById('addOrgModal').style.display = 'flex';
}
function closeAddOrgModal() {
  document.getElementById('addOrgModal').style.display = 'none';
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
