/* ==================== 个人中心 JavaScript ==================== */
/**
 * profile.js — 个人中心模块
 * 功能：统计展示、深色模式开关、震动反馈开关、本地数据清除
 * 主题切换复用 main.js 的 setTheme() 函数，localStorage key = 'theme'
 */

(function () {
  'use strict';

  var _initialized = false;

  // ── 本地存储 key ──
  var SK_DENOISE = 'prismden_count_denoise';
  var SK_FILTER   = 'prismden_count_filter';
  var SK_TICKET   = 'prismden_count_ticket';
  var SK_THEME    = 'theme';                // 与 main.js setTheme() 共用
  var SK_VIBRATE  = 'prismden_vibrate';     // '1' | '0'
  var SK_LANG     = 'prismden_lang';        // 'zh' | 'en'

  /* ── 工具：安全读写 localStorage ── */
  function lsGet(key, def) {
    try { var v = localStorage.getItem(key); return v === null ? def : v; }
    catch (e) { return def; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  /* ── 统计计数器（供 main.js / filter.js 调用）── */
  window.PrismDenStats = {
    incDenoise: function () {
      var n = parseInt(lsGet(SK_DENOISE, '0'), 10) + 1;
      lsSet(SK_DENOISE, String(n));
      updateStat('statDenoise', n);
    },
    incFilter: function () {
      var n = parseInt(lsGet(SK_FILTER, '0'), 10) + 1;
      lsSet(SK_FILTER, String(n));
      updateStat('statFilter', n);
    },
    incTicket: function () {
      var n = parseInt(lsGet(SK_TICKET, '0'), 10) + 1;
      lsSet(SK_TICKET, String(n));
      updateStat('statTicket', n);
    }
  };

  function updateStat(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function loadStats() {
    updateStat('statDenoise', parseInt(lsGet(SK_DENOISE, '0'), 10));
    updateStat('statFilter', parseInt(lsGet(SK_FILTER, '0'), 10));
    updateStat('statTicket', parseInt(lsGet(SK_TICKET, '0'), 10));
  }

  /* ── 深色模式开关（复用 main.js setTheme）── */
  function initThemeToggle() {
    var item = document.getElementById('themeToggle');
    if (!item) return;
    var toggle = item.querySelector('.settings-toggle');

    syncThemeToggle(item, toggle);

    item.addEventListener('click', function () {
      if (typeof vibrate === 'function') vibrate(8);
      var current = document.documentElement.getAttribute('data-theme') || 'light';
      var next = current === 'dark' ? 'light' : 'dark';

      // 调用 main.js 的 setTheme（含扫幕动画，500ms 后才更新 data-theme）
      if (typeof setTheme === 'function') {
        setTheme(next);
      } else {
        document.documentElement.setAttribute('data-theme', next);
        lsSet(SK_THEME, next);
      }

      // 直接用 next 设置 toggle 状态，不依赖 DOM 读取（避免 500ms 动画延迟导致读到旧值）
      var isDark = next === 'dark';
      if (toggle) toggle.classList.toggle('active', isDark);
      updateThemeDesc(item, isDark);
    });
  }

  function updateThemeDesc(item, isDark) {
    var desc = item.querySelector('.settings-desc');
    if (!desc) return;
    var saved = lsGet(SK_THEME, null);
    if (saved) {
      desc.textContent = typeof i18n !== 'undefined'
        ? (isDark ? i18n.t('darkModeOn') : i18n.t('darkModeOff'))
        : (isDark ? '已开启' : '已关闭');
    } else {
      desc.textContent = typeof i18n !== 'undefined'
        ? i18n.t('darkModeAuto')
        : '跟随系统';
    }
  }

  function syncThemeToggle(item, toggle) {
    var theme = document.documentElement.getAttribute('data-theme');
    if (!theme) {
      // 未设置 data-theme，跟随系统
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    var isDark = theme === 'dark';
    if (toggle) toggle.classList.toggle('active', isDark);
    updateThemeDesc(item, isDark);
  }

  /* ── 震动反馈开关 ── */
  function initVibrateToggle() {
    var item = document.getElementById('vibrateToggle');
    if (!item) return;
    var toggle = item.querySelector('.settings-toggle');

    var enabled = lsGet(SK_VIBRATE, '1') !== '0';
    if (toggle) toggle.classList.toggle('active', enabled);

    item.addEventListener('click', function () {
      var nowEnabled = !toggle.classList.contains('active');
      toggle.classList.toggle('active', nowEnabled);
      lsSet(SK_VIBRATE, nowEnabled ? '1' : '0');

      // 同步全局变量（main.js 中定义）
      if (typeof _vibrateEnabled !== 'undefined') {
        _vibrateEnabled = nowEnabled;
      }

      // 反馈：开启时震一下
      if (nowEnabled && typeof vibrate === 'function') vibrate(20);

      var desc = item.querySelector('.settings-desc');
      if (desc) {
        desc.textContent = typeof i18n !== 'undefined'
          ? (nowEnabled ? i18n.t('vibrateOn') : i18n.t('vibrateOff'))
          : (nowEnabled ? '已开启' : '已关闭');
      }
    });
  }

  /* ── 语言切换开关 ── */
  function updateLangDesc(item, isZh) {
    var desc = item.querySelector('.settings-desc');
    if (!desc) return;
    desc.textContent = typeof i18n !== 'undefined'
      ? (isZh ? i18n.t('langZh') : i18n.t('langEn'))
      : (isZh ? '中文' : 'English');
  }

  function initLangToggle() {
    var item = document.getElementById('langToggle');
    if (!item) return;
    var toggle = item.querySelector('.settings-toggle');

    var lang = lsGet(SK_LANG, 'zh');
    var isZh = lang !== 'en';
    if (toggle) toggle.classList.toggle('active', isZh);

    updateLangDesc(item, isZh);

    item.addEventListener('click', function () {
      if (typeof vibrate === 'function') vibrate(8);
      var nowZh = !toggle.classList.contains('active');
      toggle.classList.toggle('active', nowZh);
      var newLang = nowZh ? 'zh' : 'en';
      lsSet(SK_LANG, newLang);

      // 调用 i18n 系统执行翻译
      if (typeof i18n !== 'undefined' && i18n.setLang) {
        i18n.setLang(newLang);
      }

      updateLangDesc(item, nowZh);

      if (typeof showToast === 'function') {
        showToast(nowZh ? 'toastLangZh' : 'toastLangEn', 'success');
      }
    });
  }

  /* ── 清除本地数据 ── */
  function initClearData() {
    var btn = document.getElementById('clearDataBtn');
    if (!btn) return;

    btn.addEventListener('click', function () {
      if (typeof vibrate === 'function') vibrate(10);
      if (!confirm('确定要清除所有本地数据吗？\n（包括使用统计，不影响主题和震动设置）')) return;

      try {
        localStorage.removeItem(SK_DENOISE);
        localStorage.removeItem(SK_FILTER);
        localStorage.removeItem(SK_TICKET);
      } catch (e) {}

      loadStats();
      if (typeof showToast === 'function') showToast('本地数据已清除', 'success');
    });
  }

  /* ── 初始化 ── */
  function initProfile() {
    if (_initialized) return;
    _initialized = true;

    loadStats();
    initThemeToggle();
    initVibrateToggle();
    initLangToggle();
    initClearData();
    initThemeObserver();
  }

  /* ── 监听 data-theme 变化，同步 toggle 状态 ── */
  function initThemeObserver() {
    var item = document.getElementById('themeToggle');
    if (!item) return;
    var toggle = item.querySelector('.settings-toggle');

    // MutationObserver 监听 <html> 的 data-theme 属性变化
    // 无论从导航栏、首页还是个人中心切换主题，都能实时同步 toggle
    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          if (m.attributeName === 'data-theme') {
            syncThemeToggle(item, toggle);
          }
        });
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    // 系统主题变化（自动模式下）也要同步
    try {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) {
        mq.addEventListener('change', function () { syncThemeToggle(item, toggle); });
      } else if (mq.addListener) {
        mq.addListener(function () { syncThemeToggle(item, toggle); });
      }
    } catch (e) {}
  }

  /* ── 页面进入/离开回调 ── */
  window.onProfilePageEnter = function () {
    initProfile();
    loadStats(); // 每次进入刷新统计
    // 同步主题 toggle 状态（用户可能在别处切换了主题）
    var item = document.getElementById('themeToggle');
    var toggle = item ? item.querySelector('.settings-toggle') : null;
    if (item && toggle) syncThemeToggle(item, toggle);
  };

  window.onProfilePageLeave = function () {};

  /* ── 自动初始化 ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProfile);
  } else {
    initProfile();
  }
})();
