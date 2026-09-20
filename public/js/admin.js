/* =========================================================
   admin.js — لوحة مدير النظام (الواجهة الكاملة)
   ========================================================= */
(async function () {
  let me = null;
  try { me = await currentMe(); } catch (e) { location.replace('login.html'); return; }
  const u = me.user;
  const org = me.organization;
  if (org) {
    if (document.getElementById('orgBrandTitle')) document.getElementById('orgBrandTitle').textContent = org.orgName || 'إدارة المنظومة';
    if (document.getElementById('orgBrandSubtitle')) document.getElementById('orgBrandSubtitle').textContent = 'رمز الجهة: ' + (org.orgCode || '');
    if (document.getElementById('orgBadgeText')) document.getElementById('orgBadgeText').textContent = org.orgName + ' (' + org.orgCode + ')';
  }
  const canAccessAdmin = u.role === 'Admin' || u.canDash || u.canReports || u.canUsers || u.canSettings;
  if (!canAccessAdmin) {
    location.href = 'entry.html';
    return;
  }
  if (me.settings && me.settings.reportHeaderConfig && typeof updateReportHeaderConfig === 'function') {
    updateReportHeaderConfig(me.settings.reportHeaderConfig);
  }

  const $ = id => document.getElementById(id);
  const PRINTS = ['printView', 'printFrame'];
  $('adminName').textContent = u.fullName + (u.role === 'Admin' ? ' (مدير)' : '');

  // إظهار أو إخفاء أزرار التبويب حسب الصلاحيات الممنوحة من المدير
  const navDash = document.querySelector('.nav-btn[data-page="dash"]');
  const navReports = document.querySelector('.nav-btn[data-page="reports"]');
  const navEvents = document.querySelector('.nav-btn[data-page="events"]');
  const navUsers = document.querySelector('.nav-btn[data-page="users"]');
  const navSettings = document.querySelector('.nav-btn[data-page="settings"]');

  if (navDash) navDash.style.display = (u.role === 'Admin' || u.canDash) ? 'flex' : 'none';
  if (navReports) navReports.style.display = (u.role === 'Admin' || u.canReports) ? 'flex' : 'none';
  if (navEvents) navEvents.style.display = (u.role === 'Admin' || u.canEvents) ? 'flex' : 'none';
  if (navUsers) navUsers.style.display = (u.role === 'Admin' || u.canUsers) ? 'flex' : 'none';
  if (navSettings) navSettings.style.display = (u.role === 'Admin' || u.canSettings) ? 'flex' : 'none';

  /* ---------- التنقل ---------- */
  const NAVS = {
    dash: 'dashPage', reports: 'reportsPage',
    events: 'eventsPage',
    users: 'usersPage', settings: 'settingsPage'
  };
  const PERMS = {
    dash: u.role === 'Admin' || u.canDash,
    reports: u.role === 'Admin' || u.canReports,
    events: u.role === 'Admin' || u.canEvents,
    users: u.role === 'Admin' || u.canUsers,
    settings: u.role === 'Admin' || u.canSettings
  };

  document.querySelectorAll('.nav-btn[data-page]').forEach(b => {
    b.onclick = () => {
      const pageKey = b.dataset.page;
      if (!PERMS[pageKey]) {
        toast('ليس لديك صلاحية الوصول لهذا القسم', 'err');
        return;
      }
      document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      Object.values(NAVS).forEach(p => { if ($(p)) $(p).classList.remove('active'); });
      if ($(NAVS[pageKey])) $(NAVS[pageKey]).classList.add('active');
      if (pageKey === 'dash') renderDash();
      if (pageKey === 'reports') renderReports();
      if (pageKey === 'events') renderEvents();
      if (pageKey === 'users') renderUsers();
      if (pageKey === 'settings') renderSettings();
    };
  });

  // تفعيل أول صفحة مصرح للمستخدم بفتحها
  const hashPage = (location.hash || '').replace('#', '');
  if (hashPage && NAVS[hashPage] && PERMS[hashPage]) {
    const target = document.querySelector('.nav-btn[data-page="' + hashPage + '"]');
    if (target) target.click();
  } else {
    const firstAllowed = Object.keys(PERMS).find(k => PERMS[k]);
    if (firstAllowed) {
      const target = document.querySelector('.nav-btn[data-page="' + firstAllowed + '"]');
      if (target) target.click();
    }
  }

  /* ================= لوحة التحكم ================= */
  let dashStatsData = null;
  async function renderDash() {
    try {
      const s = await api('/stats');
      dashStatsData = s;
      updateDashUI(s);
    } catch (err) { toast(err.message, 'err'); }
  }

  function updateDashUI(s) {
    if (!s) return;
    const pendingCount = s.devicesPending || 0;

    // تحديث بانر إشعار الأجهزة المعلقة في لوحة التحكم
    const banner = $('dashPendingDevicesBanner');
    if (banner) {
      if (pendingCount > 0) {
        banner.style.display = 'block';
        if ($('dashBannerPendingCount')) $('dashBannerPendingCount').textContent = pendingCount;
      } else {
        banner.style.display = 'none';
      }
    }
    const appAllBannerBtn = $('dashBannerApproveAllBtn');
    if (appAllBannerBtn && !appAllBannerBtn._bound) {
      appAllBannerBtn._bound = true;
      appAllBannerBtn.onclick = async () => {
        try {
          const res = await api('/devices/approve-all', { method: 'POST' });
          toast(res.message || 'تم اعتماد وتفعيل كافة الأجهزة بنجاح ✔');
          renderDash();
          renderDevices();
        } catch(e) { toast(e.message, 'err'); }
      };
    }
    const viewDevBannerBtn = $('dashBannerViewDevicesBtn');
    if (viewDevBannerBtn && !viewDevBannerBtn._bound) {
      viewDevBannerBtn._bound = true;
      viewDevBannerBtn.onclick = () => {
        const usersBtn = document.querySelector('.nav-btn[data-page="users"]');
        if (usersBtn) usersBtn.click();
        setTimeout(() => {
          const devEl = $('devicesTableBody');
          if (devEl) devEl.scrollIntoView({ behavior: 'smooth' });
        }, 300);
      };
    }

    // تحديث شارة التنبيه في القائمة الجانبية
    const sideBadge = $('sideDevicesBadge');
    if (sideBadge) {
      sideBadge.textContent = pendingCount;
      sideBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
    }

    const kpis = [
      { l: 'إجمالي التقارير', v: s.reportsTotal, h: 'في قاعدة البيانات', c: 'blue', i: '📄' },
      { l: 'تقارير اليوم', v: s.reportsToday, h: 'بتاريخ ' + todayStr(), c: 'green', i: '📅' },
      { l: 'المستخدمون', v: s.usersTotal, h: s.usersActive + ' نشط', c: 'blue', i: '👥' },
      { l: 'الهواتف المعتمدة', v: s.devicesApproved || 0, h: (pendingCount ? '⚠️ ' + pendingCount + ' بانتظار الاعتماد' : 'كافة الهواتف مصرحة'), c: (pendingCount ? 'warn' : 'green'), i: '📱' }
    ];
    if ($('kpiGrid')) {
      $('kpiGrid').innerHTML = kpis.map(k => `
        <div class="kpi ${k.c}" style="cursor:pointer" onclick="${k.i === '📱' ? 'document.querySelector(\'.nav-btn[data-page=users]\').click()' : ''}">
          <div class="lbl">${k.i} ${k.l}</div>
          <div class="val">${k.v}</div>
          <div class="hint">${k.h}</div>
        </div>`).join('');
    }

    // توزيع تقييم التقارير
    const maxR = Math.max(...(s.reportsByRating || []).map(x => x.v), 1);
    if ($('ratingDist')) {
      $('ratingDist').innerHTML = (s.reportsByRating || []).map(x => `
        <div class="mini-item">
          <span class="k">${x.k}</span>
          <div style="flex:1;max-width:140px"><div class="bar-track"><div class="bar-fill" style="width:${(x.v / maxR * 100).toFixed(0)}%"></div></div></div>
          <span class="v">${x.v}</span>
        </div>`).join('');
    }

    // تقارير لكل مستخدم
    const maxU = Math.max(...(s.reportsPerUser || []).map(x => x.v), 1);
    if ($('perUserDist')) {
      $('perUserDist').innerHTML = (s.reportsPerUser && s.reportsPerUser.length) ? s.reportsPerUser.map(x => `
        <div class="mini-item">
          <span class="k">👤 ${esc(x.k)}</span>
          <div style="flex:1;max-width:140px"><div class="bar-track"><div class="bar-fill" style="width:${(x.v / maxU * 100).toFixed(0)}%;background:linear-gradient(90deg,var(--secondary),#2bb3a6)"></div></div></div>
          <span class="v">${x.v}</span>
        </div>`).join('') : '<div class="empty">لا توجد بيانات</div>';
    }

    // أحدث التقارير مع فك التشفير وتطبيق فلتر البحث
    const searchVal = $('dashSearch') ? $('dashSearch').value.trim().toLowerCase() : '';
    let recReports = (s.recentReports || []).map(r => (typeof decryptReportData === 'function' ? decryptReportData(r) : r));
    if (searchVal) {
      recReports = recReports.filter(r =>
        (r.reportNumber || '').toLowerCase().includes(searchVal) ||
        (r.subject || '').toLowerCase().includes(searchVal) ||
        (r.enteredBy || '').toLowerCase().includes(searchVal) ||
        (r.target || '').toLowerCase().includes(searchVal)
      );
    }
    if ($('latestReports')) {
      $('latestReports').innerHTML = recReports.length ? recReports.map(r => {
        const encBadge = r._wasEncrypted || r.isEncrypted ? ' <span style="color:#10b981;font-size:12px" title="مشفر E2EE">🔒</span>' : '';
        return `
        <tr>
          <td><b>${esc(r.reportNumber)}</b>${encBadge}</td>
          <td class="det">${esc(r.subject)}</td>
          <td>${esc(r.enteredBy || '—')}</td>
          <td>${esc(r.reportDate)}</td>
          <td>${badgeStatus(r.rating || 'بدون تصنيف')}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="5" class="empty">لا توجد تقارير مطابقة</td></tr>';
    }
  }
  if ($('dashSearch')) $('dashSearch').oninput = () => updateDashUI(dashStatsData);

  /* ================= التقارير ================= */
  let currentReports = [];
  const RATING_OPTS = ['مهم جدا', 'مهم', 'متوسط', 'عادي', 'غير مهم'];
  const canDeleteReports = u.role === 'Admin' || !!u.canDelete || !!u.canReportsDelete;
  const canPrintReports = u.role === 'Admin' || !!u.canPrint || !!u.canReportsPrint;

  function updateBatchDeleteUI() {
    const chks = Array.from(document.querySelectorAll('.report-select-chk:checked'));
    const count = chks.length;
    if ($('selectedReportsCount')) $('selectedReportsCount').textContent = count;
    if ($('btnBatchDeleteReports')) {
      $('btnBatchDeleteReports').style.display = (canDeleteReports && count > 0) ? 'inline-flex' : 'none';
    }
    if ($('selectAllReportsChk')) {
      const allChks = document.querySelectorAll('.report-select-chk');
      $('selectAllReportsChk').checked = (allChks.length > 0 && count === allChks.length);
    }
  }

  // ربط زر الحذف الجماعي للتقارير
  if ($('btnBatchDeleteReports') && !$('btnBatchDeleteReports')._bound) {
    $('btnBatchDeleteReports')._bound = true;
    $('btnBatchDeleteReports').onclick = async () => {
      const selected = Array.from(document.querySelectorAll('.report-select-chk:checked')).map(c => c.dataset.id);
      if (!selected.length) return;
      if (!confirm(`⚠️ تحذير: هل أنت متأكد من حذف (${selected.length}) تقرير محدد نهائياً من قاعدة البيانات؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
      try {
        const res = await api('/reports/batch-delete', {
          method: 'POST',
          body: JSON.stringify({ ids: selected })
        });
        toast(res.message || 'تم حذف التقارير المحددة بنجاح ✔');
        renderReports();
        if (typeof renderDash === 'function') renderDash();
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  async function renderReports() {
    const q = {};
    const from = $('rFrom').value, to = $('rTo').value, uId = $('rUser').value, rt = $('rRating').value;
    if (from) q.from = from; if (to) q.to = to;
    if (uId) q.userId = uId; if (rt) q.rating = rt;

    // إظهار أو إخفاء عمود التحديد بناءً على صلاحية الحذف
    if ($('thSelectAllReports')) {
      $('thSelectAllReports').style.display = canDeleteReports ? 'table-cell' : 'none';
    }
    if ($('selectAllReportsChk')) $('selectAllReportsChk').checked = false;
    updateBatchDeleteUI();

    try {
      const d = await api('/reports?' + new URLSearchParams(q));
      currentReports = (d.reports || []).map(r => (typeof decryptReportData === 'function' ? decryptReportData(r) : r));
      const searchVal = $('rSearch') ? $('rSearch').value.trim().toLowerCase() : '';
      if (searchVal) {
        currentReports = currentReports.filter(r =>
          (r.reportNumber || '').toLowerCase().includes(searchVal) ||
          (r.subject || '').toLowerCase().includes(searchVal) ||
          (r.target || '').toLowerCase().includes(searchVal) ||
          (r.details || '').toLowerCase().includes(searchVal) ||
          (r.location || '').toLowerCase().includes(searchVal) ||
          (r.enteredBy || '').toLowerCase().includes(searchVal)
        );
      }
      $('repCount').textContent = 'عدد التقارير: ' + currentReports.length;
      $('reportsTableBody').innerHTML = currentReports.length ? currentReports.map(r => {
        const chkCell = canDeleteReports
          ? `<td style="text-align:center"><input type="checkbox" class="report-select-chk" data-id="${r.id}" style="cursor:pointer;width:16px;height:16px" /></td>`
          : '';
        const delBtn = canDeleteReports
          ? `<button class="btn btn-danger btn-xs" data-del="${r.id}" title="حذف هذا التقرير نهائياً">🗑️ حذف</button>`
          : '';
        const encBadge = r._wasEncrypted || r.isEncrypted
          ? `<span class="badge green" style="font-size:10.5px;padding:2px 6px;margin-right:4px" title="هذا التقرير مشفر ومحمي بتقنية E2EE">🔒 مشفر</span>`
          : '';

        return `<tr>
          ${chkCell}
          <td><b>${esc(r.reportNumber)}</b> ${encBadge}</td>
          <td class="det" style="min-width:200px">${esc(r.subject)}</td>
          <td>${esc(r.target || '—')}</td>
          <td>${esc(r.reportDate)}</td>
          <td>
            <select class="rating-select" data-id="${r.id}" style="width:auto;padding:6px 10px;font-size:12.5px;border-radius:9px" title="تقييم التقرير (خاص بالمدير)">
              <option value="">بدون تقييم</option>
              ${RATING_OPTS.map(o => `<option ${r.rating === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </td>
          <td>${r.imageCount > 0 ? `<span class="badge blue">📎 ${r.imageCount}</span>` : '<span class="badge gray">—</span>'}</td>
          <td>
            <div class="btn-row" style="gap:6px">
              <button class="btn btn-outline btn-xs" data-view="${r.id}">👁 عرض</button>
              <button class="btn btn-primary btn-xs" data-print="${r.id}">🖨 طباعة</button>
              ${delBtn}
            </div>
          </td>
        </tr>`;
      }).join('') : `<tr><td colspan="${canDeleteReports ? 8 : 7}" class="empty"><span class="ic">📄</span>لا توجد تقارير مطابقة للتصفية</td></tr>`;

      bindRatingSelects();
      bindReportActions();
      bindSelectionEvents();
    } catch (err) { toast(err.message, 'err'); }
  }
  if ($('rSearch')) $('rSearch').oninput = () => renderReports();

  function bindRatingSelects() {
    document.querySelectorAll('.rating-select').forEach(sel => {
      sel.onchange = async () => {
        try {
          await api('/reports/' + sel.dataset.id + '/rating', {
            method: 'PUT', body: JSON.stringify({ rating: sel.value })
          });
          toast('تم تحديث تقييم التقرير ✔');
        } catch (err) { toast(err.message, 'err'); renderReports(); }
      };
    });
  }

  function bindSelectionEvents() {
    document.querySelectorAll('.report-select-chk').forEach(chk => {
      chk.onchange = updateBatchDeleteUI;
    });
    if ($('selectAllReportsChk') && !$('selectAllReportsChk')._bound) {
      $('selectAllReportsChk')._bound = true;
      $('selectAllReportsChk').onchange = function() {
        const isChecked = this.checked;
        document.querySelectorAll('.report-select-chk').forEach(c => c.checked = isChecked);
        updateBatchDeleteUI();
      };
    }
  }

  function bindReportActions() {
    document.querySelectorAll('[data-view]').forEach(b => {
      b.onclick = () => showReportDetail(currentReports.find(r => r.id === b.dataset.view));
    });
    document.querySelectorAll('[data-print]').forEach(b => {
      b.onclick = () => printReport(currentReports.find(r => r.id === b.dataset.print));
    });
    document.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        const r = currentReports.find(x => x.id === b.dataset.del);
        if (!r) return;
        if (!confirm(`هل أنت متأكد من حذف التقرير رقم «${r.reportNumber}» (${r.subject}) نهائياً من النظام؟`)) return;
        try {
          const res = await api('/reports/' + r.id, { method: 'DELETE' });
          toast(res.message || 'تم حذف التقرير بنجاح ✔');
          renderReports();
          if (typeof renderDash === 'function') renderDash();
        } catch (err) { toast(err.message, 'err'); }
      };
    });
  }

  /* نافذة تفاصيل التقرير */
  function showReportDetail(r) {
    if (!r) return;
    const headerHtml = typeof renderReportHeaderHTML === 'function' ? renderReportHeaderHTML(r) : '';
    const rawImages = (r.images && Array.isArray(r.images)) ? r.images : [];
    const attachments = rawImages.map(normalizeAttachment);

    let attHtml = '';
    if (attachments.length) {
      attHtml = `
        <h3 style="margin:20px 0 12px;font-size:15px;display:flex;align-items:center;gap:6px">
          <span>📎 المرفقات والوسائط المتعددة (${attachments.length})</span>
        </h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:14px">
          ${attachments.map((att, idx) => {
            const isImg = att.type.startsWith('image/');
            const isVid = att.type.startsWith('video/');
            const isAud = att.type.startsWith('audio/');
            const icon = getAttachmentIcon(att.type, att.name);
            const sizeStr = formatBytes(att.size);

            if (isImg) {
              return `
                <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#f8fafc;display:flex;flex-direction:column">
                  <a href="${att.data}" target="_blank" download="${esc(att.name)}" style="display:block;height:120px;overflow:hidden;background:#000" title="اضغط للتكبير أو التنزيل">
                    <img src="${att.data}" alt="${esc(att.name)}" style="width:100%;height:100%;object-fit:cover" />
                  </a>
                  <div style="padding:8px 10px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;background:#fff">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;max-width:110px" title="${esc(att.name)}">${esc(att.name)}</span>
                    <a href="${att.data}" download="${esc(att.name)}" class="btn btn-outline btn-xs" style="padding:2px 8px;font-size:11px" title="تنزيل">⬇️</a>
                  </div>
                </div>`;
            } else if (isVid) {
              return `
                <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#0f172a;color:#fff;display:flex;flex-direction:column">
                  <video src="${att.data}" controls style="width:100%;height:120px;background:#000;object-fit:contain"></video>
                  <div style="padding:8px 10px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;background:#1e293b">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;max-width:110px" title="${esc(att.name)}">🎬 ${esc(att.name)}</span>
                    <a href="${att.data}" download="${esc(att.name)}" class="btn btn-primary btn-xs" style="padding:2px 8px;font-size:11px" title="تنزيل الفيديو">⬇️</a>
                  </div>
                </div>`;
            } else if (isAud) {
              return `
                <div style="border:1px solid var(--line);border-radius:10px;padding:10px;background:#f8fafc;display:flex;flex-direction:column;gap:8px">
                  <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px">
                    <span style="font-size:18px">🎵</span>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px" title="${esc(att.name)}">${esc(att.name)}</span>
                  </div>
                  <audio src="${att.data}" controls style="width:100%;height:32px"></audio>
                  <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted)">
                    <span>${sizeStr}</span>
                    <a href="${att.data}" download="${esc(att.name)}" class="btn btn-outline btn-xs" style="padding:2px 8px;font-size:11px">⬇️ تنزيل</a>
                  </div>
                </div>`;
            } else {
              return `
                <div style="border:1px solid var(--line);border-radius:10px;padding:12px;background:#ffffff;display:flex;flex-direction:column;justify-content:space-between;gap:10px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
                  <div style="display:flex;align-items:flex-start;gap:10px">
                    <span style="font-size:28px;line-height:1">${icon}</span>
                    <div style="flex:1;overflow:hidden">
                      <div style="font-size:12.5px;font-weight:800;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(att.name)}">${esc(att.name)}</div>
                      <div style="font-size:11px;color:var(--muted);margin-top:2px">${sizeStr}</div>
                    </div>
                  </div>
                  <a href="${att.data}" download="${esc(att.name)}" class="btn btn-outline btn-sm" style="width:100%;justify-content:center;font-size:12px;gap:6px">
                    <span>⬇️ تنزيل الملف</span>
                  </a>
                </div>`;
            }
          }).join('')}
        </div>`;
    }

    const secNotice = (r._wasEncrypted || r.isEncrypted) ? `
      <div style="background:#ecfdf5;border:1px solid #10b981;color:#065f46;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12.5px;display:flex;align-items:center;gap:8px">
        <span style="font-size:16px">🔒</span>
        <span><b>تم استلام هذا التقرير مشفراً بنجاح (E2EE):</b> تم فك التشفير وعرض المحتوى الأصلي بأمان على جهاز المدير.</span>
      </div>` : '';

    $('mDetailBody').innerHTML = `
      ${headerHtml}
      ${secNotice}
      <table class="recent-table" style="margin-bottom:6px">
        <tr><th style="width:180px">رقم التقرير</th><td><b>${esc(r.reportNumber || '—')}</b></td></tr>
        <tr><th>موضوع التقرير</th><td><b>${esc(r.subject || '—')}</b></td></tr>
        <tr><th>الجهة / الشخص</th><td>${esc(r.target || '—')}</td></tr>
        <tr><th>المكان</th><td>${esc(r.location || '—')}</td></tr>
        <tr><th>التاريخ والوقت</th><td>${esc(r.reportDate || '—')} ${r.reportTime ? '— ' + esc(r.reportTime) : ''}</td></tr>
        <tr><th>تقييم التقرير</th><td>${badgeStatus(r.rating || 'غير مقيم')}</td></tr>
      </table>
      <h3 style="margin:18px 0 10px;font-size:15px">التقرير التفصيلي</h3>
      <div style="background:var(--surface-soft);border:1px solid var(--line);border-radius:var(--r-md);padding:16px;line-height:2;white-space:pre-wrap">${esc(r.details || '—')}</div>
      ${attHtml}
      <div style="font-size:12px;color:var(--muted);margin-top:14px;border-top:1px dashed var(--line);padding-top:10px">
        مُدخل التقرير: <b>${esc(r.enteredBy || '—')}</b>
      </div>
    `;
    $('modal').classList.add('show');
    if ($('mDeleteBtn')) {
      $('mDeleteBtn').style.display = canDeleteReports ? 'inline-block' : 'none';
      $('mDeleteBtn').onclick = async () => {
        if (!confirm(`هل أنت متأكد من حذف التقرير رقم «${r.reportNumber}» (${r.subject}) نهائياً من النظام؟`)) return;
        try {
          const res = await api('/reports/' + r.id, { method: 'DELETE' });
          toast(res.message || 'تم حذف التقرير بنجاح ✔');
          $('modal').classList.remove('show');
          renderReports();
          if (typeof renderDash === 'function') renderDash();
        } catch (err) { toast(err.message, 'err'); }
      };
    }
    $('mPrintBtn').onclick = () => { $('modal').classList.remove('show'); printReport(r); };
    $('mCloseBtn').onclick = () => $('modal').classList.remove('show');
  }

  /* طباعة التقرير */
  function printReport(r) {
    if (!r) return;
    const headerHtml = typeof renderReportHeaderHTML === 'function' ? renderReportHeaderHTML(r) : `<div style="font-size:20px;font-weight:900;color:#1f6feb;border-bottom:2px solid #1f6feb;padding-bottom:10px;margin-bottom:20px">تقرير ${esc(r.reportNumber)}</div>`;
    const headerCss = typeof getReportHeaderCSS === 'function' ? getReportHeaderCSS() : '';
    const rawImages = (r.images && Array.isArray(r.images)) ? r.images : [];
    const attachments = rawImages.map(normalizeAttachment);
    const imgList = attachments.filter(a => a.type.startsWith('image/'));
    const otherList = attachments.filter(a => !a.type.startsWith('image/'));

    const imgHtml = imgList.length ? `
      <h3 style="font-size:15px;margin:16px 0 8px">الصور المرفقة (${imgList.length})</h3>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        ${imgList.map(img => `<img src="${img.data}" alt="${esc(img.name)}" style="max-width:100%;max-height:260px;border-radius:8px;border:1px solid #ccc;margin:4px" />`).join('')}
      </div>` : '';

    const otherDocsHtml = otherList.length ? `
      <h3 style="font-size:15px;margin:16px 0 8px">المستندات والملفات المرفقة (${otherList.length})</h3>
      <table style="width:100%;margin-bottom:14px;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="width:40px;text-align:center;border:1px solid #cbd5e1;padding:6px">#</th>
            <th style="border:1px solid #cbd5e1;padding:6px">اسم الملف</th>
            <th style="width:120px;text-align:center;border:1px solid #cbd5e1;padding:6px">نوع الملف</th>
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
      </table>` : '';

    const attSummaryHtml = attachments.length ? (imgHtml + otherDocsHtml) : '<p style="color:#888;font-size:13px">لا توجد مرفقات مع هذا التقرير</p>';

    const w = window.open('', '_blank', 'width=900,height=700');
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>تقرير ${esc(r.reportNumber)}</title>
<style>
  body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1a2233;margin:0;padding:32px;background:#fff}
  ${headerCss}
  table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px}
  th{background:#f2f6fc;text-align:right;padding:10px 12px;border:1px solid #dbe4f0;width:170px;font-size:13px}
  td{padding:10px 12px;border:1px solid #dbe4f0}
  .det{background:#fafcff;border:1px solid #dbe4f0;border-radius:8px;padding:16px;line-height:2;white-space:pre-wrap;margin-bottom:18px}
  .foot{margin-top:34px;border-top:1px solid #ccc;padding-top:12px;font-size:12px;color:#888;display:flex;justify-content:space-between}
  @media print{body{padding:0}.no-print{display:none!important}}
</style></head><body>
  ${headerHtml}
  <table>
    <tr><th>رقم التقرير</th><td>${esc(r.reportNumber)}</td><th>تاريخ التقرير</th><td>${esc(r.reportDate || '—')}</td></tr>
    <tr><th>الوقت</th><td>${esc(r.reportTime || '—')}</td><th>المكان</th><td>${esc(r.location || '—')}</td></tr>
    <tr><th>الجهة / الشخص</th><td colspan="3">${esc(r.target || '—')}</td></tr>
    <tr><th>موضوع التقرير</th><td colspan="3"><b>${esc(r.subject)}</b></td></tr>
    <tr><th>تقييم التقرير</th><td colspan="3">${esc(r.rating || 'غير مقيم')}</td></tr>
  </table>
  <h3 style="font-size:15px;margin-bottom:8px">التقرير التفصيلي</h3>
  <div class="det">${esc(r.details || '—')}</div>
  ${attSummaryHtml}
  ${typeof renderReportSignaturesHTML === 'function' ? renderReportSignaturesHTML() : ''}
  <div class="foot"><span>نظام إدارة التقارير • مُدخل التقرير: ${esc(r.enteredBy || '—')}</span><span>طُبع بتاريخ ${fmtDateTime(new Date().toISOString())}</span></div>
  <div class="no-print" style="text-align:center;margin-top:22px"><button onclick="window.print()" style="padding:10px 26px;background:#1f6feb;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">🖨 طباعة</button></div>
</body></html>`);
    w.document.close();
  }

  /* ================= طباعة وتصدير التقارير (إجمالي / تفصيلي / Word / PDF) ================= */

  /* فتح نافذة خيارات الطباعة */
  if ($('openPrintChoiceBtn')) {
    $('openPrintChoiceBtn').onclick = () => {
      if (!currentReports.length) { toast('لا توجد تقارير مطابقة في القائمة للطباعة', 'err'); return; }
      if ($('printModalCount')) $('printModalCount').textContent = currentReports.length;
      if ($('printModalBack')) $('printModalBack').classList.add('show');
    };
  }
  if ($('pCloseBtn')) {
    $('pCloseBtn').onclick = () => {
      if ($('printModalBack')) $('printModalBack').classList.remove('show');
    };
  }

  /* 1. طباعة إجمالية (كشف ملخص بجدول منظم) */
  function printReportsSummary() {
    if (!currentReports.length) { toast('لا توجد تقارير للطباعة', 'err'); return; }
    const headerHtml = typeof renderReportHeaderHTML === 'function' ? renderReportHeaderHTML({ reportDate: todayStr() }) : '';
    const headerCss = typeof getReportHeaderCSS === 'function' ? getReportHeaderCSS() : '';
    const rows = currentReports.map(r => `
      <tr>
        <td style="text-align:center"><b>${esc(r.reportNumber)}</b></td>
        <td><b>${esc(r.subject)}</b></td>
        <td>${esc(r.target || '—')}</td>
        <td>${esc(r.location || '—')}</td>
        <td style="text-align:center">${esc(r.reportDate || '—')}</td>
        <td style="text-align:center">${esc(r.reportTime || '—')}</td>
        <td style="text-align:center">${esc(r.rating || 'بدون تقييم')}</td>
        <td style="text-align:center">${r.images && r.images.length ? '📎 ' + r.images.length : '—'}</td>
        <td>${esc(r.enteredBy || '—')}</td>
      </tr>`).join('');

    const w = window.open('', '_blank', 'width=1000,height=750');
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>كشف إجمالي التقارير</title>
<style>
  body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1e293b;margin:0;padding:28px;background:#fff;line-height:1.6}
  ${headerCss}
  .doc-title{text-align:center;font-size:18px;font-weight:900;color:#0f172a;margin:16px 0;background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #cbd5e1}
  table{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:18px}
  th{background:#f1f5f9;text-align:center;padding:9px 8px;border:1px solid #cbd5e1;font-weight:800;color:#334155}
  td{padding:8px 8px;border:1px solid #cbd5e1}
  .sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:40px;text-align:center;font-size:13.5px;font-weight:700;page-break-inside:avoid}
  .sig-box{border-top:1px dashed #64748b;padding-top:10px;margin-top:45px}
  .foot{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:12px;color:#64748b;display:flex;justify-content:space-between}
  @media print{body{padding:0}.no-print{display:none!important}}
</style></head><body>
  ${headerHtml}
  <div class="doc-title">📊 كشف إجمالي التقارير الميدانية والموثقة (العدد الإجمالي: ${currentReports.length} تقرير)</div>
  <table>
    <thead>
      <tr>
        <th>رقم التقرير</th><th>موضوع التقرير</th><th>الجهة / الشخص</th><th>المكان</th>
        <th>التاريخ</th><th>الوقت</th><th>التقييم</th><th>المرفقات</th><th>مُدخل التقرير</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${typeof renderReportSignaturesHTML === 'function' ? renderReportSignaturesHTML() : ''}
  <div class="foot"><span>نظام إدارة التقارير الرسمية</span><span>طُبع بتاريخ ${fmtDateTime(new Date().toISOString())}</span></div>
  <div class="no-print" style="text-align:center;margin-top:22px"><button onclick="window.print()" style="padding:10px 26px;background:#1f6feb;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:700">🖨 طباعة الكشف الإجمالي</button></div>
</body></html>`);
    w.document.close();
  }

  /* 2. طباعة تفصيلية (كافة التقارير بالتفصيل كل تقرير ببياناته ومرفقاته) */
  function printReportsDetailed() {
    if (!currentReports.length) { toast('لا توجد تقارير للطباعة', 'err'); return; }
    const headerCss = typeof getReportHeaderCSS === 'function' ? getReportHeaderCSS() : '';
    const reportsHtml = currentReports.map((r, idx) => {
      const headerHtml = typeof renderReportHeaderHTML === 'function' ? renderReportHeaderHTML(r) : '';
      const rawImages = (r.images && Array.isArray(r.images)) ? r.images : [];
      const attachments = rawImages.map(normalizeAttachment);
      const imgList = attachments.filter(a => a.type.startsWith('image/'));
      const otherList = attachments.filter(a => !a.type.startsWith('image/'));

      const imgHtml = imgList.length ? `
        <h4 style="font-size:14px;margin:14px 0 6px">الصور المرفقة (${imgList.length}):</h4>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          ${imgList.map(img => `<img src="${img.data}" alt="${esc(img.name)}" style="max-width:100%;max-height:240px;border-radius:8px;border:1px solid #ccc;margin:4px" />`).join('')}
        </div>` : '';

      const otherDocsHtml = otherList.length ? `
        <h4 style="font-size:14px;margin:14px 0 6px">المستندات والملفات المرفقة (${otherList.length}):</h4>
        <table style="width:100%;margin-bottom:14px;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="width:40px;text-align:center;border:1px solid #cbd5e1;padding:6px">#</th>
              <th style="border:1px solid #cbd5e1;padding:6px">اسم الملف</th>
              <th style="width:120px;text-align:center;border:1px solid #cbd5e1;padding:6px">نوع الملف</th>
              <th style="width:100px;text-align:center;border:1px solid #cbd5e1;padding:6px">الحجم</th>
            </tr>
          </thead>
          <tbody>
            ${otherList.map((doc, i) => `
              <tr>
                <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${i + 1}</td>
                <td style="border:1px solid #cbd5e1;padding:6px"><b>${getAttachmentIcon(doc.type, doc.name)} ${esc(doc.name)}</b></td>
                <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${esc(doc.type.split('/')[1] || doc.type)}</td>
                <td style="text-align:center;border:1px solid #cbd5e1;padding:6px">${formatBytes(doc.size)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '';

      const attSection = attachments.length ? (imgHtml + otherDocsHtml) : '';

      return `
        <div class="single-report-block" style="${idx < currentReports.length - 1 ? 'page-break-after:always;break-after:page;' : ''}">
          ${headerHtml}
          <div style="text-align:center;font-size:16px;font-weight:800;color:#0f172a;margin:12px 0 16px;background:#f8fafc;padding:6px;border-radius:6px;border:1px solid #cbd5e1">
            تقرير رقم (${esc(r.reportNumber)}) — ${esc(r.subject)}
          </div>
          <table>
            <tr><th style="width:140px">رقم التقرير</th><td><b>${esc(r.reportNumber)}</b></td><th style="width:120px">التاريخ</th><td>${esc(r.reportDate || '—')}</td></tr>
            <tr><th>الوقت</th><td>${esc(r.reportTime || '—')}</td><th>المكان</th><td>${esc(r.location || '—')}</td></tr>
            <tr><th>الجهة / الشخص</th><td colspan="3">${esc(r.target || '—')}</td></tr>
            <tr><th>موضوع التقرير</th><td colspan="3"><b>${esc(r.subject)}</b></td></tr>
            <tr><th>تقييم التقرير</th><td colspan="3">${esc(r.rating || 'غير مقيم')}</td></tr>
          </table>
          <h4 style="font-size:14px;margin:14px 0 6px">التقرير التفصيلي:</h4>
          <div class="det-box">${esc(r.details || '—')}</div>
          ${attSection}
          ${typeof renderReportSignaturesHTML === 'function' ? renderReportSignaturesHTML() : ''}
          <div class="foot"><span>نظام إدارة التقارير • مُدخل التقرير: <b>${esc(r.enteredBy || '—')}</b></span><span>طُبع بتاريخ ${fmtDateTime(new Date().toISOString())}</span></div>
        </div>
      `;
    }).join('\n<hr class="no-print" style="margin:40px 0;border:2px dashed #94a3b8"/>\n');

    const w = window.open('', '_blank', 'width=950,height=750');
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>التقارير التفصيلية المجمعة</title>
<style>
  body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#1e293b;margin:0;padding:28px;background:#fff;line-height:1.6}
  ${headerCss}
  table{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:16px}
  th{background:#f8fafc;text-align:right;padding:8px 12px;border:1px solid #cbd5e1;font-weight:700;color:#334155}
  td{padding:8px 12px;border:1px solid #cbd5e1;color:#0f172a}
  .det-box{background:#fafcff;border:1px solid #cbd5e1;border-radius:8px;padding:14px;line-height:1.9;white-space:pre-wrap;font-size:13.5px;margin-bottom:14px}
  .foot{margin-top:20px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:12px;color:#64748b;display:flex;justify-content:space-between}
  @media print{body{padding:0}.no-print{display:none!important}}
</style></head><body>
  ${reportsHtml}
  <div class="no-print" style="text-align:center;margin:30px 0"><button onclick="window.print()" style="padding:12px 30px;background:#1f6feb;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;font-weight:800">🖨 طباعة كافة التقارير التفصيلية</button></div>
</body></html>`);
    w.document.close();
  }

  /* 3. التصدير إلى Word (.doc) */
  function exportReportsToWord(detailed = false) {
    if (!currentReports.length) { toast('لا توجد تقارير لتصديرها', 'err'); return; }
    let bodyHtml = '';
    const dateStr = todayStr();

    if (!detailed) {
      // تصدير إجمالي
      const rows = currentReports.map(r => `
        <tr>
          <td style="text-align:center"><b>${esc(r.reportNumber)}</b></td>
          <td><b>${esc(r.subject)}</b></td>
          <td>${esc(r.target || '—')}</td>
          <td>${esc(r.location || '—')}</td>
          <td style="text-align:center">${esc(r.reportDate || '—')}</td>
          <td style="text-align:center">${esc(r.rating || 'بدون تقييم')}</td>
          <td>${esc(r.enteredBy || '—')}</td>
        </tr>`).join('');
      bodyHtml = `
        <h2 style="text-align:center;font-size:18pt;color:#1e3a8a;">كشف تقارير إجمالي</h2>
        <p style="text-align:center;color:#475569;">تاريخ التصدير: ${dateStr} — إجمالي عدد التقارير: ${currentReports.length}</p>
        <table border="1" style="width:100%;border-collapse:collapse;margin-top:15px">
          <thead>
            <tr style="background-color:#e2e8f0">
              <th>رقم التقرير</th><th>الموضوع</th><th>الجهة / الشخص</th><th>المكان</th><th>التاريخ</th><th>التقييم</th><th>مُدخل التقرير</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else {
      // تصدير تفصيلي
      bodyHtml = currentReports.map(r => `
        <div style="page-break-after:always;margin-bottom:30px">
          <h2 style="text-align:center;color:#1e3a8a">تقرير رقم (${esc(r.reportNumber)})</h2>
          <table border="1" style="width:100%;border-collapse:collapse;margin-bottom:12px">
            <tr><th style="background:#f1f5f9;width:150px">رقم التقرير</th><td><b>${esc(r.reportNumber)}</b></td><th style="background:#f1f5f9;width:100px">التاريخ</th><td>${esc(r.reportDate||'—')}</td></tr>
            <tr><th style="background:#f1f5f9">الموضوع</th><td colspan="3"><b>${esc(r.subject)}</b></td></tr>
            <tr><th style="background:#f1f5f9">الجهة / الشخص</th><td colspan="3">${esc(r.target||'—')}</td></tr>
            <tr><th style="background:#f1f5f9">المكان</th><td>${esc(r.location||'—')}</td><th style="background:#f1f5f9">التقييم</th><td>${esc(r.rating||'—')}</td></tr>
            <tr><th style="background:#f1f5f9">مُدخل التقرير</th><td colspan="3">${esc(r.enteredBy||'—')}</td></tr>
          </table>
          <h3 style="font-size:13pt;margin:10px 0 5px">تفاصيل التقرير:</h3>
          <div style="border:1px solid #ccc;padding:12px;background:#fafafa;line-height:1.8;white-space:pre-wrap">${esc(r.details||'—')}</div>
        </div>
      `).join('<hr style="margin:25px 0"/>');
    }

    const fullDoc = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8"/>
        <title>تقارير النظام</title>
        <style>
          body { font-family: 'Calibri', 'Arial', sans-serif; direction: rtl; text-align: right; margin: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 15px; }
          th, td { border: 1px solid #94a3b8; padding: 7px 10px; font-size: 11pt; }
          th { background-color: #f1f5f9; font-weight: bold; }
        </style>
      </head>
      <body>
        ${bodyHtml}
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', fullDoc], { type: 'application/msword;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `تقارير_${detailed ? 'تفصيلية' : 'إجمالية'}_${dateStr}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`تم تصدير ملف Word (${detailed ? 'تفصيلي' : 'إجمالي'}) بنجاح ✔`);
  }

  /* ربط أزرار نافذة خيارات الطباعة والتصدير */
  if ($('btnPrintSummary')) $('btnPrintSummary').onclick = () => { $('printModalBack').classList.remove('show'); printReportsSummary(); };
  if ($('btnPrintDetailed')) $('btnPrintDetailed').onclick = () => { $('printModalBack').classList.remove('show'); printReportsDetailed(); };
  if ($('btnExportWordSummary')) $('btnExportWordSummary').onclick = () => { $('printModalBack').classList.remove('show'); exportReportsToWord(false); };
  if ($('btnExportWordDetailed')) $('btnExportWordDetailed').onclick = () => { $('printModalBack').classList.remove('show'); exportReportsToWord(true); };
  if ($('btnExportPdfChoice')) $('btnExportPdfChoice').onclick = () => { $('printModalBack').classList.remove('show'); printReportsSummary(); };

  /* ================= تصدير واستيراد التقارير وقوالب التعبئة ================= */
  window.openReportsTemplateModal = function () {
    if ($('reportsTemplateModal')) $('reportsTemplateModal').classList.add('show');
  };

  window.closeReportsTemplateModal = function () {
    if ($('reportsTemplateModal')) $('reportsTemplateModal').classList.remove('show');
  };

  window.downloadReportsCsvTemplate = function () {
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
  };

  window.downloadReportsJsonTemplate = function () {
    const templateData = {
      system: 'منظومة إدارة الحسابات والتقارير',
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
  };

  function parseCsvToReports(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = [];
    let row = [];
    let cur = '';
    let inQuote = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '"') {
        if (inQuote && next === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        row.push(cur.trim());
        cur = '';
      } else if ((ch === '\r' || ch === '\n') && !inQuote) {
        if (ch === '\r' && next === '\n') i++;
        row.push(cur.trim());
        if (row.some(c => c.length > 0)) lines.push(row);
        row = [];
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.length > 0 || row.length > 0) {
      row.push(cur.trim());
      if (row.some(c => c.length > 0)) lines.push(row);
    }
    if (lines.length < 2) throw new Error('الملف لا يحتوي على صفوف بيانات كافية (مطلوب ترويسة وصف بيانات على الأقل)');

    const headers = lines[0].map(h => h.trim().toLowerCase().replace(/[_ \-]/g, ''));
    const reports = [];

    for (let i = 1; i < lines.length; i++) {
      const r = lines[i];
      const rep = {};
      headers.forEach((h, idx) => {
        const val = (r[idx] || '').trim();
        if (h.includes('رقم') || h === 'reportnumber' || h === 'number' || h === 'id') rep.reportNumber = val;
        else if (h.includes('موضوع') || h.includes('عنوان') || h === 'subject' || h === 'title') rep.subject = val;
        else if (h.includes('مستهدف') || h.includes('جهة') || h === 'target') rep.target = val;
        else if (h.includes('تاريخ') || h === 'reportdate' || h === 'date') rep.reportDate = val;
        else if (h.includes('وقت') || h === 'reporttime' || h === 'time') rep.reportTime = val;
        else if (h.includes('موقع') || h.includes('مكان') || h === 'location') rep.location = val;
        else if (h.includes('تفاصيل') || h.includes('بيان') || h.includes('شرح') || h === 'details') rep.details = val;
        else if (h.includes('تقييم') || h.includes('أهمية') || h === 'rating') rep.rating = val;
        else if (h.includes('مدخل') || h.includes('موظف') || h === 'enteredby') rep.enteredBy = val;
      });

      if (rep.subject || rep.details || rep.reportNumber) {
        if (!rep.subject) rep.subject = rep.details ? rep.details.slice(0, 30) : 'تقرير مستورد';
        if (!rep.reportDate) rep.reportDate = new Date().toISOString().slice(0, 10);
        reports.push(rep);
      }
    }
    return reports;
  }

  if ($('btnExportReportsTemplate')) {
    $('btnExportReportsTemplate').onclick = openReportsTemplateModal;
  }

  if ($('btnExportReportsJson')) {
    $('btnExportReportsJson').onclick = async () => {
      if (!currentReports || !currentReports.length) {
        toast('لا توجد تقارير في القائمة لتصديرها', 'err');
        return;
      }
      try {
        const dump = {
          system: 'إدارة الحسابات',
          version: '3.0.0',
          exportedAt: new Date().toISOString(),
          count: currentReports.length,
          reports: currentReports
        };
        const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json;charset=utf-8' });
        const a = document.createElement('a');
        const dateStr = (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10));
        a.href = URL.createObjectURL(blob);
        a.download = `تقارير_إدارة_الحسابات_${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast(`تم تصدير (${currentReports.length}) تقرير بنجاح ✔`);
      } catch (err) {
        toast('تعذر تصدير التقارير: ' + err.message, 'err');
      }
    };
  }

  if ($('btnImportReportsJson')) {
    $('btnImportReportsJson').onclick = () => {
      if ($('importReportsFileInput')) {
        $('importReportsFileInput').value = '';
        $('importReportsFileInput').click();
      }
    };
  }

  if ($('importReportsFileInput')) {
    $('importReportsFileInput').onchange = async function () {
      const file = this.files && this.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        let reportsList = [];

        const isCsv = file.name.toLowerCase().endsWith('.csv') || (!text.trim().startsWith('{') && !text.trim().startsWith('['));
        if (isCsv) {
          reportsList = parseCsvToReports(text);
        } else {
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch (e) {
            throw new Error('الملف المحدد ليس ملف JSON أو CSV صالح');
          }

          if (Array.isArray(parsed)) {
            reportsList = parsed;
          } else if (parsed && Array.isArray(parsed.reports)) {
            reportsList = parsed.reports;
          } else if (parsed && parsed.backup && Array.isArray(parsed.backup.reports)) {
            reportsList = parsed.backup.reports;
          } else {
            throw new Error('لم يتم العثور على قائمة تقارير صالحة داخل الملف');
          }
        }

        if (!reportsList.length) {
          throw new Error('الملف لا يحتوي على أي تقارير صالحة للاستيراد');
        }

        const confirmMsg = `تم العثور على (${reportsList.length}) تقرير جاهز للاستيراد من الملف:\n«${file.name}»\n\nهل ترغب في استيرادها وإضافتها إلى النظام الآن؟`;
        if (!confirm(confirmMsg)) return;

        toast('⏳ جارٍ استيراد ومعالجة التقارير...');
        const res = await api('/reports/import', {
          method: 'POST',
          body: JSON.stringify({ reports: reportsList })
        });

        toast(res.message || `تم استيراد (${res.importedCount || reportsList.length}) تقرير بنجاح ✔`, 'ok');
        await renderReports();
        if (typeof renderDashboard === 'function') renderDashboard();
      } catch (err) {
        toast('فشل الاستيراد: ' + err.message, 'err');
      } finally {
        this.value = '';
      }
    };
  }

  /* تعبئة قوائم اختيار المستخدمين (لتصفية التقارير والمهام) */
  async function loadUserSelects() {
    try {
      const d = await api('/users');
      const allUsers = d.users || [];
      const activeUsers = allUsers.filter(u => u.isActive);
      const opts = activeUsers.map(u => `<option value="${u.id}">${esc(u.fullName)} (${esc(u.userName)})</option>`).join('');
      if ($('rUser')) $('rUser').innerHTML = '<option value="">كل المستخدمين</option>' + opts;
      if ($('efAssignedUser')) $('efAssignedUser').innerHTML = '<option value="">-- اختر الموظف المكلف --</option>' + opts;
      if ($('evFilterUser')) $('evFilterUser').innerHTML = '<option value="">كل الموظفين</option>' + opts;
    } catch (err) { toast(err.message, 'err'); }
  }

  /* ================= المهام والأحداث (Events & Tasks) ================= */
  let currentEvents = [];

  function getEventTypeBadge(type) {
    const map = {
      'ورشة عمل': 'badge blue',
      'اجتماع إداري': 'badge warn',
      'نزول ميداني': 'badge green',
      'مهمة تفتيشية': 'badge red',
      'مؤتمر / ندوة': 'badge purple',
      'حملة توعوية': 'badge teal',
      'متابعة وإنجاز': 'badge gold',
      'مهمة خاصة': 'badge dark',
      'أخرى': 'badge gray'
    };
    const c = map[type] || 'badge blue';
    return `<span class="${c}">📌 ${esc(type || 'مهمة')}</span>`;
  }

  function getEventStatusBadge(e) {
    if (e.status === 'completed') {
      return `<span class="badge green">✅ تم الإنجاز ${e.completedAt ? '<small style="display:block;font-size:10px">(' + fmtDate(e.completedAt) + ')</small>' : ''}</span>`;
    }
    if (e.status === 'received' || e.status === 'in_progress') {
      return `<span class="badge blue">📬 استلمها الموظف ${e.receivedAt ? '<small style="display:block;font-size:10px">(' + fmtDateTime(e.receivedAt) + ')</small>' : ''}</span>`;
    }
    return `<span class="badge warn">⏳ بانتظار استلام الموظف</span>`;
  }

  async function renderEvents() {
    await loadUserSelects();
    const params = new URLSearchParams();
    if ($('evSearch') && $('evSearch').value.trim()) params.set('q', $('evSearch').value.trim());
    if ($('evFilterUser') && $('evFilterUser').value) params.set('assignedUserId', $('evFilterUser').value);
    if ($('evFilterType') && $('evFilterType').value) params.set('eventType', $('evFilterType').value);
    if ($('evFilterStatus') && $('evFilterStatus').value) params.set('status', $('evFilterStatus').value);
    if ($('evFilterArchive') && $('evFilterArchive').value !== '') params.set('isArchived', $('evFilterArchive').value);
    if ($('evFilterFrom') && $('evFilterFrom').value) params.set('from', $('evFilterFrom').value);
    if ($('evFilterTo') && $('evFilterTo').value) params.set('to', $('evFilterTo').value);

    try {
      const res = await api('/events?' + params.toString());
      currentEvents = res.events || [];

      // تحديث شارات الـ KPIs
      const total = currentEvents.filter(x => !x.isArchived).length;
      const pending = currentEvents.filter(x => x.status === 'pending' && !x.isArchived).length;
      const received = currentEvents.filter(x => (x.status === 'received' || x.status === 'in_progress') && !x.isArchived).length;
      const completed = currentEvents.filter(x => x.status === 'completed' && !x.isArchived).length;

      if ($('evKpiTotal')) $('evKpiTotal').textContent = total;
      if ($('evKpiPending')) $('evKpiPending').textContent = pending;
      if ($('evKpiReceived')) $('evKpiReceived').textContent = received;
      if ($('evKpiCompleted')) $('evKpiCompleted').textContent = completed;

      if ($('sideEventsBadge')) {
        $('sideEventsBadge').textContent = pending;
        $('sideEventsBadge').style.display = pending > 0 ? 'inline-block' : 'none';
      }

      if ($('evCountLabel')) {
        $('evCountLabel').textContent = `عرض (${currentEvents.length}) مهمة وحدث`;
      }

      const tbody = $('eventsTableBody');
      if (!tbody) return;

      if (!currentEvents.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">لا توجد مهام أو أحداث تطابق البحث والتصفية</td></tr>';
        return;
      }

      tbody.innerHTML = currentEvents.map(e => `
        <tr style="${e.isArchived ? 'opacity:0.65;background:#f8fafc' : ''}">
          <td>
            <div style="font-weight:800;color:var(--text);font-size:13.5px">${esc(e.title)}</div>
            ${e.isArchived ? '<span class="badge gray" style="font-size:10px;margin-top:2px">📦 مؤرشفة</span>' : ''}
            <div style="font-size:11.5px;color:var(--muted);margin-top:2px">كُلفت بواسطة: ${esc(e.createdBy || 'المدير')} • ${fmtDate(e.createdDate)}</div>
          </td>
          <td>${getEventTypeBadge(e.eventType)}</td>
          <td>
            <div style="font-weight:700">👤 ${esc(e.assignedUserName || 'غير محدد')}</div>
          </td>
          <td>
            <div style="font-weight:700">${esc(e.eventDate || '—')}</div>
            <div style="font-size:11.5px;color:var(--muted)">⏰ ${esc(e.eventTime || 'غير محدد')}</div>
          </td>
          <td>
            <div style="font-size:12.5px">${esc(e.location || '—')}</div>
          </td>
          <td>
            ${getEventStatusBadge(e)}
            ${e.feedbackNotes ? `<div style="font-size:11.5px;color:var(--secondary);margin-top:3px;font-weight:700">💬 ملاحظات: ${esc(e.feedbackNotes.slice(0, 30))}${e.feedbackNotes.length > 30 ? '...' : ''}</div>` : ''}
          </td>
          <td>
            <div class="btn-row" style="gap:4px">
              <button class="btn btn-outline btn-xs" data-ev-detail="${e.id}" title="عرض كامل التفاصيل والتغذية الراجعة">👁️ عرض</button>
              <button class="btn btn-primary btn-xs" data-ev-edit="${e.id}" title="تعديل بيانات المهمة">✏️</button>
              <button class="btn btn-outline btn-xs" data-ev-archive="${e.id}" title="${e.isArchived ? 'استعادة من الأرشيف' : 'أرشفة المهمة'}">${e.isArchived ? '📤' : '📦'}</button>
              <button class="btn btn-danger btn-xs" data-ev-del="${e.id}" title="حذف المهمة تماماً">🗑️</button>
            </div>
          </td>
        </tr>
      `).join('');

      // ربط أزرار الأحداث
      tbody.querySelectorAll('[data-ev-detail]').forEach(b => {
        b.onclick = () => {
          const item = currentEvents.find(x => x.id === b.dataset.evDetail);
          if (item) showEventDetail(item);
        };
      });

      tbody.querySelectorAll('[data-ev-edit]').forEach(b => {
        b.onclick = () => {
          const item = currentEvents.find(x => x.id === b.dataset.evEdit);
          if (item) openEventEditor(item);
        };
      });

      tbody.querySelectorAll('[data-ev-archive]').forEach(b => {
        b.onclick = async () => {
          const item = currentEvents.find(x => x.id === b.dataset.evArchive);
          if (!item) return;
          try {
            const resArch = await api(`/events/${item.id}/archive`, { method: 'PUT' });
            toast(resArch.message || 'تم تحديث حالة أرشفة المهمة ✔');
            renderEvents();
          } catch(err) { toast(err.message, 'err'); }
        };
      });

      tbody.querySelectorAll('[data-ev-del]').forEach(b => {
        b.onclick = async () => {
          const item = currentEvents.find(x => x.id === b.dataset.evDel);
          if (!item) return;
          if (!confirm(`هل أنت متأكد من حذف المهمة «${item.title}» تماماً من النظام والتطبيق؟`)) return;
          try {
            await api(`/events/${item.id}`, { method: 'DELETE' });
            toast('تم حذف المهمة بنجاح ✔');
            renderEvents();
          } catch(err) { toast(err.message, 'err'); }
        };
      });

    } catch(err) {
      toast('تعذر جلب المهام والأحداث: ' + err.message, 'err');
    }
  }

  function openEventEditor(item) {
    const card = $('eventFormCard');
    if (!card) return;
    $('eventFormTitle').textContent = item ? `✏️ تعديل المهمة: ${item.title}` : '➕ تكليف بمهمة أو حدث جديد';
    card.dataset.id = item ? item.id : '';
    $('efTitle').value = item ? item.title : '';
    $('efType').value = item ? item.eventType : 'ورشة عمل';
    $('efAssignedUser').value = item ? item.assignedUserId : '';
    $('efDate').value = item ? (item.eventDate || todayStr()) : todayStr();
    $('efTime').value = item ? (item.eventTime || '') : '';
    $('efLocation').value = item ? (item.location || '') : '';
    $('efNotes').value = item ? (item.notes || '') : '';
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
  }

  if ($('btnNewEvent')) $('btnNewEvent').onclick = () => openEventEditor(null);
  if ($('eventCancelBtn')) $('eventCancelBtn').onclick = () => { if ($('eventFormCard')) $('eventFormCard').style.display = 'none'; };
  if ($('efCloseBtn')) $('efCloseBtn').onclick = () => { if ($('eventFormCard')) $('eventFormCard').style.display = 'none'; };

  if ($('efSaveBtn')) {
    $('efSaveBtn').onclick = async () => {
      const card = $('eventFormCard');
      const id = card ? card.dataset.id : '';
      const title = $('efTitle').value.trim();
      const eventType = $('efType').value.trim();
      const assignedUserId = $('efAssignedUser').value.trim();
      const eventDate = $('efDate').value.trim();
      const eventTime = $('efTime').value.trim();
      const location = $('efLocation').value.trim();
      const notes = $('efNotes').value.trim();

      if (!title) { toast('عنوان الحدث أو المهمة مطلوب', 'err'); $('efTitle').focus(); return; }
      if (!assignedUserId) { toast('يرجى تحديد الموظف المكلف بالمهمة', 'err'); $('efAssignedUser').focus(); return; }

      const body = { title, eventType, assignedUserId, eventDate, eventTime, location, notes };

      try {
        if (id) {
          await api(`/events/${id}`, { method: 'PUT', body: JSON.stringify(body) });
          toast('تم تعديل بيانات المهمة بنجاح ✔');
        } else {
          const resNew = await api('/events', { method: 'POST', body: JSON.stringify(body) });
          toast(resNew.message || 'تم إرسال وتكليف المهمة بنجاح ✔');
        }
        if (card) card.style.display = 'none';
        renderEvents();
      } catch(err) {
        toast('خطأ في حفظ المهمة: ' + err.message, 'err');
      }
    };
  }

  // ربط فلاتر البحث التلقائي
  if ($('evSearch')) $('evSearch').oninput = () => renderEvents();
  if ($('evFilterUser')) $('evFilterUser').onchange = () => renderEvents();
  if ($('evFilterType')) $('evFilterType').onchange = () => renderEvents();
  if ($('evFilterStatus')) $('evFilterStatus').onchange = () => renderEvents();
  if ($('evFilterArchive')) $('evFilterArchive').onchange = () => renderEvents();
  if ($('evFilterFrom')) $('evFilterFrom').onchange = () => renderEvents();
  if ($('evFilterTo')) $('evFilterTo').onchange = () => renderEvents();

  function showEventDetail(e) {
    const modalBack = $('eventModalBack');
    if (!modalBack) return;
    $('evModalTitle').textContent = `📋 تفاصيل المهمة: ${e.title}`;

    let statusDisplay = '';
    if (e.status === 'completed') {
      statusDisplay = `<span class="badge green" style="font-size:13px">✅ تم الإنجاز (${fmtDateTime(e.completedAt)})</span>`;
    } else if (e.status === 'received' || e.status === 'in_progress') {
      statusDisplay = `<span class="badge blue" style="font-size:13px">📬 استلمها الموظف في: (${fmtDateTime(e.receivedAt)})</span>`;
    } else {
      statusDisplay = `<span class="badge warn" style="font-size:13px">⏳ بانتظار تأكيد استلام الموظف</span>`;
    }

    $('evModalBody').innerHTML = `
      <div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:16px;border:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div>${getEventTypeBadge(e.eventType)}</div>
          <div>${statusDisplay}</div>
        </div>
        <h3 style="margin:0 0 10px;font-size:17px;color:var(--text);font-weight:900">${esc(e.title)}</h3>
        <div style="font-size:12.5px;color:var(--muted);line-height:1.8">
          📅 تاريخ التكليف بالنظام: <b>${fmtDateTime(e.createdDate)}</b> بواسطة <b>${esc(e.createdBy || 'المدير')}</b>
        </div>
      </div>

      <table class="detail-table" style="width:100%;margin-bottom:16px">
        <tr><th style="width:140px">الموظف المكلف:</th><td><b>👤 ${esc(e.assignedUserName || 'غير محدد')}</b></td></tr>
        <tr><th>تاريخ ووقت الحدث:</th><td>📅 ${esc(e.eventDate || '—')} &nbsp; ⏰ ${esc(e.eventTime || 'غير محدد')}</td></tr>
        <tr><th>مكان الحدث / الموقع:</th><td>📍 ${esc(e.location || '—')}</td></tr>
        <tr><th>حالة الأرشفة:</th><td>${e.isArchived ? '<span class="badge gray">📦 مؤرشفة</span>' : '<span class="badge green">نشطة</span>'}</td></tr>
        ${e.receivedAt ? `<tr><th>وقت الاستلام الفعلي:</th><td>📬 <b>${fmtDateTime(e.receivedAt)}</b></td></tr>` : ''}
        ${e.completedAt ? `<tr><th>وقت الإنجاز:</th><td>✅ <b>${fmtDateTime(e.completedAt)}</b></td></tr>` : ''}
      </table>

      <h4 style="font-size:14px;margin:14px 0 6px;color:var(--text)">📝 الوصف والتعليمات الموجهة للموظف:</h4>
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:12px 14px;white-space:pre-wrap;font-size:13.5px;line-height:1.8;margin-bottom:16px">
        ${esc(e.notes || 'لا توجد تعليمات إضافية مسجلة.')}
      </div>

      ${e.feedbackNotes ? `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-top:14px">
          <h4 style="font-size:14px;margin:0 0 6px;color:#166534">💬 ملاحظات وتغذية راجعة من الموظف المكلف (${esc(e.assignedUserName)}):</h4>
          <div style="font-size:13.5px;color:#1e293b;line-height:1.8;white-space:pre-wrap">${esc(e.feedbackNotes)}</div>
        </div>
      ` : '<div style="font-size:12.5px;color:var(--muted);background:#f8fafc;padding:10px;border-radius:6px">لم يرسل الموظف أي ملاحظات أو تغذية راجعة بعد.</div>'}
    `;

    // ربط أزرار النافذة
    if ($('evModalCloseBtn')) $('evModalCloseBtn').onclick = () => modalBack.classList.remove('show');
    if ($('evModalEditBtn')) {
      $('evModalEditBtn').onclick = () => {
        modalBack.classList.remove('show');
        openEventEditor(e);
      };
    }
    if ($('evModalArchiveBtn')) {
      $('evModalArchiveBtn').textContent = e.isArchived ? '📤 استعادة من الأرشيف' : '📦 أرشفة';
      $('evModalArchiveBtn').onclick = async () => {
        try {
          const resA = await api(`/events/${e.id}/archive`, { method: 'PUT' });
          toast(resA.message || 'تم تحديث حالة الأرشفة ✔');
          modalBack.classList.remove('show');
          renderEvents();
        } catch(err) { toast(err.message, 'err'); }
      };
    }
    if ($('evModalDeleteBtn')) {
      $('evModalDeleteBtn').onclick = async () => {
        if (!confirm(`حذف المهمة «${e.title}» تماماً من النظام والتطبيق؟`)) return;
        try {
          await api(`/events/${e.id}`, { method: 'DELETE' });
          toast('تم حذف المهمة تماماً ✔');
          modalBack.classList.remove('show');
          renderEvents();
        } catch(err) { toast(err.message, 'err'); }
      };
    }

    modalBack.classList.add('show');
  }

  /* ================= المستخدمون والصلاحيات ================= */
  let allOrgUsers = [];
  async function renderUsers() {
    try {
      const d = await api('/users');
      allOrgUsers = d.users || [];
      const list = allOrgUsers.filter(u => u.userName.toLowerCase().includes(($('userSearch').value || '').trim().toLowerCase()));
      $('userTableBody').innerHTML = list.map(u => {
        const curPw = u.plainPassword || (u.userName === 'admin' ? 'Admin@123' : '123456');
        if (u.role === 'Admin') {
          return `<tr>
            <td>
              <div class="rep-row">
                <div class="rep-badge" style="background:var(--gold-soft);color:var(--gold)">👑</div>
                <div>
                  <b>${esc(u.fullName)}</b>
                  <div class="s" style="color:var(--muted);font-size:12px">👤 ${esc(u.userName)} &nbsp;|&nbsp; 🔑 <span style="font-family:monospace;background:#f1f5f9;padding:1px 6px;border-radius:4px" title="كلمة المرور: ${esc(curPw)}">••••••</span></div>
                </div>
              </div>
            </td>
            <td>${badgeStatus(u.isActive ? 'نشط' : 'غير نشط')}</td>
            <td><span class="badge blue">👑 مدير النظام (كافة الصلاحيات)</span></td>
            <td>${fmtDate(u.createdAt)}</td>
            <td>
              <div class="btn-row" style="gap:6px">
                <button class="btn btn-outline btn-xs" data-edit="${u.id}">✏️ تعديل / كشف كلمة المرور</button>
                <button class="btn btn-outline btn-xs" data-pwd="${u.id}">🔑 كلمة المرور</button>
              </div>
            </td>
          </tr>`;
        }
        return `<tr>
          <td>
            <div class="rep-row">
              <div class="rep-badge">👤</div>
              <div>
                <b>${esc(u.fullName)}</b>
                <div class="s" style="color:var(--muted);font-size:12px">👤 ${esc(u.userName)} &nbsp;|&nbsp; 🔑 <span style="font-family:monospace;background:#f1f5f9;padding:1px 6px;border-radius:4px" title="كلمة المرور: ${esc(curPw)}">••••••</span></div>
              </div>
            </div>
          </td>
          <td>${badgeStatus(u.isActive ? 'نشط' : 'غير نشط')}</td>
          <td><div class="chips" style="gap:4px;max-width:240px">${permBadges(u)}</div></td>
          <td>${fmtDate(u.createdAt)}</td>
          <td>
            <div class="btn-row" style="gap:6px">
              <button class="btn btn-primary btn-xs" data-edit="${u.id}">⚙️ تعديل / كشف كلمة المرور</button>
              <button class="btn btn-outline btn-xs" data-pwd="${u.id}" title="تعديل أو كشف كلمة المرور">🔑</button>
              <button class="btn btn-danger btn-xs" data-del="${u.id}">🗑</button>
            </div>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" class="empty">لا يوجد مستخدمون</td></tr>';

      document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openUserEditor(list.find(u => u.id === b.dataset.edit)));
      document.querySelectorAll('[data-pwd]').forEach(b => b.onclick = () => openPwdEditor(list.find(u => u.id === b.dataset.pwd)));
      document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        const u = list.find(x => x.id === b.dataset.del);
        if (!u) return;
        if (u.role === 'Admin') {
          toast('لا يمكن حذف حساب مدير النظام الرئيسي', 'err');
          return;
        }
        if (!confirm('حذف المستخدم «' + u.fullName + '» نهائياً؟ لا يمكن التراجع.')) return;
        try {
          await api('/users/' + u.id, { method: 'DELETE' });
          toast('تم حذف المستخدم');
          renderUsers();
        } catch (err) { toast(err.message, 'err'); }
      });
      renderDevices();
    } catch (err) { toast(err.message, 'err'); }
  }
  $('userSearch').oninput = renderUsers;

  /* ================= إدارة الأجهزة والهواتف المعتمدة ================= */
  function updateDeviceAuthBadge(isActive) {
    const badge = $('deviceAuthStatusBadge');
    if (!badge) return;
    if (isActive) {
      badge.className = 'badge green';
      badge.textContent = 'مفعّل (حماية عالية)';
    } else {
      badge.className = 'badge warn';
      badge.textContent = 'معطّل (سماح مباشر للجميع)';
    }
  }

  async function renderDevices() {
    if (!$('devicesTableBody')) return;

    // تهيئة زر ومفتاح الحماية
    const toggle = $('enforceDeviceAuthToggle');
    if (toggle) {
      if (!toggle._bound) {
        toggle._bound = true;
        toggle.onchange = async () => {
          try {
            await api('/settings', { method: 'PUT', body: JSON.stringify({ enforceDeviceAuth: toggle.checked }) });
            toast(toggle.checked ? 'تم تفعيل نظام حماية واعتماد الأجهزة ✔' : 'تم إيقاف فحص الأجهزة (السماح بالدخول المباشر واعتماد المعلقة) 🔓');
            updateDeviceAuthBadge(toggle.checked);
            if (me.settings) me.settings.enforceDeviceAuth = toggle.checked;
            renderDevices();
            if (typeof renderDash === 'function') renderDash();
          } catch (err) {
            toast(err.message, 'err');
            toggle.checked = !toggle.checked;
          }
        };
      }
      toggle.checked = me.settings?.enforceDeviceAuth !== false;
      updateDeviceAuthBadge(toggle.checked);
    }

    const appAllBtn = $('approveAllDevicesBtn');
    if (appAllBtn && !appAllBtn._bound) {
      appAllBtn._bound = true;
      appAllBtn.onclick = async () => {
        try {
          const res = await api('/devices/approve-all', { method: 'POST' });
          toast(res.message || 'تم اعتماد وتفعيل كافة الأجهزة المعلقة بنجاح ✔');
          renderDevices();
          if (typeof renderDash === 'function') renderDash();
        } catch (err) { toast(err.message, 'err'); }
      };
    }

    try {
      const d = await api('/devices');
      const list = d.devices || [];
      const pendingCount = list.filter(x => x.status === 'pending').length;
      if ($('pendingDevicesBadge')) {
        $('pendingDevicesBadge').textContent = pendingCount + ' بانتظار الاعتماد';
        $('pendingDevicesBadge').style.display = pendingCount ? 'inline-block' : 'none';
      }

      $('devicesTableBody').innerHTML = list.length ? list.map(dev => {
        let statusBadge = '';
        if (dev.status === 'approved') {
          statusBadge = '<span class="badge green">🟢 معتمد دائم ومصرح</span>';
        } else if (dev.status === 'blocked') {
          statusBadge = '<span class="badge red">🔴 محظور وموقوف</span>';
        } else {
          statusBadge = '<span class="badge warn">⏳ بانتظار اعتماد المدير</span>';
        }

        const shortId = (dev.deviceId || '').slice(0, 16);

        return `<tr>
          <td>
            <b>${esc(dev.userFullName || '—')}</b>
            <div style="font-size:12px;color:var(--muted)">👤 ${esc(dev.userName || 'غير مسجل')}</div>
          </td>
          <td>
            <b>📱 ${esc(dev.deviceName || 'هاتف ميداني')}</b>
          </td>
          <td>
            <code style="font-family:monospace;font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px" title="${esc(dev.deviceId)}">${esc(shortId)}...</code>
          </td>
          <td>${fmtDate(dev.registeredAt)}</td>
          <td>${fmtDateTime(dev.lastSeenAt)}</td>
          <td>${statusBadge}</td>
          <td>
            <div class="btn-row" style="gap:6px">
              ${dev.status !== 'approved' ? `<button class="btn btn-primary btn-xs" data-approve="${dev.id}">✅ اعتماد دائم</button>` : ''}
              ${dev.status !== 'blocked' ? `<button class="btn btn-warn btn-xs" data-block="${dev.id}">🚫 حظر / توقيف</button>` : ''}
              <button class="btn btn-danger btn-xs" data-deldev="${dev.id}">🗑️ حذف</button>
            </div>
          </td>
        </tr>`;
      }).join('') : '<tr><td colspan="7" class="empty">لا توجد أجهزة مسجلة في النظام بعد</td></tr>';

      document.querySelectorAll('[data-approve]').forEach(b => {
        b.onclick = async () => {
          try {
            const res = await api('/devices/' + b.dataset.approve + '/approve', { method: 'POST' });
            toast(res.message || 'تم اعتماد الهاتف وتفعيله بشكل دائم ✔');
            renderDevices();
            if (typeof renderDash === 'function') renderDash();
          } catch (e) { toast(e.message, 'err'); }
        };
      });

      document.querySelectorAll('[data-block]').forEach(b => {
        b.onclick = async () => {
          try {
            const res = await api('/devices/' + b.dataset.block + '/block', { method: 'POST' });
            toast(res.message || 'تم حظر وتوقيف الهاتف 🚫', 'err');
            renderDevices();
            if (typeof renderDash === 'function') renderDash();
          } catch (e) { toast(e.message, 'err'); }
        };
      });

      document.querySelectorAll('[data-deldev]').forEach(b => {
        b.onclick = async () => {
          if (!confirm('حذف هذا الجهاز من سجل النظام؟')) return;
          try {
            await api('/devices/' + b.dataset.deldev, { method: 'DELETE' });
            toast('تم حذف الجهاز');
            renderDevices();
            if (typeof renderDash === 'function') renderDash();
          } catch (e) { toast(e.message, 'err'); }
        };
      });
    } catch (err) { toast(err.message, 'err'); }
  }
  window.renderDevices = renderDevices;

  $('newUserBtn').onclick = () => openUserEditor(null);

  function checkUserNameDuplicate() {
    const input = $('ufUserName');
    const errBox = $('ufUserNameError');
    if (!input || !errBox) return false;
    const currentId = $('userForm')?.dataset.id || '';
    const val = input.value.trim().toLowerCase();
    if (!val) {
      errBox.style.display = 'none';
      input.style.borderColor = '';
      return false;
    }
    const isDup = allOrgUsers.some(u => String(u.id) !== String(currentId) && (u.userName || '').trim().toLowerCase() === val);
    if (isDup) {
      errBox.style.display = 'block';
      errBox.textContent = `⚠️ اسم المستخدم «${input.value.trim()}» مسجل مسبقاً لموظف آخر، يرجى اختيار اسم فريد.`;
      input.style.borderColor = '#dc2626';
      return true;
    } else {
      errBox.style.display = 'none';
      input.style.borderColor = '';
      return false;
    }
  }

  function openUserEditor(u) {
    $('userFormTitle').textContent = u ? 'تعديل المستخدم: ' + u.fullName : 'إضافة مستخدم جديد';
    $('ufUserName').value = u ? u.userName : '';
    $('ufUserName').readOnly = false;
    $('ufFullName').value = u ? u.fullName : '';

    const errBox = $('ufUserNameError');
    if (errBox) {
      errBox.style.display = 'none';
      errBox.textContent = '';
    }
    $('ufUserName').style.borderColor = '';

    if (!$('ufUserName')._boundDupCheck) {
      $('ufUserName')._boundDupCheck = true;
      $('ufUserName').addEventListener('input', checkUserNameDuplicate);
      $('ufUserName').addEventListener('blur', checkUserNameDuplicate);
    }
    
    // وضع كلمة المرور الحالية للمستخدم
    const currentPw = u ? (u.plainPassword || (u.userName === 'admin' ? 'Admin@123' : '123456')) : '';
    $('ufPassword').value = currentPw;
    $('ufPassword').type = 'password';

    const togglePwBtn = $('toggleUfPasswordBtn');
    if (togglePwBtn) {
      togglePwBtn.textContent = '👁️';
      togglePwBtn.title = 'إظهار كلمة المرور';
      if (!togglePwBtn._bound) {
        togglePwBtn._bound = true;
        togglePwBtn.onclick = () => {
          const inp = $('ufPassword');
          if (inp.type === 'password') {
            inp.type = 'text';
            togglePwBtn.textContent = '🙈';
            togglePwBtn.title = 'إخفاء كلمة المرور';
          } else {
            inp.type = 'password';
            togglePwBtn.textContent = '👁️';
            togglePwBtn.title = 'إظهار كلمة المرور';
          }
        };
      }
    }

    $('ufActive').checked = u ? !!u.isActive : true;
    
    const permKeys = ['Dash', 'Entry', 'Add', 'Reports', 'Edit', 'Delete', 'Print', 'Events', 'Users', 'Settings'];
    permKeys.forEach(k => {
      const el = $('ufCan' + k);
      if (el) {
        if (u) {
          el.checked = !!u['can' + k];
        } else {
          el.checked = (k === 'Dash' || k === 'Entry' || k === 'Add' || k === 'Reports' || k === 'Print' || k === 'Events');
        }
      }
    });
    $('userForm').dataset.id = u ? u.id : '';
    $('userForm').style.display = 'block';
    $('userForm').scrollIntoView({ behavior: 'smooth' });
  }
  $('userCancelBtn').onclick = () => { $('userForm').style.display = 'none'; };
  $('userSaveBtn').onclick = async () => {
    const id = $('userForm').dataset.id;
    const userName = $('ufUserName').value.trim();
    const fullName = $('ufFullName').value.trim();
    if (!userName || !fullName) { toast('الاسم واسم المستخدم مطلوبان', 'err'); return; }

    if (checkUserNameDuplicate()) {
      toast(`اسم مدخل البيانات (${userName}) مسجل مسبقاً، يرجى اختيار اسم فريد`, 'err');
      $('ufUserName').focus();
      return;
    }

    const pw = $('ufPassword').value.trim();
    if (!id && !pw) { toast('كلمة المرور مطلوبة للمستخدم الجديد', 'err'); return; }

    const body = {
      userName, fullName, isActive: $('ufActive').checked,
      canDash: !!$('ufCanDash')?.checked,
      canEntry: !!$('ufCanEntry')?.checked,
      canAdd: !!$('ufCanAdd')?.checked,
      canReports: !!$('ufCanReports')?.checked,
      canEdit: !!$('ufCanEdit')?.checked,
      canDelete: !!$('ufCanDelete')?.checked,
      canPrint: !!$('ufCanPrint')?.checked,
      canEvents: !!$('ufCanEvents')?.checked,
      canUsers: !!$('ufCanUsers')?.checked,
      canSettings: !!$('ufCanSettings')?.checked,
      canOpen: !!$('ufCanEntry')?.checked || !!$('ufCanReports')?.checked
    };
    if (pw) {
      body.plainPassword = pw;
      body.password = pw;
      body.passwordHash = await sha256Hex(pw);
    }
    try {
      if (id) await api('/users/' + id, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/users', { method: 'POST', body: JSON.stringify(body) });
      toast('تم حفظ المستخدم وصلاحياته وكلمة المرور بنجاح ✔');
      $('userForm').style.display = 'none';
      renderUsers();
    } catch (err) { toast(err.message, 'err'); }
  };

  function openPwdEditor(u) {
    if (!u) return;
    const currentPw = u.plainPassword || (u.userName === 'admin' ? 'Admin@123' : '123456');
    const pw = prompt(`تعديل أو كشف كلمة المرور للمستخدم «${u.fullName}»:\n\nكلمة المرور الحالية: [ ${currentPw} ]\n\nأدخل كلمة المرور الجديدة في حال رغبت بتعديلها:`, currentPw);
    if (!pw) return;
    const trimmed = pw.trim();
    if (!trimmed) return;
    if (trimmed.length < 3) { toast('كلمة المرور قصيرة جداً', 'err'); return; }
    (async () => {
      try {
        await api('/users/' + u.id, {
          method: 'PUT',
          body: JSON.stringify({ plainPassword: trimmed, password: trimmed, passwordHash: await sha256Hex(trimmed) })
        });
        toast('تم تحديث وحفظ كلمة المرور بنجاح ✔');
        renderUsers();
      } catch (err) { toast(err.message, 'err'); }
    })();
  }

  // فحص دوري للأجهزة والإحصائيات كل 6 ثوانٍ للتنبيه الفوري
  setInterval(async () => {
    try {
      const s = await api('/stats');
      if (s) {
        updateDashUI(s);
      }
    } catch(e){}
  }, 6000);

  /* ================= الإعدادات وتخصيص الترويسة ================= */
  let customLogoBase64 = '';

  function getHeaderFormConfig() {
    const line1 = $('setHeaderLine1') ? $('setHeaderLine1').value.trim() : (REPORT_HEADER_CONFIG.line1 || '');
    const line2 = $('setHeaderLine2') ? $('setHeaderLine2').value.trim() : (REPORT_HEADER_CONFIG.line2 || '');
    const line3 = $('setHeaderLine3') ? $('setHeaderLine3').value.trim() : (REPORT_HEADER_CONFIG.line3 || '');
    const line4 = $('setHeaderLine4') ? $('setHeaderLine4').value.trim() : (REPORT_HEADER_CONFIG.line4 || '');
    const line5 = $('setHeaderLine5') ? $('setHeaderLine5').value.trim() : (REPORT_HEADER_CONFIG.line5 || '');

    const rightLines = [line1, line2, line3, line4, line5].filter(Boolean);

    let logoSrc = $('hLogoSel') ? $('hLogoSel').value : REPORT_HEADER_CONFIG.logoSrc;
    if (logoSrc === 'custom' && customLogoBase64) {
      logoSrc = customLogoBase64;
    } else if (logoSrc === 'custom') {
      logoSrc = REPORT_HEADER_CONFIG.logoSrc;
    }
    const fontFamily = $('hFontSel') ? $('hFontSel').value : (REPORT_HEADER_CONFIG.fontFamily || 'diwani');
    const showBasmala = $('hShowBasmala') ? $('hShowBasmala').checked : (REPORT_HEADER_CONFIG.showBasmala !== false);
    const basmalaText = $('hBasmalaText') ? $('hBasmalaText').value.trim() : (REPORT_HEADER_CONFIG.basmalaText || 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ');
    const confidentialityBadge = $('hConfidential') ? $('hConfidential').value.trim() : (REPORT_HEADER_CONFIG.confidentialityBadge || '');

    const sig1Title = $('setSig1') ? $('setSig1').value.trim() : (REPORT_HEADER_CONFIG.sig1Title || 'توقيع ضابط التقييم');
    const sig1Name = $('setSig1Name') ? $('setSig1Name').value.trim() : (REPORT_HEADER_CONFIG.sig1Name || '');
    const sig2Title = $('setSig2') ? $('setSig2').value.trim() : (REPORT_HEADER_CONFIG.sig2Title || 'اعتماد مدير الاستخبارات');
    const sig2Name = $('setSig2Name') ? $('setSig2Name').value.trim() : (REPORT_HEADER_CONFIG.sig2Name || '');
    const sig3Title = $('setSig3') ? $('setSig3').value.trim() : (REPORT_HEADER_CONFIG.sig3Title || 'الختم الأمني');
    const sig3Name = $('setSig3Name') ? $('setSig3Name').value.trim() : (REPORT_HEADER_CONFIG.sig3Name || '');

    return {
      line1, line2, line3, line4, line5,
      rightLines,
      logoSrc,
      fontFamily,
      showBasmala,
      basmalaText,
      confidentialityBadge,
      sig1Title,
      sig1Name,
      sig2Title,
      sig2Name,
      sig3Title,
      sig3Name,
      showSignatures: true
    };
  }

  function renderHeaderPreview() {
    if (!$('hLivePreview')) return;
    const cfg = getHeaderFormConfig();
    const sigHtml = typeof renderReportSignaturesHTML === 'function' ? renderReportSignaturesHTML(cfg) : '';
    $('hLivePreview').innerHTML = `
      ${renderReportHeaderHTML({ reportDate: todayStr(), reportTime: '10:30' }, cfg)}
      <div style="margin:24px 0 16px;padding:12px;background:#f8fafc;border-radius:8px;text-align:center;color:#64748b;font-size:13px;border:1px dashed #cbd5e1">
        📄 هنا يظهر جدول وتفاصيل التقرير والبيانات الرسمية والمرفقات...
      </div>
      ${sigHtml}
    `;
  }

  ['setHeaderLine1', 'setHeaderLine2', 'setHeaderLine3', 'setHeaderLine4', 'setHeaderLine5',
   'hConfidential', 'hBasmalaText', 'setSig1', 'setSig1Name', 'setSig2', 'setSig2Name', 'setSig3', 'setSig3Name'].forEach(id => {
    if ($(id)) $(id).oninput = renderHeaderPreview;
  });
  if ($('hRightLines')) $('hRightLines').oninput = renderHeaderPreview;
  if ($('hFontSel')) $('hFontSel').onchange = renderHeaderPreview;
  if ($('hShowBasmala')) $('hShowBasmala').onchange = renderHeaderPreview;

  if ($('hLogoSel')) {
    $('hLogoSel').onchange = function () {
      if (this.value === 'custom') {
        $('hLogoFile').click();
      } else {
        customLogoBase64 = '';
        renderHeaderPreview();
      }
    };
  }
  if ($('hLogoFile')) {
    $('hLogoFile').onchange = function () {
      const file = this.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { toast('حجم الصورة كبير، اختر صورة أقل من 2 ميجابايت', 'err'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        customLogoBase64 = reader.result;
        renderHeaderPreview();
        toast('تم اختيار الصورة بنجاح ✔ — اضغط «حفظ الترويسة والتوقيعات» لتثبيتها');
      };
      reader.readAsDataURL(file);
    };
  }

  if ($('hSaveBtn')) {
    $('hSaveBtn').onclick = async () => {
      const cfg = getHeaderFormConfig();
      try {
        await api('/settings', {
          method: 'PUT',
          body: JSON.stringify({ reportHeaderConfig: cfg })
        });
        updateReportHeaderConfig(cfg);
        renderHeaderPreview();
        toast('تم حفظ وتطبيق الترويسة والتوقيعات على جميع التقارير بنجاح ✔');
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  if ($('hResetBtn')) {
    $('hResetBtn').onclick = async () => {
      if (!confirm('هل أنت متأكد من استعادة الإعدادات الافتراضية للترويسة والتوقيعات؟')) return;
      const defaultCfg = {
        line1: "الجمهورية اليمنية",
        line2: "وزارة النقل",
        line3: "الهيئة العامة لتنظيم شؤون النقل البري",
        line4: "مكتب رئيس الهيئة",
        line5: "",
        rightLines: [
          "الجمهورية اليمنية",
          "وزارة النقل",
          "الهيئة العامة لتنظيم شؤون النقل البري",
          "مكتب رئيس الهيئة"
        ],
        logoSrc: "Image/1754379379088.jpg",
        showBasmala: true,
        basmalaText: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
        fontFamily: "diwani",
        confidentialityBadge: "خاص وسري",
        sig1Title: "توقيع ضابط التقييم",
        sig1Name: "محمد صالح",
        sig2Title: "اعتماد مدير الاستخبارات",
        sig2Name: "",
        sig3Title: "الختم الأمني",
        sig3Name: "[....................]",
        showSignatures: true
      };
      customLogoBase64 = '';
      try {
        await api('/settings', {
          method: 'PUT',
          body: JSON.stringify({ reportHeaderConfig: defaultCfg })
        });
        updateReportHeaderConfig(defaultCfg);
        renderSettings();
        toast('تم استعادة الإعدادات الافتراضية بنجاح ✔');
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  async function renderSettings() {
    try {
      const d = await api('/settings');
      const s = d.settings;
      if ($('netInfo')) $('netInfo').textContent = 'عنوان الخادم للشبكة: ' + s.baseUrl + ' — تعمل على نفس شبكة (واي فاي) المدير.';
      if (s.reportHeaderConfig) {
        updateReportHeaderConfig(s.reportHeaderConfig);
      }
      const cfg = REPORT_HEADER_CONFIG;
      if ($('setHeaderLine1')) $('setHeaderLine1').value = cfg.line1 !== undefined ? cfg.line1 : (cfg.rightLines?.[0] || 'الجمهورية اليمنية');
      if ($('setHeaderLine2')) $('setHeaderLine2').value = cfg.line2 !== undefined ? cfg.line2 : (cfg.rightLines?.[1] || 'وزارة النقل');
      if ($('setHeaderLine3')) $('setHeaderLine3').value = cfg.line3 !== undefined ? cfg.line3 : (cfg.rightLines?.[2] || 'الهيئة العامة لتنظيم شؤون النقل البري');
      if ($('setHeaderLine4')) $('setHeaderLine4').value = cfg.line4 !== undefined ? cfg.line4 : (cfg.rightLines?.[3] || 'مكتب رئيس الهيئة');
      if ($('setHeaderLine5')) $('setHeaderLine5').value = cfg.line5 !== undefined ? cfg.line5 : (cfg.rightLines?.[4] || '');

      if ($('hRightLines')) {
        const lines = cfg.rightLines;
        $('hRightLines').value = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
      }
      if ($('hConfidential')) {
        $('hConfidential').value = cfg.confidentialityBadge || '';
      }
      if ($('hFontSel')) {
        $('hFontSel').value = cfg.fontFamily || 'diwani';
      }
      if ($('hShowBasmala')) {
        $('hShowBasmala').checked = cfg.showBasmala !== false;
      }
      if ($('hBasmalaText')) {
        $('hBasmalaText').value = cfg.basmalaText || 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
      }
      if ($('setSig1')) $('setSig1').value = cfg.sig1Title || 'توقيع ضابط التقييم';
      if ($('setSig1Name')) $('setSig1Name').value = cfg.sig1Name || '';
      if ($('setSig2')) $('setSig2').value = cfg.sig2Title || 'اعتماد مدير الاستخبارات';
      if ($('setSig2Name')) $('setSig2Name').value = cfg.sig2Name || '';
      if ($('setSig3')) $('setSig3').value = cfg.sig3Title || 'الختم الأمني';
      if ($('setSig3Name')) $('setSig3Name').value = cfg.sig3Name || '';

      if ($('hLogoSel')) {
        const currentSrc = cfg.logoSrc || '';
        if (currentSrc === 'Image/1754379379088.jpg') {
          $('hLogoSel').value = currentSrc;
        } else if (currentSrc) {
          $('hLogoSel').value = 'custom';
          customLogoBase64 = currentSrc;
        } else {
          $('hLogoSel').value = 'Image/1754379379088.jpg';
        }
      }
      renderHeaderPreview();
    } catch (err) { toast(err.message, 'err'); }
  }

  /* النسخ الاحتياطي لقاعدة بيانات SQLite */
  $('backupBtn').onclick = async () => {
    try {
      toast('جارٍ تحضير ملف قاعدة بيانات SQLite (.db)...');
      const tok = getToken();
      const res = await fetch(getServerBaseUrl() + '/api/backup?format=sqlite', {
        headers: { 'Authorization': 'Bearer ' + tok }
      });
      if (!res.ok) throw new Error('فشل تنزيل قاعدة البيانات');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `بيانات_الفرع_${(me?.organization?.orgCode || 'BRANCH')}_${todayStr()}.db`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('تم تنزيل ملف قاعدة بيانات الفرع SQLite (.db) بنجاح ✔');
    } catch (err) { toast(err.message, 'err'); }
  };
  $('restoreInput').onchange = async function () {
    const file = this.files[0];
    if (!file) return;
    if (!confirm(`سيتم استبدال ودمج البيانات الحالية من ملف قاعدة البيانات (${file.name}). متابعة؟`)) { this.value = ''; return; }
    try {
      toast('جارٍ استعادة قاعدة البيانات...');
      const isDb = file.name.endsWith('.db') || file.name.endsWith('.sqlite');
      if (isDb) {
        const arrayBuf = await file.arrayBuffer();
        const res = await fetch(getServerBaseUrl() + '/api/restore', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + getToken(),
            'Content-Type': 'application/x-sqlite3'
          },
          body: arrayBuf
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشلت الاستعادة');
        toast('تمت استعادة قاعدة بيانات SQLite بنجاح ✔');
      } else {
        const text = await file.text();
        const backup = JSON.parse(text);
        await api('/restore', { method: 'POST', body: JSON.stringify({ backup }) });
        toast('تمت الاستعادة بنجاح ✔');
      }
      renderSettings(); renderUsers();
    } catch (err) { toast('فشلت الاستعادة: ' + err.message, 'err'); }
    this.value = '';
  };

  /* ================= إغلاق النوافذ ================= */
  document.querySelectorAll('.x-btn').forEach(b => b.onclick = () => b.closest('.modal-back').classList.remove('show'));

  /* ================= إدارة الباركود وبطاقة ربط الهواتف ================= */
  window.showMyOrgQrModal = function() {
    if (!me || !me.organization) {
      toast('تعذر جلب بيانات المؤسسة للباركود', 'err');
      return;
    }
    const o = me.organization;
    const nameEl = document.getElementById('adminQrOrgName');
    const codeEl = document.getElementById('adminQrOrgCode');
    if (nameEl) nameEl.textContent = o.orgName || '';
    if (codeEl) codeEl.textContent = o.orgCode || '';
    const container = document.getElementById('adminQrCanvasContainer');
    if (container) {
      container.innerHTML = '';
      const baseUrl = getServerBaseUrl() || location.origin;
      const directUrl = baseUrl + '/login.html?org=' + encodeURIComponent(o.orgCode);
      if (typeof QRCode !== 'undefined') {
        new QRCode(container, {
          text: directUrl,
          width: 190,
          height: 190
        });
      }
    }
    const modal = document.getElementById('adminOrgQrModal');
    if (modal) modal.classList.add('show');
  };

  window.closeMyOrgQrModal = function() {
    const modal = document.getElementById('adminOrgQrModal');
    if (modal) modal.classList.remove('show');
  };

  window.printMyOrgCard = function() {
    if (!me || !me.organization) return;
    const o = me.organization;
    const canvas = document.querySelector('#adminQrCanvasContainer canvas');
    const qrDataUrl = canvas ? canvas.toDataURL() : '';

    const w = window.open('', '_blank', 'width=650,height=750');
    w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>بطاقة ربط المنظومة — ${esc(o.orgName)}</title>
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
      <h2 style="margin:0">منظومة كودكس السحابية لإدارة التقارير</h2>
      <small style="color:#64748b">بطاقة ربط واعتماد الهواتف الميدانية</small>
    </div>
  </div>
  
  <div class="org-title">${esc(o.orgName)}</div>
  
  <div class="qr-box">
    <img src="${qrDataUrl}" alt="QR Code" />
  </div>
  
  <div>
    <div style="font-size:12px;color:#64748b;margin-bottom:4px;font-weight:700">رمز الجهة الرسمي:</div>
    <div class="code-badge">${esc(o.orgCode)}</div>
  </div>

  <div class="steps">
    <b>طريقة ربط الهاتف بالمنظومة:</b><br/>
    1. افتح تطبيق المنظومة أو كاميرا الهاتف وامسح رمز الـ QR أعلاه.<br/>
    2. أو افتح التطبيق واكتب رمز الجهة: <b>${esc(o.orgCode)}</b><br/>
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
  };

  /* ================= التشغيل الأولي ================= */
  window.renderDash = renderDash;
  window.renderReports = renderReports;
  window.renderUsers = renderUsers;
  window.renderSettings = renderSettings;
  loadUserSelects();
  renderDash();
})();
