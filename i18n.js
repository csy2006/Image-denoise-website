/* ==================== i18n 多语言系统 ==================== */
/**
 * i18n.js — PrismDen 中英双语切换
 * 使用方式：
 *   i18n.setLang('en')  // 切换为英文
 *   i18n.setLang('zh')  // 切换为中文
 *   i18n.t('key')        // 在 JS 中获取翻译文本（toast 等动态文本）
 *
 * HTML 中给需要翻译的元素加 data-i18n="key"
 *   纯文本元素：      <span data-i18n="key">中文</span>
 *   按钮（仅文本）：  <button data-i18n="key">中文</button>
 *   含 SVG 的元素： 把文本部分包在 <span data-i18n="key"> 中
 */

var i18n = (function () {

  'use strict';

  var currentLang = 'zh';

  /* —— 翻译字典 —— */
  var dict = {

    /* 欢迎遮罩 */
    welcomeSubtitle:    { zh: '棱镜降噪 · 图像降噪处理平台',       en: 'PrismDen · Image Denoising Platform' },
    welcomeHint:        { zh: '点击任意位置进入',                   en: 'Click anywhere to enter' },

    /* 导航栏 */
    navHome:            { zh: '首页',           en: 'Home' },
    navFeatures:        { zh: '核心特性',       en: 'Features' },
    navGuide:           { zh: '参数指南',       en: 'Guide' },
    navUpload:           { zh: '图像降噪',       en: 'Denoise' },
    navResult:           { zh: '降噪结果',       en: 'Result' },
    navTicket:           { zh: '旅行票根',       en: 'Ticket' },
    navFilter:           { zh: '创意滤镜',       en: 'Filters' },
    navProfile:          { zh: '个人中心',       en: 'Profile' },
    statusConnecting:    { zh: '等待后端连接...', en: 'Connecting...' },
    statusConnected:     { zh: '后端已连接',     en: 'Connected' },
    statusError:         { zh: '连接失败',       en: 'Connection failed' },
    brandTag:            { zh: ' · 棱镜降噪',   en: ' · PrismDen' },

    /* 首页 */
    heroKanji:         { zh: 'Image Processing · Young__Yang', en: 'Image Processing · Young__Yang' },
    heroSubtitle:       { zh: 'Hash-Accelerated Bilateral Filtering<br>哈希加速双边滤波图像降噪项目', en: 'Hash-Accelerated Bilateral Filtering<br>Image Denoising Project' },
    btnDenoise:        { zh: '即刻降噪',       en: 'Start Denoising' },
    btnFilter:           { zh: '创意滤镜',       en: 'Creative Filters' },
    themeLight:          { zh: '浅色',           en: 'Light' },
    themeDark:           { zh: '深色',           en: 'Dark' },

    /* 核心特性 */
    featBilateral:      { zh: '双边滤波算法',   en: 'Bilateral Filter' },
    featBilateralDesc:  { zh: '空间权重与色彩权重联合保边去噪，精准区分噪声与细节边缘，避免传统高斯滤波导致的模糊', en: 'Joint spatial-color weighting for edge-preserving denoising. Accurately separates noise from detail edges, avoiding blurring caused by traditional Gaussian filters.' },
    featDS:              { zh: '数据结构',       en: 'Data Structures' },
    featDSDesc:          { zh: '综合运用哈希表、链表、大顶堆、队列等数据结构来管理处理流水线', en: 'HashMap, LinkedList, MaxHeap, and Queue to manage the processing pipeline.' },
    featCPP:             { zh: 'C++ 后端',      en: 'C++ Backend' },
    featCPPDesc:         { zh: '原生 C++ HTTP 服务器，LUT 加速双边滤波，Catmull-Rom 双三次上采样，Unsharp Mask 锐化', en: 'Native C++ HTTP server, LUT-accelerated bilateral filter, Catmull-Rom bicubic upsampling, Unsharp Mask sharpening.' },
    featFormat:          { zh: '多格式支持',     en: 'Multi-Format' },
    featFormatDesc:      { zh: '支持 PNG、JPG、JPEG、RAW、BMP、TIFF、WebP 等主流图片格式输入，输出 PNG/JPEG/WebP', en: 'Input: PNG, JPG, JPEG, RAW, BMP, TIFF, WebP. Output: PNG, JPEG, WebP.' },
    btnViewGuide:        { zh: '查看参数指南 →',  en: 'View Guide →' },

    /* 参数指南 */
    guideIntro:          { zh: '调整降噪参数前，先了解两个核心参数的含义与推荐取值，助你快速找到最佳效果', en: 'Before adjusting denoising parameters, learn the meaning and recommended values of the two core parameters to find the best result quickly.' },
    guideSpace:          { zh: '空间半径',       en: 'Spatial Radius' },
    guideSpaceDesc:      { zh: '控制滤波器的<span style="color:var(--orange); font-weight:600;">空间作用范围</span>。数值越大，参与计算的像素距离越远，降噪力度越强，但细节也可能被过度平滑。', en: 'Controls the <span style="color:var(--orange); font-weight:600;">spatial range</span> of the filter. Larger values increase denoising strength but may over-smooth details.' },
    guideRange:          { zh: '颜色阈值',       en: 'Range Threshold' },
    guideRangeDesc:      { zh: '控制<span style="color:var(--orange); font-weight:600;">颜色相似度阈值</span>。数值越小，颜色边界保护越强（边缘越清晰）；数值越大，跨边缘平滑越激进。', en: 'Controls the <span style="color:var(--orange); font-weight:600;">color similarity threshold</span>. Smaller values preserve edges better; larger values smooth more aggressively.' },
    sigmaSLight:        { zh: '1 − 3',         en: '1 − 3' },
    sigmaSLightDesc:    { zh: '轻微降噪，保留最多细节', en: 'Light denoising, most detail preserved' },
    sigmaSRec:          { zh: '4 − 7（推荐）',  en: '4 − 7 (Recommended)' },
    sigmaSRecDesc:      { zh: '日常使用，细节与降噪平衡', en: 'Daily use, balance of detail and denoising' },
    sigmaSStrong:       { zh: '8 − 15',        en: '8 − 15' },
    sigmaSStrongDesc:   { zh: '强力降噪，适合高噪声风景照', en: 'Strong denoising, suitable for noisy landscapes' },
    sigmaRLow:          { zh: '1 − 15',        en: '1 − 15' },
    sigmaRLowDesc:      { zh: '强保边，适合人像、建筑', en: 'Strong edge preservation, for portraits/buildings' },
    sigmaRRec:          { zh: '16 − 40（推荐）', en: '16 − 40 (Recommended)' },
    sigmaRRecDesc:      { zh: '平衡保边与平滑，默认 25', en: 'Balanced, default 25' },
    sigmaRHigh:         { zh: '41 − 100',      en: '41 − 100' },
    sigmaRHighDesc:     { zh: '平滑优先，适合天空、水面等', en: 'Smoothing priority, for sky/water' },
    btnGoParams:         { zh: '去调整参数 →',   en: 'Adjust Parameters →' },

    /* 上传处理 */
    uploadTitle:         { zh: '导入图片',       en: 'Import Image' },
    uploadHint:          { zh: '拖拽或点击导入图片', en: 'Drag or click to import' },
    uploadFormat:        { zh: '支持 PNG · JPG · JPEG · RAW · BMP · TIFF · WebP', en: 'Supports PNG · JPG · JPEG · RAW · BMP · TIFF · WebP' },
    btnChangePhoto:     { zh: '更换照片',       en: 'Change Photo' },
    btnRemovePhoto:     { zh: '移除照片',       en: 'Remove Photo' },
    metaName:            { zh: '文件名',         en: 'File Name' },
    metaFormat:          { zh: '格式',           en: 'Format' },
    metaSize:            { zh: '大小',           en: 'Size' },
    metaCamera:          { zh: '相机参数',       en: 'Camera Info' },
    metaMake:            { zh: '相机制造商',     en: 'Camera Make' },
    metaModel:           { zh: '相机型号',       en: 'Camera Model' },
    metaAperture:       { zh: '光圈',           en: 'Aperture' },
    metaShutter:        { zh: '快门',           en: 'Shutter' },
    metaISO:             { zh: 'ISO',             en: 'ISO' },
    metaFocal:           { zh: '焦距',           en: 'Focal Length' },
    paramTitle:          { zh: '降噪参数',       en: 'Denoising Parameters' },
    btnBackToGuide:     { zh: '← 参数指南',    en: '← Guide' },
    sigmaSLabel:        { zh: '空间半径',       en: 'Spatial Radius' },
    sigmaSScaleL:       { zh: '1 — 轻微',     en: '1 — Light' },
    sigmaSScaleR:       { zh: '15 — 强力',    en: '15 — Strong' },
    sigmaRLabel:        { zh: '颜色阈值',       en: 'Range Threshold' },
    sigmaRScaleL:       { zh: '1 — 保边',    en: '1 — Edge' },
    sigmaRScaleR:        { zh: '100 — 平滑',   en: '100 — Smooth' },
    modeBilateral:      { zh: '彩色双边',       en: 'Color Bilateral' },
    modeGrayscale:      { zh: '灰度 Y 通道',   en: 'Grayscale Y' },
    btnStartDenoise:    { zh: '开始图像降噪',   en: 'Start Denoising' },
    processing:          { zh: '处理中...',       en: 'Processing...' },

    /* 降噪结果 */
    emptyTitle:          { zh: '暂无处理结果',   en: 'No Result Yet' },
    emptyDesc:           { zh: '请先前往上传处理页面导入图片并进行降噪处理', en: 'Please import an image and denoise it first.' },
    btnGoUpload:         { zh: '← 去上传图片',  en: '← Upload Image' },
    resultTiming:        { zh: '处理耗时',       en: 'Processing Time' },
    resultSigmaS:       { zh: 'σs 空间半径',   en: 'σs Spatial Radius' },
    resultSigmaR:       { zh: 'σr 颜色阈值',   en: 'σr Range Threshold' },
    resultMode:          { zh: '降噪模式',       en: 'Denoising Mode' },
    modeBilateralFull:  { zh: '彩色双边滤波',   en: 'Color Bilateral' },
    modeGrayscaleFull:  { zh: '灰度 Y 通道双边滤波', en: 'Grayscale Y Bilateral' },
    resultTitle:         { zh: '降噪结果',       en: 'Denoised Result' },
    saveFormat:          { zh: '保存格式',       en: 'Save Format' },
    savePNG:            { zh: 'PNG',            en: 'PNG' },
    saveJPEG:           { zh: 'JPEG',           en: 'JPEG' },
    saveWebP:           { zh: 'WebP',           en: 'WebP' },
    qualityLabel:        { zh: '压缩质量',       en: 'Quality' },
    btnSave:             { zh: '保存图片',       en: 'Save Image' },
    btnNewImage:        { zh: '处理新图片',     en: 'New Image' },
    btnConfirm:          { zh: '确定',           en: 'Confirm' },
    photoInfo:           { zh: '照片信息',       en: 'Photo Info' },
    fileInfo:            { zh: '文件信息',       en: 'File Info' },
    fileSize:            { zh: '文件大小',       en: 'File Size' },
    fileFormat:          { zh: '文件格式',       en: 'File Format' },
    colorSpace:          { zh: '颜色空间',       en: 'Color Space' },

    /* 旅行票根 */
    ticketTitle:         { zh: '旅行票根',       en: 'Travel Ticket' },
    ticketDesc:          { zh: '上传照片，生成专属电子旅行票根', en: 'Upload a photo to generate your exclusive digital travel ticket' },
    ticketUploadHint:    { zh: '拖放或点击上传照片', en: 'Drag or click to upload photo' },
    ticketUploadFormat:  { zh: '支持 JPG / PNG / WebP', en: 'Supports JPG / PNG / WebP' },
    ticketPreview:       { zh: '票根预览',       en: 'Ticket Preview' },
    ticketEditor:        { zh: '编辑票根信息',   en: 'Edit Ticket Info' },
    ticketDest:          { zh: '目的地',         en: 'Destination' },
    ticketDestHint:      { zh: '纯英文大写建议15字符以内', en: 'Uppercase English, ≤15 chars recommended' },
    ticketLocation:      { zh: '中文地名',       en: 'Location (CN)' },
    ticketDate:          { zh: '日期',           en: 'Date' },
    ticketName:          { zh: '旅行者',         en: 'Traveler' },
    ticketNo:            { zh: '票号',           en: 'Ticket No.' },
    ticketCode:          { zh: '防伪码',         en: 'Security Code' },
    btnRegenerate:       { zh: '重新生成',       en: 'Regenerate' },
    btnDownload:         { zh: '下载票根',       en: 'Download Ticket' },
    btnReupload:         { zh: '重新上传',       en: 'Re-upload' },
    ticketPlaceholder:   { zh: '上传照片后<br>票根将在此预览', en: 'Ticket preview<br>after upload' },
    ticketOptions:       { zh: '票根选项',       en: 'Ticket Options' },
    ticketChangeHint:    { zh: '点击更换照片',   en: 'Click to change photo' },

    /* 创意滤镜 */
    filterTitle:         { zh: '创意滤镜',       en: 'Creative Filters' },
    filterDesc:          { zh: '上传照片，一键应用胶片模拟滤镜', en: 'Upload a photo, apply film simulation filters with one click' },
    filterUploadHint:    { zh: '拖放或点击上传照片', en: 'Drag or click to upload photo' },
    filterUploadFormat:  { zh: '支持 JPG / PNG / WebP', en: 'Supports JPG / PNG / WebP' },
    filterPreset:        { zh: '选择滤镜预设',   en: 'Select Filter Preset' },
    filterCatSony:      { zh: '创意外观',       en: 'Creative Look' },
    filterCatFilm:      { zh: '胶片模拟',       en: 'Film Sim.' },
    filterCatTone:      { zh: '类色调',         en: 'Color Tone' },
    filterFL:            { zh: 'FL · 柔和',     en: 'FL · Soft' },
    filterNT:            { zh: 'NT · 中性',     en: 'NT · Neutral' },
    filterVV:            { zh: 'VV · 鲜艳',     en: 'VV · Vivid' },
    filterSH:            { zh: 'SH · 暗部',     en: 'SH · Shadows' },
    filterIN:            { zh: 'IN · 即时',     en: 'IN · Instant' },
    filterPT:            { zh: 'PT · 人像',     en: 'PT · Portrait' },
    filterAS:            { zh: 'AS · 柔和',     en: 'AS · Soft' },
    filterPN:            { zh: 'PN · 负片',     en: 'PN · Negative' },
    filterCC:            { zh: 'CC · Chrome',    en: 'CC · Chrome' },
    filterTO:            { zh: 'TO · 青橙',     en: 'TO · Teal-Orange' },
    filterOR:            { zh: 'OR · 橙红',     en: 'OR · Orange-Red' },
    btnSaveFilter:       { zh: '保存图片',       en: 'Save Image' },
    btnReuploadFilter:   { zh: '重新上传',       en: 'Re-upload' },
    filterPlaceholder:   { zh: '上传照片后<br>在此预览滤镜效果', en: 'Filter preview<br>after upload' },
    filterOptions:       { zh: '滤镜选项',       en: 'Filter Options' },
    filterPreview:       { zh: '滤镜预览',       en: 'Filter Preview' },
    filterChangeHint:    { zh: '点击更换照片',   en: 'Click to change photo' },

    /* 个人中心 */
    profileName:        { zh: 'PrismDen',                          en: 'PrismDen' },
    profileBio:         { zh: '棱镜降噪 · 哈希加速双边滤波',     en: 'PrismDen · Hash-Accelerated Denoising' },
    statTitle:           { zh: '使用统计',       en: 'Statistics' },
    statDenoise:        { zh: '图像降噪',       en: 'Denoise' },
    statFilter:          { zh: '创意滤镜',       en: 'Filters' },
    statTicket:          { zh: '旅行票根',       en: 'Tickets' },
    settingsTitle:       { zh: '偏好设置',       en: 'Preferences' },
    settingDarkMode:     { zh: '深色模式',       en: 'Dark Mode' },
    darkModeAuto:       { zh: '跟随系统',       en: 'Auto (System)' },
    darkModeOn:         { zh: '已开启',         en: 'On' },
    darkModeOff:        { zh: '已关闭',         en: 'Off' },
    vibrateTitle:       { zh: '震动反馈',       en: 'Haptic Feedback' },
    vibrateOn:          { zh: '已开启',         en: 'On' },
    vibrateOff:         { zh: '已关闭',         en: 'Off' },
    vibrateiOS:         { zh: 'iOS设备暂不支持', en: 'Not supported on iOS' },
    langTitle:           { zh: '语言 / Language', en: 'Language / 语言' },
    langZh:             { zh: '中文',           en: '中文' },
    langEn:             { zh: 'English',        en: 'English' },
    aboutTitle:          { zh: '关于项目',       en: 'About' },
    aboutLabelName:     { zh: '项目名称',       en: 'Project Name' },
    aboutName:          { zh: 'PrismDen · 棱镜降噪',          en: 'PrismDen · Image Denoising' },
    aboutLabelAlgo:     { zh: '核心算法',       en: 'Core Algorithm' },
    aboutAlgo:          { zh: '哈希加速双边滤波',                en: 'Hash-Accelerated Bilateral Filter' },
    aboutDS:            { zh: 'HashMap · LinkedList · MaxHeap · Queue', en: 'HashMap · LinkedList · MaxHeap · Queue' },
    aboutLabelTech:     { zh: '技术栈',         en: 'Tech Stack' },
    aboutTech:          { zh: 'C++ · WebAssembly · 液态玻璃 UI',    en: 'C++ · WebAssembly · Glassmorphism UI' },
    aboutLabelVersion:   { zh: '版本',           en: 'Version' },
    aboutAuthor:        { zh: 'Young__Yang',                     en: 'Young__Yang' },
    aboutLabelVersion:   { zh: '版本',           en: 'Version' },
    aboutVersion:       { zh: 'v1.0.0',                         en: 'v1.0.0' },
    dataTitle:           { zh: '数据管理',       en: 'Data' },
    btnClearData:        { zh: '清除本地使用统计', en: 'Clear Usage Statistics' },
    confirmClear:       { zh: '确定要清除所有本地数据吗？\n（包括使用统计，不影响主题和震动设置）', en: 'Clear all local data?\n(Includes usage statistics. Theme and haptic settings are kept.)' },

    /* 页脚 */
    footer:             { zh: '© 2026 Young__Yang. All rights reserved.', en: '© 2026 Young__Yang. All rights reserved.' },

    /* Toast 消息 */
    toastDenoiseStart:  { zh: '降噪处理中...',   en: 'Denoising...' },
    toastDenoiseDone:  { zh: '降噪完成，耗时 ',   en: 'Denoising complete, time: ' },
    toastDenoiseErr:   { zh: '降噪失败',         en: 'Denoising failed' },
    toastFilterDone:    { zh: '滤镜已应用',       en: 'Filter applied' },
    toastTicketDone:    { zh: '票根已下载',       en: 'Ticket downloaded' },
    toastDataCleared:   { zh: '本地数据已清除',   en: 'Local data cleared' },
    toastLangZh:        { zh: '已切换至中文',   en: 'Switched to Chinese' },
    toastLangEn:        { zh: '已切换至英文',       en: 'Switched to English' },
    toastNoResult:    { zh: '没有可保存的图片', en: 'No image to save.' },
    toastNoFormat:    { zh: '请选择保存格式',   en: 'Please select a format.' },
    toastSaved:      { zh: '已保存: ',         en: 'Saved: ' },
    toastRemoved:     { zh: '已移除照片',       en: 'Photo removed.' },

    /* 对比浮层 */
    compareOriginal:    { zh: '原图',   en: 'Original' },
    compareResult:      { zh: '降噪后', en: 'Denoised' }
  };


  /* —— 获取翻译文本 —— */
  function t(key) {
    var entry = dict[key];
    if (!entry) return key;
    return entry[currentLang] || entry.zh || key;
  }

  /* —— 应用语言到 DOM —— */
  function applyLang(lang) {
    currentLang = lang;

    // 收集所有带 data-i18n 的元素，过滤掉被父元素嵌套的
    var allEls = document.querySelectorAll('[data-i18n]');
    var els = [];

    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      // 检查是否有祖先元素也带 data-i18n，如果有则跳过（由祖先统一处理）
      var parent = el.parentNode;
      var nested = false;
      while (parent && parent !== document) {
        if (parent.hasAttribute && parent.hasAttribute('data-i18n')) {
          nested = true;
          break;
        }
        parent = parent.parentNode;
      }
      if (!nested) els.push(el);
    }

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute('data-i18n');
      var entry = dict[key];
      if (!entry) continue;

      var text = entry[lang] || entry.zh || '';

      // 判断是用 textContent 还是 innerHTML
      var isHTML = el.getAttribute('data-i18n-html') === 'true';
      if (isHTML) {
        el.innerHTML = text;
      } else {
        if (text.indexOf('<') !== -1) {
          el.innerHTML = text;
        } else {
          el.textContent = text;
        }
      }
    }

    // 更新 html lang 属性
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';

    // 更新 title
    document.title = lang === 'en'
      ? 'PrismDen — Image Denoising'
      : 'PrismDen — 图像降噪';

    // 同步个人中心动态文本（深色模式、震动、语言）
    syncProfileDescs();
  }

  /* 同步个人中心动态文本 */
  function syncProfileDescs() {
    // 深色模式状态
    var themeItem = document.getElementById('themeToggle');
    if (themeItem) {
      var toggle = themeItem.querySelector('.settings-toggle');
      var isDark = toggle && toggle.classList.contains('active');
      var desc = themeItem.querySelector('.settings-desc');
      if (desc) {
        var saved = localStorage.getItem('prismden_theme');
        if (saved) {
          desc.textContent = isDark ? t('darkModeOn') : t('darkModeOff');
        } else {
          desc.textContent = t('darkModeAuto');
        }
      }
    }

    // 震动反馈状态
    var vibItem = document.getElementById('vibrateToggle');
    if (vibItem) {
      var toggle = vibItem.querySelector('.settings-toggle');
      var enabled = toggle && toggle.classList.contains('active');
      var desc = vibItem.querySelector('.settings-desc');
      if (desc && !vibItem.querySelector('.settings-tag')) {
        desc.textContent = enabled ? t('vibrateOn') : t('vibrateOff');
      }
    }

    // 语言状态
    var langItem = document.getElementById('langToggle');
    if (langItem) {
      var toggle = langItem.querySelector('.settings-toggle');
      var isZh = toggle && toggle.classList.contains('active');
      var desc = langItem.querySelector('.settings-desc');
      if (desc) {
        desc.textContent = isZh ? t('langZh') : t('langEn');
      }
    }
  }

  /* —— 切换语言并持久化 —— */
  function setLang(lang) {
    if (lang !== 'zh' && lang !== 'en') return;
    try { localStorage.setItem('prismden_lang', lang); } catch (e) {}
    applyLang(lang);
  }

  /* —— 初始化：读取偏好并应用 —— */
  function init() {
    var saved = 'zh';
    try { saved = localStorage.getItem('prismden_lang') || 'zh'; } catch (e) {}
    applyLang(saved);
  }

  // 暴露 API
  return {
    t: t,
    setLang: setLang,
    getLang: function () { return currentLang; },
    init: init,
    applyLang: applyLang
  };

})();

// 页面加载后自动初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', i18n.init);
} else {
  i18n.init();
}
