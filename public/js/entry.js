/* =========================================================
   entry.js — صفحة إدخال البيانات لمستخدم الإدخال
   - مسودة محلية على الجهاز (localStorage) قابلة للتعديل
   - «حفظ وترحيل / مزامنة»: تُرسل للخادم ثم تُحذف محلياً نهائياً
   - اسم المدخل يُملأ تلقائياً من الجلسة
   ========================================================= */
(async function () {
  let me = null;
  try { me = await currentMe(); } catch (e) { location.replace('login.html'); return; }
  if (me.settings && me.settings.reportHeaderConfig && typeof updateReportHeaderConfig === 'function') {
    updateReportHeaderConfig(me.settings.reportHeaderConfig);
  }
  // المدير يستطيع استخدام واجهة الإدخال أيضاً عند الحاجة، من دون إجباره
  // على المرور بحساب مستخدم إدخال أو منحه صلاحية منفصلة.

  // عناصر الواجهة
  const $ = id => document.getElementById(id);
  const draftBox = $('draftBox'), formCard = $('formCard');
  const u = me.user;
  const org = me.organization;
  if (org) {
    if (document.getElementById('orgBrandTitle')) document.getElementById('orgBrandTitle').textContent = org.orgName || 'إدخال البيانات';
    if (document.getElementById('orgBrandSubtitle')) document.getElementById('orgBrandSubtitle').textContent = 'منظومة: ' + (org.orgName || '') + ' (' + (org.orgCode || '') + ')';
    if (document.getElementById('orgBadgeText')) document.getElementById('orgBadgeText').textContent = org.orgName + ' (' + org.orgCode + ')';
  }
  $('userNameTop').textContent = u.fullName + (u.role === 'Admin' ? ' (مدير)' : '');
  if (u.role === 'Admin') $('userAv').textContent = '👑';

  // إظهار الأقسام المصرح للمستخدم بالانتقال إليها
  const hasAnyAdminPerm = u.role === 'Admin' || u.canDash || u.canReports || u.canEvents || u.canUsers || u.canSettings;
  if (hasAnyAdminPerm) {
    if ($('adminNav')) $('adminNav').style.display = 'grid';
    if ($('eNavDash')) $('eNavDash').style.display = (u.role === 'Admin' || u.canDash) ? 'flex' : 'none';
    if ($('eNavReports')) $('eNavReports').style.display = (u.role === 'Admin' || u.canReports) ? 'flex' : 'none';
    if ($('eNavEvents')) $('eNavEvents').style.display = (u.role === 'Admin' || u.canEvents) ? 'flex' : 'none';
    if ($('eNavUsers')) $('eNavUsers').style.display = (u.role === 'Admin' || u.canUsers) ? 'flex' : 'none';
    if ($('eNavSettings')) $('eNavSettings').style.display = (u.role === 'Admin' || u.canSettings) ? 'flex' : 'none';
  } else {
    if ($('adminNav')) $('adminNav').style.display = 'none';
  }
  if ($('permChips')) $('permChips').innerHTML = permBadges(u);
  $('lockOut').style.display = 'none';

  // شاشة قفل الصلاحيات
  const canAccessEntry = me.user.role === 'Admin' || me.user.canEntry || me.user.canAdd || me.user.canOpen;
  if (!canAccessEntry) {
    $('lockTitle').textContent = '⚠️ صلاحية الإدخال غير متاحة حالياً';
    $('lockDesc').textContent = 'لم يمنحك مدير النظام صلاحية إدخال البيانات بعد.';
    $('lockOut').style.display = 'grid';
    $('entryRoot').style.display = 'none';
    return;
  }
  $('entryRoot').style.display = 'block';

  let edits = {};       // حقل -> قيمة
  let photos = [];      // صور باسم base64
  let currentDraftId = null;
  let busy = false;
  let isSyncingQueue = false;

  /* ---------- فحص حالة الاتصال بالسيرفر وطابور المعلقات ---------- */
  async function checkServerStatusAndPending() {
    const list = myLocalDrafts();
    const pending = list.filter(d => d.syncStatus === 'pending');
    if ($('pendingBadgeCount')) $('pendingBadgeCount').textContent = pending.length;
    if ($('btnSyncAllNow')) $('btnSyncAllNow').style.display = pending.length ? 'inline-flex' : 'none';

    try {
      const res = await testServerConnection(getServerBaseUrl());
      if ($('syncDotStatus')) $('syncDotStatus').textContent = '🟢';
      if ($('syncStatusText')) {
        $('syncStatusText').textContent = 'متصل بالخادم المركزي';
      }
      if ($('syncStatusBanner')) {
        $('syncStatusBanner').style.background = '#f0fdf4';
        $('syncStatusBanner').style.borderColor = '#bbf7d0';
        $('syncStatusBanner').style.color = '#15803d';
      }

      // إذا وُجدت تقارير معلقة في طابور الانتظار، ابدأ المزامنة التلقائية في الخلفية
      if (pending.length && !isSyncingQueue) {
        runAutoSyncQueue();
      }
    } catch (e) {
      if ($('syncDotStatus')) $('syncDotStatus').textContent = '🔴';
      if ($('syncStatusText')) {
        $('syncStatusText').textContent = pending.length
          ? `غير متصل بالخادم (يوجد ${pending.length} تقارير معلقة — ستتم المزامنة تلقائياً فور توفر الإنترنت)`
          : 'غير متصل بالخادم المركزي (التقارير تُحفظ محلياً على جهازك)';
      }
      if ($('syncStatusBanner')) {
        $('syncStatusBanner').style.background = '#fffbeb';
        $('syncStatusBanner').style.borderColor = '#fef08a';
        $('syncStatusBanner').style.color = '#854d0e';
      }
    }
  }

  /* ---------- محرك المزامنة التلقائية لطابور الانتظار ---------- */
  async function runAutoSyncQueue() {
    if (isSyncingQueue) return;
    const pending = myLocalDrafts().filter(d => d.syncStatus === 'pending');
    if (!pending.length) return;
    isSyncingQueue = true;
    if ($('btnSyncAllNow')) {
      $('btnSyncAllNow').disabled = true;
      $('btnSyncAllNow').textContent = '⏳ جارٍ المزامنة...';
    }

    let syncedCount = 0;
    for (const d of pending) {
      try {
        const r = await api('/reports', {
          method: 'POST',
          body: JSON.stringify({ report: { ...d.fields, images: d.photos || [] } })
        });
        // نجاح المزامنة -> إزالة التقرير من الجهاز
        const updated = loadLocalDrafts().filter(x => x.id !== d.id);
        saveLocalDrafts(updated);
        syncedCount++;
        toast(`✅ تمت مزامنة التقرير (${d.fields?.subject || d.id}) وحجز رقم رسمي: ${r.reportNumber}`);
      } catch (err) {
        // انقطع الاتصال، توقف مؤقتاً
        console.warn('Auto sync paused:', err.message);
        break;
      }
    }

    isSyncingQueue = false;
    if ($('btnSyncAllNow')) {
      $('btnSyncAllNow').disabled = false;
      $('btnSyncAllNow').innerHTML = `⚡ مزامنة كل المعلقات (<span id="pendingBadgeCount">0</span>)`;
    }
    renderDrafts();
    checkServerStatusAndPending();
  }

  if ($('btnSyncAllNow')) $('btnSyncAllNow').onclick = () => runAutoSyncQueue();

  window.addEventListener('online', () => {
    toast('📶 تم استعادة الاتصال بالإنترنت — جارٍ التحقق والمزامنة...', 'info');
    checkServerStatusAndPending();
  });
  window.addEventListener('offline', () => {
    checkServerStatusAndPending();
  });
  setInterval(checkServerStatusAndPending, (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.autoSyncIntervalMs) || 15000);

  /* ---------- استرجاع المسودات المحلية ---------- */
  function loadLocalDrafts() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveLocalDrafts(list) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function myLocalDrafts() {
    return loadLocalDrafts().filter(d => d.enteredByUserId === me.user.id);
  }

  function renderDrafts() {
    let list = myLocalDrafts();
    const searchVal = $('draftSearch') ? $('draftSearch').value.trim().toLowerCase() : '';
    if (searchVal) {
      list = list.filter(d => {
        const f = d.fields || d;
        return (f.reportNumber || '').toLowerCase().includes(searchVal) ||
               (f.subject || '').toLowerCase().includes(searchVal) ||
               (f.target || '').toLowerCase().includes(searchVal) ||
               (f.location || '').toLowerCase().includes(searchVal) ||
               (f.details || '').toLowerCase().includes(searchVal);
      });
    }
    if (!list.length && !searchVal) {
      draftBox.style.display = 'none';
      formCard.style.display = 'block';
      startNewDraft();
      checkServerStatusAndPending();
      return;
    }
    draftBox.style.display = 'block';
    formCard.style.display = 'none';
    $('draftList').innerHTML = list.length ? list.map(d => {
      const f = d.fields || d;
      const reportNum = f.reportNumber || d.reportNumber || 'بدون رقم';
      const subj = f.subject || d.subject || 'بلا موضوع';
      const targetStr = f.target ? ` • الجهة: ${esc(f.target)}` : '';
      const p = d.photos ? d.photos.length : 0;
      const isPending = d.syncStatus === 'pending';

      const badgeHtml = isPending
        ? `<div class="rep-badge" style="background:#fef3c7;color:#b45309;border:1px solid #fde68a">⏳ في طابور المزامنة</div>`
        : `<div class="rep-badge">مسودة</div>`;

      return `
        <div class="draft-item" style="${isPending ? 'border-right:4px solid #f59e0b;background:#fffdfa' : ''}">
          <div class="rep-row">
            ${badgeHtml}
            <div class="rep-main">
              <div class="t" style="font-size:15px;font-weight:800;color:var(--primary-dark)">📌 ${esc(subj)}</div>
              <div class="s" style="margin-top:4px">
                رقم التقرير: <b>${esc(reportNum)}</b>${targetStr} &nbsp;•&nbsp;
                ${isPending ? '<b style="color:#b45309">بانتظار الإنترنت للمزامنة</b> • ' : ''}
                آخر حفظ: ${fmtDateTime(d.updatedAt)} &nbsp;•&nbsp; ${p > 0 ? '📎 ' + p + ' مرفقات' : 'بدون مرفقات'}
              </div>
            </div>
          </div>
          <div class="btn-row">
            <button class="btn btn-outline btn-sm" id="openDraft${d.id}">✏️ فتح وتعديل</button>
            ${isPending ? `<button class="btn btn-primary btn-sm" id="syncSingle${d.id}">⚡ مزامنة الآن</button>` : ''}
            <button class="btn btn-danger btn-sm" id="delDraft${d.id}">🗑 حذف</button>
          </div>
        </div>`;
    }).join('') : '<div class="empty">لا توجد مسودات مطابقة للبحث</div>';

    list.forEach(d => {
      if ($('openDraft' + d.id)) $('openDraft' + d.id).onclick = () => openDraft(d.id);
      if ($('syncSingle' + d.id)) $('syncSingle' + d.id).onclick = async () => {
        try {
          const r = await api('/reports', { method: 'POST', body: JSON.stringify({ report: { ...d.fields, images: d.photos || [] } }) });
          saveLocalDrafts(loadLocalDrafts().filter(x => x.id !== d.id));
          toast(`✅ تمت مزامنة التقرير وحجز رقم رسمي: ${r.reportNumber}`);
          renderDrafts();
          checkServerStatusAndPending();
        } catch (e) {
          toast('تعذر المزامنة: ' + e.message, 'err');
        }
      };
      if ($('delDraft' + d.id)) $('delDraft' + d.id).onclick = () => {
        const list2 = loadLocalDrafts().filter(x => x.id !== d.id);
        saveLocalDrafts(list2);
        toast('تم حذف التقرير محلياً', 'err');
        renderDrafts();
        checkServerStatusAndPending();
      };
    });
    checkServerStatusAndPending();
  }
  if ($('draftSearch')) $('draftSearch').oninput = () => renderDrafts();

  function startNewDraft() {
    currentDraftId = null;
    edits = {};
    photos = [];
    // رقم التقرير مؤقت للمسودة وسيتم إنشاء الرقم المتسلسل الرسمي تلقائياً عند المزامنة للسيرفر
    $('fReportNumber').value = 'مسودة مؤقتة #' + Math.floor(100 + Math.random() * 900);
    $('fSubject').value = '';
    $('fTarget').value = '';
    $('fDate').value = todayStr();
    $('fTime').value = '';
    $('fLocation').value = '';
    $('fDetails').value = '';
    $('fEnteredBy').value = me.user.fullName;
    $('photoGrid').innerHTML = '<label class="photo-add" id="photoAddBtn">📎<br/>إضافة مرفق / وسائط</label>';
    bindPhotoAdd();
    $('pageTitle').textContent = 'تقرير جديد';
    $('saveDraftBtn').textContent = '💾 حفظ كمسودة';
    $('syncBtn').textContent = '🚀 حفظ وترحيل / مزامنة';
    $('saveMsg').textContent = 'ملاحظة: إذا لم يتوفر اتصال بالإنترنت، سيتم وضع التقرير في قائمة الانتظار وترحيله تلقائياً فور توفر الاتصال.';
  }

  function bindPhotoAdd() {
    const btn = $('photoAddBtn');
    if (!btn) return;
    btn.onclick = () => $('photoInput').click();
  }

  function openDraft(id) {
    const d = loadLocalDrafts().find(x => x.id === id);
    if (!d) return;
    currentDraftId = d.id;
    edits = { ...(d.fields || {}) };
    photos = d.photos || [];
    draftBox.style.display = 'none';
    formCard.style.display = 'block';
    const f = edits;
    $('fReportNumber').value = f.reportNumber || '';
    $('fSubject').value = f.subject || '';
    $('fTarget').value = f.target || '';
    $('fDate').value = f.reportDate || todayStr();
    $('fTime').value = f.reportTime || '';
    $('fLocation').value = f.location || '';
    $('fDetails').value = f.details || '';
    $('fEnteredBy').value = me.user.fullName;
    renderPhotos();
    $('pageTitle').textContent = 'تعديل مسودة: ' + (f.reportNumber || '');
    $('saveMsg').textContent = d.syncStatus === 'pending'
      ? '⏳ هذا التقرير في طابور الانتظار للمزامنة التلقائية بمجرد توفر الإنترنت.'
      : 'أنت تعدّل مسودة محفوظة على هذا الجهاز فقط — لن تظهر للمدير حتى تضغط «حفظ وترحيل».';
  }

  function renderPhotos() {
    $('photoGrid').innerHTML =
      photos.map((p, i) => {
        const att = normalizeAttachment(p, i);
        const isImg = att.type.startsWith('image/');
        const isVid = att.type.startsWith('video/');
        const icon = getAttachmentIcon(att.type, att.name);
        const sizeStr = formatBytes(att.size);

        if (isImg) {
          return `
            <div class="photo-tile">
              <img src="${att.data}" alt="${esc(att.name)}" title="${esc(att.name)}" />
              <span style="position:absolute;bottom:4px;right:6px;left:6px;background:rgba(0,0,0,0.65);color:#fff;font-size:10.5px;padding:2px 4px;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(att.name)}">${esc(att.name)}</span>
              <button class="rm" data-i="${i}" title="حذف المرفق">✕</button>
            </div>`;
        } else if (isVid) {
          return `
            <div class="photo-tile" style="background:#0f172a">
              <video src="${att.data}" preload="metadata" muted></video>
              <div style="position:absolute;top:38%;left:50%;transform:translate(-50%,-50%);font-size:26px;pointer-events:none;opacity:0.9">🎬</div>
              <span style="position:absolute;bottom:4px;right:6px;left:6px;background:rgba(0,0,0,0.75);color:#fff;font-size:10.5px;padding:2px 4px;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(att.name)}">${esc(att.name)}</span>
              <button class="rm" data-i="${i}" title="حذف المرفق">✕</button>
            </div>`;
        } else {
          return `
            <div class="photo-tile">
              <div class="doc-preview">
                <div class="icon">${icon}</div>
                <div class="name" title="${esc(att.name)}">${esc(att.name)}</div>
                <div class="size">${sizeStr}</div>
              </div>
              <button class="rm" data-i="${i}" title="حذف المرفق">✕</button>
            </div>`;
        }
      }).join('') +
      `<label class="photo-add" id="photoAddBtn">📎<br/>إضافة مرفق / وسائط</label>`;

    document.querySelectorAll('.photo-tile .rm').forEach(b => {
      b.onclick = () => {
        photos.splice(parseInt(b.dataset.i, 10), 1);
        renderPhotos();
      };
    });
    bindPhotoAdd();

    // إجمالي حجم المرفقات
    const totalBytes = photos.reduce((s, p) => {
      const att = normalizeAttachment(p, 0);
      return s + (att.size || (att.data ? Math.round(att.data.length * 0.75) : 0));
    }, 0);
    $('photoSize').textContent = photos.length ? `📎 المرفقات: ${photos.length} ملفات — الحجم الإجمالي: ${formatBytes(totalBytes)} (تُرسل عند المزامنة)` : '';
  }

  /* ---------- حفظ الحقول ---------- */
  function readFields() {
    return {
      reportNumber: $('fReportNumber').value.trim(),
      subject: $('fSubject').value.trim(),
      target: $('fTarget').value.trim(),
      reportDate: $('fDate').value,
      reportTime: $('fTime').value,
      location: $('fLocation').value.trim(),
      details: $('fDetails').value.trim()
    };
  }
  $('fReportNumber').oninput = e => edits.reportNumber = e.target.value;
  $('fSubject').oninput = e => edits.subject = e.target.value;
  $('fTarget').oninput = e => edits.target = e.target.value;
  if ($('fLogo')) $('fLogo').onchange = e => edits.logoId = e.target.value;
  $('fDate').oninput = e => edits.reportDate = e.target.value;
  $('fTime').oninput = e => edits.reportTime = e.target.value;
  $('fLocation').oninput = e => edits.location = e.target.value;
  $('fDetails').oninput = e => edits.details = e.target.value;
  $('photoInput').onchange = function () {
    const files = Array.from(this.files || []);
    files.forEach(file => {
      if (file.size > 25 * 1024 * 1024) {
        toast(file.name + ' أكبر من 25MB — تم تجاوزه', 'err');
        return;
      }
      const r = new FileReader();
      r.onload = () => {
        photos.push({
          id: 'att_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          data: r.result
        });
        renderPhotos();
      };
      r.readAsDataURL(file);
    });
    this.value = '';
  };

  /* ---------- حفظ كمسودة ---------- */
  $('saveDraftBtn').onclick = () => {
    const f = readFields();
    if (!f.reportNumber) { toast('رقم التقرير مطلوب', 'err'); return; }
    if (!f.subject) { toast('موضوع التقرير مطلوب', 'err'); return; }
    let list = loadLocalDrafts();
    if (currentDraftId) {
      const i = list.findIndex(x => x.id === currentDraftId);
      if (i >= 0) list[i] = { ...list[i], fields: f, photos, syncStatus: 'draft', updatedAt: new Date().toISOString() };
    } else {
      list.push({
        id: 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        enteredByUserId: me.user.id,
        createdDraftAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'draft',
        fields: f, photos
      });
    }
    saveLocalDrafts(list);
    toast('تم حفظ المسودة على هذا الجهاز ✔');
    renderDrafts();
  };

  /* ---------- حفظ وترحيل / مزامنة ---------- */
  $('syncBtn').onclick = async () => {
    if (busy) return;
    const f = readFields();
    if (!f.reportNumber) { toast('رقم التقرير مطلوب', 'err'); return; }
    if (!f.subject) { toast('موضوع التقرير مطلوب', 'err'); return; }
    busy = true;
    $('syncBtn').disabled = true;
    $('saveDraftBtn').disabled = true;

    try {
      const r = await api('/reports', {
        method: 'POST',
        body: JSON.stringify({ report: { ...f, images: photos } })
      });
      // نجحت المزامنة المباشرة
      if (currentDraftId) {
        saveLocalDrafts(loadLocalDrafts().filter(x => x.id !== currentDraftId));
      }
      toast(r.message || '✅ تمت المزامنة بنجاح وحجز رقم التقرير الرسمي');
      $('syncMsg').textContent = (r.message || 'تم ترحيل التقرير إلى قاعدة بيانات النظام.') + ' لا يمكن فتحه من هذا الجهاز مجدداً.';
      setTimeout(() => { location.href = 'entry.html'; }, 2000);
    } catch (err) {
      // تعذر الاتصال بالسيرفر → حفظ التقرير في طابور الانتظار للمزامنة التلقائية
      let list = loadLocalDrafts();
      if (currentDraftId) {
        const i = list.findIndex(x => x.id === currentDraftId);
        if (i >= 0) list[i] = { ...list[i], fields: f, photos, syncStatus: 'pending', queuedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      } else {
        list.push({
          id: 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          enteredByUserId: me.user.id,
          createdDraftAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          syncStatus: 'pending',
          queuedAt: new Date().toISOString(),
          fields: f, photos
        });
      }
      saveLocalDrafts(list);
      if (err.message && (err.message.includes('بانتظار اعتماد') || err.message.includes('حظر') || err.message.includes('قيد المراجعة'))) {
        toast(err.message, 'err');
      } else {
        toast('⚠️ لا يوجد اتصال بالسيرفر حالياً — تم وضع التقرير في قائمة الانتظار وستتم المزامنة تلقائياً بمجرد توفر الإنترنت 🚀', 'info');
      }
      busy = false;
      $('syncBtn').disabled = false;
      $('saveDraftBtn').disabled = false;
      renderDrafts();
      checkServerStatusAndPending();
    }
  };

  $('backToListBtn').onclick = () => { renderDrafts(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const btnNewTop = $('btnNewReportTop');
  if (btnNewTop) {
    btnNewTop.onclick = () => {
      draftBox.style.display = 'none';
      formCard.style.display = 'block';
      startNewDraft();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  /* ================= مهام وتكليفات الموظف (My Tasks & Events) ================= */
  let myTasksList = [];
  let currentActiveFeedbackTaskId = null;

  function getMyEventTypeBadge(type) {
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

  async function loadMyTasks() {
    try {
      const res = await api('/events/mine');
      myTasksList = res.events || [];
      const pendingCount = myTasksList.filter(x => x.status === 'pending').length;

      if ($('myTasksBadge')) {
        $('myTasksBadge').textContent = pendingCount;
        $('myTasksBadge').style.display = pendingCount > 0 ? 'inline-block' : 'none';
      }

      if ($('myTasksAlertCount')) {
        $('myTasksAlertCount').textContent = pendingCount > 0 ? `${pendingCount} جديدة بانتظار الاستلام` : `${myTasksList.length} مهام مسندة`;
        $('myTasksAlertCount').className = pendingCount > 0 ? 'badge warn' : 'badge green';
      }

      const container = $('myTasksList');
      if (!container) return;

      if (!myTasksList.length) {
        container.innerHTML = `
          <div class="empty" style="padding:32px 16px;text-align:center">
            <div style="font-size:42px;margin-bottom:8px">🎉</div>
            <div style="font-size:15px;font-weight:800;color:var(--text)">لا توجد أي مهام أو تكليفات مسندة إليك حالياً</div>
            <p style="color:var(--muted);font-size:13px;margin-top:4px">عندما يقوم المدير بإسناد مهمة أو فعالية لحسابك، ستصلك فوراً هنا.</p>
          </div>`;
        return;
      }

      container.innerHTML = myTasksList.map(t => {
        const isPending = t.status === 'pending';
        const isReceived = t.status === 'received' || t.status === 'in_progress';
        const isCompleted = t.status === 'completed';

        let statusBadge = '';
        if (isCompleted) {
          statusBadge = `<span class="badge green">✅ مكتملة (${fmtDateTime(t.completedAt)})</span>`;
        } else if (isReceived) {
          statusBadge = `<span class="badge blue">📬 تم تأكيد استلامك للمهمة (${fmtDateTime(t.receivedAt)})</span>`;
        } else {
          statusBadge = `<span class="badge warn">⏳ مهمة جديدة بانتظار تأكيد استلامك</span>`;
        }

        return `
          <div class="card" style="padding:16px;border:1px solid ${isPending ? '#fde68a' : (isCompleted ? '#bbf7d0' : 'var(--border)')};background:${isPending ? '#fffdf7' : '#ffffff'};border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px">
              <div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  ${getMyEventTypeBadge(t.eventType)}
                  <h3 style="margin:0;font-size:16px;font-weight:900;color:var(--text)">${esc(t.title)}</h3>
                </div>
                <div style="font-size:12px;color:var(--muted);margin-top:4px">
                  كُلفت من: <b>${esc(t.createdBy || 'المدير')}</b> • بتاريخ: ${fmtDateTime(t.createdDate)}
                </div>
              </div>
              <div>${statusBadge}</div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;background:#f8fafc;padding:10px 12px;border-radius:8px;font-size:12.5px;margin-bottom:12px">
              <div>📅 <b>تاريخ التنفيذ:</b> ${esc(t.eventDate || '—')}</div>
              <div>⏰ <b>الوقت:</b> ${esc(t.eventTime || 'غير محدد')}</div>
              <div style="grid-column:1/-1">📍 <b>المكان / الموقع:</b> ${esc(t.location || 'غير محدد')}</div>
            </div>

            <div style="margin-bottom:14px">
              <div style="font-size:12.5px;font-weight:800;color:var(--text);margin-bottom:4px">📝 تفاصيل وتعليمات المهمة:</div>
              <div style="font-size:13px;line-height:1.8;color:#334155;background:#fff;border:1px solid var(--border);border-radius:6px;padding:10px;white-space:pre-wrap">${esc(t.notes || 'لا توجد تعليمات إضافية')}</div>
            </div>

            ${t.feedbackNotes ? `
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:12.5px">
                <b style="color:#166534">💬 تغذيتك الراجعة المرسلة للمدير:</b>
                <div style="color:#1e293b;margin-top:2px;white-space:pre-wrap">${esc(t.feedbackNotes)}</div>
              </div>
            ` : ''}

            <div class="btn-row" style="gap:8px;flex-wrap:wrap;border-top:1px dashed var(--line);padding-top:12px">
              ${isPending ? `
                <button class="btn btn-primary btn-sm" data-confirm-receive="${t.id}" style="font-weight:800;padding:8px 16px">
                  📬 تأكيد استلام المهمة (إشعار المدير بالاستلام)
                </button>
              ` : ''}

              ${!isCompleted ? `
                <button class="btn btn-secondary btn-sm" data-complete-task="${t.id}" style="font-weight:700">
                  ✅ تم إنجاز المهمة وإرسال التغذية الراجعة
                </button>
              ` : `
                <button class="btn btn-outline btn-sm" data-feedback-task="${t.id}">
                  💬 تعديل التغذية الراجعة
                </button>
              `}

              <button class="btn btn-danger btn-sm" data-delete-task="${t.id}" style="margin-right:auto" title="حذف المهمة نهائياً من هاتفك">
                🗑️ حذف من التطبيق
              </button>
            </div>
          </div>
        `;
      }).join('');

      // ربط أزرار تفاعل الموظف مع المهمة
      container.querySelectorAll('[data-confirm-receive]').forEach(b => {
        b.onclick = async () => {
          b.disabled = true;
          b.textContent = '⏳ جارٍ التأكيد...';
          try {
            await api(`/events/${b.dataset.confirmReceive}/status`, {
              method: 'PUT',
              body: JSON.stringify({ status: 'received' })
            });
            toast('تم تأكيد استلام المهمة وتوثيق الوقت للمدير بنجاح ✔');
            loadMyTasks();
          } catch(err) {
            toast('تعذر تأكيد الاستلام: ' + err.message, 'err');
            b.disabled = false;
            b.textContent = '📬 تأكيد استلام المهمة';
          }
        };
      });

      container.querySelectorAll('[data-complete-task]').forEach(b => {
        b.onclick = () => {
          const item = myTasksList.find(x => x.id === b.dataset.completeTask);
          if (item) openFeedbackModal(item, true);
        };
      });

      container.querySelectorAll('[data-feedback-task]').forEach(b => {
        b.onclick = () => {
          const item = myTasksList.find(x => x.id === b.dataset.feedbackTask);
          if (item) openFeedbackModal(item, false);
        };
      });

      container.querySelectorAll('[data-delete-task]').forEach(b => {
        b.onclick = async () => {
          const item = myTasksList.find(x => x.id === b.dataset.deleteTask);
          if (!item) return;
          if (!confirm(`هل أنت متأكد من حذف المهمة «${item.title}» تماماً من جهازك؟`)) return;
          try {
            await api(`/events/${item.id}`, { method: 'DELETE' });
            toast('تم حذف المهمة تماماً من تطبيقك بنجاح ✔');
            loadMyTasks();
          } catch(err) { toast('تعذر الحذف: ' + err.message, 'err'); }
        };
      });

    } catch(err) {
      console.warn('تعذر تحميل مهام الموظف:', err.message);
    }
  }

  function openFeedbackModal(item, defaultCompleted = true) {
    const modalBack = $('taskFeedbackModal');
    if (!modalBack) return;
    currentActiveFeedbackTaskId = item.id;
    $('tfModalTitle').textContent = defaultCompleted ? `✅ إنجاز المهمة: ${item.title}` : `💬 تغذية راجعة للمدير: ${item.title}`;
    $('tfTaskSummary').innerHTML = `
      <b>📋 المهمة:</b> ${esc(item.title)}<br/>
      <b>📍 المكان:</b> ${esc(item.location || '—')} &nbsp;•&nbsp; <b>📅 التاريخ:</b> ${esc(item.eventDate || '—')}
    `;
    $('tfNotes').value = item.feedbackNotes || '';
    $('tfMarkCompleted').checked = defaultCompleted || item.status === 'completed';
    modalBack.classList.add('show');
    $('tfNotes').focus();
  }

  if ($('tfCloseBtn')) $('tfCloseBtn').onclick = () => $('taskFeedbackModal')?.classList.remove('show');
  if ($('tfCancelBtn')) $('tfCancelBtn').onclick = () => $('taskFeedbackModal')?.classList.remove('show');

  if ($('tfSubmitBtn')) {
    $('tfSubmitBtn').onclick = async () => {
      if (!currentActiveFeedbackTaskId) return;
      const notes = $('tfNotes').value.trim();
      const markCompleted = $('tfMarkCompleted').checked;
      const targetStatus = markCompleted ? 'completed' : 'in_progress';

      $('tfSubmitBtn').disabled = true;
      $('tfSubmitBtn').textContent = '⏳ جارٍ الإرسال...';
      try {
        await api(`/events/${currentActiveFeedbackTaskId}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: targetStatus, feedbackNotes: notes })
        });
        toast('تم إرسال التغذية الراجعة وتحديث حالة المهمة للمدير بنجاح ✔');
        $('taskFeedbackModal')?.classList.remove('show');
        loadMyTasks();
      } catch(err) {
        toast('خطأ في إرسال التغذية الراجعة: ' + err.message, 'err');
      } finally {
        $('tfSubmitBtn').disabled = false;
        $('tfSubmitBtn').textContent = '🚀 إرسال التغذية الراجعة للمدير';
      }
    };
  }

  /* تبديل العرض بين شاشة إدخال التقارير وشاشة مهام الموظف */
  function showTasksView() {
    if ($('myTasksBox')) $('myTasksBox').style.display = 'block';
    if ($('draftBox')) $('draftBox').style.display = 'none';
    if ($('formCard')) $('formCard').style.display = 'none';
    if ($('entryReportsHead')) $('entryReportsHead').style.display = 'none';
    if ($('eNavMyTasks')) $('eNavMyTasks').classList.add('active');
    if ($('eNavEntry')) $('eNavEntry').classList.remove('active');
    loadMyTasks();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showReportsView() {
    if ($('myTasksBox')) $('myTasksBox').style.display = 'none';
    if ($('entryReportsHead')) $('entryReportsHead').style.display = 'flex';
    if ($('eNavMyTasks')) $('eNavMyTasks').classList.remove('active');
    if ($('eNavEntry')) $('eNavEntry').classList.add('active');
    renderDrafts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if ($('eNavMyTasks')) $('eNavMyTasks').onclick = showTasksView;
  if ($('btnToggleTasksView')) $('btnToggleTasksView').onclick = showTasksView;
  if ($('eNavEntry')) $('eNavEntry').onclick = showReportsView;
  if ($('btnBackToReportsFromTasks')) $('btnBackToReportsFromTasks').onclick = showReportsView;
  if ($('btnRefreshMyTasks')) $('btnRefreshMyTasks').onclick = loadMyTasks;

  bindPhotoAdd();
  renderDrafts();
  loadMyTasks();
})();
