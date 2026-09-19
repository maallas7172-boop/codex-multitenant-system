/* =========================================================
   login.js — تسجيل الدخول المتعدد (Multi-Tenant Login)
   ========================================================= */
(async function () {
  const msg = document.getElementById('loginMessage');
  const orgCodeInput = document.getElementById('orgCode');
  const orgStatusText = document.getElementById('orgStatusText');
  const btnCheckOrg = document.getElementById('btnCheckOrg');
  const btnScanQr = document.getElementById('btnScanQr');
  const mainTitle = document.getElementById('loginMainTitle');
  const subTitle = document.getElementById('loginSubTitle');

  function show(m, type) {
    msg.textContent = m;
    msg.className = 'login-msg ' + (type || 'err');
    setTimeout(() => { if (msg.textContent === m) msg.className = 'login-msg'; }, 6000);
  }

  // فحص إذا كان الرابط يحتوي على رمز جهة عبر QR Code (مثل ?org=AMANA)
  const urlParams = new URLSearchParams(window.location.search);
  const paramOrg = urlParams.get('org') || urlParams.get('orgCode');
  if (paramOrg && orgCodeInput) {
    orgCodeInput.value = paramOrg.trim().toUpperCase();
    setTimeout(() => checkOrgInfo(paramOrg.trim().toUpperCase(), false), 200);
  }

  if (btnScanQr) {
    btnScanQr.onclick = () => {
      const scanned = prompt('📷 اكتب رمز المؤسسة أو الصق الرابط الممسوح من الباركود:');
      if (scanned) {
        let code = scanned.trim().toUpperCase();
        if (code.includes('org=')) {
          const match = code.match(/org=([^&]+)/i);
          if (match && match[1]) code = decodeURIComponent(match[1]).trim().toUpperCase();
        }
        orgCodeInput.value = code;
        checkOrgInfo(code, true);
      }
    };
  }

  const loginTopLogo = document.getElementById('loginTopLogo');
  const DEFAULT_TITLE = 'إدارة الحسابات';
  const DEFAULT_SUBTITLE = 'منظومة إدارة الحسابات والتقارير المالية والميدانية';
  const DEFAULT_LOGO = 'Image/app_logo.jpg';
  const CODEX_LOGO = 'Image/codex_logo.jpg';

  // استرجاع رمز الجهة المحفوظ مسبقاً في الهاتف
  const savedOrg = getOrgCode();
  if (savedOrg) {
    orgCodeInput.value = savedOrg;
    checkOrgInfo(savedOrg, false);
  }

  // فحص معلومات الجهة وتحديث عنوان وشعار الشاشة
  async function checkOrgInfo(code, showFeedback = true) {
    if (!code) {
      mainTitle.textContent = DEFAULT_TITLE;
      subTitle.textContent = DEFAULT_SUBTITLE;
      if (loginTopLogo) loginTopLogo.src = DEFAULT_LOGO;
      orgStatusText.style.display = 'none';
      return;
    }
    try {
      if (code === 'CODEX' || code === 'SUPER') {
        orgStatusText.style.display = 'block';
        orgStatusText.style.color = '#2563eb';
        orgStatusText.textContent = '👑 بوابة الدخول للإدارة العليا (Super Admin)';
        mainTitle.textContent = 'لوحة إدارة شركة كودكس للبرمجيات';
        subTitle.textContent = 'الإدارة المركزية للجهات والمؤسسات المشتركة';
        if (loginTopLogo) loginTopLogo.src = CODEX_LOGO;
        return;
      }

      // للجهات والمؤسسات الممنوحة النظام: تظهر ترويسة وشعار البرنامج القديم
      const data = await api('/public/org-info?orgCode=' + encodeURIComponent(code));
      if (data && data.found) {
        orgStatusText.style.display = 'block';
        orgStatusText.style.color = '#10b981';
        orgStatusText.textContent = '✔ الجهة: ' + data.org.orgName;
        mainTitle.textContent = DEFAULT_TITLE;
        subTitle.textContent = data.org.orgName + ' — ' + DEFAULT_SUBTITLE;
        if (loginTopLogo) loginTopLogo.src = DEFAULT_LOGO;
        setOrgCode(code);
      } else {
        orgStatusText.style.display = 'block';
        orgStatusText.style.color = '#ef4444';
        orgStatusText.textContent = '❌ رمز الجهة غير مسجل في النظام';
        mainTitle.textContent = DEFAULT_TITLE;
        subTitle.textContent = DEFAULT_SUBTITLE;
        if (loginTopLogo) loginTopLogo.src = DEFAULT_LOGO;
      }
    } catch(e) {
      if (showFeedback) show('تعذر فحص الجهة: ' + e.message, 'err');
    }
  }

  if (btnCheckOrg) {
    btnCheckOrg.onclick = () => {
      const code = orgCodeInput.value.trim().toUpperCase();
      if (!code) return show('يرجى كتابة رمز الجهة أولاً', 'err');
      checkOrgInfo(code, true);
    };
  }

  orgCodeInput.addEventListener('input', () => {
    const val = orgCodeInput.value.trim().toUpperCase();
    if (!val) {
      checkOrgInfo('', false);
    } else if (val === 'CODEX' || val === 'SUPER') {
      checkOrgInfo(val, false);
    }
  });

  orgCodeInput.addEventListener('blur', () => {
    const code = orgCodeInput.value.trim().toUpperCase();
    if (code) checkOrgInfo(code, false);
  });

  // زر إظهار / إخفاء كلمة المرور
  const toggleBtn = document.getElementById('toggleLoginPasswordBtn');
  const pwdInput = document.getElementById('password');
  if (toggleBtn && pwdInput) {
    toggleBtn.onclick = () => {
      if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        toggleBtn.textContent = '🙈';
      } else {
        pwdInput.type = 'password';
        toggleBtn.textContent = '👁️';
      }
    };
  }

  // زر فحص الاتصال بالسيرفر المباشر بدون إظهار أي روابط للمستخدم
  const btnTestConn = document.getElementById('btnTestServerConn');
  const connStatusBox = document.getElementById('connStatusBox');
  if (btnTestConn) {
    btnTestConn.onclick = async () => {
      btnTestConn.disabled = true;
      btnTestConn.innerHTML = '<span>⏳</span><span>جارٍ فحص الاتصال بالسيرفر...</span>';
      if (connStatusBox) connStatusBox.style.display = 'none';

      try {
        const base = getServerBaseUrl() || '';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);
        const res = await fetch((base ? base : '') + '/api/public/org-info?orgCode=DEMO', {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          if (connStatusBox) {
            connStatusBox.style.display = 'block';
            connStatusBox.style.background = '#ecfdf5';
            connStatusBox.style.color = '#047857';
            connStatusBox.style.border = '1px solid #a7f3d0';
            connStatusBox.innerHTML = '🟢 الاتصال بالسيرفر نشط ومستقر تماماً ✔';
          }
        } else {
          throw new Error('استجابة غير متوقعة');
        }
      } catch (err) {
        if (connStatusBox) {
          connStatusBox.style.display = 'block';
          connStatusBox.style.background = '#fef2f2';
          connStatusBox.style.color = '#b91c1c';
          connStatusBox.style.border = '1px solid #fecaca';
          connStatusBox.innerHTML = '🔴 تعذر الاتصال بالسيرفر! يرجى التحقق من اتصال الإنترنت.';
        }
      } finally {
        btnTestConn.disabled = false;
        btnTestConn.innerHTML = '<span>📶</span><span>فحص حالة الاتصال بالسيرفر</span>';
      }
    };
  }

  // تسريع استيقاظ السيرفر السحابي (Pre-warm)
  try {
    const serverUrl = getServerBaseUrl() || '';
    if (serverUrl) fetch(serverUrl + '/api/public/org-info?orgCode=DEMO').catch(() => {});
  } catch(e){}

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const orgCode = orgCodeInput.value.trim().toUpperCase();
    const userName = document.getElementById('userName').value.trim();
    const password = document.getElementById('password').value;

    if (!userName || !password) return show('أدخل اسم المستخدم وكلمة المرور', 'err');
    if (!orgCode && userName.toLowerCase() !== 'superadmin') {
      return show('يرجى إدخال رمز الجهة (Organization Code)', 'err');
    }

    const btn = document.getElementById('loginBtn');
    btn.disabled = true; btn.textContent = 'جارٍ التحقق...';

    try {
      let passwordHash = null;
      try { passwordHash = await sha256Hex(password); } catch(e){ passwordHash = null; }

      let response = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          response = await api('/login', {
            method: 'POST',
            body: JSON.stringify({ orgCode, userName, password, passwordHash })
          });
          break;
        } catch(err) {
          if (attempt === 1 && (err.message.includes('502') || err.message.includes('Cold Start') || err.message.includes('الاستيقاظ'))) {
            btn.textContent = 'السيرفر يستيقظ... انتظر قليلاً';
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
          throw err;
        }
      }

      if (!response || !response.token || !response.user) {
        throw new Error('لم تكتمل استجابة تسجيل الدخول.');
      }

      // حفظ الجلسة ورمز الجهة
      setToken(response.token);
      if (orgCode) setOrgCode(orgCode);
      setMe(response, passwordHash);

      // التوجيه الذكي وفق الدور (SuperAdmin / OrgAdmin / Employee)
      if (response.isSuperAdmin || response.user.role === 'SuperAdmin') {
        show('تم الدخول كمدير أعلى للنظام بنجاح ✔', 'ok');
        setTimeout(() => { location.href = 'super_admin.html'; }, 400);
        return;
      }

      const u = response.user;
      const isOrgAdminUser = u.role === 'Admin' || u.canDash || u.canUsers || u.canSettings;
      if (isOrgAdminUser) {
        show('تم الدخول بنجاح إلى لوحة تحكم الجهة ✔', 'ok');
        setTimeout(() => { location.href = 'admin.html'; }, 400);
      } else {
        show('تم الدخول بنجاح إلى واجهة العمل الميداني ✔', 'ok');
        setTimeout(() => { location.href = 'entry.html'; }, 400);
      }

    } catch(err) {
      show(err.message, 'err');
      btn.disabled = false; btn.textContent = 'تسجيل الدخول';
    }
  });
})();
