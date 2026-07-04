/* 
 * inject-i18n.js
 * 给 index.html 中文本元素自动加 data-i18n 属性
 * 用法：node inject-i18n.js
 */

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

/* 替换规则：[key, 查找文本, 是否HTML, 上下文（使查找唯一）] */
const rules = [
  // ── 欢迎遮罩 ──
  ['welcomeSubtitle', '棱镜降噪 · 图像降噪处理平台', false, 'welcome-subtitle'],
  ['welcomeHint', '点击任意位置进入', false, 'welcome-hint'],

  // ── 状态栏 ──
  ['statusConnecting', '等待后端连接...', false, 'statusText'],

  // ── 导航栏 ──
  ['navHome', '首页', false, 'nav-link.*data-page="home"'],
  ['navFeatures', '核心特性', false, 'nav-link.*data-page="features"'],
  ['navGuide', '参数指南', false, 'nav-link.*data-page="guide"'],
  ['navUpload', '图像降噪', false, 'nav-link.*data-page="upload"'],
  ['navResult', '降噪结果', false, 'nav-link.*data-page="result"'],
  ['navTicket', '旅行票根', false, 'nav-link.*data-page="ticket"'],
  ['navFilter', '创意滤镜', false, 'nav-link.*data-page="filter"'],
  ['navProfile', '个人中心', false, 'nav-link.*data-page="profile"'],

  // ── 首页 ──
  ['heroKanji', 'Image Processing · Young__Yang', false, 'hero-kanji'],
  ['heroSubtitle', 'Hash-Accelerated Bilateral Filtering', true, 'hero-subtitle'],
  ['btnDenoise', '即刻降噪', false, 'btn-hero-action'],
  ['btnFilter', '创意滤镜', false, 'btn-hero-filter'],
  ['themeLight', '浅色', false, 'theme-option.*data-theme-option="light"'],
  ['themeDark', '深色', false, 'theme-option.*data-theme-option="dark"'],

  // ── 核心特性 ──
  ['featBilateral', '双边滤波算法', false, 'feature-card'],
  ['featBilateralDesc', '空间权重与色彩权重联合保边去噪', false, 'feature-card'],
  ['featDS', '数据结构', false, 'feature-card'],
  ['featDSDesc', '综合运用哈希表、链表、大顶堆、队列等数据结构来管理处理流水线', false, 'feature-card'],
  ['featCPP', 'C++ 后端', false, 'feature-card'],
  ['featFormat', '多格式支持', false, 'feature-card'],
  ['featFormatDesc', '支持 PNG、JPG、JPEG、RAW、BMP、TIFF、WebP 等主流图片格式输入', false, 'feature-card'],
  ['btnViewGuide', '查看参数指南 →', false, 'btn-lg.*guide'],

  // ── 参数指南 ──
  ['guideIntro', '调整降噪参数前，先了解两个核心参数的含义与推荐取值', false, 'text-align:center'],
  ['guideSpace', '空间半径', false, 'font-display.*font-weight:300'],
  ['guideRange', '颜色阈值', false, 'font-display.*font-weight:300'],
  ['sigmaSLight', '1 − 3', false, 'justify-content:space-between'],
  ['sigmaSLightDesc', '轻微降噪，保留最多细节', false, 'justify-content:space-between'],
  ['sigmaSRec', '4 − 7（推荐）', false, 'justify-content:space-between'],
  ['sigmaSRecDesc', '日常使用，细节与降噪平衡', false, 'justify-content:space-between'],
  ['sigmaSStrong', '8 − 15', false, 'justify-content:space-between'],
  ['sigmaSStrongDesc', '强力降噪，适合高噪声风景照', false, 'justify-content:space-between'],
  ['sigmaRLow', '1 − 15', false, 'justify-content:space-between'],
  ['sigmaRLowDesc', '强保边，适合人像、建筑', false, 'justify-content:space-between'],
  ['sigmaRRec', '16 − 40（推荐）', false, 'justify-content:space-between'],
  ['sigmaRRecDesc', '平衡保边与平滑，默认 25', false, 'justify-content:space-between'],
  ['sigmaRHigh', '41 − 100', false, 'justify-content:space-between'],
  ['sigmaRHighDesc', '平滑优先，适合天空、水面等', false, 'justify-content:space-between'],
  ['btnGoParams', '去调整参数 →', false, 'btn-lg.*upload'],

  // ── 上传处理 ──
  ['uploadTitle', '导入图片', false, 'panel-header.*upload'],
  ['uploadHint', '拖拽或点击导入图片', false, 'upload-hint'],
  ['uploadFormat', '支持 PNG · JPG · JPEG · RAW · BMP · TIFF · WebP', false, 'upload-format'],
  ['btnChangePhoto', '更换照片', false, 'img-action-btn change'],
  ['btnRemovePhoto', '移除照片', false, 'img-action-btn remove'],
  ['metaName', '文件名', false, 'meta-key.*元'],
  ['metaFormat', '格式', false, 'meta-key'],
  ['metaSize', '大小', false, 'meta-key'],
  ['metaCamera', '相机参数', false, 'meta-sub'],
  ['metaMake', '相机制造商', false, 'meta-key'],
  ['metaModel', '相机型号', false, 'meta-key'],
  ['metaAperture', '光圈', false, 'meta-key'],
  ['metaShutter', '快门', false, 'meta-key'],
  ['metaISO', 'ISO', false, 'meta-key'],
  ['metaFocal', '焦距', false, 'meta-key'],
  ['paramTitle', '降噪参数', false, 'panel-header.*降噪参数'],
  ['btnBackToGuide', '← 参数指南', false, 'btn-ghost'],
  ['sigmaSLabel', '空间半径', false, 'param-label.*sigma'],
  ['sigmaSScaleL', '1 — 轻微', false, 'param-scale'],
  ['sigmaSScaleR', '15 — 强力', false, 'param-scale'],
  ['sigmaRLabel', '颜色阈值', false, 'param-label.*sigmaR'],
  ['sigmaRScaleL', '1 — 保边', false, 'param-scale'],
  ['sigmaRScaleR', '100 — 平滑', false, 'param-scale'],
  ['modeBilateral', '彩色双边', false, 'mode-tab.*bilateral'],
  ['modeGrayscale', '灰度 Y 通道', false, 'mode-tab.*grayscale'],
  ['btnStartDenoise', '开始图像降噪', false, 'btn-process'],
  ['processing', '处理中...', false, 'progress-text'],

  // ── 降噪结果 ──
  ['emptyTitle', '暂无处理结果', false, 'empty-state'],
  ['emptyDesc', '请先前往上传处理页面导入图片并进行降噪处理', false, 'empty-state'],
  ['btnGoUpload', '← 去上传图片', false, 'goto-upload-btn'],
  ['resultTiming', '处理耗时', false, 'info-label.*处理耗时'],
  ['resultSigmaS', 'σs 空间半径', false, 'info-label.*sigma'],
  ['resultSigmaR', 'σr 颜色阈值', false, 'info-label.*sigmaR'],
  ['resultMode', '降噪模式', false, 'info-label.*降噪模式'],
  ['resultTitle', '降噪结果', false, 'panel-header.*降噪结果'],
  ['saveFormat', '保存格式', false, 'save-label'],
  ['savePNG', 'PNG', false, 'save-fmt-btn.*data-fmt="png"'],
  ['saveJPEG', 'JPEG', false, 'save-fmt-btn.*data-fmt="jpeg"'],
  ['saveWebP', 'WebP', false, 'save-fmt-btn.*data-fmt="webp"'],
  ['qualityLabel', '压缩质量', false, 'param-label.*压缩质量'],
  ['btnSave', '保存图片', false, 'save-action-btn.*save'],
  ['btnNewImage', '处理新图片', false, 'save-action-btn.*new'],
  ['btnConfirm', '确定', false, 'save-confirm-btn'],
  ['photoInfo', '照片信息', false, 'panel-header.*照片信息'],
  ['cameraParams', '相机参数', false, 'info-sub-header'],
  ['fileInfo', '文件信息', false, 'info-sub-header.*文件信息'],
  ['fileSize', '文件大小', false, 'info-key.*文件大小'],
  ['fileFormat', '文件格式', false, 'info-key.*文件格式'],
  ['colorSpace', '颜色空间', false, 'info-key.*颜色空间'],

  // ── 旅行票根 ──
  ['ticketTitle', '旅行票根', false, 'ticket-panel-title'],
  ['ticketDesc', '上传照片，生成专属电子旅行票根', false, 'ticket-panel-desc'],
  ['ticketUploadHint', '拖放或点击上传照片', false, 'ticket-upload-text'],
  ['ticketUploadFormat', '支持 JPG / PNG / WebP', false, 'ticket-upload-hint'],
  ['ticketPreview', '票根预览', false, 'ticket-sheet-preview-label'],
  ['ticketEditor', '编辑票根信息', false, 'editor-title'],
  ['ticketDest', '目的地', false, 'form-label.*目的地'],
  ['ticketDestHint', '纯英文大写建议15字符以内', false, 'form-hint'],
  ['ticketLocation', '中文地名', false, 'form-label.*中文地名'],
  ['ticketDate', '日期', false, 'form-label.*日期'],
  ['ticketName', '旅行者', false, 'form-label.*旅行者'],
  ['ticketNo', '票号', false, 'form-label.*票号'],
  ['ticketCode', '防伪码', false, 'form-label.*防伪码'],
  ['btnRegenerate', '重新生成', false, 'btn-regenerate'],
  ['btnDownload', '下载票根', false, 'btn-primary.*download'],
  ['btnReupload', '重新上传', false, 'btn-secondary.*resetTicket'],
  ['ticketPlaceholder', '上传照片后', true, 'placeholder-content'],
  ['ticketOptions', '票根选项', false, 'ticket-mobile-toggle'],

  // ── 创意滤镜 ──
  ['filterTitle', '创意滤镜', false, 'filter-panel-title'],
  ['filterDesc', '上传照片，一键应用胶片模拟滤镜', false, 'filter-panel-desc'],
  ['filterUploadHint', '拖放或点击上传照片', false, 'filter-upload-text'],
  ['filterUploadFormat', '支持 JPG / PNG / WebP', false, 'filter-upload-hint'],
  ['filterPreset', '选择滤镜预设', false, 'filter-editor-title'],
  ['filterCatSony', '创意外观', false, 'filter-category-tab.*sony'],
  ['filterCatFilm', '胶片模拟', false, 'filter-category-tab.*film'],
  ['filterCatTone', '类色调', false, 'filter-category-tab.*tone'],
  ['filterFL', 'FL · 柔和', false, 'filter-preset-label.*FL'],
  ['filterNT', 'NT · 中性', false, 'filter-preset-label.*NT'],
  ['filterVV', 'VV · 鲜艳', false, 'filter-preset-label.*VV'],
  ['filterSH', 'SH · 暗部', false, 'filter-preset-label.*SH'],
  ['filterIN', 'IN · 即时', false, 'filter-preset-label.*IN'],
  ['filterPT', 'PT · 人像', false, 'filter-preset-label.*PT'],
  ['filterAS', 'AS · 柔和', false, 'filter-preset-label.*AS'],
  ['filterPN', 'PN · 负片', false, 'filter-preset-label.*PN'],
  ['filterCC', 'CC · Chrome', false, 'filter-preset-label.*CC'],
  ['filterTO', 'TO · 青橙', false, 'filter-preset-label.*TO'],
  ['filterOR', 'OR · 橙红', false, 'filter-preset-label.*OR'],
  ['btnSaveFilter', '保存图片', false, 'btn-primary.*downloadFilter'],
  ['btnReuploadFilter', '重新上传', false, 'btn-secondary.*resetFilter'],
  ['filterPlaceholder', '上传照片后', true, 'filter-preview-placeholder'],
  ['filterOptions', '滤镜选项', false, 'filter-mobile-toggle'],

  // ── 个人中心 ──
  ['profileName', 'PrismDen', false, 'profile-name'],
  ['profileBio', '棱镜降噪 · 哈希加速双边滤波', false, 'profile-bio'],
  ['statTitle', '使用统计', false, 'profile-section-title'],
  ['statDenoise', '图像降噪', false, 'stat-label.*降噪'],
  ['statFilter', '创意滤镜', false, 'stat-label.*滤镜'],
  ['statTicket', '旅行票根', false, 'stat-label.*票根'],
  ['settingsTitle', '偏好设置', false, 'profile-section-title.*偏好'],
  ['darkMode', '深色模式', false, 'settings-name.*深色'],
  ['darkModeAuto', '跟随系统', false, 'settings-desc.*深色'],
  ['vibrateTitle', '震动反馈', false, 'settings-name.*震动'],
  ['vibrateOn', '已开启', false, 'settings-desc.*震动'],
  ['vibrateiOS', 'iOS设备暂不支持', false, 'settings-tag'],
  ['langTitle', '语言 / Language', false, 'settings-name.*语言'],
  ['langZh', '中文', false, 'settings-desc.*语言'],
  ['aboutTitle', '关于项目', false, 'profile-section-title.*关于'],
  ['aboutName', 'PrismDen · 棱镜降噪', false, 'about-value.*项目名称'],
  ['aboutAlgo', '哈希加速双边滤波', false, 'about-value.*核心算法'],
  ['aboutDS', 'HashMap · LinkedList · MaxHeap · Queue', false, 'about-value.*数据结构'],
  ['aboutTech', 'C++ · WebAssembly · 液态玻璃 UI', false, 'about-value.*技术栈'],
  ['aboutAuthor', 'Young__Yang', false, 'about-value.*作者'],
  ['aboutVersion', 'v1.0.0', false, 'about-value.*版本'],
  ['dataTitle', '数据管理', false, 'profile-section-title.*数据'],
  ['btnClearData', '清除本地使用统计', false, 'clearDataBtn'],

  // ── 页脚 ──
  ['footer', '© 2026 Young__Yang. All rights reserved.', false, 'site-footer'],

  // ── 对比浮层 ──
  ['compareOriginal', '原图', false, 'badge-left'],
  ['compareResult', '降噪后', false, 'badge-right'],
];

/* 转义正则特殊字符 */
function escRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let applied = 0;
let skipped = 0;

for (const [key, zhText, isHTML, context] of rules) {
  // 构建查找正则：在上下文附近查找目标文本
  // 策略：查找包含目标文本的标签，且没有 data-i18n 属性
  const escapedText = escRegExp(zhText);

  // 构建正则：匹配在上下文范围内、包含目标文本、且还没有 data-i18n 的元素开标签
  let pattern;
  if (context) {
    // 有上下文：在上下文元素内查找
    const contextEscaped = escRegExp(context);
    // 简化：直接查找 `>zhText<` 或 `>zhText` 的模式
    pattern = new RegExp(
      '([^>]*data-i18n="?' + escapedText + '[^"]*"?[^>]*>|>)(' + escapedText + ')(<|\\n)',
      'g'
    );
  }

  // 直接使用字符串查找 + 替换（更可靠）
  const searchPatterns = [
    // 模式1：<tag ...>中文</tag>
    [new RegExp('(>[^<]*)(' + escapedText + ')([^<]*<)', 'g'), '$1' + zhText + '$3'],
  ];

  let replaced = false;

  // 更精确的替换：找到包含该文本的 HTML 元素开标签，在其中插入 data-i18n
  // 查找 "...>zhText<..." 的模式，给前面的开标签加 data-i18n
  const tagRe = new RegExp(
    '(<[^>]+)(\\sdata-i18n="[^"]*")?([^>]*>)([^<]*' + escapedText + '[^<]*<)',
    'g'
  );

  const before = html;
  html = html.replace(tagRe, function (match, open, existing, rest, after) {
    if (existing) return match; // 已有 data-i18n，跳过
    applied++;
    replaced = true;
    return open + ' data-i18n="' + key + '"' + rest + after;
  });

  if (!replaced) {
    skipped++;
    console.log('  [跳过] ' + key + ': ' + zhText);
  }
}

// 处理特殊情况：hero-subtitle 含 <br>
html = html.replace(
  /(<p class="hero-subtitle">)([^<]*)<br>([^<]*)(<\/p>)/,
  function (m, open, line1, line2, close) {
    if (m.indexOf('data-i18n') !== -1) return m;
    return open + '<span data-i18n="heroSubtitle" data-i18n-html="true">' + line1 + '<br>' + line2 + '</span>' + close;
  }
);

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('完成！应用: ' + applied + ', 跳过: ' + skipped);
console.log('文件路径: ' + htmlPath);
