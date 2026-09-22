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

  // توليد أسطر الجهة على اليمين بحيث تكون متوسطة فوق بعضها بشكل منظم ومتناسق تماماً
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
    logoHtml = `<img src="${esc(cfg.logoSrc)}" alt="الشعار الرسمي" style="max-height:80px; max-width:140px; object-fit:contain; display:block; margin:0 auto;" />`;
  } else if (cfg.logoHtml) {
    logoHtml = cfg.logoHtml;
  }

  // البسملة
  const basmalaHtml = (cfg.showBasmala !== false && cfg.basmalaText) ?
    `<div class="hdr-basmala">${esc(cfg.basmalaText)}</div>` : '';

  return `
    <style>${getReportHeaderCSS()}</style>
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
      display: flex !important;
      flex-direction: row !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 10px 16px !important;
      background: #ffffff !important;
      border-radius: 8px !important;
      direction: rtl !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    .report-header-master.font-diwani,
    .report-header-master.font-diwani .hdr-line-main,
    .report-header-master.font-diwani .hdr-line-sub,
    .report-header-master.font-diwani .hdr-basmala {
      font-family: 'Aref Ruqaa', 'Amiri', 'Traditional Arabic', 'Simplified Arabic', serif !important;
    }
    .report-header-master.font-amiri,
    .report-header-master.font-amiri .hdr-line-main,
    .report-header-master.font-amiri .hdr-line-sub,
    .report-header-master.font-amiri .hdr-basmala {
      font-family: 'Amiri', 'Traditional Arabic', 'Times New Roman', serif !important;
    }
    .report-header-master.font-ruqaa,
    .report-header-master.font-ruqaa .hdr-line-main,
    .report-header-master.font-ruqaa .hdr-line-sub,
    .report-header-master.font-ruqaa .hdr-basmala {
      font-family: 'Aref Ruqaa', 'Traditional Arabic', serif !important;
    }
    .report-header-master.font-cairo,
    .report-header-master.font-cairo .hdr-line-main,
    .report-header-master.font-cairo .hdr-line-sub,
    .report-header-master.font-cairo .hdr-basmala {
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif !important;
    }
    .report-header-master.font-sans {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif !important;
    }

    .report-header-master .hdr-col {
      display: flex !important;
      flex-direction: column !important;
    }
    .report-header-master .hdr-right {
      flex: 0 0 auto !important;
      min-width: 220px !important;
      text-align: center !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: center !important;
      align-items: center !important;
      gap: 2px !important;
      margin: 0 !important;
    }
    .report-header-master .hdr-line-main {
      font-size: 22px !important;
      font-weight: 800 !important;
      color: #0f172a !important;
      line-height: 1.35 !important;
      letter-spacing: 0.5px !important;
      text-align: center !important;
      width: 100% !important;
      margin: 0 auto 3px auto !important;
      display: block !important;
    }
    .report-header-master .hdr-line-sub {
      font-size: 13.5px !important;
      font-weight: 700 !important;
      color: #334155 !important;
      line-height: 1.4 !important;
      text-align: center !important;
      width: 100% !important;
      margin: 0 auto !important;
      display: block !important;
    }
    .report-header-master .hdr-center {
      flex: 1 1 auto !important;
      text-align: center !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 0 12px !important;
      display: flex !important;
      flex-direction: column !important;
      margin: 0 !important;
    }
    .report-header-master .hdr-basmala {
      font-size: 16px !important;
      font-weight: 800 !important;
      color: #0f172a !important;
      margin: 0 auto 6px auto !important;
      letter-spacing: 0.5px !important;
      text-align: center !important;
      line-height: 1.25 !important;
      display: block !important;
    }
    .report-header-master .hdr-logo-box {
      display: flex !important;
      justify-content: center !important;
      align-items: center !important;
      margin: 0 auto 4px auto !important;
      text-align: center !important;
    }
    .report-header-master .hdr-logo-box img {
      max-height: 75px !important;
      max-width: 130px !important;
      object-fit: contain !important;
      display: block !important;
      margin: 0 auto !important;
    }
    .report-header-master .hdr-confidential-tag {
      display: inline-block !important;
      padding: 2px 10px !important;
      background: #fef2f2 !important;
      color: #dc2626 !important;
      border: 1px solid #fca5a5 !important;
      border-radius: 10px !important;
      font-family: 'Segoe UI', Tahoma, 'Cairo', Arial, sans-serif !important;
      font-size: 11px !important;
      font-weight: 800 !important;
      letter-spacing: 0.3px !important;
      margin: 4px auto 0 auto !important;
      line-height: 1.35 !important;
      text-shadow: none !important;
      text-align: center !important;
    }
    .report-header-master .hdr-left {
      flex: 0 0 auto !important;
      min-width: 160px !important;
      text-align: left !important;
      font-size: 13px !important;
      color: #1e293b !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: center !important;
      align-items: flex-end !important;
      gap: 3px !important;
      margin: 0 !important;
      font-family: 'Segoe UI', Tahoma, 'Cairo', Arial, sans-serif !important;
    }
    .report-header-master .hdr-info-item {
      display: flex !important;
      justify-content: flex-end !important;
      align-items: center !important;
      gap: 6px !important;
      font-family: 'Segoe UI', Tahoma, 'Cairo', Arial, sans-serif !important;
    }
    .report-header-master .hdr-info-item b {
      color: #64748b !important;
      font-weight: 700 !important;
    }
    .report-header-line {
      height: 3px !important;
      background: linear-gradient(90deg, #1e293b, #2563eb, #0d9488) !important;
      margin: 10px 0 18px 0 !important;
      border-radius: 2px !important;
    }
  `;
}
