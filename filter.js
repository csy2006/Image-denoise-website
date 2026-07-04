/* ==================== 创意滤镜引擎 ==================== */
(function() {
  'use strict';

  /* ── DOM 引用 ── */
  const uploadZone   = document.getElementById('filterUploadZone');
  const fileInput    = document.getElementById('filterFileInput');
  const filterEditorBlk  = document.getElementById('filterEditorBlock');
  const previewPlaceholder = document.getElementById('filterPreviewPlaceholder');
  const resultContainer  = document.getElementById('filterResultContainer');
  const resultImg    = document.getElementById('filterResultImg');
  const uploadContent = document.getElementById('filterUploadContent');
  const uploadPreview = document.getElementById('filterUploadPreview');
  const uploadPreviewImg = document.getElementById('filterUploadPreviewImg');

  /* ── 状态 ── */
  var _fImage     = null;   // 原始图片 Image 对象
  var _fDataURL   = null;   // 原始图片 dataURL
  var _fActiveFilter = null; // 当前激活的滤镜 key
  var _fCanvas    = null;   // 处理用的离屏 canvas
  var _fCtx       = null;

  /* ── 微信检测 ── */
  var _isWeChat = /MicroMessenger/i.test(navigator.userAgent);

  /* ── 滤镜预设定义 ── */
  /* category: "sony" = 索尼创意外观 | "film" = 人像胶片模拟 */
  var FILTERS = {
    /* ========== 索尼创意外观 ========== */
    'FL': {
      label: 'Flat 柔和',
      desc:  '低对比 · 柔和淡雅',
      category: 'sony',
      apply: function(r, g, b) {
        r = Math.min(255, Math.max(0, (r - 128) * 0.72 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 0.72 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 0.72 + 128));
        var avg = (r + g + b) / 3;
        r = avg + (r - avg) * 0.70;
        g = avg + (g - avg) * 0.70;
        b = avg + (b - avg) * 0.70;
        r = Math.min(255, r + 8);
        g = Math.min(255, g + 8);
        b = Math.min(255, b + 8);
        return [r, g, b];
      }
    },
    'NT': {
      label: 'Neutral 中性',
      desc:  '自然色彩，轻微增亮',
      category: 'sony',
      apply: function(r, g, b) {
        r = Math.min(255, r * 1.04);
        g = Math.min(255, g * 1.04);
        b = Math.min(255, b * 1.04);
        r = Math.min(255, Math.max(0, (r - 128) * 1.03 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 1.03 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 1.03 + 128));
        r = Math.min(255, r + 3);
        return [r, g, b];
      }
    },
    'VV': {
      label: 'Velvia 鲜艳',
      desc:  '高饱和 · 强对比 · 浓郁',
      category: 'sony',
      apply: function(r, g, b) {
        r = Math.min(255, Math.max(0, (r - 128) * 1.28 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 1.28 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 1.28 + 128));
        var avg = (r + g + b) / 3;
        r = avg + (r - avg) * 1.42;
        g = avg + (g - avg) * 1.42;
        b = avg + (b - avg) * 1.42;
        r = Math.min(255, Math.max(0, r));
        g = Math.min(255, Math.max(0, g));
        b = Math.min(255, Math.max(0, b));
        return [r, g, b];
      }
    },
    'SH': {
      label: 'Shadow 暗部',
      desc:  '提升暗部，暖色调氛围',
      category: 'sony',
      apply: function(r, g, b) {
        var brightness = (r + g + b) / 3;
        if (brightness < 100) {
          var factor = 1 + (100 - brightness) / 100 * 0.35;
          r = Math.min(255, r * factor);
          g = Math.min(255, g * factor);
          b = Math.min(255, b * factor);
        }
        r = Math.min(255, Math.max(0, (r - 128) * 0.93 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 0.93 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 0.93 + 128));
        var avg = (r + g + b) / 3;
        r = avg + (r - avg) * 0.88;
        g = avg + (g - avg) * 0.88;
        b = avg + (b - avg) * 0.88;
        r = Math.min(255, r + 8);
        b = Math.max(0, b - 6);
        return [r, g, b];
      }
    },
    'IN': {
      label: 'Instant 即时',
      desc:  '复古暖调 · 轻微褪色',
      category: 'sony',
      apply: function(r, g, b) {
        r = Math.min(255, r + 14);
        b = Math.max(0, b - 10);
        r = Math.min(255, Math.max(0, (r - 128) * 0.84 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 0.84 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 0.84 + 128));
        var avg = (r + g + b) / 3;
        r = avg + (r - avg) * 0.82;
        g = avg + (g - avg) * 0.82;
        b = avg + (b - avg) * 0.82;
        r = Math.min(255, r + 5);
        g = Math.min(255, g + 5);
        b = Math.min(255, b + 8);
        return [r, g, b];
      }
    },

    /* ========== 人像胶片模拟 ========== */
    'PT': {
      label: 'Portra 人像',
      desc:  '柔和肤色 · 暖调 · 低反差',
      category: 'film',
      apply: function(r, g, b) {
        // Kodak Portra 风格：暗部提亮、暖调偏移、低反差、肤色保留
        var brightness = (r + g + b) / 3;
        // 暗部柔软提亮
        if (brightness < 90) {
          var lift = 1 + (90 - brightness) / 90 * 0.28;
          r = Math.min(255, r * lift);
          g = Math.min(255, g * lift);
          b = Math.min(255, b * lift);
        }
        // 降低整体对比度
        r = Math.min(255, Math.max(0, (r - 128) * 0.80 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 0.80 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 0.80 + 128));
        // 暖色调偏移（Portra 标志性暖调）
        r = Math.min(255, r * 1.06);
        g = Math.min(255, g * 1.02);
        b = Math.max(0, b * 0.94);
        // 极轻微降低饱和度，保留肤色
        var avg2 = (r + g + b) / 3;
        r = avg2 + (r - avg2) * 0.92;
        g = avg2 + (g - avg2) * 0.94;
        b = avg2 + (b - avg2) * 0.88;
        return [r, g, b];
      }
    },
    'AS': {
      label: 'Astia 柔和',
      desc:  '自然肤色 · 柔滑影调',
      category: 'film',
      apply: function(r, g, b) {
        // Fujifilm ASTIA 风格：极柔和对比、准确肤色、微暖
        // 降低对比度
        r = Math.min(255, Math.max(0, (r - 128) * 0.76 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 0.76 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 0.76 + 128));
        // 肤色保护：红色通道微提，蓝色微降
        r = Math.min(255, r + 6);
        b = Math.max(0, b - 4);
        // 柔化饱和度
        var avg = (r + g + b) / 3;
        r = avg + (r - avg) * 0.88;
        g = avg + (g - avg) * 0.90;
        b = avg + (b - avg) * 0.86;
        // 整体轻微提亮
        r = Math.min(255, r + 4);
        g = Math.min(255, g + 4);
        b = Math.min(255, b + 6);
        return [r, g, b];
      }
    },
    'PN': {
      label: 'Pro Neg 负片',
      desc:  '平反差 · 淡彩 · 柔和',
      category: 'film',
      apply: function(r, g, b) {
        // Fujifilm PRO Neg Std 风格：专业负片、极平反差、淡彩
        // 强暗部提亮
        var brightness = (r + g + b) / 3;
        if (brightness < 110) {
          var lift = 1 + (110 - brightness) / 110 * 0.32;
          r = Math.min(255, r * lift);
          g = Math.min(255, g * lift);
          b = Math.min(255, b * lift);
        }
        // 大幅降低对比度
        r = Math.min(255, Math.max(0, (r - 128) * 0.68 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 0.68 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 0.68 + 128));
        // 淡彩处理
        var avg = (r + g + b) / 3;
        r = avg + (r - avg) * 0.78;
        g = avg + (g - avg) * 0.80;
        b = avg + (b - avg) * 0.76;
        // 微暖
        r = Math.min(255, r + 5);
        b = Math.max(0, b - 3);
        return [r, g, b];
      }
    },
    'CC': {
      label: 'Classic Chrome',
      desc:  '低饱和 · 浓郁阴影 · 纪实',
      category: 'film',
      apply: function(r, g, b) {
        // Fujifilm Classic Chrome 风格：低饱和、浓郁阴影、略冷调
        var brightness = (r + g + b) / 3;
        // 暗部加重（Classic Chrome 标志性浓郁暗部）
        if (brightness < 80) {
          r = Math.max(0, r * 0.82);
          g = Math.max(0, g * 0.82);
          b = Math.max(0, b * 0.82);
        }
        // 提升中间调对比
        r = Math.min(255, Math.max(0, (r - 128) * 1.08 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 1.08 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 1.08 + 128));
        // 大幅降低饱和度
        var avg = (r + g + b) / 3;
        r = avg + (r - avg) * 0.72;
        g = avg + (g - avg) * 0.74;
        b = avg + (b - avg) * 0.72;
        // 轻微冷调偏移
        r = Math.max(0, r - 3);
        b = Math.min(255, b + 4);
        return [r, g, b];
      }
    },

    /* ========== 电影类色调 ========== */
    'TO': {
      label: 'Teal Orange',
      desc:  '青橙色调 · 电影级冷暖对比',
      category: 'tone',
      apply: function(r, g, b) {
        // 青橙色调：阴影偏青(teal)、高光偏橙(orange)
        var brightness = (r + g + b) / 3;
        // 暗部推青（减红、加蓝绿）
        if (brightness < 128) {
          var factor = (128 - brightness) / 128;
          r = Math.max(0, r - factor * 35);
          g = Math.min(255, g + factor * 8);
          b = Math.min(255, b + factor * 28);
        }
        // 高光推橙（加红黄、减蓝）
        if (brightness > 128) {
          var f2 = (brightness - 128) / 127;
          r = Math.min(255, r + f2 * 30);
          g = Math.min(255, g + f2 * 12);
          b = Math.max(0, b - f2 * 25);
        }
        // 提升整体对比度
        r = Math.min(255, Math.max(0, (r - 128) * 1.15 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 1.08 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 1.12 + 128));
        // 轻微降低饱和度，营造电影感
        var avg = (r + g + b) / 3;
        r = avg + (r - avg) * 0.88;
        g = avg + (g - avg) * 0.90;
        b = avg + (b - avg) * 0.92;
        return [r, g, b];
      }
    },
    'OR': {
      label: 'Orange Red',
      desc:  '橙红色调 · 温暖落日氛围',
      category: 'tone',
      apply: function(r, g, b) {
        // 橙红色调：整体暖色偏移，强化橙红色通道
        // 强烈暖化：红增、绿微增、蓝减
        r = Math.min(255, r * 1.14);
        g = Math.min(255, g * 1.05);
        b = Math.max(0, b * 0.82);
        // 提升暗部亮度（防止过暗丢失细节）
        var brightness = (r + g + b) / 3;
        if (brightness < 80) {
          var lift = 1 + (80 - brightness) / 80 * 0.20;
          r = Math.min(255, r * lift);
          g = Math.min(255, g * lift);
          b = Math.min(255, b * lift);
        }
        // 增强暖调对比度
        r = Math.min(255, Math.max(0, (r - 128) * 1.10 + 128));
        g = Math.min(255, Math.max(0, (g - 128) * 1.02 + 128));
        b = Math.min(255, Math.max(0, (b - 128) * 1.05 + 128));
        // 轻微提升饱和度（暖色更浓郁）
        var avg2 = (r + g + b) / 3;
        r = avg2 + (r - avg2) * 1.10;
        g = avg2 + (g - avg2) * 1.04;
        b = avg2 + (b - avg2) * 0.88;
        return [r, g, b];
      }
    }
  };

  /* ── 应用滤镜到 Canvas ── */
  function applyFilter(filterKey) {
    if (!_fImage || !_fCtx || !_fCanvas) return;
    var filter = FILTERS[filterKey];
    if (!filter) return;

    var w = _fCanvas.width;
    var h = _fCanvas.height;

    // 画原始图片
    _fCtx.clearRect(0, 0, w, h);
    _fCtx.drawImage(_fImage, 0, 0, w, h);

    // 读取像素
    var imageData = _fCtx.getImageData(0, 0, w, h);
    var data = imageData.data;

    // 逐像素应用滤镜
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i];
      var g = data[i + 1];
      var b = data[i + 2];
      var result = filter.apply(r, g, b);
      data[i]     = Math.round(result[0]);
      data[i + 1] = Math.round(result[1]);
      data[i + 2] = Math.round(result[2]);
      // alpha 不变
    }

    // 写回 canvas
    _fCtx.putImageData(imageData, 0, 0);

    // 更新预览
    var resultDataURL = _fCanvas.toDataURL('image/jpeg', 0.92);
    if (resultImg) {
      resultImg.src = resultDataURL;
    }

    // 更新弹窗内预览
    _showSheetPreview(resultDataURL);

    // 更新激活状态
    _fActiveFilter = filterKey;
    _updateActiveButton(filterKey);

    // 统计计数
    if (window.PrismDenStats) window.PrismDenStats.incFilter();
  }

  /* ── 更新预设按钮激活状态 ── */
  function _updateActiveButton(key) {
    document.querySelectorAll('.filter-preset-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === key);
    });
  }

  /* ── 弹窗内预览 ── */
  function _showSheetPreview(dataURL) {
    var previewInner = document.getElementById('filterSheetPreviewInner');
    if (!previewInner) return;
    var img = previewInner.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.alt = '滤镜预览';
      previewInner.appendChild(img);
    }
    img.src = dataURL;

    var previewBlock = document.getElementById('filterSheetPreview');
    if (previewBlock) {
      previewBlock.style.display = 'block';
    }
  }

  /* ── 处理文件 ── */
  function handleFile(file) {
    if (!file || !file.type.match(/image\/(jpeg|png|webp)/)) {
      alert('请上传 JPG / PNG / WebP 格式的图片');
      return;
    }
    if (typeof vibrate === 'function') vibrate(10);

    var reader = new FileReader();
    reader.onload = function(e) {
      _fDataURL = e.target.result;

      var img = new Image();
      img.onload = function() {
        _fImage = img;

        // 创建处理用 canvas（限制最大尺寸 1600px，保证性能）
        var maxW = 1600, maxH = 1600;
        var scale = Math.min(1, maxW / img.width, maxH / img.height);
        var cw = Math.round(img.width * scale);
        var ch = Math.round(img.height * scale);

        _fCanvas = document.createElement('canvas');
        _fCanvas.width = cw;
        _fCanvas.height = ch;
        _fCtx = _fCanvas.getContext('2d');

        // 隐藏编辑器
        if (filterEditorBlk) filterEditorBlk.style.display = 'block';
        if (previewPlaceholder) previewPlaceholder.style.display = 'none';
        if (resultContainer) resultContainer.style.display = 'flex';

        // 上传后隐藏上传区（桌面端和移动端都隐藏）
        if (uploadZone) uploadZone.classList.add('upload-hidden');

        // 重置激活滤镜
        _fActiveFilter = null;
        _updateActiveButton(null);

        // 默认显示原图
        if (resultImg) resultImg.src = _fDataURL;

        // 移动端：上传后自动打开弹窗并展开到全屏
        if (window.innerWidth <= 768) {
          openFilterSheet();
          // 等弹窗完全滑入后再展开全屏
          // 等弹窗完全滑入后再展开全屏
          setTimeout(function() {
            var panel = document.getElementById('filterPanel');
            if (panel && panel.classList.contains('sheet-open') && !panel.classList.contains('sheet-expanded')) {
              toggleFilterSheetExpand();
            }
          }, 400);
          var previewBlock = document.getElementById('filterSheetPreview');
          if (previewBlock) previewBlock.style.display = 'block';
          var previewInner = document.getElementById('filterSheetPreviewInner');
          if (previewInner) {
            var pimg = previewInner.querySelector('img');
            if (!pimg) {
              pimg = document.createElement('img');
              pimg.alt = '滤镜预览';
              previewInner.appendChild(pimg);
            }
            pimg.src = _fDataURL;
          }
        }
      };
      img.src = _fDataURL;
    };
    reader.readAsDataURL(file);
  }

  /* ── 下载滤镜结果 ── */
  window.downloadFilterResult = function() {
    if (!_fCanvas || !_fCtx) return;

    var dataURL = _fCanvas.toDataURL('image/jpeg', 0.95);

    if (_isWeChat) {
      // 微信：弹出全屏预览，提示长按保存
      _wechatSaveImage(dataURL);
    } else {
      var a = document.createElement('a');
      a.download = 'filtered-' + (_fActiveFilter || 'original') + '.jpg';
      a.href = dataURL;
      a.click();
    }
  };

  /* ── 微信长按保存 ── */
  function _wechatSaveImage(dataURL) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'padding:2rem;cursor:default;';

    var img = document.createElement('img');
    img.src = dataURL;
    img.alt = '滤镜结果';
    img.style.cssText = 'max-width:94vw;max-height:75vh;border-radius:8px;object-fit:contain;'
      + 'box-shadow:0 4px 24px rgba(0,0,0,0.5);';

    var tip = document.createElement('p');
    tip.textContent = '长按图片保存到相册';
    tip.style.cssText = 'color:rgba(255,255,255,0.85);font-size:0.9rem;margin-top:1.5rem;'
      + 'font-family:system-ui,sans-serif;letter-spacing:0.04em;';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'margin-top:1.5rem;padding:0.6rem 2rem;border:1px solid rgba(255,255,255,0.3);'
      + 'border-radius:100px;background:transparent;color:#fff;font-size:0.9rem;'
      + 'font-family:system-ui,sans-serif;cursor:pointer;';
    closeBtn.onclick = function() { document.body.removeChild(overlay); };

    overlay.appendChild(img);
    overlay.appendChild(tip);
    overlay.appendChild(closeBtn);
    overlay.onclick = function(e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    };

    document.body.appendChild(overlay);
  }

  /* ── 重置（"重新上传"按钮） ── */
  window.resetFilterAll = function() {
    _fImage = null;
    _fDataURL = null;
    _fActiveFilter = null;
    _fCanvas = null;
    _fCtx = null;

    if (filterEditorBlk) filterEditorBlk.style.display = 'none';
    if (previewPlaceholder) previewPlaceholder.style.display = '';
    if (resultContainer) resultContainer.style.display = 'none';
    if (resultImg) resultImg.src = '';
    if (uploadContent) uploadContent.style.display = '';
    if (uploadPreview) uploadPreview.style.display = 'none';
    if (uploadPreviewImg) uploadPreviewImg.src = '';

    // 弹窗内重新显示上传区，并降为半屏
    if (uploadZone) uploadZone.classList.remove('upload-hidden');

    // 如果弹窗是全屏状态，降为半屏
    var panel = document.getElementById('filterPanel');
    if (panel && panel.classList.contains('sheet-expanded')) {
      panel.classList.remove('sheet-expanded');
      var btn = document.getElementById('filterExpandBtn');
      if (btn) {
        var arrowUp = btn.querySelector('.arrow-up');
        var arrowDown = btn.querySelector('.arrow-down');
        if (arrowUp) arrowUp.style.display = '';
        if (arrowDown) arrowDown.style.display = 'none';
      }
    }

    var previewBlock = document.getElementById('filterSheetPreview');
    if (previewBlock) previewBlock.style.display = 'none';
    var previewInner = document.getElementById('filterSheetPreviewInner');
    if (previewInner) previewInner.innerHTML = '';

    _updateActiveButton(null);
    if (fileInput) fileInput.value = '';
  };

  /* ── 预设按钮点击 ── */
  document.querySelectorAll('.filter-preset-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var key = this.getAttribute('data-filter');
      if (!_fImage) {
        alert('请先上传一张照片');
        return;
      }
      if (typeof vibrate === 'function') vibrate(8);
      applyFilter(key);
    });
  });

  /* ── 液态玻璃药丸定位 + 灵动放大 ── */
  function positionFilterPill() {
    var pill = document.querySelector('.filter-category-pill');
    var activeTab = document.querySelector('.filter-category-tab.active');
    var container = document.querySelector('.filter-category-tabs');
    if (!pill || !activeTab || !container) return;

    var cRect = container.getBoundingClientRect();
    var tRect = activeTab.getBoundingClientRect();
    var left = tRect.left - cRect.left + 2;
    var width = tRect.width - 4;

    pill.style.left = left + 'px';
    pill.style.width = width + 'px';
  }

  /* Tab 点击：pill 纵向放大 > 横向，灵动回弹 */
  function animatePillClick(pill) {
    if (!pill) return;
    // 清除之前的动画残留
    pill.style.transition = 'none';
    pill.style.transform = 'scaleX(1.06) scaleY(1.22)';
    // 用两层回弹制造灵动感
    requestAnimationFrame(function() {
      pill.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.1, 0.25, 1.4)';
      pill.style.transform = 'scaleX(0.97) scaleY(0.95)';
    });
    setTimeout(function() {
      pill.style.transition = 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
      pill.style.transform = 'scaleX(1) scaleY(1)';
    }, 200);
  }

  /* ── 滤镜类别 Tab 切换 ── */
  document.querySelectorAll('.filter-category-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      if (typeof vibrate === 'function') vibrate(6);
      var category = this.getAttribute('data-category');

      // 更新 tab 激活状态
      document.querySelectorAll('.filter-category-tab').forEach(function(t) {
        t.classList.toggle('active', t.getAttribute('data-category') === category);
      });

      // 切换滤镜预设网格显示
      document.querySelectorAll('.filter-presets').forEach(function(grid) {
        grid.style.display = grid.getAttribute('data-category') === category ? '' : 'none';
      });

      // 液态玻璃药丸滑动 + 灵动放大
      var pill = document.querySelector('.filter-category-pill');
      if (pill) {
        positionFilterPill();
        animatePillClick(pill);
      }
    });
  });

  // 初始定位液态玻璃药丸
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', positionFilterPill);
  } else {
    positionFilterPill();
  }

  // 窗口 resize 重新定位
  var _filterPillResizeTimer = null;
  window.addEventListener('resize', function() {
    clearTimeout(_filterPillResizeTimer);
    _filterPillResizeTimer = setTimeout(positionFilterPill, 150);
  });

  /* ── 上传区域交互 ── */
  if (uploadZone && fileInput) {
    uploadZone.addEventListener('click', function() { fileInput.click(); });

    uploadZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', function() {
      uploadZone.classList.remove('drag-over');
    });
    uploadZone.addEventListener('drop', function(e) {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', function() {
      if (fileInput.files.length > 0) {
        handleFile(fileInput.files[0]);
      }
    });
  }

  /* ==================== 移动端底部弹窗 ==================== */

  /* ── 打开弹窗（从底部升起 → 半屏，带动画）── */
  window.openFilterSheet = function() {
    var panel = document.getElementById('filterPanel');
    var backdrop = document.getElementById('filterMobileBackdrop');
    var toggle = document.getElementById('filterMobileToggle');

    if (!panel) return;

    // 取消可能正在进行的关闭动画 timer
    if (panel._closeTimer) {
      clearTimeout(panel._closeTimer);
      panel._closeTimer = null;
    }

    // 确保面板是 body 的直接子元素（CSS body > .filter-panel 依赖此结构）
    if (panel.parentNode !== document.body) {
      document.body.appendChild(panel);
    }
    if (backdrop && backdrop.parentNode !== document.body) {
      document.body.appendChild(backdrop);
    }

    // 清除 inline style 残留，重置为隐藏态（translateY(100%)）
    panel.style.transform = '';
    panel.style.maxHeight = '';

    // 确保初始状态：无 sheet-open，translateY(100%) 隐藏
    panel.classList.remove('sheet-open', 'sheet-expanded', 'dragging');

    // 强制回流，让浏览器先应用 translateY(100%) 的初始帧
    void panel.offsetHeight;

    // 下一帧添加 sheet-open，触发 CSS transition 动画：translateY(100%) → translateY(0)
    requestAnimationFrame(function() {
      panel.classList.add('sheet-open');
      if (backdrop) backdrop.classList.add('show');
      if (toggle) toggle.classList.add('hidden');

      // 初始箭头朝上（半屏→提示可以上滑展开全屏）
      var expandBtn = document.getElementById('filterExpandBtn');
      if (expandBtn) {
        var up = expandBtn.querySelector('.arrow-up');
        var down = expandBtn.querySelector('.arrow-down');
        if (up) { up.style.display = ''; up.removeAttribute('data-filter-dir'); }
        if (down) { down.style.display = 'none'; down.removeAttribute('data-filter-dir'); }
      }

      // 如果已上传图片，确保编辑器区域可见，同时隐藏上传区
      if (_fImage) {
        var editor = document.getElementById('filterEditorBlock');
        if (editor) editor.style.display = '';
        if (uploadZone) uploadZone.classList.add('upload-hidden');
      }
    });

    lockBodyForSheet();
  };

  /* ── 关闭弹窗（从当前状态 → 降到底部，带动画）── */
  window.closeFilterSheet = function() {
    var panel = document.getElementById('filterPanel');
    var backdrop = document.getElementById('filterMobileBackdrop');
    var toggle = document.getElementById('filterMobileToggle');
    var page = document.querySelector('.filter-page');
    var pageSection = document.getElementById('page-filter');

    if (!panel) return;

    // 清除展开态（如果有的话，触发展开到半屏的过渡）
    panel.classList.remove('sheet-expanded');

    // 箭头复位
    var expandBtn = document.getElementById('filterExpandBtn');
    if (expandBtn) {
      var up = expandBtn.querySelector('.arrow-up');
      var down = expandBtn.querySelector('.arrow-down');
      if (up) up.style.display = '';
      if (down) down.style.display = '';
    }

    // 先移除 sheet-open 触发 slide-down 动画
    panel.classList.remove('sheet-open');
    if (backdrop) backdrop.classList.remove('show');
    if (toggle) toggle.classList.remove('hidden');
    if (page) {
      page.classList.remove('sheet-active', 'sheet-expanded-active');
    }

    unlockBodyForSheet();

    // 等待动画完成（350ms）后再移回 DOM + 清理 dragging
    // 注意：如果在动画期间用户又打开了弹窗，跳过移动
    var _closeTimer = setTimeout(function() {
      // 如果面板又被重新打开了（sheet-open），不要移动
      if (panel.classList.contains('sheet-open')) return;

      panel.classList.remove('dragging');
      panel.style.transform = '';
      panel.style.maxHeight = '';

      // 将面板移回 .filter-page 内（作为第一个子元素）
      if (panel.parentNode === document.body && page) {
        page.insertBefore(panel, page.firstChild);
      }
      if (backdrop && backdrop.parentNode === document.body && pageSection) {
        pageSection.appendChild(backdrop);
      }
      _closeTimer = null;
    }, 380);

    // 保存 timer 引用，以便 openFilterSheet 可以取消它
    panel._closeTimer = _closeTimer;
  };

  /* ── 切换弹窗 ── */
  window.toggleFilterMobileSheet = function() {
    var panel = document.getElementById('filterPanel');
    if (panel && panel.classList.contains('sheet-open')) {
      closeFilterSheet();
    } else {
      openFilterSheet();
    }
  };

  /* ── 切换全屏展开（带动画）── */
  window.toggleFilterSheetExpand = function() {
    var panel = document.getElementById('filterPanel');
    if (!panel || !panel.classList.contains('sheet-open')) return;

    var btn = document.getElementById('filterExpandBtn');
    var arrowUp = btn ? btn.querySelector('.arrow-up') : null;
    var arrowDown = btn ? btn.querySelector('.arrow-down') : null;

    if (panel.classList.contains('sheet-expanded')) {
      // 当前全屏 → 恢复半屏：箭头朝上
      panel.classList.remove('sheet-expanded');
      if (arrowUp) arrowUp.style.display = '';
      if (arrowDown) arrowDown.style.display = 'none';
      // 滚动回顶部
      panel.scrollTop = 0;
    } else {
      // 当前半屏 → 展开全屏：箭头朝下
      panel.classList.add('sheet-expanded');
      if (arrowUp) arrowUp.style.display = 'none';
      if (arrowDown) arrowDown.style.display = '';
      panel.scrollTop = 0;
    }
  };

  /* ── 锁 / 解锁 body ── */
  function lockBodyForSheet() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    document.body.style.overscrollBehavior = 'none';
    var navbar = document.getElementById('navbar');
    if (navbar) navbar.classList.add('sheet-visible');
  }

  function unlockBodyForSheet() {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    document.body.style.overscrollBehavior = '';
    var navbar = document.getElementById('navbar');
    if (navbar) navbar.classList.remove('sheet-visible');
  }

  /* ── 弹窗拖拽 ── */
  function initFilterSheetDrag() {
    var panel = document.getElementById('filterPanel');
    var backdrop = document.getElementById('filterMobileBackdrop');
    var toggle = document.getElementById('filterMobileToggle');
    if (!panel || !backdrop) return;

    var dragData = {
      startY: 0,
      currentY: 0,
      isDragging: false,
      isExpanded: false,
      isClosed: true
    };

    panel.addEventListener('touchstart', function(e) {
      var handle = e.target.closest('.sheet-drag-handle');
      if (!handle) return;
      dragData.startY = e.touches[0].clientY;
      dragData.currentY = e.touches[0].clientY;
      dragData.isDragging = true;
      dragData.isExpanded = panel.classList.contains('sheet-expanded');
      dragData.isClosed = !panel.classList.contains('sheet-open');
      panel.classList.add('dragging');
      panel.style.transition = 'none';
    }, { passive: false });

    panel.addEventListener('touchmove', function(e) {
      if (!dragData.isDragging) return;
      e.preventDefault();
      dragData.currentY = e.touches[0].clientY;
      var dy = dragData.currentY - dragData.startY;

      if (dragData.isExpanded) {
        // 展开态：只能往下拖
        if (dy > 0) {
          panel.style.transform = 'translateY(' + dy + 'px)';
          panel.style.maxHeight = 'calc(100vh - 8px)';
        }
      } else {
        // 普通态
        if (dy > 0) {
          // 向下拖 = 缩小/关闭
          panel.style.transform = 'translateY(' + dy + 'px)';
          panel.style.maxHeight = '';
        } else if (dy < 0) {
          // 向上拖 = 扩展
          panel.style.transform = '';
          panel.style.maxHeight = 'calc(100vh - 8px - ' + Math.abs(dy) + 'px)';
        }
      }
    }, { passive: false });

    panel.addEventListener('touchend', function() {
      if (!dragData.isDragging) return;
      dragData.isDragging = false;
      panel.classList.remove('dragging');
      panel.style.transition = '';

      var dy = dragData.currentY - dragData.startY;

      if (dragData.isExpanded) {
        // 展开态：向下拖 > 60px → 收起为普通；> 150px → 关闭
        if (dy > 150) {
          closeFilterSheet();
        } else if (dy > 60) {
          panel.style.transform = '';
          panel.style.maxHeight = '';
          panel.classList.remove('sheet-expanded');
          panel.classList.add('sheet-open');
        } else {
          panel.style.transform = '';
          panel.style.maxHeight = '';
          panel.classList.add('sheet-expanded');
        }
      } else {
        // 普通态：向上拖 > 70px → 全屏；向下拖 > 60px → 关闭
        if (dy < -70) {
          panel.style.transform = '';
          panel.style.maxHeight = '';
          panel.classList.add('sheet-expanded');
        } else if (dy > 60) {
          closeFilterSheet();
        } else {
          panel.style.transform = '';
          panel.style.maxHeight = '';
          panel.classList.add('sheet-open');
        }
      }
    });

    // 遮罩点击关闭
    backdrop.addEventListener('click', function() {
      closeFilterSheet();
    });

    // 浮动按钮切换
    if (toggle) {
      toggle.addEventListener('click', function(e) {
        e.preventDefault();
        toggleFilterMobileSheet();
      });
    }
  }

  /* ── 展开按钮 ── */
  var expandBtn = document.getElementById('filterExpandBtn');
  if (expandBtn) {
    expandBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      toggleFilterSheetExpand();
    });
  }

  /* ==================== 初始化 ==================== */
  document.addEventListener('DOMContentLoaded', function() {
    initFilterSheetDrag();
  });

})();
