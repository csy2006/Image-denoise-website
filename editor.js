/*
 * PrismDen 棱镜降噪图像处理系统 V1.0
 * 图像编辑模块：比例裁剪、旋转翻转、亮度对比度饱和度调整、Unsharp Mask 锐化、预设风格
 * 著作权人：Young__Yang
 * 完成日期：2026-09-28
 * 权利取得方式：原始取得  权利范围：全部权利
 */

(function () {
  'use strict';

  var srcImg = null;
  var srcCanvas = null;
  var workCanvas = null;
  var params = null;
  var defaultParams = null;
  var el = {};

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  function makeDefaultParams() {
    return {
      cropRatio: 'origin',
      cropScale: 1,
      cropX: 0.5,
      cropY: 0.5,
      rotate: 0,
      flipH: false,
      flipV: false,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpen: 0,
      preset: 'none'
    };
  }

  /* 裁剪框计算：按目标比例与取景缩放求裁剪区域，支持在预览图上点击移动裁剪中心 */
function cropRect(w, h, p) {
    var ratioMap = { '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9 };
    var target = ratioMap[p.cropRatio];

    var cw, ch;
    if (!target) {
      cw = w * p.cropScale;
      ch = h * p.cropScale;
    } else {

      var baseW = w, baseH = w / target;
      if (baseH > h) { baseH = h; baseW = h * target; }
      cw = baseW * p.cropScale;
      ch = baseH * p.cropScale;
    }

    cw = Math.max(16, Math.min(w, Math.round(cw)));
    ch = Math.max(16, Math.min(h, Math.round(ch)));

    var x = Math.round(p.cropX * w - cw / 2);
    var y = Math.round(p.cropY * h - ch / 2);
    x = Math.max(0, Math.min(w - cw, x));
    y = Math.max(0, Math.min(h - ch, y));

    return { x: x, y: y, w: cw, h: ch };
  }

  function applyGeometry(src, p) {
    var rect = cropRect(src.width, src.height, p);

    var tmp = document.createElement('canvas');
    tmp.width = rect.w;
    tmp.height = rect.h;
    tmp.getContext('2d').drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

    var swap = (p.rotate === 90 || p.rotate === 270);
    var out = document.createElement('canvas');
    out.width = swap ? rect.h : rect.w;
    out.height = swap ? rect.w : rect.h;

    var ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(p.rotate * Math.PI / 180);
    ctx.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
    ctx.drawImage(tmp, -rect.w / 2, -rect.h / 2);

    return out;
  }

  /* 色彩调整：亮度、对比度、饱和度逐像素映射，含鲜艳/黑白/复古预设 */
function applyColor(canvas, p) {
    if (!p.brightness && !p.contrast && !p.saturation) return canvas;

    var ctx = canvas.getContext('2d');
    var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = imgData.data;

    var b = p.brightness * 2.55;
    var c = (p.contrast + 100) / 100;
    var cFactor = Math.pow(c, 2);
    var s = (p.saturation + 100) / 100;

    var lut = new Uint8ClampedArray(256);
    for (var i = 0; i < 256; i++) {
      var v = (i - 128) * cFactor + 128 + b;
      lut[i] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    var RW = 0.299, RG = 0.587, RB = 0.114;

    for (var idx = 0; idx < d.length; idx += 4) {
      var r = lut[d[idx]];
      var g = lut[d[idx + 1]];
      var bl = lut[d[idx + 2]];

      if (s !== 1) {
        var gray = r * RW + g * RG + bl * RB;
        r = gray + (r - gray) * s;
        g = gray + (g - gray) * s;
        bl = gray + (bl - gray) * s;
      }

      d[idx] = r;
      d[idx + 1] = g;
      d[idx + 2] = bl;
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /* Unsharp Mask 锐化：高斯模糊求低频，原图与低频按权重叠加得到锐化结果 */
function applySharpen(canvas, amount) {
    if (!amount) return canvas;

    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d');
    var src = ctx.getImageData(0, 0, w, h);
    var s = src.data;

    var blur = new Uint8ClampedArray(s.length);
    var kernelSum = 9;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ar = 0, ag = 0, ab = 0;
        for (var ky = -1; ky <= 1; ky++) {
          for (var kx = -1; kx <= 1; kx++) {
            var px = Math.min(w - 1, Math.max(0, x + kx));
            var py = Math.min(h - 1, Math.max(0, y + ky));
            var o = (py * w + px) * 4;
            ar += s[o]; ag += s[o + 1]; ab += s[o + 2];
          }
        }
        var o2 = (y * w + x) * 4;
        blur[o2] = ar / kernelSum;
        blur[o2 + 1] = ag / kernelSum;
        blur[o2 + 2] = ab / kernelSum;
        blur[o2 + 3] = s[o2 + 3];
      }
    }

    var strength = amount / 100 * 1.6;
    for (var i = 0; i < s.length; i += 4) {
      s[i] = Math.min(255, Math.max(0, s[i] + (s[i] - blur[i]) * strength));
      s[i + 1] = Math.min(255, Math.max(0, s[i + 1] + (s[i + 1] - blur[i + 1]) * strength));
      s[i + 2] = Math.min(255, Math.max(0, s[i + 2] + (s[i + 2] - blur[i + 2]) * strength));
    }

    ctx.putImageData(src, 0, 0);
    return canvas;
  }

  function presetParams(name) {
    switch (name) {
      case 'vivid': return { brightness: 5, contrast: 18, saturation: 35, sharpen: 20 };
      case 'mono': return { brightness: 0, contrast: 12, saturation: -100, sharpen: 15 };
      case 'retro': return { brightness: 8, contrast: -8, saturation: -25, sharpen: 8 };
      default: return { brightness: 0, contrast: 0, saturation: 0, sharpen: 0 };
    }
  }

  /* 渲染管线：裁剪 → 旋转翻转 → 色彩调整 → 锐化，实时输出到预览画布 */
function render() {

    if (!srcCanvas || !params) return;

    var started = performance.now();

    var geo = applyGeometry(srcCanvas, params);

    applyColor(geo, params);

    applySharpen(geo, params.sharpen);

    var display = document.getElementById('editorCanvas');
    if (display) {

      var maxW = display.parentElement ? display.parentElement.clientWidth : 720;
      var scale = Math.min(1, maxW / geo.width);
      display.width = Math.max(1, Math.round(geo.width * scale));
      display.height = Math.max(1, Math.round(geo.height * scale));
      var dctx = display.getContext('2d');
      dctx.fillStyle = '#ffffff';
      dctx.fillRect(0, 0, display.width, display.height);
      dctx.drawImage(geo, 0, 0, display.width, display.height);
    }

    workCanvas = geo;

    var info = document.getElementById('editorInfo');
    if (info) {
      info.textContent = '输出尺寸 ' + geo.width + ' × ' + geo.height + '（原图 ' + srcCanvas.width + ' × ' + srcCanvas.height + '）· 本次渲染 ' + Math.round(performance.now() - started) + ' ms';
    }
  }

  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        srcImg = img;
        srcCanvas = document.createElement('canvas');
        srcCanvas.width = img.naturalWidth;
        srcCanvas.height = img.naturalHeight;
        srcCanvas.getContext('2d').drawImage(img, 0, 0);

        defaultParams = makeDefaultParams();
        params = makeDefaultParams();
        syncControls();

        document.getElementById('editorZone').classList.add('hidden');
        document.getElementById('editorStageWrap').classList.remove('hidden');
        document.getElementById('editorPanel').classList.remove('hidden');
        document.getElementById('editorFileName').textContent = file.name;

        render();

        if (window.PrismDenLog) {
          window.PrismDenLog.add({
            type: 'import', name: file.name,
            width: img.naturalWidth, height: img.naturalHeight,
            status: 'success', elapsed: 0,
            params: { source: '编辑器导入' }
          });
        }
      };
      img.onerror = function () {
        toast('图片解码失败', 'error');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function syncControls() {
    if (!params) return;
    var map = {
      cropRatio: 'editorCropRatio', rotate: 'editorRotate',
      brightness: 'editorBrightness', contrast: 'editorContrast',
      saturation: 'editorSaturation', sharpen: 'editorSharpen',
      preset: 'editorPreset'
    };
    Object.keys(map).forEach(function (k) {
      var node = document.getElementById(map[k]);
      if (node) node.value = params[k];
    });

    var scale = document.getElementById('editorCropScale');
    if (scale) scale.value = Math.round(params.cropScale * 100);
    updateLabels();
  }

  function updateLabels() {
    if (!params) return;
    function set(id, text) {
      var n = document.getElementById(id);
      if (n) n.textContent = text;
    }
    set('editorBrightnessVal', params.brightness);
    set('editorContrastVal', params.contrast);
    set('editorSaturationVal', params.saturation);
    set('editorSharpenVal', params.sharpen);
    set('editorCropScaleVal', Math.round(params.cropScale * 100) + '%');
  }

  function readControls() {
    if (!params) return;
    params.cropRatio = document.getElementById('editorCropRatio').value;
    params.rotate = parseInt(document.getElementById('editorRotate').value, 10);
    params.brightness = parseInt(document.getElementById('editorBrightness').value, 10);
    params.contrast = parseInt(document.getElementById('editorContrast').value, 10);
    params.saturation = parseInt(document.getElementById('editorSaturation').value, 10);
    params.sharpen = parseInt(document.getElementById('editorSharpen').value, 10);
    params.cropScale = parseInt(document.getElementById('editorCropScale').value, 10) / 100;
  }

  function exportBlob() {
    return new Promise(function (resolve, reject) {
      if (!workCanvas) { reject(new Error('没有可导出的图像')); return; }
      var fmt = document.getElementById('editorFormat').value;
      var mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
      workCanvas.toBlob(function (b) {
        b ? resolve(b) : reject(new Error('结果导出失败'));
      }, mime, 0.95);
    });
  }

  function currentOutName() {
    var base = (document.getElementById('editorFileName').textContent || 'image').replace(/\.[^.]+$/, '');
    var fmt = document.getElementById('editorFormat').value;
    return base + '_edited.' + (fmt === 'jpeg' ? 'jpg' : fmt);
  }

  function logEdit(status, elapsed, err) {
    if (!window.PrismDenLog) return;
    window.PrismDenLog.add({
      type: 'edit',
      name: document.getElementById('editorFileName').textContent || '编辑结果',
      params: (function () {
        var p = {};
        p['裁剪'] = params.cropRatio;
        p['旋转'] = params.rotate + '°';
        p['翻转'] = (params.flipH ? 'H' : '') + (params.flipV ? 'V' : '') || '无';
        p['亮度'] = params.brightness;
        p['对比'] = params.contrast;
        p['饱和'] = params.saturation;
        p['锐化'] = params.sharpen;
        p['预设'] = params.preset;
        return p;
      })(),
      width: workCanvas ? workCanvas.width : 0,
      height: workCanvas ? workCanvas.height : 0,
      elapsed: elapsed,
      status: status,
      error: err || ''
    });
  }

  function init() {
    el = {
      fileInput: document.getElementById('editorFileInput'),
      pick: document.getElementById('editorPickBtn'),
      zone: document.getElementById('editorZone')
    };

    if (!el.fileInput) return;

    el.pick.addEventListener('click', function () { el.fileInput.click(); });
    el.zone.addEventListener('click', function (e) {
      if (e.target === el.zone) el.fileInput.click();
    });
    el.fileInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
      e.target.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      el.zone.addEventListener(ev, function (e) {
        e.preventDefault(); el.zone.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      el.zone.addEventListener(ev, function (e) {
        e.preventDefault(); el.zone.classList.remove('drag-over');
      });
    });
    el.zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });

    ['editorCropRatio', 'editorRotate', 'editorCropScale',
      'editorBrightness', 'editorContrast', 'editorSaturation', 'editorSharpen'
    ].forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      node.addEventListener('input', function () {
        readControls();
        updateLabels();
        scheduleRender();
      });
      node.addEventListener('change', function () {
        readControls();
        updateLabels();
        render();
      });
    });

    var presetNode = document.getElementById('editorPreset');
    if (presetNode) {
      presetNode.addEventListener('change', function () {
        params.preset = presetNode.value;
        var p = presetParams(presetNode.value);
        params.brightness = p.brightness;
        params.contrast = p.contrast;
        params.saturation = p.saturation;
        params.sharpen = p.sharpen;
        syncControls();
        render();
      });
    }

    var flipH = document.getElementById('editorFlipH');
    var flipV = document.getElementById('editorFlipV');
    if (flipH) flipH.addEventListener('click', function () { params.flipH = !params.flipH; render(); });
    if (flipV) flipV.addEventListener('click', function () { params.flipV = !params.flipV; render(); });

    var stage = document.getElementById('editorCanvas');
    if (stage) {
      stage.addEventListener('click', function (e) {
        if (!srcCanvas || !params) return;
        var r = stage.getBoundingClientRect();
        params.cropX = (e.clientX - r.left) / r.width;
        params.cropY = (e.clientY - r.top) / r.height;
        render();
      });
    }

    var reset = document.getElementById('editorResetBtn');
    if (reset) {
      reset.addEventListener('click', function () {
        if (!defaultParams) return;
        params = JSON.parse(JSON.stringify(defaultParams));
        syncControls();
        render();
        toast('已恢复初始参数', 'info');
      });
    }

    var dl = document.getElementById('editorDownloadBtn');
    if (dl) {
      dl.addEventListener('click', function () {
        var t0 = performance.now();
        exportBlob().then(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = currentOutName();
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
          logEdit('success', Math.round(performance.now() - t0));
          toast('已导出图片', 'success');
        }).catch(function (err) {
          logEdit('error', Math.round(performance.now() - t0), err.message);
          toast(err.message, 'error');
        });
      });
    }

    var save = document.getElementById('editorArchiveBtn');
    if (save) {
      save.addEventListener('click', function () {
        var t0 = performance.now();
        exportBlob().then(function (blob) {
          if (!window.PrismDenArchive) {
            toast('档案库模块未加载', 'error');
            return;
          }
          return window.PrismDenArchive.save(blob, {
            name: currentOutName(), source: 'edit', tags: ['编辑']
          }).then(function () {
            logEdit('success', Math.round(performance.now() - t0));
            toast('已存入档案库', 'success');
          });
        }).catch(function (err) {
          toast(err.message, 'error');
        });
      });
    }
  }

  var _renderTimer = null;
  function scheduleRender() {
    if (_renderTimer) clearTimeout(_renderTimer);
    _renderTimer = setTimeout(function () {
      _renderTimer = null;
      render();
    }, 120);
  }

  window.PrismDenEditor = {
    hasImage: function () { return !!srcCanvas; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
