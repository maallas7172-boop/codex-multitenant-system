/* =========================================================
   report-header.js — الملف الموحد لترويسة التقارير
   - يحتوي على الترويسة الموحدة للنظام
   - يدعم الخطوط العربية الرسمية والبسملة فوق الشعار
   - يتم تحديثه ومزامنته مباشرة من لوحة تحكم المدير (الإعدادات)
   ========================================================= */

let REPORT_HEADER_CONFIG = {
  // أسطر الجهة في الجانب الأيمن (سطر تحت سطر)
  rightLines: [
    "الجمهورية اليمنية",
    "وزارة النقل",
    "الهيئة العامة لتنظيم شؤون النقل البري",
    "مكتب رئيس الهيئة"
  ],

  // مسار أو صورة الشعار المعتمد (شعار الجمهورية اليمنية)
  logoSrc: "Image/1754379379088.jpg",

  // إظهار البسملة فوق الشعار
  showBasmala: true,
  basmalaText: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",

  // نوع الخط للترويسة (diwani | amiri | ruqaa | cairo | default)
  fontFamily: "diwani",

  // درجة السرية / الوسام (اختياري: اتركه فارغاً '' لإخفائه)
  confidentialityBadge: "خاص وسري",

  // إظهار التاريخ والوقت في الترويسة
  showDateTime: true,

  // إظهار رقم التقرير في الترويسة (معطّل افتراضياً)
  showReportNumber: false
};

/**
 * دالة تحديث وتطبيق إعدادات الترويسة فوراً
 * @param {Object|String} cfg الإعدادات الجديدة
 */
function updateReportHeaderConfig(cfg) {
  if (!cfg) return;
  if (typeof cfg === 'string') {
    try { cfg = JSON.parse(cfg); } catch (e) { return; }
  }
  REPORT_HEADER_CONFIG = { ...REPORT_HEADER_CONFIG, ...cfg };
}

/**
 * دالة إنشاء وتوليد HTML الترويسة الموحدة للتقارير
 * @param {Object} report بيانات التقرير المراد طباعته أو عرضه
 * @param {Object} customOpts إعدادات إضافية اختيارية
 * @returns {String} كود HTML الترويسة الموحدة
 */
function renderReportHeaderHTML(report, customOpts = {}) {
  const r = report || {};
  const cfg = { ...REPORT_HEADER_CONFIG, ...customOpts };

  const reportDate = r.reportDate || (typeof todayStr === 'function' ? todayStr() : '');
  const reportTime = r.reportTime || '';

  // نوع الخط
  let fontClass = 'font-diwani';
  if (cfg.fontFamily === 'amiri') fontClass = 'font-amiri';
  else if (cfg.fontFamily === 'ruqaa') fontClass = 'font-ruqaa';
  else if (cfg.fontFamily === 'cairo') fontClass = 'font-cairo';
  else if (cfg.fontFamily === 'default') fontClass = 'font-sans';

  // توليد أسطر الجهة على اليمين بحيث تكون متوسطة فوق بعضها بشكل منظم
  let rightHtml = '';
  let lines = cfg.rightLines;
  if (typeof lines === 'string') {
    lines = lines.split('\n').map(x => x.trim()).filter(Boolean);
  }
  if (Array.isArray(lines) && lines.length > 0) {
    rightHtml = lines.map((line, idx) => {
      const cls = idx === 0 ? 'hdr-line-main' : 'hdr-line-sub';
      return `<div class="${cls}">${esc(line)}</div>`;
    }).join('');
  } else {
    rightHtml = `
      <div class="hdr-line-main">${esc(cfg.orgName || 'الجمهورية اليمنية')}</div>
      <div class="hdr-line-sub">${esc(cfg.subTitle || '')}</div>
    `;
  }

  // الشعار
  let logoHtml = '';
  if (cfg.logoSrc) {
    logoHtml = `<img src="${esc(cfg.logoSrc)}" alt="الشعار الرسمي" style="max-height:82px; max-width:140px; object-fit:contain; display:block; margin:0 auto;" />`;
  } else if (cfg.logoHtml) {
    logoHtml = cfg.logoHtml;
  }

  // البسملة
  const basmalaHtml = (cfg.showBasmala !== false && cfg.basmalaText) ?
    `<div class="hdr-basmala">${esc(cfg.basmalaText)}</div>` : '';

  return `
    <div class="report-header-master ${fontClass}">
      <div class="hdr-col hdr-right">
        ${rightHtml}
      </div>

      <div class="hdr-col hdr-center">
        ${basmalaHtml}
        <div class="hdr-logo-box">${logoHtml}</div>
        ${cfg.confidentialityBadge ? `<div class="hdr-confidential-tag">${esc(cfg.confidentialityBadge)}</div>` : ''}
      </div>

      <div class="hdr-col hdr-left">
        ${cfg.showDateTime ? `<div class="hdr-info-item"><b>التاريخ:</b> <span>${esc(reportDate)}</span></div>` : ''}
        ${cfg.showDateTime && reportTime ? `<div class="hdr-info-item"><b>الوقت:</b> <span>${esc(reportTime)}</span></div>` : ''}
      </div>
    </div>
    <div class="report-header-line"></div>
  `;
}

/**
 * دالة إرجاع تنسيقات CSS الخاصة بالترويسة الموحدة للطباعة والمعاينة
 */
function getReportHeaderCSS() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400;1,700&family=Aref+Ruqaa:wght@400;700&family=Cairo:wght@400;600;700;800;900&display=swap');

    .report-header-master {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 16px;
      background: #ffffff;
      border-radius: 8px;
      direction: rtl;
    }
    .report-header-master.font-diwani {
      font-family: 'Diwani Letter', 'Aref Ruqaa', 'Traditional Arabic', 'Amiri', serif;
    }
    .report-header-master.font-diwani .hdr-line-main {
      font-size: 23px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-align: center;
    }
    .report-header-master.font-diwani .hdr-line-sub {
      font-size: 15.5px;
      font-weight: 700;
      text-align: center;
    }
    .report-header-master.font-diwani .hdr-basmala {
      font-size: 18px;
      font-weight: 700;
      text-align: center;
    }
    .report-header-master.font-amiri {
      font-family: 'Amiri', 'Traditional Arabic', 'Times New Roman', serif;
    }
    .report-header-master.font-ruqaa {
      font-family: 'Aref Ruqaa', 'Traditional Arabic', serif;
    }
    .report-header-master.font-cairo {
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    }
    .report-header-master.font-sans {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    }

    .hdr-col {
      display: flex;
      flex-direction: column;
    }
    .hdr-right {
      flex: 1 1 0%;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 2px;
    }
    .hdr-line-main {
      font-size: 21px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.35;
      letter-spacing: 0.3px;
      text-align: center;
      width: 100%;
      margin: 0 auto 2px auto;
    }
    .hdr-line-sub {
      font-size: 14.5px;
      font-weight: 700;
      color: #334155;
      line-height: 1.35;
      text-align: center;
      width: 100%;
      margin: 0 auto;
    }
    .hdr-center {
      flex: 0 0 auto;
      text-align: center;
      align-items: center;
      justify-content: center;
      padding: 0 16px;
    }
    .hdr-basmala {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 5px;
      letter-spacing: 0.5px;
      text-align: center;
      line-height: 1.2;
    }
    .hdr-logo-box {
      display: flex;
      justify-content: center;
      align-items: center;
      margin: 0 auto 4px auto;
      text-align: center;
    }
    .hdr-logo-box img {
      max-height: 82px;
      max-width: 140px;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .hdr-confidential-tag {
      display: inline-block;
      padding: 3px 12px;
      background: #fef2f2;
      color: #dc2626;
      border: 1px solid #fca5a5;
      border-radius: 12px;
      font-family: 'Segoe UI', Tahoma, 'Cairo', Arial, sans-serif !important;
      font-size: 12px !important;
      font-weight: 700 !important;
      letter-spacing: 0.3px;
      margin: 4px auto 0 auto;
      line-height: 1.35;
      text-shadow: none !important;
    }
    .hdr-left {
      flex: 1 1 0%;
      text-align: left;
      font-size: 13.5px;
      color: #1e293b;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 4px;
      font-family: 'Segoe UI', Tahoma, 'Cairo', Arial, sans-serif !important;
    }
    .hdr-info-item {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      font-family: 'Segoe UI', Tahoma, 'Cairo', Arial, sans-serif !important;
    }
    .hdr-info-item b {
      color: #64748b;
      font-weight: 700;
    }
    .report-header-line {
      height: 3px;
      background: linear-gradient(90deg, #1e293b, #2563eb, #0d9488);
      margin: 12px 0 20px 0;
      border-radius: 2px;
    }
  `;
}
