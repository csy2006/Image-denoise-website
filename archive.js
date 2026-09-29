/*
 * PrismDen 棱镜降噪图像处理系统 V1.0
 * 图片档案库模块：基于 IndexedDB 的图像持久化存储、标签管理与导入导出
 * 著作权人：Young__Yang
 * 完成日期：2026-09-28
 * 权利取得方式：原始取得  权利范围：全部权利
 */


(function () {
  'use strict';

  var DB_NAME = 'prismden_archive';
  var DB_VERSION = 1;
  var STORE = 'images';
  var THUMB_MAX = 480;
  var _db = null;
  var _cache = [];
  var _filter = { source: 'all', keyword: '', favOnly: false, sort: 'time' };
  var _previewId = null;
  var _dragDepth = 0;

  var elGrid, elEmpty, elSearch, elFavToggle, elSort, elStorage;
  var elModalBackdrop, elModalImg, elModalName, elModalSource, elModalDims;
  var elModalBytes, elModalDate, elModalTags, elModalFav;
  var elFileInput, elDropHint;

  /* IndexedDB 封装：档案库图片的持久化存储，以 Blob 保存缩略图与原图 */
function openDB() {
    return new Promise(function (resolve, reject) {
      if (_db) { resolve(_db); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('by_created', 'createdAt');
          store.createIndex('by_name', 'name');
          store.createIndex('by_source', 'source');
        }
      };
      req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function tx(mode) {
    return _db.transaction(STORE, mode).objectStore(STORE);
  }

  function dbAll() {
    return new Promise(function (resolve, reject) {
      var req = tx('readonly').getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbPut(record) {
    return new Promise(function (resolve, reject) {
      var req = tx('readwrite').put(record);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbDelete(id) {
    return new Promise(function (resolve, reject) {
      var req = tx('readwrite').delete(id);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbClear() {
    return new Promise(function (resolve, reject) {
      var req = tx('readwrite').clear();
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function uid() {
    return 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function _fmtBytes(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  }

  function formatDate(ts) {
    var d = new Date(ts);
    var p = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function sourceLabel(source) {
    var map = { denoise: '降噪', filter: '滤镜', import: '导入' };
    return map[source] || '导入';
  }

  function makeThumb(img) {
    var scale = Math.min(1, THUMB_MAX / img.width, THUMB_MAX / img.height);
    var w = Math.max(1, Math.round(img.width * scale));
    var h = Math.max(1, Math.round(img.height * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.8);
  }

  function loadImageFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  async function saveBlob(blob, meta) {
    meta = meta || {};
    if (!blob || !(blob instanceof Blob)) return null;

    var img = await loadImageFromBlob(blob);
    var record = {
      id: uid(),
      name: meta.name || ('image_' + new Date().toISOString().slice(0, 10) + '.png'),
      source: meta.source || 'import',
      tags: meta.tags || [],
      favorite: false,
      createdAt: Date.now(),
      width: img.width,
      height: img.height,
      size: blob.size,
      type: blob.type || 'image/png',
      thumb: makeThumb(img),
      blob: blob
    };
    await openDB();
    await dbPut(record);
    await refresh();
    return record.id;
  }

  window.archiveCurrentResult = function () {
    try {
      if (typeof resultBlob !== 'undefined' && resultBlob) {
        var params = window._lastDenoiseParams || {};
        var suffix = (params.sigmaS !== undefined) ? '_s' + params.sigmaS + '_r' + params.sigmaR : '';
        var baseName = (typeof resultFileName !== 'undefined' && resultFileName)
          ? resultFileName.replace(/\.[^.]+$/, '') : 'denoised';
        saveBlob(resultBlob, {
          name: baseName + suffix + '_denoised.png',
          source: 'denoise',
          tags: ['denoise'],
          params: params
        }).then(function (id) {
          if (id && typeof showToast === 'function') showToast('已存入档案库', 'success');
          if (typeof vibrate === 'function') vibrate(10);
        });
      } else {
        if (typeof showToast === 'function') showToast('当前没有可存入的结果', 'error');
      }
    } catch (e) {  }
  };

  function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return /^image\//.test(f.type);
    });
    if (!files.length) return;

    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        return saveBlob(file, { name: file.name, source: 'import' });
      });
    });
    chain.then(function () {
      if (typeof showToast === 'function') {
        showToast('成功存入' + ' ' + files.length + ' ' + '张图片', 'success');
      }
      if (typeof vibrate === 'function') vibrate(12);
    });
  }

  function applyFilterList() {
    var kw = _filter.keyword.trim().toLowerCase();
    var list = _cache.filter(function (r) {
      if (_filter.source !== 'all' && r.source !== _filter.source) return false;
      if (_filter.favOnly && !r.favorite) return false;
      if (kw) {
        var hay = (r.name + ' ' + (r.tags || []).join(' ')).toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });
    if (_filter.sort === 'name') {
      list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    } else if (_filter.sort === 'size') {
      list.sort(function (a, b) { return b.size - a.size; });
    } else {
      list.sort(function (a, b) { return b.createdAt - a.createdAt; });
    }
    return list;
  }

  function render() {
    var list = applyFilterList();
    elGrid.innerHTML = '';
    elEmpty.classList.toggle('show', list.length === 0);
    updateStorage();

    list.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'archive-card' + (r.favorite ? ' is-fav' : '');

      var img = document.createElement('img');
      img.className = 'archive-card-thumb';
      img.src = r.thumb;
      img.alt = r.name;
      img.loading = 'lazy';

      var info = document.createElement('div');
      info.className = 'archive-card-info';

      var name = document.createElement('span');
      name.className = 'archive-card-name';
      name.textContent = r.name;
      name.title = r.name;

      var badge = document.createElement('span');
      badge.className = 'archive-card-src';
      badge.textContent = sourceLabel(r.source);

      info.appendChild(name);
      info.appendChild(badge);

      var fav = document.createElement('span');
      fav.className = 'archive-card-fav';
      fav.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

      card.appendChild(img);
      card.appendChild(info);
      card.appendChild(fav);
      card.addEventListener('click', function () { openPreview(r.id); });

      elGrid.appendChild(card);
    });
  }

  function updateStorage() {
    if (!elStorage) return;
    var total = _cache.reduce(function (s, r) { return s + (r.size || 0); }, 0);
    elStorage.textContent = _cache.length + ' ' + '张图片' + ' · ' + _fmtBytes(total);
  }

  async function refresh() {
    await openDB();
    _cache = await dbAll();
    render();
  }

  function findRecord(id) {
    for (var i = 0; i < _cache.length; i++) {
      if (_cache[i].id === id) return _cache[i];
    }
    return null;
  }

  function openPreview(id) {
    var r = findRecord(id);
    if (!r) return;
    _previewId = id;

    elModalImg.src = URL.createObjectURL(r.blob);
    elModalName.textContent = r.name;
    elModalSource.textContent = sourceLabel(r.source);
    elModalDims.textContent = r.width + ' × ' + r.height;
    elModalBytes.textContent = _fmtBytes(r.size);
    elModalDate.textContent = formatDate(r.createdAt);
    elModalTags.value = (r.tags || []).join(', ');
    syncFavBtn(r.favorite);

    elModalBackdrop.classList.add('show');
    if (typeof vibrate === 'function') vibrate(6);
  }

  function closePreview() {
    elModalBackdrop.classList.remove('show');
    if (elModalImg.src && elModalImg.src.indexOf('blob:') === 0) {
      URL.revokeObjectURL(elModalImg.src);
    }
    elModalImg.src = '';
    _previewId = null;
  }

  function syncFavBtn(fav) {
    elModalFav.textContent = fav ? '取消收藏' : '收藏';
    elModalFav.classList.toggle('active', !!fav);
  }

  async function updatePreviewRecord(patch) {
    var r = findRecord(_previewId);
    if (!r) return;
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    await dbPut(r);
    render();
  }

  function bindEvents() {

    document.getElementById('archiveImportBtn').addEventListener('click', function () {
      elFileInput.click();
    });
    elFileInput.addEventListener('change', function (e) {
      importFiles(e.target.files);
      e.target.value = '';
    });

    var section = document.getElementById('sec-archive');
    section.addEventListener('dragenter', function (e) {
      if (e.target.closest('.archive-modal')) return;
      e.preventDefault();
      _dragDepth++;
      elDropHint.classList.add('show');
    });
    section.addEventListener('dragover', function (e) { e.preventDefault(); });
    section.addEventListener('dragleave', function () {
      _dragDepth = Math.max(0, _dragDepth - 1);
      if (_dragDepth === 0) elDropHint.classList.remove('show');
    });
    section.addEventListener('drop', function (e) {
      e.preventDefault();
      _dragDepth = 0;
      elDropHint.classList.remove('show');
      if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
    });

    document.getElementById('archiveClearBtn').addEventListener('click', async function () {
      if (!_cache.length) return;
      if (!confirm('确定要清空档案库中的所有图片吗？')) return;
      await dbClear();
      _cache = [];
      render();
      if (typeof showToast === 'function') showToast('档案库已清空', 'success');
      if (typeof vibrate === 'function') vibrate(10);
    });

    var searchTimer = null;
    elSearch.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        _filter.keyword = elSearch.value;
        render();
      }, 180);
    });

    elFavToggle.addEventListener('click', function () {
      _filter.favOnly = !_filter.favOnly;
      elFavToggle.classList.toggle('active', _filter.favOnly);
      render();
    });

    elSort.addEventListener('change', function () {
      _filter.sort = elSort.value;
      render();
    });

    var tabs = document.getElementById('archiveSourceTabs');
    var pill = document.getElementById('archiveTabPill');
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('.archive-tab');
      if (!btn) return;
      tabs.querySelectorAll('.archive-tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      _filter.source = btn.getAttribute('data-source');
      movePill(btn);
      render();
    });

    function movePill(target) {
      var parentRect = tabs.getBoundingClientRect();
      var rect = target.getBoundingClientRect();
      pill.style.width = rect.width + 'px';
      pill.style.transform = 'translateX(' + (rect.left - parentRect.left - 3) + 'px)';
    }

    var initPill = function () {
      var active = tabs.querySelector('.archive-tab.active');
      if (active) movePill(active);
    };
    requestAnimationFrame(initPill);
    window.addEventListener('resize', initPill);

    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(function () { requestAnimationFrame(initPill); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }

    document.getElementById('archiveModalClose').addEventListener('click', closePreview);
    elModalBackdrop.addEventListener('click', function (e) {
      if (e.target === elModalBackdrop) closePreview();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && elModalBackdrop.classList.contains('show')) closePreview();
    });

    document.getElementById('archiveModalDownload').addEventListener('click', function () {
      var r = findRecord(_previewId);
      if (!r) return;
      var a = document.createElement('a');
      a.download = r.name;
      a.href = URL.createObjectURL(r.blob);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    });

    elModalFav.addEventListener('click', function () {
      var r = findRecord(_previewId);
      if (!r) return;
      r.favorite = !r.favorite;
      updatePreviewRecord({ favorite: r.favorite });
      syncFavBtn(r.favorite);
    });

    elModalTags.addEventListener('change', function () {
      var tags = elModalTags.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      updatePreviewRecord({ tags: tags });
      if (typeof showToast === 'function') showToast('标签已保存', 'success');
    });

    document.getElementById('archiveModalDelete').addEventListener('click', async function () {
      if (!confirm('确定要删除这张图片吗？')) return;
      await dbDelete(_previewId);
      closePreview();
      await refresh();
      if (typeof showToast === 'function') showToast('已删除', 'success');
      if (typeof vibrate === 'function') vibrate(8);
    });
  }

  function init() {
    elGrid = document.getElementById('archiveGrid');
    elEmpty = document.getElementById('archiveEmpty');
    elSearch = document.getElementById('archiveSearch');
    elFavToggle = document.getElementById('archiveFavToggle');
    elSort = document.getElementById('archiveSort');
    elStorage = document.getElementById('archiveStorage');
    elModalBackdrop = document.getElementById('archiveModalBackdrop');
    elModalImg = document.getElementById('archiveModalImg');
    elModalName = document.getElementById('archiveModalName');
    elModalSource = document.getElementById('archiveModalSource');
    elModalDims = document.getElementById('archiveModalDims');
    elModalBytes = document.getElementById('archiveModalBytes');
    elModalDate = document.getElementById('archiveModalDate');
    elModalTags = document.getElementById('archiveModalTags');
    elModalFav = document.getElementById('archiveModalFav');
    elFileInput = document.getElementById('archiveFileInput');
    elDropHint = document.getElementById('archiveDropHint');

    if (!elGrid || !elModalBackdrop) return;

    if (elModalBackdrop.parentElement !== document.body) {
      document.body.appendChild(elModalBackdrop);
    }

    bindEvents();
    refresh();
  }

  window.PrismDenArchive = {
    save: saveBlob,
    count: function () { return _cache.length; },
    refresh: refresh
  };

  window.onArchivePageEnter = function () {
    refresh();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
