/*
 * PrismDen 棱镜降噪图像处理系统 V1.0
 * 处理日志模块：基于 IndexedDB 的操作记录、筛选检索、统计与 CSV 导出
 * 著作权人：Young__Yang
 * 完成日期：2026-09-28
 * 权利取得方式：原始取得  权利范围：全部权利
 */

(function () {
  'use strict';

  var DB_NAME = 'prismden_logs';
  var DB_VERSION = 1;
  var STORE = 'logs';
  var db = null;
  var cache = [];
  var filterType = 'all';
  var filterStatus = 'all';
  var keyword = '';
  var _ready = false;

  var el = {};

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  /* IndexedDB 封装：处理日志的持久化读写，含建库、升级与事务管理 */
function openDB() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          var store = d.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('type', 'type');
          store.createIndex('status', 'status');
        }
      };
      req.onsuccess = function (e) { db = e.target.result; resolve(db); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function dbPut(record) {
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = function () { resolve(record); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function dbGetAll() {
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function dbClear() {
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function dbDelete(id) {
    return openDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function addLog(info) {
    info = info || {};
    var record = {
      id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      type: info.type || 'other',
      name: info.name || '未命名',
      params: info.params || {},
      width: info.width || 0,
      height: info.height || 0,
      elapsed: info.elapsed || 0,
      status: info.status || 'success',
      error: info.error || '',
      thumb: info.thumb || '',
      createdAt: Date.now()
    };
    cache.unshift(record);
    return dbPut(record).catch(function (e) {
      console.warn('[history] 写入失败', e);
    }).then(function () {
      if (_ready) refresh();
    });
  }

  function refresh() {
    return dbGetAll().then(function (rows) {
      cache = rows.sort(function (a, b) { return b.createdAt - a.createdAt; });
      render();
    }).catch(function () {
      render();
    });
  }

  function filtered() {
    var kw = keyword.trim().toLowerCase();
    return cache.filter(function (r) {
      if (filterType !== 'all' && r.type !== filterType) return false;
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (kw) {
        var hay = (r.name + ' ' + r.type + ' ' + JSON.stringify(r.params || {})).toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });
  }

  var TYPE_TEXT = {
    denoise: '图像降噪', edit: '图像编辑', batch: '批量处理',
    import: '图片导入', other: '其他'
  };

  function typeText(type) {
    return TYPE_TEXT[type] || '其他';
  }

  function fmtDateTime(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function fmtParams(params) {
    if (!params) return '-';
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === '' || v === null || typeof v === 'undefined') return;
      parts.push(k + '=' + v);
    });
    return parts.length ? parts.join(' · ') : '-';
  }

  function render() {
    if (!el.list) return;

    var rows = filtered();
    el.list.innerHTML = '';

    if (!rows.length) {
      el.empty.classList.remove('hidden');
    } else {
      el.empty.classList.add('hidden');
    }

    rows.forEach(function (r) {
      var item = document.createElement('div');
      item.className = 'log-item status-' + r.status;
      item.setAttribute('data-id', r.id);

      var thumbHtml = r.thumb
        ? '<img src="' + r.thumb + '" alt="" />'
        : '<div class="log-thumb-ph">' + '无图' + '</div>';

      item.innerHTML =
        '<div class="log-thumb">' + thumbHtml + '</div>' +
        '<div class="log-main">' +
          '<div class="log-line1">' +
            '<span class="log-type">' + typeText(r.type) + '</span>' +
            '<span class="log-name" title="' + r.name + '">' + r.name + '</span>' +
            '<span class="log-status">' + (r.status === 'success' ? '成功' : '失败') + '</span>' +
          '</div>' +
          '<div class="log-line2">' +
            '<span>' + fmtDateTime(r.createdAt) + '</span>' +
            (r.width ? '<span>' + r.width + '×' + r.height + '</span>' : '') +
            (r.elapsed ? '<span>' + '耗时 ' + r.elapsed + ' ms' + '</span>' : '') +
          '</div>' +
          '<div class="log-line3">' + fmtParams(r.params) +
            (r.error ? ' <span class="log-err">（' + r.error + '）</span>' : '') +
          '</div>' +
        '</div>' +
        '<button class="log-del" title="' + '删除这条记录' + '">×</button>';

      item.querySelector('.log-del').addEventListener('click', function (e) {
        e.stopPropagation();
        dbDelete(r.id).then(function () {
          cache = cache.filter(function (x) { return x.id !== r.id; });
          render();
        });
      });

      el.list.appendChild(item);
    });

    renderStats();
  }

  function renderStats() {
    if (!el.stats) return;
    var total = cache.length;
    var ok = cache.filter(function (r) { return r.status === 'success'; }).length;
    var err = total - ok;
    var times = cache.filter(function (r) { return r.elapsed > 0; }).map(function (r) { return r.elapsed; });
    var avg = times.length ? Math.round(times.reduce(function (a, b) { return a + b; }, 0) / times.length) : 0;
    var pixels = cache.reduce(function (s, r) { return s + (r.width && r.height ? r.width * r.height : 0); }, 0);

    el.stats.innerHTML =
      '<div class="log-stat"><span class="log-stat-num">' + total + '</span><span>' + '总记录' + '</span></div>' +
      '<div class="log-stat ok"><span class="log-stat-num">' + ok + '</span><span>' + '成功' + '</span></div>' +
      '<div class="log-stat err"><span class="log-stat-num">' + err + '</span><span>' + '失败' + '</span></div>' +
      '<div class="log-stat"><span class="log-stat-num">' + avg + '<i>ms</i></span><span>' + '平均耗时' + '</span></div>' +
      '<div class="log-stat"><span class="log-stat-num">' + (pixels / 1e6).toFixed(1) + '<i>MP</i></span><span>' + '累计像素' + '</span></div>';
  }

  /* CSV 导出：带 UTF-8 BOM，保证 Excel 打开中文不乱码 */
function exportCSV() {
    var rows = filtered();
    if (!rows.length) {
      toast('没有可导出的记录', 'error');
      return;
    }

    function esc(v) {
      var s = String(v === null || v === undefined ? '' : v);
      return '"' + s.replace(/"/g, '""') + '"';
    }

    var head = [
      '序号', '时间', '类型', '文件名', '状态',
      '耗时(ms)', '宽度', '高度', '参数', '错误信息'
    ];
    var lines = [head.map(esc).join(',')];

    rows.forEach(function (r, i) {
      lines.push([
        i + 1,
        fmtDateTime(r.createdAt),
        typeText(r.type),
        r.name,
        r.status === 'success' ? '成功' : '失败',
        r.elapsed || 0,
        r.width || '',
        r.height || '',
        fmtParams(r.params),
        r.error || ''
      ].map(esc).join(','));
    });

    var csv = '\uFEFF' + lines.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'PrismDen_处理日志_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);

    toast('已导出 ' + rows.length + ' 条记录', 'success');
  }

  function init() {
    el = {
      list: document.getElementById('logList'),
      empty: document.getElementById('logEmpty'),
      stats: document.getElementById('logStats'),
      search: document.getElementById('logSearch'),
      typeTabs: document.getElementById('logTypeTabs'),
      statusTabs: document.getElementById('logStatusTabs'),
      btnExport: document.getElementById('logExportBtn'),
      btnClear: document.getElementById('logClearBtn'),
      btnRefresh: document.getElementById('logRefreshBtn')
    };

    if (!el.list) return;

    if (el.search) {
      el.search.addEventListener('input', function () {
        keyword = el.search.value;
        render();
      });
    }

    function bindTabs(container, onPick) {
      if (!container) return;
      container.addEventListener('click', function (e) {
        var btn = e.target.closest('.log-tab');
        if (!btn) return;
        Array.prototype.forEach.call(container.querySelectorAll('.log-tab'), function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        onPick(btn.getAttribute('data-value'));
        render();
      });
    }

    bindTabs(el.typeTabs, function (v) { filterType = v; });
    bindTabs(el.statusTabs, function (v) { filterStatus = v; });

    if (el.btnExport) el.btnExport.addEventListener('click', exportCSV);
    if (el.btnRefresh) el.btnRefresh.addEventListener('click', function () { refresh(); });

    if (el.btnClear) {
      el.btnClear.addEventListener('click', function () {
        if (!cache.length) return;
        if (!window.confirm('确定清空全部 ' + cache.length + ' 条处理日志？此操作不可恢复。')) return;
        dbClear().then(function () {
          cache = [];
          render();
          toast('日志已清空', 'info');
        });
      });
    }

    refresh();
    _ready = true;
  }

  window.PrismDenLog = {
    add: addLog,
    count: function () { return cache.length; },
    refresh: refresh
  };

  window.onHistoryPageEnter = function () { refresh(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
