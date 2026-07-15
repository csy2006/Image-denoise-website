/* ==================== 调色盘提取模块 (PhotoColors 风格) ==================== */
/**
 * palette.js — PrismDen 调色盘提取
 * 算法流程：
 *   1. 上传图片 → Canvas 提取像素
 *   2. RGB 量化（16级 → 4096桶）→ HashMap 统计频率
 *   3. MaxHeap 按频率排序 → 取占比最大的单一主色调
 *   4. 页面背景 / 导航栏背景同步切换为主色调
 *   5. 生成合成图：上半主色调色块（大图大字）+ 下半原图
 *
 * 数据结构：HashMap（桶映射） + MaxHeap（频率排序）
 */

(function () {
  'use strict';

  /* ========== MaxHeap ========== */
  function MaxHeap() { this.heap = []; }

  MaxHeap.prototype.push = function (item) {
    this.heap.push(item);
    this._bubbleUp(this.heap.length - 1);
  };

  MaxHeap.prototype.pop = function () {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop();
    var top = this.heap[0];
    this.heap[0] = this.heap.pop();
    this._sinkDown(0);
    return top;
  };

  MaxHeap.prototype.size = function () { return this.heap.length; };

  MaxHeap.prototype._bubbleUp = function (idx) {
    var heap = this.heap;
    while (idx > 0) {
      var parent = (idx - 1) >>> 1;
      if (heap[idx].freq <= heap[parent].freq) break;
      var t = heap[idx]; heap[idx] = heap[parent]; heap[parent] = t;
      idx = parent;
    }
  };

  MaxHeap.prototype._sinkDown = function (idx) {
    var heap = this.heap;
    var len = heap.length;
    while (true) {
      var largest = idx;
      var left = (idx << 1) + 1;
      var right = left + 1;
      if (left < len && heap[left].freq > heap[largest].freq) largest = left;
      if (right < len && heap[right].freq > heap[largest].freq) largest = right;
      if (largest === idx) break;
      var t = heap[idx]; heap[idx] = heap[largest]; heap[largest] = t;
      idx = largest;
    }
  };

  /* ========== 色彩提取 ========== */
  var COLOR_LEVELS = 16;
  var BIN_SHIFT = 4;

  function colorKey(r, g, b) {
    return ((r >> BIN_SHIFT) << 8) | ((g >> BIN_SHIFT) << 4) | (b >> BIN_SHIFT);
  }

  function extractDominantColor(sourceImg) {
    var maxDim = 300;
    var w = sourceImg.naturalWidth;
    var h = sourceImg.naturalHeight;
    var scale = Math.min(maxDim / w, maxDim / h, 1);
    var cw = Math.round(w * scale);
    var ch = Math.round(h * scale);

    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(sourceImg, 0, 0, cw, ch);

    var imageData = ctx.getImageData(0, 0, cw, ch);
    var data = imageData.data;
    var len = data.length;

    var buckets = {};
    var totalPixels = 0;
    var SAMPLE_STEP = Math.max(1, Math.floor(Math.sqrt(len / 4) / 150));

    for (var i = 0; i < len; i += 4 * SAMPLE_STEP) {
      if (data[i + 3] < 128) continue;
      var key = colorKey(data[i], data[i + 1], data[i + 2]);
      if (!buckets[key]) {
        buckets[key] = { rSum: 0, gSum: 0, bSum: 0, freq: 0 };
      }
      buckets[key].rSum += data[i];
      buckets[key].gSum += data[i + 1];
      buckets[key].bSum += data[i + 2];
      buckets[key].freq++;
      totalPixels++;
    }

    var heap = new MaxHeap();
    for (var k in buckets) {
      if (!buckets.hasOwnProperty(k)) continue;
      var b = buckets[k];
      heap.push({
        r: Math.round(b.rSum / b.freq),
        g: Math.round(b.gSum / b.freq),
        b: Math.round(b.bSum / b.freq),
        freq: b.freq
      });
    }

    var top = heap.pop();
    if (!top) return { r: 128, g: 128, b: 128, hex: '#808080', pct: 100 };

    return {
      r: top.r, g: top.g, b: top.b,
      hex: rgbToHex(top.r, top.g, top.b),
      pct: Math.round((top.freq / totalPixels) * 1000) / 10
    };
  }

  function rgbToHex(r, g, b) {
    var hr = r.toString(16); if (hr.length === 1) hr = '0' + hr;
    var hg = g.toString(16); if (hg.length === 1) hg = '0' + hg;
    var hb = b.toString(16); if (hb.length === 1) hb = '0' + hb;
    return '#' + hr + hg + hb;
  }

  /* ========== 颜色工具 ========== */
  function getLuminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function getContrastTextColor(r, g, b) {
    return getLuminance(r, g, b) > 128 ? '#1a1a1a' : '#ffffff';
  }

  /* ========== 合成图绘制（上半色块 + 下半原图） ========== */
  var MAX_OUT_W = 1200;

  function renderCombined(sourceImg, color) {
    var srcW = sourceImg.naturalWidth;
    var srcH = sourceImg.naturalHeight;
    var outW = Math.min(srcW, MAX_OUT_W);
    var outH = Math.round(outW * (srcH / srcW));

    // 上半色块与下半图片等高
    var COLOR_BLOCK_H = outH;
    var totalH = COLOR_BLOCK_H + outH;

    var canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = totalH;
    var ctx = canvas.getContext('2d');

    // 1. 上半：主色调纯色块
    ctx.fillStyle = color.hex;
    ctx.fillRect(0, 0, outW, COLOR_BLOCK_H);

    // 大号 HEX 居中
    var textColor = getContrastTextColor(color.r, color.g, color.b);
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 56px "DM Mono", monospace';
    ctx.fillText(color.hex.toUpperCase(), outW / 2, COLOR_BLOCK_H / 2 - 18);

    // 占比小字
    ctx.font = '24px "DM Sans", sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText('主色调 · ' + color.pct + '%', outW / 2, COLOR_BLOCK_H / 2 + 34);
    ctx.globalAlpha = 1;

    // 分隔线
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, COLOR_BLOCK_H);
    ctx.lineTo(outW, COLOR_BLOCK_H);
    ctx.stroke();

    // 2. 下半：原图
    ctx.drawImage(sourceImg, 0, 0, srcW, srcH, 0, COLOR_BLOCK_H, outW, outH);

    return canvas;
  }

  /* ========== DOM 逻辑 ========== */
  var pageSection, app, emptyState, resultState, fileInput,
      uploadBtn, uploadMainBtn, downloadBtn, resetBtn,
      resultTitle, resultSubtitle, resultImg, imageCard, toastEl,
      navbar;
  var currentImage = null;
  var currentColor = null;
  var combinedCanvas = null;

  function init() {
    pageSection = document.getElementById('page-palette');
    app = document.getElementById('paletteApp');
    emptyState = document.getElementById('paletteEmptyState');
    resultState = document.getElementById('paletteResultState');
    fileInput = document.getElementById('paletteFileInput');
    uploadBtn = document.getElementById('paletteUploadBtn');
    uploadMainBtn = document.getElementById('paletteUploadMainBtn');
    downloadBtn = document.getElementById('paletteDownloadBtn');
    resetBtn = document.getElementById('paletteResetBtn');
    resultTitle = document.getElementById('paletteResultTitle');
    resultSubtitle = document.getElementById('paletteResultSubtitle');
    resultImg = document.getElementById('paletteResultImg');
    imageCard = document.getElementById('paletteImageCard');
    toastEl = document.getElementById('paletteToast');
    navbar = document.getElementById('navbar');

    uploadBtn.addEventListener('click', triggerUpload);
    uploadMainBtn.addEventListener('click', triggerUpload);

    fileInput.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (file) loadFile(file);
      fileInput.value = '';
    });

    downloadBtn.addEventListener('click', function () {
      if (!combinedCanvas) { showToast('请先生成结果'); return; }
      var link = document.createElement('a');
      link.download = 'photocolors-result.png';
      link.href = combinedCanvas.toDataURL('image/png');
      link.click();
      showToast('已保存');
    });

    resetBtn.addEventListener('click', resetAll);

    // 拖拽上传（目标：整个页面）
    app.addEventListener('dragover', function (e) { e.preventDefault(); });
    app.addEventListener('drop', function (e) {
      e.preventDefault();
      var file = e.dataTransfer.files[0];
      if (file && file.type.match(/image\//)) loadFile(file);
    });

    // 监听页面切换：离开 palette 时重置背景
    observePageVisibility();
  }

  function triggerUpload() {
    if (fileInput) fileInput.click();
  }

  function loadFile(file) {
    if (!file.type.match(/image\//)) { showToast('请选择图片文件'); return; }
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        currentImage = img;
        processImage();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function processImage() {
    if (!currentImage) return;

    currentColor = extractDominantColor(currentImage);
    combinedCanvas = renderCombined(currentImage, currentColor);

    applyPaletteTheme(currentColor);
    renderUI(currentColor, combinedCanvas);
  }

  function applyPaletteTheme(color) {
    var textColor = getContrastTextColor(color.r, color.g, color.b);

    // 页面背景
    pageSection.style.setProperty('--palette-bg', color.hex);
    pageSection.style.setProperty('--palette-text', textColor);
    pageSection.classList.add('palette-has-image');

    // 导航栏背景
    if (navbar) {
      navbar.style.backgroundColor = color.hex;
      navbar.style.color = textColor;
      navbar.classList.add('palette-colored');
    }

    // 隐藏全局背景动画，避免与主色背景冲突
    var bgAnimation = document.querySelector('.bg-animation');
    if (bgAnimation) bgAnimation.style.opacity = '0';
  }

  function resetPaletteTheme() {
    pageSection.style.removeProperty('--palette-bg');
    pageSection.style.removeProperty('--palette-text');
    pageSection.classList.remove('palette-has-image');

    if (navbar) {
      navbar.style.backgroundColor = '';
      navbar.style.color = '';
      navbar.classList.remove('palette-colored');
    }

    var bgAnimation = document.querySelector('.bg-animation');
    if (bgAnimation) bgAnimation.style.opacity = '';
  }

  function renderUI(color, canvas) {
    emptyState.style.display = 'none';
    resultState.classList.add('show');

    resultTitle.textContent = color.hex.toUpperCase();
    resultSubtitle.textContent = '主色调 · ' + color.pct + '%';
    resultImg.src = canvas.toDataURL('image/png');
  }

  function resetAll() {
    currentImage = null;
    currentColor = null;
    combinedCanvas = null;

    emptyState.style.display = '';
    resultState.classList.remove('show');
    resultImg.src = '';
    resultTitle.textContent = '';
    resultSubtitle.textContent = '';

    resetPaletteTheme();
  }

  function observePageVisibility() {
    if (!pageSection) return;

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          if (!pageSection.classList.contains('active') && pageSection.classList.contains('palette-has-image')) {
            resetPaletteTheme();
          }
        }
      });
    });

    observer.observe(pageSection, { attributes: true, attributeFilter: ['class'] });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  var _toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
