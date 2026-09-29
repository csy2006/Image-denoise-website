/*
 * PrismDen 棱镜降噪图像处理系统 V1.0
 * 批量处理模块：多图任务队列、串行调度、暂停/取消/重试、结果打包下载
 * 著作权人：Young__Yang
 * 完成日期：2026-09-28
 * 权利取得方式：原始取得  权利范围：全部权利
 */

(function () {
  'use strict';

  var tasks = [];
  var running = false;
  var paused = false;
  var cancelFlag = false;
  var seq = 0;
  var _abortWaiters = [];

  var el = {};

  function uid() {
    return 'b' + Date.now().toString(36) + (seq++).toString(36) +
      Math.random().toString(36).slice(2, 6);
  }

  function fmtBytes(n) {
    if (!n && n !== 0) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function fmtTime(ms) {
    if (!ms && ms !== 0) return '-';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  function baseName(name) {
    return String(name || 'image').replace(/\.[^.]+$/, '');
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('图片解码失败')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.readAsDataURL(file);
    });
  }

  function makeThumb(img, size) {
    size = size || 160;
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var scale = Math.min(size / w, size / h, 1);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) {
      c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ZIP 打包：自行实现 store 模式（无压缩）打包，含本地文件头、目录结束记录与 CRC32 校验 */
function buildZip(entries) {
    var parts = [];
    var central = [];
    var offset = 0;

    function dosTime(d) {
      var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
      var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      return { time: time, date: date };
    }

    return Promise.all(entries.map(function (e) {
      return e.blob.arrayBuffer().then(function (ab) {
        return { name: e.name, data: new Uint8Array(ab) };
      });
    })).then(function (files) {
      var now = new Date();
      var dt = dosTime(now);

      files.forEach(function (f) {
        var nameBytes = new TextEncoder().encode(f.name);
        var crc = crc32(f.data);

        var local = new Uint8Array(30 + nameBytes.length);
        var dv = new DataView(local.buffer);
        dv.setUint32(0, 0x04034b50, true);
        dv.setUint16(4, 20, true);
        dv.setUint16(6, 0x0800, true);
        dv.setUint16(8, 0, true);
        dv.setUint16(10, dt.time, true);
        dv.setUint16(12, dt.date, true);
        dv.setUint32(14, crc, true);
        dv.setUint32(18, f.data.length, true);
        dv.setUint32(22, f.data.length, true);
        dv.setUint16(26, nameBytes.length, true);
        dv.setUint16(28, 0, true);
        local.set(nameBytes, 30);

        parts.push(local, f.data);

        var cen = new Uint8Array(46 + nameBytes.length);
        var cv = new DataView(cen.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, dt.time, true);
        cv.setUint16(14, dt.date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, f.data.length, true);
        cv.setUint32(24, f.data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        cen.set(nameBytes, 46);

        central.push(cen);
        offset += local.length + f.data.length;
      });

      var centralSize = central.reduce(function (s, c) { return s + c.length; }, 0);
      var eocd = new Uint8Array(22);
      var ev = new DataView(eocd.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(4, 0, true);
      ev.setUint16(6, 0, true);
      ev.setUint16(8, files.length, true);
      ev.setUint16(10, files.length, true);
      ev.setUint32(12, centralSize, true);
      ev.setUint32(16, offset, true);
      ev.setUint16(20, 0, true);

      return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function addFiles(fileList) {
    var added = 0;
    Array.prototype.forEach.call(fileList, function (f) {
      if (!/^image\//.test(f.type)) return;
      tasks.push({
        id: uid(),
        file: f,
        name: f.name,
        size: f.size,
        status: 'pending',
        progress: 0,
        elapsed: 0,
        thumb: '',
        blob: null,
        outName: '',
        error: '',
        retries: 0
      });
      added++;
    });
    if (added) {
      render();
      toast('已加入 ' + added + ' 个文件', 'success');
    } else {
      toast('未识别到图片文件', 'error');
    }
  }

  function removeTask(id) {
    var t = findTask(id);
    if (!t) return;
    if (t.status === 'running') { toast('正在处理，请先暂停或取消', 'error'); return; }
    tasks = tasks.filter(function (x) { return x.id !== id; });
    render();
  }

  function findTask(id) {
    for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i];
    return null;
  }

  function clearFinished() {
    tasks = tasks.filter(function (t) { return t.status !== 'done'; });
    render();
  }

  function currentParams() {
    return {
      sigmaS: parseInt(el.sigmaS.value, 10),
      sigmaR: parseInt(el.sigmaR.value, 10),
      mode: (document.querySelector('input[name="batchMode"]:checked') || {}).value || 'bilateral',
      format: el.format.value,
      quality: parseInt(el.quality.value, 10) / 100,
      maxPixels: parseInt(el.maxPixels.value, 10),
      timeoutSec: parseInt(el.timeout.value, 10)
    };
  }

  /* 大图保护：超出像素上限时等比缩放，避免单张耗时过长拖住整个队列 */
function limitSize(canvas, maxPixels) {
    var px = canvas.width * canvas.height;
    if (!maxPixels || px <= maxPixels) return { canvas: canvas, scaled: false, scale: 1 };

    var scale = Math.sqrt(maxPixels / px);
    var w = Math.max(1, Math.round(canvas.width * scale));
    var h = Math.max(1, Math.round(canvas.height * scale));
    var small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    var ctx = small.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, w, h);
    return { canvas: small, scaled: true, scale: scale };
  }

  /* 单张处理：解码 → 缩放保护 → 调用降噪核心 → 编码输出，含超时跳过与中止信号 */
function processOne(t, params) {
    return new Promise(function (resolve) {
      var started = performance.now();
      var tickTimer = null;

      function startTick() {
        stopTick();
        tickTimer = setInterval(function () {
          t.elapsed = Math.round(performance.now() - started);
          var node = el.list.querySelector('[data-id="' + t.id + '"]');
          if (node) {
            var meta = node.querySelector('.batch-task-meta');
            if (meta) {
              var timeSpan = meta.querySelector('.batch-task-time');
              if (timeSpan) timeSpan.textContent = fmtTime(t.elapsed);
            }
          }
        }, 1000);
      }
      function stopTick() {
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      }

      loadImage(t.file).then(function (img) {
        var srcCanvas = document.createElement('canvas');
        srcCanvas.width = img.naturalWidth;
        srcCanvas.height = img.naturalHeight;
        srcCanvas.getContext('2d').drawImage(img, 0, 0);

        t.thumb = makeThumb(img);
        t.srcWidth = img.naturalWidth;
        t.srcHeight = img.naturalHeight;
        render();

        if (!window.PrismDenDenoise) throw new Error('降噪核心未就绪');

        var limited = limitSize(srcCanvas, params.maxPixels);
        t.width = limited.canvas.width;
        t.height = limited.canvas.height;
        t.scaled = limited.scaled;
        if (limited.scaled) {
          t.note = '原图 ' + t.srcWidth + '×' + t.srcHeight + '，已缩至上限内';
          render();
        }

        startTick();

        var runPromise = window.PrismDenDenoise.run(limited.canvas, {
          sigmaS: params.sigmaS,
          sigmaR: params.sigmaR,
          mode: params.mode,
          onProgress: function (done, total) {
            t.progress = Math.round((done / total) * 100);
            updateTaskNode(t);
          }
        });

        var timed = runPromise;
        if (params.timeoutSec) {
          timed = new Promise(function (res, rej) {
            var timer = setTimeout(function () {
              if (window.PrismDenDenoise && window.PrismDenDenoise.abort) {
                window.PrismDenDenoise.abort();
              }
              rej(new Error('单张超过 ' + params.timeoutSec + ' 秒未完，已跳过'));
            }, params.timeoutSec * 1000);
            runPromise.then(function (v) { clearTimeout(timer); res(v); },
                            function (e) { clearTimeout(timer); rej(e); });
          });
        }

        var aborted = new Promise(function (res, rej) { _abortWaiters.push(rej); });

        return Promise.race([timed, aborted]);
      }).then(function (outCanvas) {
        stopTick();
        var mime = params.format === 'jpeg' ? 'image/jpeg'
          : params.format === 'webp' ? 'image/webp' : 'image/png';
        var ext = params.format === 'jpeg' ? 'jpg' : params.format;

        return new Promise(function (res, rej) {
          outCanvas.toBlob(function (b) {
            b ? res(b) : rej(new Error('结果导出失败'));
          }, mime, params.quality);
        }).then(function (blob) {
          t.blob = blob;
          t.outName = baseName(t.name) + '_denoised.' + ext;
          t.elapsed = outCanvas._denoiseElapsed || Math.round(performance.now() - started);
          t.status = 'done';
          t.progress = 100;

          if (window.PrismDenLog) {
            window.PrismDenLog.add({
              type: 'batch',
              name: t.name,
            params: {
              sigmaS: params.sigmaS, sigmaR: params.sigmaR, mode: params.mode, format: params.format,
              ['缩放']: t.scaled
                ? '是（原 ' + t.srcWidth + '×' + t.srcHeight + '）'
                : '否'
            },
            width: t.width, height: t.height,
              elapsed: t.elapsed,
              status: 'success',
              thumb: t.thumb
            });
          }

          if (el.saveArchive && el.saveArchive.checked && window.PrismDenArchive) {
            window.PrismDenArchive.save(blob, {
              name: t.outName,
              source: 'denoise',
              tags: ['批量处理']
            });
          }
          resolve();
        });
      }).catch(function (err) {
        stopTick();
        var msg = err && err.message ? err.message : String(err);
        t.status = /已取消/.test(msg) ? 'cancelled' : 'error';
        t.error = msg;
        t.elapsed = Math.round(performance.now() - started);
        if (window.PrismDenLog) {
          window.PrismDenLog.add({
            type: 'batch', name: t.name,
            params: { sigmaS: params.sigmaS, sigmaR: params.sigmaR, mode: params.mode },
            elapsed: t.elapsed, status: 'error',
            error: t.error, thumb: t.thumb
          });
        }
        resolve();
      });
    });
  }

  async function startQueue() {
    if (running) return;
    var pending = tasks.filter(function (t) { return t.status === 'pending' || t.status === 'error'; });
    if (!pending.length) { toast('队列为空', 'error'); return; }

    running = true;
    paused = false;
    cancelFlag = false;
    syncButtons();

    var params = currentParams();

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (cancelFlag) break;
      if (t.status === 'done') continue;
      if (t.status !== 'pending' && t.status !== 'error') continue;

      if (paused) { t.status = 'pending'; break; }

      t.status = 'running';
      t.error = '';
      t.progress = 0;
      setQueueInfo('正在处理第 ' + i + 1 + '/' + tasks.length + ' 张：' + t.name);
      render();

      await processOne(t, params);

      render();
      updateSummary();
    }

    setQueueInfo('');

    running = false;
    syncButtons();
    render();
    updateSummary();

    var doneCount = tasks.filter(function (t) { return t.status === 'done'; }).length;
    var errCount = tasks.filter(function (t) { return t.status === 'error'; }).length;
    if (cancelFlag) toast('已取消，完成 ' + doneCount + ' 个', 'info');
    else if (paused) toast('已暂停', 'info');
    else toast('队列处理完毕：成功 ' + doneCount + ' 个' +
      (errCount ? '，失败 ' + errCount + ' 个' : ''), 'success');
  }

  function pauseQueue() {
    if (!running) return;
    paused = true;
    syncButtons();
    toast('将在当前任务完成后暂停', 'info');
  }

  function cancelQueue() {
    if (!running) return;
    cancelFlag = true;
    paused = false;

    if (window.PrismDenDenoise && window.PrismDenDenoise.abort) {
      window.PrismDenDenoise.abort();
    }

    _abortWaiters.forEach(function (rej) { rej(new Error('已取消')); });
    _abortWaiters = [];
    syncButtons();
  }

  function retryTask(id) {
    var t = findTask(id);
    if (!t) return;
    t.status = 'pending';
    t.error = '';
    t.retries++;
    render();
  }

  function statusText(status) {
    var map = {
      pending: '等待中',
      running: '处理中',
      done: '已完成',
      error: '失败',
      cancelled: '已取消'
    };
    return map[status] || '等待中';
  }

  function updateTaskNode(t) {
    var node = el.list.querySelector('[data-id="' + t.id + '"]');
    if (!node) return;
    var bar = node.querySelector('.batch-task-bar-fill');
    var txt = node.querySelector('.batch-task-status');
    if (bar) bar.style.width = t.progress + '%';
    if (txt) txt.textContent = statusText(t.status) + (t.progress && t.status === 'running' ? ' ' + t.progress + '%' : '');
  }

  function render() {
    if (!el.list) return;
    el.list.innerHTML = '';

    if (!tasks.length) {
      el.empty.classList.remove('hidden');
    } else {
      el.empty.classList.add('hidden');
    }

    tasks.forEach(function (t) {
      var card = document.createElement('div');
      card.className = 'batch-task status-' + t.status;
      card.setAttribute('data-id', t.id);

      var thumbHtml = t.thumb
        ? '<img src="' + t.thumb + '" alt="" />'
        : '<div class="batch-task-thumb-ph">图</div>';

      var actions = '';
      if (t.status === 'done') {
        actions += '<button class="batch-btn-mini" data-act="download">' + '下载' + '</button>';
        if (window.PrismDenArchive) {
          actions += '<button class="batch-btn-mini" data-act="archive">' + '存档案' + '</button>';
        }
      }
      if (t.status === 'error') {
        actions += '<button class="batch-btn-mini" data-act="retry">' + '重试' + '</button>';
      }
      if (t.status !== 'running') {
        actions += '<button class="batch-btn-mini danger" data-act="remove">' + '移除' + '</button>';
      }

      card.innerHTML =
        '<div class="batch-task-thumb">' + thumbHtml + '</div>' +
        '<div class="batch-task-body">' +
          '<div class="batch-task-name" title="' + t.name + '">' + t.name + '</div>' +
          '<div class="batch-task-meta">' +
            '<span class="batch-task-status">' + statusText(t.status) +
              (t.status === 'running' && t.progress ? ' ' + t.progress + '%' : '') + '</span>' +
            '<span>' + fmtBytes(t.size) + '</span>' +
            (t.width ? '<span>' + t.width + '×' + t.height + (t.scaled ? '（已缩放）' : '') + '</span>' : '') +
            '<span class="batch-task-time">' + fmtTime(t.elapsed) + '</span>' +
            (t.note ? '<span>' + t.note + '</span>' : '') +
            (t.error ? '<span class="batch-task-err">' + t.error + '</span>' : '') +
          '</div>' +
          '<div class="batch-task-bar"><div class="batch-task-bar-fill" style="width:' + t.progress + '%"></div></div>' +
        '</div>' +
        '<div class="batch-task-actions">' + actions + '</div>';

      card.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (!btn) return;
        var act = btn.getAttribute('data-act');
        if (act === 'download' && t.blob) downloadBlob(t.blob, t.outName);
        else if (act === 'retry') retryTask(t.id);
        else if (act === 'remove') removeTask(t.id);
        else if (act === 'archive') {
          if (window.PrismDenArchive && t.blob) {
            window.PrismDenArchive.save(t.blob, { name: t.outName, source: 'denoise', tags: ['批量处理'] })
              .then(function () { toast('已存入档案库', 'success'); });
          }
        }
      });

      el.list.appendChild(card);
    });

    updateSummary();
  }

  function updateSummary() {
    if (!el.summary) return;
    var total = tasks.length;
    var done = tasks.filter(function (t) { return t.status === 'done'; }).length;
    var err = tasks.filter(function (t) { return t.status === 'error'; }).length;
    var pending = tasks.filter(function (t) { return t.status === 'pending'; }).length;
    var pct = total ? Math.round(((done + err) / total) * 100) : 0;

    el.summary.innerHTML =
      '<div class="batch-stat"><span class="batch-stat-num">' + total + '</span><span>' + '总任务' + '</span></div>' +
      '<div class="batch-stat ok"><span class="batch-stat-num">' + done + '</span><span>' + '已完成' + '</span></div>' +
      '<div class="batch-stat err"><span class="batch-stat-num">' + err + '</span><span>' + '失败' + '</span></div>' +
      '<div class="batch-stat"><span class="batch-stat-num">' + pending + '</span><span>' + '等待中' + '</span></div>' +
      '<div class="batch-stat"><span class="batch-stat-num">' + pct + '%</span><span>' + '总进度' + '</span></div>';

    if (el.overallBar) el.overallBar.style.width = pct + '%';
  }

  function setQueueInfo(text) {
    if (el.queueInfo) el.queueInfo.textContent = text || '';
  }

  function syncButtons() {
    if (el.btnStart) el.btnStart.disabled = running;
    if (el.btnPause) el.btnPause.disabled = !running;
    if (el.btnCancel) el.btnCancel.disabled = !running;
    if (el.btnStart) el.btnStart.textContent = running ? '处理中…' : '开始处理';
  }

  function packAndDownload() {
    var done = tasks.filter(function (t) { return t.status === 'done' && t.blob; });
    if (!done.length) { toast('没有已完成的结果可打包', 'error'); return; }
    toast('正在打包 ' + done.length + ' 个结果…', 'info');

    buildZip(done.map(function (t) { return { name: t.outName, blob: t.blob }; }))
      .then(function (zip) {
        var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        downloadBlob(zip, 'PrismDen_批量结果_' + stamp + '.zip');
        toast('打包完成', 'success');
      })
      .catch(function (err) {
        toast('打包失败：' + err.message || err, 'error');
      });
  }

  function init() {
    el = {
      list: document.getElementById('batchList'),
      empty: document.getElementById('batchEmpty'),
      summary: document.getElementById('batchSummary'),
      overallBar: document.getElementById('batchOverallBar'),
      fileInput: document.getElementById('batchFileInput'),
      zone: document.getElementById('batchZone'),
      sigmaS: document.getElementById('batchSigmaS'),
      sigmaR: document.getElementById('batchSigmaR'),
      format: document.getElementById('batchFormat'),
      quality: document.getElementById('batchQuality'),
      qualityRow: document.getElementById('batchQualityRow'),
      saveArchive: document.getElementById('batchSaveArchive'),
      maxPixels: document.getElementById('batchMaxPixels'),
      timeout: document.getElementById('batchTimeout'),
      queueInfo: document.getElementById('batchQueueInfo'),
      btnStart: document.getElementById('batchStartBtn'),
      btnPause: document.getElementById('batchPauseBtn'),
      btnCancel: document.getElementById('batchCancelBtn'),
      btnPack: document.getElementById('batchPackBtn'),
      btnClear: document.getElementById('batchClearBtn'),
      btnPick: document.getElementById('batchPickBtn')
    };

    if (!el.list) return;

    if (el.btnPick) el.btnPick.addEventListener('click', function () { el.fileInput.click(); });
    if (el.zone) el.zone.addEventListener('click', function () { el.fileInput.click(); });

    if (el.fileInput) {
      el.fileInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files.length) addFiles(e.target.files);
        e.target.value = '';
      });
    }

    ['dragenter', 'dragover'].forEach(function (ev) {
      el.zone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        el.zone.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      el.zone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        el.zone.classList.remove('drag-over');
      });
    });
    el.zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    if (el.btnStart) el.btnStart.addEventListener('click', startQueue);
    if (el.btnPause) el.btnPause.addEventListener('click', pauseQueue);
    if (el.btnCancel) el.btnCancel.addEventListener('click', cancelQueue);
    if (el.btnPack) el.btnPack.addEventListener('click', packAndDownload);
    if (el.btnClear) el.btnClear.addEventListener('click', function () {
      clearFinished();
      toast('已清理已完成的任务', 'info');
    });

    if (el.sigmaS) el.sigmaS.addEventListener('input', function () {
      document.getElementById('batchSigmaSVal').textContent = el.sigmaS.value;
    });
    if (el.sigmaR) el.sigmaR.addEventListener('input', function () {
      document.getElementById('batchSigmaRVal').textContent = el.sigmaR.value;
    });
    if (el.quality) el.quality.addEventListener('input', function () {
      document.getElementById('batchQualityVal').textContent = el.quality.value;
    });
    if (el.format) el.format.addEventListener('change', function () {
      var show = el.format.value === 'jpeg' || el.format.value === 'webp';
      el.qualityRow.classList.toggle('hidden', !show);
    });

    render();
    syncButtons();
  }

  window.PrismDenBatch = {
    addFiles: addFiles,
    count: function () { return tasks.length; },
    isRunning: function () { return running; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
