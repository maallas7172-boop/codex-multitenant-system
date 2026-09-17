/* =========================================================
   login.js — تسجيل الدخول المتعدد (Multi-Tenant Login)
   ========================================================= */
(async function () {
  const msg = document.getElementById('loginMessage');
  const orgCodeInput = document.getElementById('orgCode');
  const orgStatusText = document.getElementById('orgStatusText');
  const btnCheckOrg = document.getElementById('btnCheckOrg');
  const mainTitle = document.getElementById('loginMainTitle');
  const subTitle = document.getElementById('loginSubTitle');

  function show(m, type) {
    msg.textContent = m;
    msg.className = 'login-msg ' + (type || 'err');
    setTimeout(() => { if (msg.textContent === m) msg.className = 'login-msg'; }, 6000);
  }

  // استرجاع رمز الجهة المحفوظ مسبقاً في الهاتف
  const savedOrg = getOrgCode();
  if (savedOrg) {
    orgCodeInput.value = savedOrg;
    checkOrgInfo(savedOrg, false);
  }

  // فحص معلومات الجهة وتحديث عنوان الشاشة
  async function checkOrgInfo(code, showFeedback = true) {
    if (!code) return;
    try {
      if (code === 'CODEX' || code === 'SUPER') {
        orgStatusText.style.display = 'block';
        orgStatusText.style.color = '#2563eb';
        orgStatusText.textContent = '👑 بوابة الدخول للإدارة العليا (Super Admin)';
        mainTitle.textContent = 'لوحة إدارة شركة كودكس للبرمجيات';
        subTitle.textContent = 'الإدارة المركزية للجهات والمؤسسات المشتركة';
        return;
      }
      const data = await api('/public/org-info?orgCode=' + encodeURIComponent(code));
      if (data && data.found) {
        orgStatusText.style.display = 'block';
        orgStatusText.style.color = '#10b981';
        orgStatusText.textContent = '✔ الجهة: ' + data.org.orgName;
        mainTitle.textContent = data.org.orgName;
        subTitle.textContent = 'منظومة الحسابات وإدارة التقارير والمهام الميدانية';
        setOrgCode(code);
      } else {
        orgStatusText.style.display = 'block';
        orgStatusText.style.color = '#ef4444';
        orgStatusText.textContent = '❌ رمز الجهة غير مسجل في النظام';
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
