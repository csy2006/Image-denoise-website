/**
 * IMAGE DENOISE — Frontend Main Script (SPA)
 * Connects to C++ backend via HTTP API
 * Supports: PNG, JPG, JPEG, RAW, BMP, TIFF, WebP
 */

// ── 本地处理模式（无需后端服务器）──
// 使用 Blob URL 创建 Worker，兼容 file:// 协议
let _denoiseWorker = null;
let _denoiseWorkerBlobURL = null;
let _denoiseMsgId = 0;

// ── 移动端震动反馈工具 ──
// 只在触屏设备上触发，桌面端静默跳过
var _vibrateEnabled = true;
try {
  var _savedVP = localStorage.getItem('prismden_vibrate');
  if (_savedVP === '0') _vibrateEnabled = false;
} catch(e) {}

// 触屏设备检测：多重判断，兼容微信 X5 / iOS WKWebView / 安卓 Chrome
// matchMedia('(hover: none)') 在微信 X5 内核上可能不可靠，辅以 ontouchstart 和 maxTouchPoints
var _isTouchDevice = (function() {
  if (typeof navigator === 'undefined') return false;
  // 1. ontouchstart — 最广泛的触屏检测
  if ('ontouchstart' in window) return true;
  // 2. maxTouchPoints — W3C 标准，IE10+/Edge/Chrome
  if (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) return true;
  // 3. msMaxTouchPoints — IE/旧 Edge
  if (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0) return true;
  // 4. matchMedia 兜底（部分设备只有此 API 可用）
  try {
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) return true;
  } catch(e) {}
  return false;
})();

function vibrate(pattern) {
  if (!_vibrateEnabled) return;
  if (!_isTouchDevice) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(pattern); } catch(e) {}
}

function getDenoiseWorker() {
  if (!_denoiseWorker) {
    // 内联 Worker 代码（从 denoise-worker.js）
    const workerCode = `
      function gaussianLUT(sigma) {
        const lut = new Float32Array(256);
        const denom = 2 * sigma * sigma;
        for (let d = 0; d < 256; d++) { lut[d] = Math.exp(-(d * d) / denom); }
        return lut;
      }
      function buildSpatialKernel(radius, sigma) {
        const size = 2 * radius + 1;
        const kernel = new Float32Array(size * size);
        const denom = 2 * sigma * sigma;
        let ki = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            kernel[ki++] = Math.exp(-(dx * dx + dy * dy) / denom);
          }
        }
        return { kernel, size, radius };
      }
      function bilateralColor(src, dst, w, h, radius, size, kernel, rLUT) {
        const wh = w * h;
        for (let idx = 0; idx < wh; idx++) {
          const x = idx % w; const y = (idx / w) | 0;
          const ci = idx * 4;
          const cr = src[ci], cg = src[ci + 1], cb = src[ci + 2];
          let sumR = 0, sumG = 0, sumB = 0, sumW = 0;
          const kyMin = Math.max(0, y - radius);
          const kyMax = Math.min(h - 1, y + radius);
          const kxMin = Math.max(0, x - radius);
          const kxMax = Math.min(w - 1, x + radius);
          for (let ky = kyMin; ky <= kyMax; ky++) {
            const rowOff = ky * w * 4;
            const kyOff = (ky - y + radius) * size;
            for (let kx = kxMin; kx <= kxMax; kx++) {
              const si = rowOff + kx * 4;
              const sr = src[si], sg = src[si + 1], sb = src[si + 2];
              let d = cr - sr; if (d < 0) d = -d;
              let rw = rLUT[d];
              d = cg - sg; if (d < 0) d = -d;
              rw *= rLUT[d];
              d = cb - sb; if (d < 0) d = -d;
              rw *= rLUT[d];
              const wgt = kernel[kyOff + (kx - x + radius)] * rw;
              sumR += sr * wgt; sumG += sg * wgt; sumB += sb * wgt; sumW += wgt;
            }
          }
          const invW = sumW > 0 ? 1 / sumW : 0;
          dst[ci] = sumW > 0 ? sumR * invW : cr;
          dst[ci + 1] = sumW > 0 ? sumG * invW : cg;
          dst[ci + 2] = sumW > 0 ? sumB * invW : cb;
          dst[ci + 3] = 255;
        }
      }
      function bilateralGrayscale(src, dst, w, h, radius, size, kernel, rLUT) {
        const wh = w * h;
        const yBuf = new Uint8ClampedArray(wh);
        for (let i = 0; i < wh; i++) {
          const ci = i * 4;
          yBuf[i] = Math.round(0.299 * src[ci] + 0.587 * src[ci + 1] + 0.114 * src[ci + 2]);
        }
        for (let idx = 0; idx < wh; idx++) {
          const x = idx % w; const y = (idx / w) | 0;
          const ci = idx * 4;
          const cy = yBuf[idx];
          let sumY = 0, sumW = 0;
          const kyMin = Math.max(0, y - radius);
          const kyMax = Math.min(h - 1, y + radius);
          const kxMin = Math.max(0, x - radius);
          const kxMax = Math.min(w - 1, x + radius);
          for (let ky = kyMin; ky <= kyMax; ky++) {
            const rowOff = ky * w;
            const kyOff = (ky - y + radius) * size;
            for (let kx = kxMin; kx <= kxMax; kx++) {
              const syVal = yBuf[rowOff + kx];
              let d = cy - syVal; if (d < 0) d = -d;
              const wgt = kernel[kyOff + (kx - x + radius)] * rLUT[d];
              sumY += syVal * wgt; sumW += wgt;
            }
          }
          const finalY = sumW > 0 ? Math.round(sumY / sumW) : cy;
          const factor = cy > 0 ? finalY / cy : 1;
          dst[ci] = Math.min(255, Math.round(src[ci] * factor));
          dst[ci + 1] = Math.min(255, Math.round(src[ci + 1] * factor));
          dst[ci + 2] = Math.min(255, Math.round(src[ci + 2] * factor));
          dst[ci + 3] = 255;
        }
      }
      self.onmessage = function (e) {
        const { id, pixels, width, height, sigmaS, sigmaR, mode } = e.data;
        const w = width, h = height;
        try {
          const radius = Math.min(Math.max(1, Math.ceil(sigmaS * 2)), 8);
          const { kernel, size } = buildSpatialKernel(radius, sigmaS);
          const rLUT = gaussianLUT(sigmaR);
          const src = new Uint8ClampedArray(pixels);
          const dst = new Uint8ClampedArray(src.length);
          const start = performance.now();
          if (mode === 'grayscale') {
            bilateralGrayscale(src, dst, w, h, radius, size, kernel, rLUT);
          } else {
            bilateralColor(src, dst, w, h, radius, size, kernel, rLUT);
          }
          const elapsed = Math.round(performance.now() - start);
          self.postMessage({ id, type: 'done', pixels: dst, elapsed }, [dst.buffer]);
        } catch (err) {
          self.postMessage({ id, type: 'error', message: err.message || String(err) });
        }
      };
    `;
    _denoiseWorkerBlobURL = URL.createObjectURL(
      new Blob([workerCode], { type: 'application/javascript' })
    );
    _denoiseWorker = new Worker(_denoiseWorkerBlobURL);
  }
  return _denoiseWorker;
}

// State
let currentFile = null;
let currentFileData = null;
let resultBlob = null;
let resultFileName = null;
let currentMode = 'bilateral';
let startTime = 0;
let currentPage = 'home';
let _currentSaveFormat = 'png';
let _currentSaveAction = 'save';


// Sound
let audioCtx = null;
let soundEnabled = true;
let soundActivated = false;


// ======================= Sound =======================
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function activateAudio() {
  if (soundActivated) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => { soundActivated = true; }).catch(()=>{});
    } else { soundActivated = true; }
  } catch(e){}
}
function playTickSound() {
  if (!soundEnabled || !soundActivated) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(3000, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.01);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.025);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.025);
  } catch(e){}
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('volumeBtn');
  if (!btn) return;
  const iconOn = btn.querySelector('.volume-on');
  const iconOff = btn.querySelector('.volume-off');
  if (iconOn) iconOn.style.display = soundEnabled ? '' : 'none';
  if (iconOff) iconOff.style.display = soundEnabled ? 'none' : '';
  if (soundEnabled) {
    btn.classList.remove('muted');
    btn.title = '音效开关 — 已开启';
  } else {
    btn.classList.add('muted');
    btn.title = '音效开关 — 已关闭';
  }
}

// ======================= Bouncing Welcome Hint =======================

const HINT_PHYSICS = { stiffness: 0.16, damping: 0.72, trailStiffness: 0.08, trailDamping: 0.84 };
let hintBounceRAF = null;
let hintTargetTimer = null;

function initBouncingHint() {
  const hint = document.getElementById('welcomeHint');
  const overlay = document.getElementById('welcomeOverlay');
  if (!hint || !overlay) return;

  // ---- Create trail clones (visual blur only, no text) ----
  const trails = [];
  const TH = hint.offsetWidth;
  const TV = hint.offsetHeight;
  for (let i = 0; i < 3; i++) {
    const trail = document.createElement('div');
    trail.className = 'welcome-hint-trail';
    trail.style.width = TH + 'px';
    trail.style.height = TV + 'px';
    overlay.appendChild(trail);
    trails.push(trail);
  }

  // ---- Spring state for main hint ----
  const spring = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  // ---- Spring state for each trail ----
  const trailSprings = trails.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));

  function randTarget() {
    const pad = 40;
    const maxW = window.innerWidth - TH - pad * 2;
    const maxH = window.innerHeight - TV - pad * 2;
    return {
      x: pad + Math.random() * maxW,
      y: pad + Math.random() * maxH
    };
  }

  // Initial position: center
  spring.tx = (window.innerWidth - TH) / 2;
  spring.ty = (window.innerHeight - TV) / 2;
  spring.x = spring.tx;
  spring.y = spring.ty;
  trailSprings.forEach(s => { s.x = spring.x; s.y = spring.y; });

  // Apply initial position
  hint.style.left = spring.x + 'px';
  hint.style.top = spring.y + 'px';

  function applySpring(s, targetX, targetY, stiff, damp) {
    const ax = (targetX - s.x) * stiff;
    const ay = (targetY - s.y) * stiff;
    s.vx = (s.vx + ax) * damp;
    s.vy = (s.vy + ay) * damp;
    s.x += s.vx;
    s.y += s.vy;
  }

  function loop() {
    // Main hint spring toward target
    applySpring(spring, spring.tx, spring.ty, HINT_PHYSICS.stiffness, HINT_PHYSICS.damping);

    // Trail springs chase the hint with delay
    for (let i = 0; i < trailSprings.length; i++) {
      const ts = trailSprings[i];
      applySpring(ts, spring.x, spring.y, HINT_PHYSICS.trailStiffness, HINT_PHYSICS.trailDamping);
    }

    // Apply positions
    hint.style.left = spring.x + 'px';
    hint.style.top = spring.y + 'px';

    for (let i = 0; i < trails.length; i++) {
      trails[i].style.left = trailSprings[i].x + 'px';
      trails[i].style.top = trailSprings[i].y + 'px';
    }

    hintBounceRAF = requestAnimationFrame(loop);
  }

  // Start animation
  hintBounceRAF = requestAnimationFrame(loop);

  // Randomly change target
  function bounce() {
    const t = randTarget();
    spring.tx = t.x;
    spring.ty = t.y;
    // Schedule next bounce: 500-800ms (faster pace)
    hintTargetTimer = setTimeout(bounce, 500 + Math.random() * 300);
  }
  hintTargetTimer = setTimeout(bounce, 200);

  // Cleanup function
  return () => {
    if (hintBounceRAF) cancelAnimationFrame(hintBounceRAF);
    if (hintTargetTimer) clearTimeout(hintTargetTimer);
    trails.forEach(t => t.remove());
  };
}

function initSoundSystem() {
  // 在用户首次点击任意位置时激活 Web Audio（需要用户手势）。
  // 欢迎遮罩覆盖全屏，因此首次点击必然是关闭遮罩。
  document.addEventListener('click', function activate() {
    if (soundActivated) return;
    try {
      var ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().then(function() { soundActivated = true; }).catch(function(){});
      } else { soundActivated = true; }
    } catch(e){}
    // 播放欢迎旋律
    try {
      var ctx2 = getAudioContext();
      if (ctx2.state !== 'suspended') {
        var notes = [523, 587, 659, 784, 880, 784, 659, 587, 523];
        var t = ctx2.currentTime;
        notes.forEach(function(f, i) {
          var o = ctx2.createOscillator();
          var g = ctx2.createGain();
          o.connect(g); g.connect(ctx2.destination);
          o.type = 'sine';
          o.frequency.setValueAtTime(f, t);
          g.gain.setValueAtTime(0.08, t);
          g.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
          o.start(t); o.stop(t + 0.35);
          t += 0.18;
        });
      }
    } catch(e){}
  }, { once: true, capture: true });
}
// ======================= Theme Switcher =======================
function setTheme(theme) {
  var currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  if (theme === currentTheme) {
    // 同主题只更新 UI 状态，不播放动画
    _applyThemeUI(theme);
    return;
  }

  // 用户手动切换主题：写入 localStorage，清除自动检测标记
  localStorage.setItem('theme', theme);
  sessionStorage.removeItem('_themeAuto');

  // 新主题背景色（与 [data-theme="dark"] 中的 --warm-white 一致）
  var newBg = (theme === 'dark') ? '#1A1612' : '#FDF8F4';

  // 获取或创建扫幕遮罩
  var sweep = document.getElementById('themeSweepOverlay');
  if (!sweep) {
    sweep = document.createElement('div');
    sweep.id = 'themeSweepOverlay';
    sweep.className = 'theme-sweep-overlay';
    document.body.appendChild(sweep);
  }
  // 重置状态
   sweep.style.background = newBg;
  sweep.className = 'theme-sweep-overlay';

  // 强制回流后添加动画 class
  void sweep.offsetHeight;
  sweep.classList.add('sweeping');

  // 动画完成后切换主题并移除遮罩
  clearTimeout(window._themeSweepTimer);
  window._themeSweepTimer = setTimeout(function() {
    // 禁用所有 CSS 过渡，避免 data-theme 切换时元素背景色渐变产生闪烁
    document.body.classList.add('theme-switching');
    _applyThemeUI(theme);
    sweep.className = 'theme-sweep-overlay';   // 停止动画
    sweep.style.clipPath = 'inset(0 0 100% 0)'; // 隐藏回顶部

    // 下一帧恢复过渡，确保新主题色已瞬时应用
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        document.body.classList.remove('theme-switching');
      });
    });

    // 主题切换后，如果当前是首页，重新播放开场动画
    if (currentPage === 'home') {
      var home = document.getElementById('page-home');
      if (home) {
        var animatedEls = home.querySelectorAll('.hero-kanji, .word, .hero-subtitle, .hero-actions');
        animatedEls.forEach(function(el) {
          el.style.animation = 'none';
          void el.offsetHeight;  // 强制 reflow
          el.style.animation = '';
        });
      }
    }
  }, 500);
}

/* 内部：切换 data-theme + 更新 UI 状态（不含动画） */
function _applyThemeUI(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  const options = document.querySelectorAll('.theme-option');
  options.forEach(opt => {
    opt.classList.toggle('active', opt.getAttribute('data-theme-option') === theme);
  });

  moveThemePill(theme);
}

function moveThemePill(theme) {
  const switcher = document.getElementById('themeSwitcher');
  if (!switcher) return;
  const target = switcher.querySelector('[data-theme-option="' + theme + '"]');
  if (!target) return;
  updateThemePill(target, false);
}

function initThemeSwitcher() {
  const switcher = document.getElementById('themeSwitcher');
  if (!switcher) return;

  // Get theme pill element
  themePillEl = switcher.querySelector('.theme-pill');
  if (!themePillEl) return;

  // Measure theme switcher dimensions
  _themeSwitcherHeight = (parseFloat(getComputedStyle(switcher).height) || 0) - _themeSwitcherPad * 2;
  // 兜底：移动端字体未加载时 computed height 可能为 0
  if (!_themeSwitcherHeight || _themeSwitcherHeight < 10) _themeSwitcherHeight = 30;
  themePillSpring.h = _themeSwitcherHeight;
  themePillSpring.targetH = _themeSwitcherHeight;

  // 监听 theme-switcher 尺寸变化（字体加载后重新校准）
  if (!window._themeSwitcherObserver) {
    window._themeSwitcherObserver = new ResizeObserver(() => {
      const h = (parseFloat(getComputedStyle(switcher).height) || 0) - _themeSwitcherPad * 2;
      if (h > 0 && Math.abs(h - _themeSwitcherHeight) > 1) {
        _themeSwitcherHeight = h;
        themePillSpring.h = h;
        themePillSpring.targetH = h;
        moveThemePill(localStorage.getItem('theme') || 'light');
      }
    });
    window._themeSwitcherObserver.observe(switcher);
  }

  // Remove CSS transitions — spring handles all animation
  themePillEl.style.transition = 'none';

  // 自动检测系统深色模式（仅在用户未手动设置过主题时）
  let saved = localStorage.getItem('theme');
  if (!saved) {
    // 检测系统主题偏好（兼容 iOS：优先用 matchMedia，fallback 用 CSS 计算值）
    let prefersDark = false;
    try {
      prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch(e) {}
    // iOS fallback：创建一个临时元素，用 CSS 的 prefers-color-scheme 设置背景色，再读取判断
    if (!prefersDark) {
      try {
        var tmp = document.createElement('div');
        tmp.style.cssText = 'position:absolute;visibility:hidden;background:red;';
        tmp.style.background = 'var(--tmp-bg, red)';
        // 在 :root 上设一个 CSS 变量，用 @media 区分
        var style = document.createElement('style');
        style.id = '_theme-detect';
        style.textContent = ':root { --tmp-bg: var(--warm-white, #FDF8F4); } @media (prefers-color-scheme: dark) { :root { --tmp-bg: #1A1612; } }';
        document.head.appendChild(style);
        var bg = getComputedStyle(document.documentElement).getPropertyValue('--tmp-bg').trim();
        prefersDark = (bg === '#1A1612' || bg === 'rgb(26, 22, 18)');
        var s = document.getElementById('_theme-detect');
        if (s) s.remove();
      } catch(e) {}
    }
    saved = prefersDark ? 'dark' : 'light';
    sessionStorage.setItem('_themeAuto', '1');
  } else {
    sessionStorage.removeItem('_themeAuto');
  }

  // Compute initial position first, then set spring state before theme activates
  const preTarget = switcher.querySelector('[data-theme-option="' + saved + '"]');
  if (preTarget) {
    const sr = switcher.getBoundingClientRect();
    const tr = preTarget.getBoundingClientRect();
    themePillSpring.x = tr.left - sr.left;
    themePillSpring.targetX = themePillSpring.x;
    themePillSpring.w = tr.width;
    themePillSpring.targetW = themePillSpring.w;
  }

  // Now activate theme (spring starts from correct position, no visual jump)
  // 初始加载直接设置，不播放扫幕动画
  // 如果是自动检测的系统主题：不设置 data-theme（让 CSS @media 自行决定，兼容 iOS）
  // 如果用户手动设置过：设置 data-theme 覆盖 CSS 默认值
  if (sessionStorage.getItem('_themeAuto')) {
    // 自动检测模式：不设置 data-theme，让 CSS @media (prefers-color-scheme: dark) 决定
    // 只更新主题切换器 UI 状态
    var options = document.querySelectorAll('.theme-option');
    options.forEach(function(opt) {
      opt.classList.toggle('active', opt.getAttribute('data-theme-option') === saved);
    });
    moveThemePill(saved);
  } else {
    // 用户手动设置过：设置 data-theme 覆盖 CSS 默认值
    _applyThemeUI(saved);
  }
  applyThemePillTransform();

  // 监听系统主题变化（仅自动检测模式下生效）
  // iOS 兼容：同时用 addEventListener + addListener（旧 Safari 只支持 addListener）
  if (window._themeMediaQuery && window._themeChangeHandler) {
    try { window._themeMediaQuery.removeEventListener('change', window._themeChangeHandler); } catch(e){}
    try { window._themeMediaQuery.removeListener(window._themeChangeHandler); } catch(e){}
  }
  window._themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  window._themeChangeHandler = function(e) {
    // 仅在自动检测模式下跟随系统
    if (sessionStorage.getItem('_themeAuto')) {
      var newTheme = e.matches ? 'dark' : 'light';
      // 直接设置属性，不写入 localStorage，不播放扫幕动画
      document.documentElement.setAttribute('data-theme', newTheme);
      var options = document.querySelectorAll('.theme-option');
      options.forEach(function(opt) {
        opt.classList.toggle('active', opt.getAttribute('data-theme-option') === newTheme);
      });
      moveThemePill(newTheme);
      // 如果当前是首页，重新播放开场动画
      if (currentPage === 'home') {
        var home = document.getElementById('page-home');
        if (home) {
          var animatedEls = home.querySelectorAll('.hero-kanji, .word, .hero-subtitle, .hero-actions');
          animatedEls.forEach(function(el) {
            el.style.animation = 'none';
            void el.offsetHeight;
            el.style.animation = '';
          });
        }
      }
    }
  };
  // 新标准 + iOS 旧 Safari 兼容
  try { window._themeMediaQuery.addEventListener('change', window._themeChangeHandler); } catch(e){}
  try { window._themeMediaQuery.addListener(window._themeChangeHandler); } catch(e){}

  // Hover effects: spring-driven magnification
  var options = switcher.querySelectorAll('.theme-option');
  var _hoveredOption = null;

  options.forEach(opt => {
    opt.addEventListener('mouseenter', () => {
      _hoveredOption = opt;
      updateThemePill(opt, true);
    });
    opt.addEventListener('mouseleave', () => {
      _hoveredOption = null;
      // Return to current active option
      const activeOpt = switcher.querySelector('.theme-option.active');
      if (activeOpt) {
        updateThemePill(activeOpt, false);
      }
    });
  });

  // Click: switch theme with spring animation
  options.forEach(opt => {
    opt.addEventListener('click', () => {
      const theme = opt.getAttribute('data-theme-option');
      setTheme(theme);
    });
  });

  // iOS 兼容：延迟二次检测（部分 iOS 浏览器 DOMContentLoaded 时 matchMedia 尚未就绪）
  if (sessionStorage.getItem('_themeAuto')) {
    setTimeout(function() {
      try {
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        var currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        var expectedTheme = prefersDark ? 'dark' : 'light';
        if (currentTheme !== expectedTheme) {
          document.documentElement.setAttribute('data-theme', expectedTheme);
          var opts = document.querySelectorAll('.theme-option');
          opts.forEach(function(o) {
            o.classList.toggle('active', o.getAttribute('data-theme-option') === expectedTheme);
          });
          moveThemePill(expectedTheme);
        }
      } catch(e) {}
    }, 500);
  }
}
// ======================= Init =======================

// 动态测量导航栏高度，设置 CSS 变量，让所有页面自动适配
function syncNavbarHeight() {
  const navbar = document.getElementById('navbar');
  if (navbar) {
    document.documentElement.style.setProperty('--navbar-h', navbar.offsetHeight + 'px');
  }
  // 字体可能刚加载完，重新校准液态玻璃 pill
  if (navPill) repositionNavPill();
}

document.addEventListener('DOMContentLoaded', () => {
  syncNavbarHeight();
  // 欢迎遮罩需最先初始化，避免其他模块报错导致点击失灵
  initSoundSystem();
  initNavPill();
  initNavLinks();
  initFireworks();
  setupDragDrop();
  setupFileInput();
  setupFormatTabs();
  setupModePill();
  setupCompareSlider();
  initCustomSliders();
  initMouseTilt();
  pingBackend();
  initBouncingHint();
  initThemeSwitcher();
  initSavePills();

  // ─── 移动端：按需把面板和遮罩移到 body 下 ──
  // 桌面端（>768px）：面板留在原页面内，保持 flex 布局
  // 移动端（≤768px）：面板移到 body 下，用 position:fixed 实现底部弹窗
  var _panelsInBody = false;
  var _panelDefs = [
    { id: 'ticketPanel',         backdropId: 'ticketMobileBackdrop',  pageId: 'page-ticket'  },
    { id: 'filterPanel',         backdropId: 'filterMobileBackdrop',  pageId: 'page-filter'  }
  ];

  function movePanelsToBodyIfMobile() {
    var isMobile = window.innerWidth <= 768;
    if (isMobile && !_panelsInBody) {
      _panelDefs.forEach(function(p) {
        var panel = document.getElementById(p.id);
        var backdrop = document.getElementById(p.backdropId);
        if (panel && panel.parentNode !== document.body) {
          document.body.appendChild(panel);
        }
        if (backdrop && backdrop.parentNode !== document.body) {
          document.body.appendChild(backdrop);
        }
      });
      _panelsInBody = true;
    } else if (!isMobile && _panelsInBody) {
      // 移回原页面
      _panelDefs.forEach(function(p) {
        var panel = document.getElementById(p.id);
        var backdrop = document.getElementById(p.backdropId);
        var page = document.getElementById(p.pageId);
        if (panel && panel.parentNode === document.body && page) {
          // 清除弹窗状态
          panel.classList.remove('sheet-open', 'sheet-expanded', 'dragging');
          panel.style.transform = '';
          panel.style.maxHeight = '';
          page.appendChild(panel);
        }
        if (backdrop && backdrop.parentNode === document.body && page) {
          backdrop.classList.remove('show');
          page.appendChild(backdrop);
        }
      });
      _panelsInBody = false;
      // 恢复 body 滚动
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      document.documentElement.style.overflow = '';
    }
  }

  // 初始执行
  movePanelsToBodyIfMobile();

  // 暴露到全局供 resize/load 使用
  window._movePanelsToBodyIfMobile = movePanelsToBodyIfMobile;

  // 窗口大小变化时重新评估（覆盖手机横竖屏切换、浏览器栏显示/隐藏等场景）
  var _resizeDebounce = null;
  window.addEventListener('resize', function() {
    syncNavbarHeight();
    if (_resizeDebounce) clearTimeout(_resizeDebounce);
    _resizeDebounce = setTimeout(function() {
      movePanelsToBodyIfMobile();
    }, 200);
  });

  // ─── 移动端弹窗按钮绑定（极简方案：只用 click）───
  function bindMobileBtn(id, fnName) {
    var el = document.getElementById(id);
    if (!el) return;
    // 用 {} 绑定确保只绑定一次
    if (el._mobileBound) return;
    el._mobileBound = true;
    el.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (window[fnName]) window[fnName]();
    });
    // 键盘无障碍：Enter/Space 触发
    el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (window[fnName]) window[fnName]();
      }
    });
  }

  // 必须在 DOMContentLoaded 里绑定，此时 window.toggleXxx 已赋值
  bindMobileBtn('ticketMobileToggle', 'toggleTicketMobileSheet');
  bindMobileBtn('ticketExpandBtn', 'toggleTicketSheetExpand');

  // 遮罩关闭（仅 click）
  var tbd = document.getElementById('ticketMobileBackdrop');
  if (tbd && !tbd._mobileBound) {
    tbd._mobileBound = true;
    tbd.addEventListener('click', function(e) { e.preventDefault(); if (window.toggleTicketMobileSheet) window.toggleTicketMobileSheet(); });
  }
});

// 页面完全加载后再测一次（确保字体加载完毕、导航栏高度稳定）
window.addEventListener('load', function() {
  syncNavbarHeight();
  repositionNavPill();
  // 微信 WebView 字体加载可能有延迟，加多次后备校准
  setTimeout(repositionNavPill, 200);
  setTimeout(repositionNavPill, 600);
  setTimeout(repositionNavPill, 1500);
  if (window._movePanelsToBodyIfMobile) window._movePanelsToBodyIfMobile();
});

// ======================= Page Switching (SPA) =======================

const NAV_ORDER = ['home', 'features', 'guide', 'upload', 'result', 'ticket', 'filter', 'profile'];

let _switchTimer = null;
let _prevSection = null;
let _enterTimer  = null;   // 新页面进入动画结束后的清理 timer

function switchPage(page) {
  if (page === currentPage) return;
  vibrate(8);
  var _prevPage = currentPage;

  // 强制关闭所有移动端弹窗（防止状态残留）
  // 面板常驻 body 下，不需要移回原页面，只需清除状态
  ['ticketPanel'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.classList.remove('sheet-open', 'sheet-expanded', 'dragging');
      el.style.transform = '';
      el.style.maxHeight = '';
    }
  });
  ['ticketMobileBackdrop'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('show');
  });
  ['ticketMobileToggle'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  });
  // 解锁 body（防止滚动被锁）
  if (document.body.style.overflow === 'hidden') {
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    document.documentElement.style.overflow = '';
  }
  // 去掉 sheet-visible（如果有）
  var navbar = document.getElementById('navbar');
  if (navbar) navbar.classList.remove('sheet-visible');

  // 重置所有倾斜元素的 inline 样式，防止 SPA 切换后动画被阻塞
  if (typeof resetAllTilt === 'function') resetAllTilt();

  // 清理旧 timer（上次切换可能还没结束）
  if (_switchTimer) {
    clearTimeout(_switchTimer);
    _switchTimer = null;
    if (_prevSection) {
      _prevSection.style.visibility = 'hidden';
      _prevSection.classList.remove('exit-to-left', 'exit-to-right', 'enter-from-left', 'enter-from-right');
      _prevSection.classList.remove('active');
      _prevSection.style.transform = '';
      _prevSection = null;
    }
  }
  if (_enterTimer) {
    clearTimeout(_enterTimer);
    _enterTimer = null;
    // 上一次的 page-transitioning 可能还没清理
    document.body.classList.remove('page-transitioning');
  }
  if (_enterTimer) {
    clearTimeout(_enterTimer);
    _enterTimer = null;
  }

  const oldSection = document.getElementById('page-' + currentPage);
  const newSection = document.getElementById('page-' + page);
  const curIdx = NAV_ORDER.indexOf(currentPage);
  const newIdx = NAV_ORDER.indexOf(page);
  const goingRight = newIdx > curIdx;

  // 离开票根页时，立即隐藏上传区避免在退出动画中闪现到新页面
  if (currentPage === 'ticket') {
    const tuz = document.getElementById('ticketUploadZone');
    if (tuz) tuz.style.visibility = 'hidden';
    // 关闭移动端底部弹窗 + 恢复滚动/导航栏
    var tp = document.getElementById('ticketPanel');
    var tb = document.getElementById('ticketMobileBackdrop');
    var tt = document.getElementById('ticketMobileToggle');
    var tpage = document.querySelector('.ticket-page');
    if (tp) {
      // 取消可能正在进行的关闭 timer
      if (tp._closeTimer) { clearTimeout(tp._closeTimer); tp._closeTimer = null; }
      tp.classList.remove('sheet-open'); tp.classList.remove('sheet-expanded'); tp.classList.remove('dragging'); tp.style.transform = ''; tp.style.maxHeight = '';
    }
    if (tb) tb.classList.remove('show');
    if (tt) tt.classList.remove('hidden');
    if (tpage) { tpage.classList.remove('sheet-active'); tpage.classList.remove('sheet-expanded-active'); }
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    document.documentElement.style.overflow = '';
    var navbar = document.getElementById('navbar');
    if (navbar) navbar.classList.remove('sheet-visible');
  }

  // 离开图像降噪上传页时，隐藏上传区避免闪现到目标页面
  if (currentPage === 'upload') {
    const uz = document.getElementById('uploadZone');
    if (uz) uz.style.visibility = 'hidden';
  }
  // 离开降噪结果页时，隐藏内容区 + emptyState 避免闪现
  if (currentPage === 'result') {
    const rc = document.getElementById('resultContent');
    if (rc) rc.style.visibility = 'hidden';
    const es = document.getElementById('emptyState');
    if (es) es.style.visibility = 'hidden';
  }

  // 离开创意滤镜页时，关闭底部弹窗 + 恢复滚动
  if (currentPage === 'filter') {
    var fp = document.getElementById('filterPanel');
    var fb = document.getElementById('filterMobileBackdrop');
    var ft = document.getElementById('filterMobileToggle');
    var fpage = document.querySelector('.filter-page');
    var fsection = document.getElementById('page-filter');
    if (fp) {
      // 取消可能正在进行的关闭 timer
      if (fp._closeTimer) { clearTimeout(fp._closeTimer); fp._closeTimer = null; }
      fp.classList.remove('sheet-open', 'sheet-expanded', 'dragging'); fp.style.transform = ''; fp.style.maxHeight = ''; /* 移回原位置 */ if (fp.parentNode === document.body && fsection) fsection.appendChild(fp);
    }
    if (fb) { fb.classList.remove('show'); if (fb.parentNode === document.body && fsection) fsection.appendChild(fb); }
    if (ft) ft.classList.remove('hidden');
    if (fpage) { fpage.classList.remove('sheet-active', 'sheet-expanded-active'); }
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    document.documentElement.style.overflow = '';
    var navbarF = document.getElementById('navbar');
    if (navbarF) navbarF.classList.remove('sheet-visible');
  }

  // 1. 旧页面：带方向退出
  if (oldSection) {
    oldSection.classList.remove('enter-from-left', 'enter-from-right', 'active');
    const exitClass = goingRight ? 'exit-to-left' : 'exit-to-right';
    oldSection.classList.add(exitClass);
    _prevSection = oldSection;
  }

  // 页面切换期间标记 body，隐藏底部弹窗（防止 fixed 元素因 parent transform 偏移）
  document.body.classList.add('page-transitioning');

  // 2. 新页面：带方向进入
  if (newSection) {
    newSection.classList.remove('exit-to-left', 'exit-to-right', 'enter-from-left', 'enter-from-right');
    newSection.style.visibility = '';    // 清除上一次 _switchTimer 残留的 inline hidden
    newSection.scrollTop = 0;            // 重置内部滚动位置
    const enterClass = goingRight ? 'enter-from-right' : 'enter-from-left';
    newSection.classList.add(enterClass);
    void newSection.offsetWidth; // 强制 reflow，让浏览器先应用 enter-from 的初始帧
    newSection.classList.add('active');

    // 动画结束后移除进入方向类，恢复 pointer-events
    _enterTimer = setTimeout(() => {
      newSection.classList.remove('enter-from-left', 'enter-from-right');
      document.body.classList.remove('page-transitioning');
      _enterTimer = null;
    }, 440);
  }

  // 3. 立即更新导航栏
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === page);
  });

  const activeLink = document.querySelector('.nav-link.active');
  if (activeLink) updatePill(activeLink);

  if (page === 'result') refreshResultPage();

  // 进入票根页时，恢复上传区可见性 + 彻底清除弹窗残留状态
  if (page === 'ticket') {
    const tuz = document.getElementById('ticketUploadZone');
    if (tuz) tuz.style.visibility = '';
    // 双重保障：强制清除所有弹窗状态
    var tp = document.getElementById('ticketPanel');
    var tmb = document.getElementById('ticketMobileBackdrop');
    var ttb = document.getElementById('ticketMobileToggle');
    var tpg = document.querySelector('.ticket-page');
    if (tp) { tp.classList.remove('sheet-open', 'sheet-expanded', 'dragging'); tp.style.transform = ''; tp.style.maxHeight = ''; }
    if (tmb) tmb.classList.remove('show');
    if (ttb) ttb.classList.remove('hidden');
    if (tpg) { tpg.classList.remove('sheet-active', 'sheet-expanded-active'); }
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    document.documentElement.style.overflow = '';
    var navbar2 = document.getElementById('navbar');
    if (navbar2) navbar2.classList.remove('sheet-visible');
  }

  // 进入上传页时，恢复上传区可见性
  if (page === 'upload') {
    const uz = document.getElementById('uploadZone');
    if (uz) uz.style.visibility = '';
  }
  // 进入结果页时，恢复内容区 + emptyState 可见性
  if (page === 'result') {
    const rc = document.getElementById('resultContent');
    if (rc) rc.style.visibility = '';
    const es = document.getElementById('emptyState');
    if (es) es.style.visibility = '';
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // 重新触发首页 hero 动画（全部元素）
  if (page === 'home') {
    const home = document.getElementById('page-home');
    if (home) {
      // 重置所有带 CSS 动画的 hero 子元素
      const animatedEls = home.querySelectorAll('.hero-kanji, .word, .hero-subtitle, .hero-actions');
      animatedEls.forEach(el => {
        el.style.animation = 'none';
        void el.offsetHeight;  // 强制 reflow
        el.style.animation = '';
      });
    }
  }

  // 4. 旧页面动画结束后隐藏
  if (_prevSection) {
    _switchTimer = setTimeout(() => {
      if (_prevSection) {
        _prevSection.style.visibility = 'hidden';
        _prevSection.classList.remove('exit-to-left', 'exit-to-right', 'enter-from-left', 'enter-from-right');
        _prevSection.style.transform = '';
      }
      _switchTimer = null;
      _prevSection = null;
    }, 420);
  }

  currentPage = page;

  // 移动端：每次页面切换后确保面板/遮罩在 body 下
  // 防止 navigateTo → closeSheet 把面板移回 section 后，下次进入布局错乱
  movePanelsToBodyIfMobile();

  // 进入创意滤镜页时，确保弹窗为关闭态（只显示预览区+浮动按钮）
  if (page === 'filter') {
    var _fp = document.getElementById('filterPanel');
    var _fb = document.getElementById('filterMobileBackdrop');
    var _ft = document.getElementById('filterMobileToggle');
    if (_fp) { _fp.classList.remove('sheet-open', 'sheet-expanded'); }
    if (_fb) _fb.classList.remove('show');
    if (_ft) _ft.classList.remove('hidden');
  }

  // 个人中心页面进入/离开回调
  if (page === 'profile' && typeof window.onProfilePageEnter === 'function') {
    window.onProfilePageEnter();
  }
  if (_prevPage === 'profile' && page !== 'profile' && typeof window.onProfilePageLeave === 'function') {
    window.onProfilePageLeave();
  }
}

// 页面标题信息已移除，保留空函数避免调用报错
function updateNavPageInfo() {}

let _navHoverTimer = null;   // 全局共享，快速跨按钮时立即覆盖
// 检测设备是否支持 hover（触屏设备返回 false）
var _hasHover = window.matchMedia('(hover: hover)').matches;

function initNavLinks() {
  const links = document.querySelectorAll('.nav-link');

  links.forEach(link => {
    // mouseenter：立即切换，0ms delay 跟手（仅 hover 设备）
    if (_hasHover) {
      link.addEventListener('mouseenter', () => {
        const page = link.dataset.page;
        if (!page || page === currentPage) return;

        // 立即取消上一次的 timer，无论之前悬停在哪个按钮上
        if (_navHoverTimer) clearTimeout(_navHoverTimer);

        // 0ms 直接切换，极致跟手
        _navHoverTimer = setTimeout(() => {
          _navHoverTimer = null;
          switchPage(page);
        }, 0);
      });

      // mouseleave：只取消还未执行的切换，不阻止已触发的
      link.addEventListener('mouseleave', () => {
        // 只有 timer 还存在（还没执行）时才取消
        // 如果已经执行了，clearTimeout 也无害
        if (_navHoverTimer) {
          clearTimeout(_navHoverTimer);
          _navHoverTimer = null;
        }
      });
    }

    // 点击作为触屏备用 + 桌面备用
    link.addEventListener('click', (e) => {
      const page = link.dataset.page;
      if (!page || page === currentPage) return;
      e.preventDefault();
      if (_navHoverTimer) { clearTimeout(_navHoverTimer); _navHoverTimer = null; }
      switchPage(page);
    });
  });

  // 鼠标完全离开导航区域时取消待执行切换（仅 hover 设备）
  if (_hasHover) {
    const navLinks = document.getElementById('navLinks');
    if (navLinks) {
      navLinks.addEventListener('mouseleave', () => {
        if (_navHoverTimer) { clearTimeout(_navHoverTimer); _navHoverTimer = null; }
      });
    }
  }
}

// ======================= Theme Pill Physics =======================

const THEME_PILL_PHYSICS = {
  stiffness: 0.12,
  damping: 0.78,
};

let themePillEl = null;
let themePillSpring = {
  x: 0, w: 0, h: 0,
  hover: 0, hoverW: 0, hoverH: 0,
  vx: 0, vw: 0, vh: 0, vHover: 0, vHoverW: 0, vHoverH: 0,
  targetX: 0, targetW: 0, targetH: 0,
  targetHover: 0, targetHoverW: 0, targetHoverH: 0,
  animating: false,
};
let _themePillAnimId = null;
let _themeSwitcherHeight = 0;
let _themeSwitcherPad = 3;

function applyThemePillTransform() {
  if (!themePillEl) return;
  const p = themePillSpring;
  const curH = p.h + p.hoverH;
  const hoverTop = _themeSwitcherPad - (curH - p.h) / 2;
  const curW = p.w + p.hoverW;
  const curX = p.x - p.hoverW / 2;
  themePillEl.style.left   = curX + 'px';
  themePillEl.style.width  = curW + 'px';
  themePillEl.style.top    = hoverTop + 'px';
  themePillEl.style.height = curH + 'px';
}

function themePillAnimateLoop() {
  const p = themePillSpring;
  const phys = THEME_PILL_PHYSICS;
  let fx = phys.stiffness * (p.targetX - p.x);
  p.vx += fx; p.vx *= phys.damping; p.x += p.vx;
  let fw = phys.stiffness * (p.targetW - p.w);
  p.vw += fw; p.vw *= phys.damping; p.w += p.vw;
  let fh = phys.stiffness * (p.targetH - p.h);
  p.vh += fh; p.vh *= phys.damping; p.h += p.vh;
  let fhv = phys.stiffness * (p.targetHover - p.hover);
  p.vHover += fhv; p.vHover *= phys.damping; p.hover += p.vHover;
  let fhw = phys.stiffness * (p.targetHoverW - p.hoverW);
  p.vHoverW += fhw; p.vHoverW *= phys.damping; p.hoverW += p.vHoverW;
  let fhh = phys.stiffness * (p.targetHoverH - p.hoverH);
  p.vHoverH += fhh; p.vHoverH *= phys.damping; p.hoverH += p.vHoverH;
  applyThemePillTransform();
  const still =
    Math.abs(p.vx) < 0.03 && Math.abs(p.vw) < 0.03
    && Math.abs(p.x - p.targetX) < 0.3 && Math.abs(p.w - p.targetW) < 0.3
    && Math.abs(p.vHover) < 0.005 && Math.abs(p.vHoverW) < 0.005 && Math.abs(p.vHoverH) < 0.005;
  if (still) {
    p.x = p.targetX; p.w = p.targetW;
    p.hover = p.targetHover; p.hoverW = p.targetHoverW; p.hoverH = p.targetHoverH;
    applyThemePillTransform();
    p.animating = false;
    if (_themePillAnimId) cancelAnimationFrame(_themePillAnimId);
    _themePillAnimId = null;
    return;
  }
  _themePillAnimId = requestAnimationFrame(themePillAnimateLoop);
}

function startThemePillAnimation() {
  if (themePillSpring.animating) return;
  themePillSpring.animating = true;
  _themePillAnimId = requestAnimationFrame(themePillAnimateLoop);
}

function updateThemePill(targetEl, hover) {
  if (!themePillEl || !targetEl) return;
  const switcher = document.getElementById('themeSwitcher');
  if (!switcher) return;
  const sr = switcher.getBoundingClientRect();
  const tr = targetEl.getBoundingClientRect();
  themePillSpring.targetX = tr.left - sr.left;
  themePillSpring.targetW = tr.width;
  themePillSpring.targetH = _themeSwitcherHeight;
  if (hover) {
    themePillSpring.targetHoverW = 6;
    themePillSpring.targetHoverH = 12;
    themePillSpring.targetHover = 1;
  } else {
    themePillSpring.targetHoverW = 0;
    themePillSpring.targetHoverH = 0;
    themePillSpring.targetHover = 0;
  }
  startThemePillAnimation();
}

// ======================= Nav Pill Physics (Spring) =======================
const PILL_PHYSICS = {
  stiffness: 0.10,    // 弹簧刚度（越大越快追上目标）
  damping: 0.80,      // 阻尼（越大越快停下来）
  maxStretch: 0.10,   // 拖拽时最大拉伸比例
};

let pillSpring = {
  x: 0,       // 当前 left
  w: 0,       // 当前 width
  h: 0,       // 当前 height
  hover: 0,   // hover 拉伸量 (0~1)
  stretch: 0,  // 拖拽拉伸量 (0~1)
  vx: 0,      // left 速度
  vw: 0,      // width 速度
  vh: 0,      // height 速度
  vHover: 0,
  vStretch: 0,
  vHoverW: 0,    // 宽度 hover 扩展速度
  hoverW: 0,     // 当前宽度 hover 扩展量
  targetHoverW: 0, // 目标宽度 hover 扩展量
  targetX: 0,
  targetW: 0,
  targetH: 0,  // 目标高度（由 nav-link 实际高度决定）
  targetHover: 0,
  targetStretch: 0,
  animating: false,
};
let _navLinkHeight = 38;  // nav-link 实际高度（不含 nav-links padding）
let _navLinksPad = 5;    // nav-links 的 padding-top/ bottom
let _navRowTop = 0;     // 目标链接所在行相对于容器的 top 偏移（多行布局时）

let _pillAnimFrameId = null;

function applyPillTransform() {
  if (!navPill) return;
  const p = pillSpring;

  // 高度：hover 时明显放大（最多 +14px），垂直居中
  const baseH = _navLinkHeight;
  const curH = baseH + p.hover * 14;
  const pad = _navLinksPad;
  const hoverTop = pad - (curH - baseH) / 2;
  const hoverY = p.hover * 2;

  // 宽度：hover 时两端各轻微扩展（总量由 hoverW 控制，最多 +8px），拖拽时横向拉伸
  const stretchScale = 1 + p.stretch * PILL_PHYSICS.maxStretch;
  const curW = p.w + p.hoverW;
  const curX = p.x - p.hoverW / 2;  // 向两端均匀扩展，中心不变

  navPill.style.left      = curX + 'px';
  navPill.style.width     = curW + 'px';
  navPill.style.top       = (hoverTop + _navRowTop) + 'px';
  navPill.style.height    = curH + 'px';
  navPill.style.transform = 'translateY(' + hoverY + 'px) scaleX(' + stretchScale + ')';
}

function pillAnimateLoop() {
  const p = pillSpring;
  const phys = PILL_PHYSICS;

  // X (left)
  let fx = phys.stiffness * (p.targetX - p.x);
  p.vx += fx; p.vx *= phys.damping;
  p.x += p.vx;

  // W (width)
  let fw = phys.stiffness * (p.targetW - p.w);
  p.vw += fw; p.vw *= phys.damping;
  p.w += p.vw;

  // H (height)
  let fh2 = phys.stiffness * (p.targetH - p.h);
  p.vh += fh2; p.vh *= phys.damping;
  p.h += p.vh;

  // Hover
  let fh = phys.stiffness * (p.targetHover - p.hover);
  p.vHover += fh; p.vHover *= phys.damping;
  p.hover += p.vHover;

  // HoverW (width hover expand)
  let fhw = phys.stiffness * (p.targetHoverW - p.hoverW);
  p.vHoverW += fhw; p.vHoverW *= phys.damping;
  p.hoverW += p.vHoverW;

  // Stretch
  let fs = phys.stiffness * (p.targetStretch - p.stretch);
  p.vStretch += fs; p.vStretch *= phys.damping;
  p.stretch += p.vStretch;

  applyPillTransform();

  // 检查是否基本静止
  const still = Math.abs(p.vx) < 0.05 && Math.abs(p.vw) < 0.05
             && Math.abs(p.x - p.targetX) < 0.5
             && Math.abs(p.w - p.targetW) < 0.5;

  if (still && Math.abs(p.vHover) < 0.01 && Math.abs(p.vStretch) < 0.01) {
    // 吸附到目标
    p.x = p.targetX; p.w = p.targetW;
    p.hover = p.targetHover; p.stretch = p.targetStretch;
    applyPillTransform();
    p.animating = false;
    if (_pillAnimFrameId) cancelAnimationFrame(_pillAnimFrameId);
    _pillAnimFrameId = null;
    return;
  }
  _pillAnimFrameId = requestAnimationFrame(pillAnimateLoop);
}

function startPillAnimation() {
  if (pillSpring.animating) return;
  pillSpring.animating = true;
  _pillAnimFrameId = requestAnimationFrame(pillAnimateLoop);
}

function updatePill(target, instant) {
  if (!navPill || !target) return;
  const container = document.getElementById('navLinks');
  if (!container) return;
  const cr = container.getBoundingClientRect();
  const tr = target.getBoundingClientRect();
  pillSpring.targetX = tr.left - cr.left;
  pillSpring.targetW = tr.width;
  pillSpring.targetH = _navLinkHeight;  // 固定高度，hover 时会额外增加
  // 多行布局时追踪目标行偏移（移动端 nav-links 可能换行），减去 padding 避免与 hoverTop 重复
  _navRowTop = tr.top - cr.top - _navLinksPad;
  if (instant) {
    pillSpring.x = pillSpring.targetX;
    pillSpring.w = pillSpring.targetW;
    pillSpring.h = pillSpring.targetH;
    pillSpring.vx = 0; pillSpring.vw = 0; pillSpring.vh = 0;
    applyPillTransform();
    // 弹簧即刻吸附，无需 visibility 切换
  }
  startPillAnimation();
}
// ======================= Nav Pill (Liquid Glass Sliding) =======================


let navPill = null;

function initNavPill() {
  const navLinks = document.getElementById('navLinks');
  if (!navLinks) return;

  // 获取 nav-link 实际高度 & nav-links padding
  const firstLink = navLinks.querySelector('.nav-link');
  if (firstLink && firstLink.offsetHeight > 0) {
    _navLinkHeight = firstLink.offsetHeight;
  }
  // 兜底：确保高度不为 0，防止 pill 不可见
  if (!_navLinkHeight || _navLinkHeight < 10) {
    _navLinkHeight = 34;
  }
  try {
    const ls = window.getComputedStyle(navLinks);
    _navLinksPad = parseFloat(ls.paddingTop) || 5;
  } catch(e) {}

  navPill = document.createElement('div');
  navPill.className = 'nav-pill';
  navLinks.appendChild(navPill);

  // 初始化 pill 高度
  pillSpring.h = _navLinkHeight;
  pillSpring.targetH = _navLinkHeight;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const active = navLinks.querySelector('.nav-link.active');
      if (active) updatePill(active, true);
    });
  });

  // 字体异步加载完成后重新校准 pill（Google Fonts 可能导致初始高度为 0）
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function() {
      setTimeout(repositionNavPill, 50);
    });
  }

  const links = navLinks.querySelectorAll('.nav-link');

  links.forEach(link => {
    // 仅 hover 设备注册鼠标事件（触屏设备用 touch 事件代替）
    if (_hasHover) {
      link.addEventListener('mouseenter', () => {
        // hover 高度明显放大 (+14px)，宽度轻微扩展两端 (+8px total)
        pillSpring.targetH = _navLinkHeight + 14;
        pillSpring.targetHoverW = 8;   // 宽度额外扩展量（两端各 4px）
        pillSpring.targetHover = 1;
        startPillAnimation();
        updatePill(link);
      });
      link.addEventListener('mouseleave', () => {
        pillSpring.targetH = _navLinkHeight;
        pillSpring.targetHoverW = 0;
        pillSpring.targetHover = 0;
        startPillAnimation();
        const active = navLinks.querySelector('.nav-link.active');
        if (active) updatePill(active);
      });
      // 点击时拉伸效果
      link.addEventListener('mousedown', () => {
        pillSpring.targetStretch = 1;
        startPillAnimation();
        setTimeout(() => { pillSpring.targetStretch = 0; startPillAnimation(); }, 150);
      });
    }

    // 移动端触摸：按下时放大（同 hover 效果），抬起/取消时恢复
    link.addEventListener('touchstart', () => {
      pillSpring.targetH = _navLinkHeight + 14;
      pillSpring.targetHoverW = 8;
      pillSpring.targetHover = 1;
      startPillAnimation();
      updatePill(link);
    }, { passive: true });
    function _touchShrink() {
      pillSpring.targetH = _navLinkHeight;
      pillSpring.targetHoverW = 0;
      pillSpring.targetHover = 0;
      startPillAnimation();
      const active = navLinks.querySelector('.nav-link.active');
      if (active) updatePill(active);
    }
    link.addEventListener('touchend', _touchShrink, { passive: true });
    link.addEventListener('touchcancel', _touchShrink, { passive: true });

    link.addEventListener('click', (e) => {
      const page = link.dataset.page;
      if (!page || page === currentPage) return;
      e.preventDefault();
      if (_navHoverTimer) { clearTimeout(_navHoverTimer); _navHoverTimer = null; }
      switchPage(page);
    });
  });

  window.addEventListener('resize', () => {
    const active = navLinks.querySelector('.nav-link.active');
    if (active) updatePill(active);
  });

  // ─── Nav Links Drag-to-Switch ───
  // 支持鼠标拖动 + 触摸拖动来切换页面
  let _navDrag = {
    dragging: false,
    startX: 0,
    startY: 0,
    deltaX: 0,
    threshold: 60,    // 拖动阈值(px)
    isDragging: false,  // 是否正在拖动（超过阈值后变为true）
    timer: null
  };

  function onDragStart(e) {
    if (e.button && e.button !== 0) return; // 仅左键
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    _navDrag.dragging = true;
    _navDrag.startX = clientX;
    _navDrag.startY = clientY;
    _navDrag.deltaX = 0;
    _navDrag.isDragging = false;
  }

  function onDragMove(e) {
    if (!_navDrag.dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - _navDrag.startX;
    const dy = clientY - _navDrag.startY;

    // 如果垂直拖动距离太大，则取消（用户在滚动）
    if (Math.abs(dy) > 30 && !_navDrag.isDragging) {
      _navDrag.dragging = false;
      return;
    }

    _navDrag.deltaX = dx;

    if (Math.abs(dx) > _navDrag.threshold) {
      if (!_navDrag.isDragging) {
        _navDrag.isDragging = true;
        // 切换页面
        const curIdx = NAV_ORDER.indexOf(currentPage);
        let newIdx;
        if (dx > 0) {
          // 向右拖动 = 上一个页面
          newIdx = curIdx - 1;
        } else {
          // 向左拖动 = 下一个页面
          newIdx = curIdx + 1;
        }
        if (newIdx >= 0 && newIdx < NAV_ORDER.length) {
          switchPage(NAV_ORDER[newIdx]);
        }
        // 重置起始位置，允许连续拖动
        _navDrag.startX = clientX;
        _navDrag.startY = clientY;
      }
    }
  }

  function onDragEnd() {
    _navDrag.dragging = false;
    _navDrag.isDragging = false;
    _navDrag.deltaX = 0;
  }

  // 鼠标事件
  navLinks.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  // 触摸事件
  navLinks.addEventListener('touchstart', onDragStart, { passive: true });
  document.addEventListener('touchmove', onDragMove, { passive: true });
  document.addEventListener('touchend', onDragEnd);
}

// 字体加载完成后重新校准 pill 位置（解决 Google Fonts 异步加载导致液态玻璃错位）
function repositionNavPill() {
  const navLinks = document.getElementById('navLinks');
  if (!navLinks || !navPill) return;
  const firstLink = navLinks.querySelector('.nav-link');
  if (firstLink && firstLink.offsetHeight > 0) {
    _navLinkHeight = firstLink.offsetHeight;
  }
  try {
    const ls = window.getComputedStyle(navLinks);
    _navLinksPad = parseFloat(ls.paddingTop) || 5;
  } catch(e) {}
  pillSpring.h = _navLinkHeight;
  pillSpring.targetH = _navLinkHeight;
  const active = navLinks.querySelector('.nav-link.active');
  if (active) updatePill(active, true);
}

// updatePill is now spring-powered (see above)

// ── ResizeObserver 监视 nav-links 尺寸变化（字体加载/内容回流时自动校准 pill）──
(function initPillResizeObserver() {
  var navLinks = document.getElementById('navLinks');
  if (!navLinks || !window.ResizeObserver) return;
  var obs = new ResizeObserver(function() {
    repositionNavPill();
  });
  obs.observe(navLinks);
})();

// ======================= Firework Particle System =======================

function initFireworks() {
  let canvas = document.getElementById('fireworkCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'fireworkCanvas';
    document.body.appendChild(canvas);
  }

  const ctx = canvas.getContext('2d');
  let particles = [];
  let animId = null;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const FIREWORK_DURATION = 500;

  class Particle {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed - 1;
      this.born = performance.now();
      this.life = 1;
      const colors = [
        [196, 104, 58], [255, 180, 120], [255, 210, 160],
        [255, 255, 220], [220, 140, 100], [196, 130, 80], [240, 160, 120],
      ];
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.r = c[0]; this.g = c[1]; this.b = c[2];
      this.size = 1.5 + Math.random() * 3.5;
      this.gravity = 0.06;
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.vy += this.gravity;
      this.vx *= 0.99;
      const elapsed = performance.now() - this.born;
      this.life = Math.max(0, 1 - elapsed / FIREWORK_DURATION);
    }
    draw(ctx) {
      const alpha = this.life;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${this.r},${this.g},${this.b})`;
      ctx.shadowColor = `rgba(${this.r},${this.g},${this.b},0.6)`;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * alpha, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    dead() { return this.life <= 0; }
  }

  function spawn(x, y, count) {
    if (animId) cancelAnimationFrame(animId);
    particles = [];
    animId = null;

    count = count || 30;
    for (let i = 0; i < count; i++) particles.push(new Particle(x, y));
    animId = requestAnimationFrame(loop);
  }

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.update();
      if (p.dead()) {
        particles.splice(i, 1);
        continue;
      }
      p.draw(ctx);
    }
    if (particles.length > 0) {
      animId = requestAnimationFrame(loop);
    } else {
      animId = null;
    }
  }

  document.addEventListener('click', (e) => {
    spawn(e.clientX, e.clientY, 25 + Math.floor(Math.random() * 15));
  });
}

// ======================= Backend Ping (本地处理模式) =======================

function pingBackend() {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (!dot || !text) return;
  // 本地 Worker 处理，无需远程后端
  dot.className = 'status-dot online';
  text.textContent = 'Young__Yang降噪程序就绪';
}

// ======================= File Input =======================

function setupFileInput() {
  const input = document.getElementById('fileInput');
  const zone = document.getElementById('uploadZone');
  if (!input) return;
  // 防止重复绑定：先移除旧事件（如果存在）
  if (setupFileInput._bound) return;
  setupFileInput._bound = true;

  input.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  // 上传区域点击 → 触发文件选择（统一在这里绑，去掉 HTML 的 onclick）
  if (zone) {
    zone.addEventListener('click', (e) => {
      // 防止事件冒泡导致双触发
      if (e.target.closest('.upload-zone') && !e.target.closest('#fileInput')) {
        input.click();
      }
    });
  }
}

function setupDragDrop() {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
}

async function handleFile(file) {
  // 200MB size limit
  if (file.size > 200 * 1024 * 1024) {
    showToast('文件大小超过200MB，请选择更小的图片', 'error');
    return;
  }
  vibrate(10);

  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-tiff'];
  const ext = file.name.split('.').pop().toLowerCase();
  const allowedExts = ['png', 'jpg', 'jpeg', 'raw', 'bmp', 'tiff', 'tif', 'webp'];

  if (!allowed.includes(file.type) && !allowedExts.includes(ext)) {
    showToast('不支持该文件格式', 'error');
    return;
  }

  currentFile = file;
  resultBlob = null;
  resultFileName = null;

  // Read raw file data synchronously (awaited) for reliable EXIF extraction later
  try {
    currentFileData = await file.arrayBuffer();
  } catch {
    currentFileData = null;
  }

  const meta = document.getElementById('imgMeta');
  if (meta) {
    document.getElementById('metaName').textContent = file.name;
    document.getElementById('metaFormat').textContent = ext.toUpperCase();
    document.getElementById('metaBytes').textContent = formatBytes(file.size);
    meta.classList.remove('hidden');
  }

  // Fill EXIF camera params on the upload page immediately
  const exif = parseExifRobust(currentFileData);
  const setMeta = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '--';
  };
  setMeta('metaMake', exif.make || '--');
  setMeta('metaModel', exif.model || '--');
  setMeta('metaAperture', formatAperture(exif.fNumber));
  setMeta('metaShutter', formatShutterSpeed(exif.exposureTime));
  setMeta('metaISO', exif.iso ? String(exif.iso) : '--');
  setMeta('metaFocal', formatFocalLength(exif.focalLength));

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataURL = e.target.result;
    const previewImg = document.getElementById('previewImg');
    if (previewImg) {
      previewImg.src = dataURL;
      previewImg.classList.remove('hidden');
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById('inputCanvas');
      if (!canvas) return;
      drawToCanvas(canvas, img);
      canvas.classList.add('hidden');  // 仅保留坐标数据，不显示

      const uz = document.getElementById('uploadZone');
      if (uz) uz.style.display = 'none';

      const actions = document.getElementById('imgActions');
      if (actions) actions.classList.remove('hidden');

      const metaSize = document.getElementById('metaSize');
      if (metaSize) metaSize.textContent = `${img.width} × ${img.height}`;

      resetOutputUI();

      const pb = document.getElementById('processBtn');
      if (pb) pb.disabled = false;

      showToast(i18n.t('toastUploadSuccess') + ` ${file.name}`, 'success');
    };
    img.src = dataURL;
  };

  if (ext === 'raw') {
    showRawPlaceholder();
    const pb = document.getElementById('processBtn');
    if (pb) pb.disabled = false;
    const metaSize = document.getElementById('metaSize');
    if (metaSize) metaSize.textContent = 'RAW 格式';
  } else {
    reader.readAsDataURL(file);
  }
}

function resetOutputUI() {
  const timingBlock = document.getElementById('timingBlock');
  if (timingBlock) timingBlock.classList.add('hidden');
}

function showRawPlaceholder() {
  const previewImg = document.getElementById('previewImg');
  if (previewImg) previewImg.classList.add('hidden');

  const canvas = document.getElementById('inputCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = 300;
  canvas.height = 200;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, 300, 200);
  ctx.fillStyle = '#666';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('RAW FILE', 150, 95);
  ctx.font = '13px monospace';
  ctx.fillStyle = '#C4683A';
  ctx.fillText(currentFile.name, 150, 120);
  canvas.classList.remove('hidden');
  const uz = document.getElementById('uploadZone');
  if (uz) uz.style.display = 'none';
  const actions = document.getElementById('imgActions');
  if (actions) actions.classList.remove('hidden');
}

function changeImage() {
  const fi = document.getElementById('fileInput');
  if (fi) fi.click();
}

function removeImage() {
  currentFile = null;
  currentFileData = null;
  resultBlob = null;
  resultFileName = null;

  const el = (id) => document.getElementById(id);
  if (el('previewImg')) el('previewImg').classList.add('hidden');
  if (el('inputCanvas')) el('inputCanvas').classList.add('hidden');
  if (el('uploadZone')) el('uploadZone').style.display = '';
  if (el('imgActions')) el('imgActions').classList.add('hidden');
  if (el('imgMeta')) el('imgMeta').classList.add('hidden');
  if (el('processBtn')) el('processBtn').disabled = true;
  resetOutputUI();
  if (el('fileInput')) el('fileInput').value = '';

  showToast(i18n.t('toastRemoved'));
}

function drawToCanvas(canvas, img) {
  const MAX_SIDE = 800;
  let w = img.width, h = img.height;
  const maxSide = Math.max(w, h);
  if (maxSide > MAX_SIDE) {
    const ratio = MAX_SIDE / maxSide;
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
}

// ======================= Mode Selection =======================

function setupModePill() {
  const pill = document.getElementById('modePill');
  const tabs = document.querySelectorAll('.mode-tab');
  if (!pill || !tabs.length) return;

  function movePill(activeTab) {
    const parent = pill.parentElement;
    const parentRect = parent.getBoundingClientRect();
    const rect = activeTab.getBoundingClientRect();
    pill.style.left = (rect.left - parentRect.left) + 'px';
    pill.style.width = rect.width + 'px';
  }

  const activeTab = document.querySelector('.mode-tab.active') || tabs[0];
  requestAnimationFrame(() => movePill(activeTab));

  tabs.forEach(tab => {
    tab.addEventListener('mouseenter', () => {
      selectMode(tab);
    });
  });
  const container = pill.parentElement;
  if (container) {
    container.addEventListener('mouseleave', () => {
      const current = document.querySelector('.mode-tab.active') || tabs[0];
      selectMode(current);
    });
  }
}

function selectMode(btn) {
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentMode = btn.dataset.mode;

  const pill = document.getElementById('modePill');
  const parent = pill?.parentElement;
  if (pill && parent) {
    const parentRect = parent.getBoundingClientRect();
    const rect = btn.getBoundingClientRect();
    pill.style.left = (rect.left - parentRect.left) + 'px';
    pill.style.width = rect.width + 'px';
  }
}

// ======================= Format Tabs =======================

function setupFormatTabs() {
  document.querySelectorAll('.fmt-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(6);
      document.querySelectorAll('.fmt-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const qualityRow = document.getElementById('qualityRow');
      if (qualityRow) qualityRow.style.display = btn.dataset.fmt === 'png' ? 'none' : '';
    });
  });
}

// ======================= Process Image =======================

async function processImage() {
  if (!currentFile) return;
  vibrate(10);

  const processBtn = document.getElementById('processBtn');
  if (!processBtn) return;

  const btnText = processBtn.querySelector('.btn-text');
  const btnSpinner = document.getElementById('btnSpinner');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');

  processBtn.disabled = true;
  if (btnText) btnText.textContent = '处理中...';
  if (btnSpinner) btnSpinner.classList.remove('hidden');
  if (progressWrap) progressWrap.classList.remove('hidden');
  const timingBlock = document.getElementById('timingBlock');
  if (timingBlock) timingBlock.classList.add('hidden');

  const stopProgress = animateProgress(progressBar, progressText);

  const sigmaS = parseInt(document.getElementById('sigmaS').value);
  const sigmaR = parseInt(document.getElementById('sigmaR').value);

  startTime = performance.now();

  try {
    // 1. 全分辨率加载原图
    const img = await loadImage(currentFile);
    const dw = img.naturalWidth, dh = img.naturalHeight;

    // 源 canvas（全分辨率，后续逐块提取 tile）
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = dw;
    srcCanvas.height = dh;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(img, 0, 0);

    // 输出 canvas（全分辨率，tile 拼回）
    const outCanvas = document.createElement('canvas');
    outCanvas.width = dw;
    outCanvas.height = dh;
    const outCtx = outCanvas.getContext('2d');

    // ---- 分块降噪参数 ----
    const TILE = 1800;        // 每块最大尺寸（留 248px 给重叠）
    const OVERLAP = 32;       // 相邻块重叠像素，消除拼接缝
    const tilesX = Math.ceil(dw / TILE);
    const tilesY = Math.ceil(dh / TILE);
    const totalTiles = tilesX * tilesY;

    if (totalTiles > 1) {
      showToast(`大图分块降噪（${tilesX}×${tilesY}=${totalTiles}块）`, 'info');
    }

    window._lastElapsed = 0;

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        // --- 从源图提取当前 tile（含重叠） ---
        const sx = Math.max(0, tx * TILE - OVERLAP);
        const sy = Math.max(0, ty * TILE - OVERLAP);
        const sw = Math.min(TILE + 2 * OVERLAP, dw - sx);
        const sh = Math.min(TILE + 2 * OVERLAP, dh - sy);
        const tileData = srcCtx.getImageData(sx, sy, sw, sh);

        // --- 送 worker 降噪 ---
        const msgId = ++_denoiseMsgId;
        const worker = getDenoiseWorker();

        const { pixels } = await new Promise((resolve, reject) => {
          worker.onmessage = function (e) {
            const { id, type, pixels, elapsed, message } = e.data;
            if (id !== msgId) return;
            if (type === 'error') { reject(new Error(message)); return; }
            if (type === 'done') {
              window._lastElapsed += (elapsed || 0);
              resolve({ pixels });
            }
          };
          worker.onerror = (err) => reject(new Error('Worker 错误'));

          const buffer = tileData.data.buffer.slice(0);
          worker.postMessage({
            id: msgId,
            pixels: new Uint8ClampedArray(buffer),
            width: sw, height: sh,
            sigmaS, sigmaR, mode: currentMode
          }, [buffer]);
        });

        // --- 将有效区域（去除重叠）写回输出 canvas ---
        const ex = tx * TILE;                    // 输出 canvas 上的 x
        const ey = ty * TILE;                    // 输出 canvas 上的 y
        const ew = Math.min(TILE, dw - ex);      // 有效宽度
        const eh = Math.min(TILE, dh - ey);      // 有效高度
        const dx = ex - sx;                      // 有效区在 tile 内的偏移 x
        const dy = ey - sy;                      // 有效区在 tile 内的偏移 y

        const outData = outCtx.createImageData(ew, eh);
        const resultArr = new Uint8ClampedArray(pixels);
        for (let y = 0; y < eh; y++) {
          const srcOff = ((dy + y) * sw + dx) * 4;
          const dstOff = y * ew * 4;
          outData.data.set(resultArr.subarray(srcOff, srcOff + ew * 4), dstOff);
        }
        outCtx.putImageData(outData, ex, ey);

        // --- 进度更新 ---
        const done = ty * tilesX + tx + 1;
        const pct = Math.round((done / totalTiles) * 100);
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.textContent = `分块降噪 ${done}/${totalTiles} (${pct}%)`;
      }
    }

    // 2. 输出为 PNG blob
    const resultBlobLocal = await new Promise((resolve, reject) => {
      outCanvas.toBlob(blob => {
        blob ? resolve(blob) : reject(new Error('Blob 导出失败'));
      }, 'image/png');
    });

    resultBlob = resultBlobLocal;

    const baseName = currentFile.name.replace(/\.[^.]+$/, '');
    resultFileName = `${baseName}_denoised.png`;

    const elapsed = window._lastElapsed || Math.round(performance.now() - startTime);
    window._lastDenoiseParams = { sigmaS, sigmaR, mode: currentMode, elapsed };
    window._lastInputCanvas = document.getElementById('inputCanvas');

    stopProgress();
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = '处理完成！';
    setTimeout(() => { if (progressWrap) progressWrap.classList.add('hidden'); }, 1200);

    showToast(i18n.t('toastDenoiseDone') + ` ${elapsed}ms`, 'success');
    if (window.PrismDenStats) window.PrismDenStats.incDenoise();

    setTimeout(() => switchPage('result'), 600);

  } catch (err) {
    stopProgress();
    if (progressWrap) progressWrap.classList.add('hidden');
    showToast(i18n.t('toastDenoiseErr'), 'error');
    console.error(err);
  } finally {
    processBtn.disabled = false;
    if (btnText) btnText.textContent = '开始处理';
    if (btnSpinner) btnSpinner.classList.add('hidden');
  }
}

/** 将 File 解码为 HTMLImageElement */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function animateProgress(bar, text) {
  if (!bar || !text) return () => {};
  let pct = 0;
  const msgs = ['解码图片...', '分析噪声分布...', '双边滤波处理中...', '合成结果...'];
  const lastMsgIdx = msgs.length - 1;
  let msgIdx = 0;
  const iv = setInterval(() => {
    if (pct < 90) {
      const step = pct < 30 ? 8 : pct < 60 ? 5 : 2;
      pct = Math.min(pct + step + Math.random() * 3, 90);
      bar.style.width = pct + '%';
      const expectedMsg = Math.floor((pct / 90) * lastMsgIdx);
      if (expectedMsg > msgIdx && expectedMsg < msgs.length) {
        msgIdx = expectedMsg;
        text.textContent = msgs[msgIdx];
      }
    } else {
      text.textContent = msgs[lastMsgIdx];
      bar.style.width = '90%';
    }
  }, 350);
  return () => { clearInterval(iv); };
}

// ======================= EXIF Parser (robust, uses exif.js + fallback) =======================

/**
 * 使用 exif.js 库（已加载在页面上）作为主要解析器，覆盖更多相机厂商的 EXIF 格式。
 * exif.js 返回的 ExposureTime/FNumber/FocalLength 是 Rational 对象 {numerator, denominator}，
 * 需要用 toNumber() 辅助函数提取数值。如果 exif.js 数据不全（部分字段缺失），
 * 则用内置 parseExif 补充缺失字段。
 */
function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v.numerator !== undefined && v.denominator !== undefined) {
    return v.denominator === 0 ? null : v.numerator / v.denominator;
  }
  // 某些厂商把 ISO 存为数组 [value]
  if (Array.isArray(v) && v.length > 0) {
    if (typeof v[0] === 'number') return v[0];
    return toNumber(v[0]);
  }
  return null;
}

function parseExifRobust(buffer) {
  if (!buffer) return {};

  // 1. 用 exif.js 解析（业界标准 EXIF 解析器）
  let exifJsResult = null;
  try {
    if (typeof EXIF !== 'undefined' && EXIF.readFromBinaryFile) {
      const raw = EXIF.readFromBinaryFile(buffer);
      if (raw && typeof raw === 'object') {
        exifJsResult = {
          make:           raw.Make || raw.make || null,
          model:          raw.Model || raw.model || null,
          exposureTime:   toNumber(raw.ExposureTime),
          fNumber:        toNumber(raw.FNumber),
          iso:            raw.ISOSpeedRatings !== undefined ? Number(raw.ISOSpeedRatings) || toNumber(raw.ISOSpeedRatings) : null,
          focalLength:    toNumber(raw.FocalLength),
          colorSpace:     raw.ColorSpace !== undefined ? Number(raw.ColorSpace) : null,
          gpsLatitude:    raw.GPSLatitude || null,
          gpsLatitudeRef: raw.GPSLatitudeRef || null,
          gpsLongitude:   raw.GPSLongitude || null,
          gpsLongitudeRef: raw.GPSLongitudeRef || null,
        };
      }
    }
  } catch (e) {
    console.warn('exif.js parsing failed:', e.message);
  }

  // 2. 用内置解析器补充（覆盖范围可能不同，互补使用）
  const custom = parseExif(buffer);

  // 3. 合并：exif.js 优先，缺失字段用内置解析器补充
  if (exifJsResult) {
    return {
      make:         exifJsResult.make         || custom.make         || null,
      model:        exifJsResult.model        || custom.model        || null,
      exposureTime: exifJsResult.exposureTime ?? custom.exposureTime ?? null,
      fNumber:      exifJsResult.fNumber      ?? custom.fNumber      ?? null,
      iso:          exifJsResult.iso          ?? custom.iso          ?? null,
      focalLength:  exifJsResult.focalLength  ?? custom.focalLength  ?? null,
      colorSpace:   exifJsResult.colorSpace   ?? custom.colorSpace   ?? null,
      gpsLatitude:    exifJsResult.gpsLatitude    || custom.gpsLatitude    || null,
      gpsLatitudeRef: exifJsResult.gpsLatitudeRef || custom.gpsLatitudeRef || null,
      gpsLongitude:   exifJsResult.gpsLongitude   || custom.gpsLongitude   || null,
      gpsLongitudeRef: exifJsResult.gpsLongitudeRef || custom.gpsLongitudeRef || null,
    };
  }

  return custom;
}


function parseExif(buffer) {
  if (!buffer) return {};
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;

  // Check SOI marker
  if (data[0] !== 0xFF || data[1] !== 0xD8) return {};

  offset = 2;
  while (offset < data.length - 1) {
    if (data[offset] !== 0xFF) break;
    const marker = data[offset + 1];

    // APP1 marker
    if (marker === 0xE1) {
      // Check Exif header
      const header = String.fromCharCode(...data.slice(offset + 4, offset + 10));
      if (header !== 'Exif\x00\x00') { offset += 2 + view.getUint16(offset + 2, false); continue; }

      offset += 10;
      const tiffOffset = offset;
      const isLE = data[offset] === 0x49; // II = little-endian, MM = big-endian
      if (data[offset] !== 0x49 && data[offset] !== 0x4D) return {};
      offset += 2;
      if (view.getUint16(offset, isLE) !== 0x002A) return {};
      offset += 2;
      const ifd0Offset = view.getUint32(offset, isLE);
      offset = tiffOffset + ifd0Offset;

      const ifd0 = readIFD(view, tiffOffset, offset, isLE);

      var result = Object.assign({}, ifd0);

      // Follow Exif SubIFD pointer (tag 0x8769) — most camera params live here
      if (ifd0._subIfdOffset) {
        const sub = readIFD(view, tiffOffset, tiffOffset + ifd0._subIfdOffset, isLE);
        result = Object.assign(result, sub);
      }

      // Follow GPS IFD pointer (tag 0x8825) — GPS data lives here
      if (ifd0._gpsIfdOffset) {
        const gps = readIFD(view, tiffOffset, tiffOffset + ifd0._gpsIfdOffset, isLE);
        result = Object.assign(result, gps);
      }

      return result;
    }

    // Other markers: skip
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      offset += 2;
    } else {
      offset += 2 + (offset + 2 < data.length ? view.getUint16(offset + 2, false) : 0);
    }
  }

  return {};
}

function readIFD(view, tiffBase, offset, isLE) {
  const result = {};
  const count = view.getUint16(offset, isLE);
  offset += 2;

  for (let i = 0; i < count; i++) {
    const tag = view.getUint16(offset, isLE);
    const type = view.getUint16(offset + 2, isLE);
    const numVals = view.getUint32(offset + 4, isLE);
    const valOffset = offset + 8;

    const typeSizes = { 1:1, 2:1, 3:2, 4:4, 5:8, 7:1, 9:4, 10:8 };
    const totalBytes = numVals * (typeSizes[type] || 1);

    let rawVal;
    if (totalBytes <= 4) {
      rawVal = valOffset;
    } else {
      rawVal = tiffBase + view.getUint32(valOffset, isLE);
    }

    switch (tag) {
      case 0x010F: result.make = readString(view, rawVal, numVals); break;
      case 0x0110: result.model = readString(view, rawVal, numVals); break;
      case 0x829A: result.exposureTime = readRational(view, rawVal, isLE); break;
      case 0x829D: result.fNumber = readRational(view, rawVal, isLE); break;
      case 0x8827: result.iso = readShort(view, rawVal, isLE); break;
      case 0x920A: result.focalLength = readRational(view, rawVal, isLE); break;
      case 0xA001: result.colorSpace = readShort(view, rawVal, isLE); break;
      case 0x8769: result._subIfdOffset = view.getUint32(valOffset, isLE); break; // Exif SubIFD pointer
      case 0x8825: result._gpsIfdOffset = view.getUint32(valOffset, isLE); break; // GPS IFD pointer
      // GPS tags（仅在 GPS IFD 中出现）
      case 0x0001: result.gpsLatitudeRef = readString(view, rawVal, numVals); break;
      case 0x0002: result.gpsLatitude = readRationalArray(view, rawVal, isLE, numVals); break;
      case 0x0003: result.gpsLongitudeRef = readString(view, rawVal, numVals); break;
      case 0x0004: result.gpsLongitude = readRationalArray(view, rawVal, isLE, numVals); break;
    }

    offset += 12;
  }

  return result;
}

function readString(view, offset, len) {
  const bytes = [];
  for (let i = 0; i < len; i++) {
    const b = view.getUint8(offset + i);
    if (b === 0) break;
    bytes.push(b);
  }
  return String.fromCharCode(...bytes).trim() || null;
}

function readRational(view, offset, isLE) {
  const num = view.getUint32(offset, isLE);
  const den = view.getUint32(offset + 4, isLE);
  if (den === 0) return null;
  return num / den;
}

function readRationalArray(view, offset, isLE, count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const num = view.getUint32(offset + 8 * i, isLE);
    const den = view.getUint32(offset + 4 + 8 * i, isLE);
    arr.push(den === 0 ? 0 : num / den);
  }
  return arr;
}

function readShort(view, offset, isLE) {
  return view.getUint16(offset, isLE);
}

function formatShutterSpeed(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds >= 1) return seconds.toFixed(1) + 's';
  const recip = Math.round(1 / seconds);
  return '1/' + recip + 's';
}

function formatAperture(fNumber) {
  if (fNumber === null || fNumber === undefined) return null;
  return 'f/' + fNumber.toFixed(1);
}

function formatFocalLength(mm) {
  if (mm === null || mm === undefined) return null;
  return Math.round(mm) + 'mm';
}

function colorSpaceName(code) {
  if (code === 1) return 'sRGB';
  if (code === 2) return 'Adobe RGB';
  if (code === 0xFFFF) return 'Uncalibrated';
  return null;
}

// ======================= Fill Photo Info =======================

async function fillPhotoInfo() {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '--';
  };

  // ---- File info (always available) ----
  if (currentFile) {
    const sizeStr = formatBytes(currentFile.size);
    const ext = currentFile.name.split('.').pop().toUpperCase();
    // Result page IDs
    set('infoFileSize', sizeStr);
    set('infoFormat', ext);
    // Upload page IDs (metaBytes / metaFormat already set in handleFile)
  } else {
    set('infoFileSize', '--');
    set('infoFormat', '--');
  }

  // ---- Camera params from EXIF ----
  // Ensure raw file data is available (fallback read if needed)
  if (!currentFileData && currentFile) {
    try { currentFileData = await currentFile.arrayBuffer(); } catch { currentFileData = null; }
  }

  const exif = parseExifRobust(currentFileData);

  // Helper: fill BOTH upload page (meta*) and result page (info*) IDs
  const setPair = (metaId, infoId, val) => {
    set(metaId, val);
    set(infoId, val);
  };

  setPair('metaMake', 'infoMake', exif.make || '--');
  setPair('metaModel', 'infoModel', exif.model || '--');
  setPair('metaAperture', 'infoAperture', formatAperture(exif.fNumber));
  setPair('metaShutter', 'infoShutter', formatShutterSpeed(exif.exposureTime));
  setPair('metaISO', 'infoISO', exif.iso ? String(exif.iso) : '--');
  setPair('metaFocal', 'infoFocal', formatFocalLength(exif.focalLength));
  set('infoColorSpace', colorSpaceName(exif.colorSpace) || '--');
}

// ======================= Result Page Refresh =======================

function refreshResultPage() {
  if (!resultBlob) {
    const emptyState = document.getElementById('emptyState');
    const resultContent = document.getElementById('resultContent');
    if (emptyState) emptyState.classList.remove('hidden');
    if (resultContent) resultContent.classList.add('hidden');
    return;
  }

  const emptyState = document.getElementById('emptyState');
  const resultContent = document.getElementById('resultContent');
  if (emptyState) emptyState.classList.add('hidden');
  if (resultContent) {
    resultContent.classList.remove('hidden');
    // Force reflow so mouse-tracking works immediately
    void resultContent.offsetHeight;
  }

  // Re-init save pills after result content becomes visible
  requestAnimationFrame(() => { requestAnimationFrame(() => initSavePills()); });

  const p = window._lastDenoiseParams || {};
  const timing = document.getElementById('resultTiming');
  if (timing) timing.textContent = (p.elapsed || '--') + ' ms';
  const rs = document.getElementById('resultSigmaS');
  if (rs) rs.textContent = p.sigmaS || '--';
  const rr = document.getElementById('resultSigmaR');
  if (rr) rr.textContent = p.sigmaR || '--';
  const rm = document.getElementById('resultMode');
  if (rm) rm.textContent = p.mode === 'bilateral' ? '彩色双边' : '灰度 Y 通道';

  // Fill photo info section
  fillPhotoInfo();

  // 用降噪后的实际文件大小覆盖原始文件大小的显示
  const resultSizeStr = formatBytes(resultBlob.size);
  const infoFileSize = document.getElementById('infoFileSize');
  if (infoFileSize) infoFileSize.textContent = resultSizeStr;
  const metaBytes = document.getElementById('metaBytes');
  if (metaBytes) metaBytes.textContent = resultSizeStr;

  const url = URL.createObjectURL(resultBlob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.getElementById('resultCanvas');
    if (!canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    setupCompareImages();
  };
  img.src = url;
}

// ======================= Save Image =======================

async function saveImage(fmtOverride) {
  if (!resultBlob) { showToast(i18n.t('toastNoResult'), 'error'); return; }

  let fmt;
  if (fmtOverride) {
    fmt = fmtOverride;
  } else {
    const activeTab = document.querySelector('.fmt-tab.active');
    if (!activeTab) { showToast(i18n.t('toastNoFormat'), 'error'); return; }
    fmt = activeTab.dataset.fmt;
  }
  const qualitySlider = document.getElementById('qualitySlider');
  const quality = qualitySlider ? parseInt(qualitySlider.value) / 100 : 1;

  let finalBlob = resultBlob;
  let fileName = resultFileName;

  if (fmt !== 'png') {
    // 非 PNG 格式需从原始 PNG blob 转换，quality 参数控制压缩率
    finalBlob = await convertBlob(resultBlob, fmt, quality);
    const base = (resultFileName || 'denoised').replace(/\.[^.]+$/, '');
    fileName = `${base}.${fmt}`;
  }
  // PNG：直接使用降噪 worker 输出的无损 PNG blob，不经过任何重编码

  const url = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'denoised.png';
  a.click();
  URL.revokeObjectURL(url);

  showToast(i18n.t('toastSaved') + ` ${fileName}`, 'success');
}

async function convertBlob(blob, fmt, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => resolve(b), `image/${fmt}`, quality);
    };
    img.src = url;
  });
}

// ======================= SPA Save UI (format pills + action pills) =======================

function selectSaveFormat(btn) {
  vibrate(6);
  _currentSaveFormat = btn.dataset.fmt;

  // Update active state
  document.querySelectorAll('.save-fmt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Move format pill
  const container = document.getElementById('saveFormatTabs');
  if (container) {
    const pill = container.querySelector('.save-format-pill');
    if (pill) {
      const cr = container.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      pill.style.left = (br.left - cr.left) + 'px';
      pill.style.width = br.width + 'px';
    }
  }

  // Show/hide quality slider
  const qualityRow = document.getElementById('qualityRow');
  if (qualityRow) {
    qualityRow.style.display = (_currentSaveFormat === 'png') ? 'none' : 'flex';
  }
}

function selectSaveAction(btn) {
  vibrate(6);
  _currentSaveAction = btn.dataset.action;

  // Update active state
  document.querySelectorAll('.save-action-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Move action pill
  const container = document.getElementById('saveActions');
  if (container) {
    const pill = container.querySelector('.save-action-pill');
    if (pill) {
      const cr = container.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      pill.style.left = (br.left - cr.left) + 'px';
      pill.style.width = br.width + 'px';
    }
  }
}

function executeSaveAction() {
  if (_currentSaveAction === 'save') {
    saveImage(_currentSaveFormat);
  } else if (_currentSaveAction === 'new') {
    switchPage('upload');
  }
}

function initSavePills() {
  // Init format pill position + click listeners
  const formatContainer = document.getElementById('saveFormatTabs');
  if (formatContainer) {
    const activeFmt = formatContainer.querySelector('.save-fmt-btn.active');
    const pill = formatContainer.querySelector('.save-format-pill');
    if (activeFmt && pill) {
      const cr = formatContainer.getBoundingClientRect();
      const br = activeFmt.getBoundingClientRect();
      pill.style.left = (br.left - cr.left) + 'px';
      pill.style.width = br.width + 'px';
    }
    // Also support click (not just hover) on format buttons
    formatContainer.querySelectorAll('.save-fmt-btn').forEach(btn => {
      btn.addEventListener('click', () => selectSaveFormat(btn));
    });
  }

  // Init action pill position + click listeners
  const actionContainer = document.getElementById('saveActions');
  if (actionContainer) {
    const firstAction = actionContainer.querySelector('.save-action-btn');
    const pill = actionContainer.querySelector('.save-action-pill');
    if (firstAction && pill) {
      const cr = actionContainer.getBoundingClientRect();
      const br = firstAction.getBoundingClientRect();
      pill.style.left = (br.left - cr.left) + 'px';
      pill.style.width = br.width + 'px';
    }
    // Also support click (not just hover) on action buttons
    actionContainer.querySelectorAll('.save-action-btn').forEach(btn => {
      btn.addEventListener('click', () => selectSaveAction(btn));
    });
  }
}

// ======================= Custom Sliders (hover-drag + liquid glass thumb) =======================

let _customSliders = [];

function initCustomSliders() {
  const natives = document.querySelectorAll('.slider');
  natives.forEach(native => {
    if (native.dataset.custom === 'true') return;
    native.dataset.custom = 'true';

    const min = parseFloat(native.min) || 0;
    const max = parseFloat(native.max) || 100;
    let val = parseFloat(native.value) || 0;

    // Build custom slider DOM
    const wrap = document.createElement('div');
    wrap.className = 'custom-slider';
    wrap.dataset.targetId = native.id;

    const track = document.createElement('div');
    track.className = 'custom-slider-track';

    const fill = document.createElement('div');
    fill.className = 'custom-slider-fill';

    const thumb = document.createElement('div');
    thumb.className = 'custom-slider-thumb';

    track.appendChild(fill);
    track.appendChild(thumb);
    wrap.appendChild(track);

    // Insert after native, then hide native
    native.style.display = 'none';
    native.insertAdjacentElement('afterend', wrap);

    // isClickDrag: 只有鼠标按下小球后才为 true
    // isHover: 仅用于视觉高亮，不触发拖动
    const data = {
      native, wrap, track, thumb, fill,
      min, max, val,
      isHover: false,
      isClickDrag: false,
    };
    _customSliders.push(data);

    function pctFromX(clientX) {
      const r = track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    }

    function updateThumb() {
      const pct = (data.val - data.min) / (data.max - data.min) * 100;
      thumb.style.left = pct + '%';
      fill.style.width = pct + '%';
    }

    function applyValue(newVal) {
      newVal = Math.max(data.min, Math.min(data.max, Math.round(newVal)));
      if (newVal === data.val) return;
      data.val = newVal;
      native.value = data.val;
      native.dispatchEvent(new Event('input', { bubbles: true }));
      updateThumb();
      const _now = performance.now();
      if (!data._lastTickTime || _now - data._lastTickTime > 80) { playTickSound(); data._lastTickTime = _now; }
    }

    updateThumb();

    // 鼠标进入/离开：仅视觉高亮，不启用拖动
    wrap.addEventListener('mouseenter', () => {
      data.isHover = true;
      wrap.classList.add('hover');
    });
    wrap.addEventListener('mouseleave', () => {
      data.isHover = false;
      data.isClickDrag = false;
      wrap.classList.remove('hover');
      thumb.classList.remove('dragging');
    });

    // 只有按下小球（thumb）才启用拖动（桌面 + 移动端）
    thumb.addEventListener('mousedown', (e) => {
      data.isClickDrag = true;
      thumb.classList.add('dragging');
      e.preventDefault();
      e.stopPropagation();
    });
    thumb.addEventListener('touchstart', (e) => {
      data.isClickDrag = true;
      thumb.classList.add('dragging');
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });

    // 点击轨道（仅桌面端，移动端通过触摸轨道也可拖动）
    track.addEventListener('click', (e) => {
      if (data.isClickDrag) return;
      applyValue(data.min + pctFromX(e.clientX) * (data.max - data.min));
    });
    // 移动端：触摸轨道也可以拖动
    track.addEventListener('touchstart', (e) => {
      e.preventDefault();
      var t = e.touches[0];
      applyValue(data.min + pctFromX(t.clientX) * (data.max - data.min));
    }, { passive: false });

    data._applyFromX = (clientX) => {
      applyValue(data.min + pctFromX(clientX) * (data.max - data.min));
    };
  });

  // 全局 mousemove：只有 isClickDrag 为 true 时才拖动
  document.addEventListener('mousemove', (e) => {
    _customSliders.forEach(d => {
      if (d.isClickDrag) {
        d._applyFromX(e.clientX);
      }
    });
  });
  // 全局 touchmove：移动端触摸拖动
  document.addEventListener('touchmove', (e) => {
    _customSliders.forEach(d => {
      if (d.isClickDrag) {
        d._applyFromX(e.touches[0].clientX);
      }
    });
  }, { passive: false });

  document.addEventListener('mouseup', () => {
    _customSliders.forEach(d => {
      d.isClickDrag = false;
      d.thumb.classList.remove('dragging');
    });
  });
  document.addEventListener('touchend', () => {
    _customSliders.forEach(d => {
      d.isClickDrag = false;
      d.thumb.classList.remove('dragging');
    });
  });
}

// ======================= Compare Slider =======================

let compareActive = false;

function setupCompareImages() {
  const compareHint = document.getElementById('compareHint');
  if (compareHint) compareHint.onclick = openCompare;
}

function openCompare() {
  if (!resultBlob) return;

  const overlay = document.getElementById('compareOverlay');
  const origCanvas = document.getElementById('compareOriginal');
  const resCanvas = document.getElementById('compareResult');

  const srcCanvas = document.getElementById('inputCanvas');
  if (!srcCanvas || !overlay || !origCanvas || !resCanvas) return;

  const resultCanvas = document.getElementById('resultCanvas');
  if (!resultCanvas) return;

  const cmpW = resultCanvas.width;
  const cmpH = resultCanvas.height;

  origCanvas.width = cmpW;
  origCanvas.height = cmpH;
  resCanvas.width = cmpW;
  resCanvas.height = cmpH;

  const ictx = origCanvas.getContext('2d');
  ictx.drawImage(srcCanvas, 0, 0, cmpW, cmpH);

  const rctx = resCanvas.getContext('2d');
  rctx.drawImage(resultCanvas, 0, 0);

  overlay.classList.remove('hidden');
  compareActive = true;
}

function closeCompare() {
  const overlay = document.getElementById('compareOverlay');
  if (overlay) overlay.classList.add('hidden');
  compareActive = false;
}

function setupCompareSlider() {
  const divider = document.getElementById('compareDivider');
  const wrap = document.getElementById('compareResultWrap');
  const container = document.getElementById('compareContainer');
  if (!divider || !wrap || !container) return;

  let dragging = false;

  const onMove = (x) => {
    if (!dragging || !compareActive) return;
    const rect = container.getBoundingClientRect();
    let pct = ((x - rect.left) / rect.width) * 100;
    pct = Math.max(5, Math.min(95, pct));
    divider.style.left = pct + '%';
    wrap.style.width = pct + '%';
  };

  divider.addEventListener('mousedown', () => { dragging = true; });
  document.addEventListener('mousemove', (e) => onMove(e.clientX));
  document.addEventListener('mouseup', () => { dragging = false; });

  divider.addEventListener('touchstart', (e) => { dragging = true; e.preventDefault(); });
  document.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX));
  document.addEventListener('touchend', () => { dragging = false; });

  const overlay = document.getElementById('compareOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeCompare();
    });
  }
}

// ======================= Utils =======================

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

let toastTimer = null;
function showToast(msgOrKey, type) {
  type = type || '';
  // 如果 i18n 可用，尝试翻译消息
  var msg = msgOrKey;
  if (typeof i18n !== 'undefined' && i18n.t) {
    var translated = i18n.t(msgOrKey);
    // i18n.t() 在 key 不存在时返回 key 本身，所以可以直接用
    // 但需判断：如果 msgOrKey 是中文且存在对应 key，则翻译
    // 简化：所有 toast 调用统一改用 key，动态消息不翻译
    if (translated !== msgOrKey) msg = translated;
  }
  // 震动反馈：成功轻震，错误双震
  if (type === 'success') vibrate(15);
  else if (type === 'error') vibrate([20, 40, 20]);
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast show' + (type ? ' ' + type : '');
  // 深色模式下直接用 inline style 设文字为黑色，不受 CSS 选择器特异性影响
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    toast.style.color = '#000000';
    toast.style.background = '#FDF8F4';
  } else {
    toast.style.color = '#FFFFFF';
    toast.style.background = '#141210';
  }
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast hidden'; }, 2800);
}

// ======================= Mouse Tilt (2D position follow) =======================
// Uses document-level event delegation so it works for all elements,
// including children of panels (canvas, buttons, etc.)

const TILT_SELECTOR =
  '.feature-card, .bounce-card, ' +
  '.btn:not(.nav-ping-btn), ' +
  '.img-action-btn, .fmt-tab, .compare-close, ' +
  '.btn-process:not(:disabled), ' +
  '.result-info-bar, .result-canvas-wrap, .save-block';

let _tiltCurrent = null;   // element currently under tilt
let _tiltLeaving = false;

function _findTiltTarget(e) {
  // Try e.target first (fast path)
  let el = e.target.closest(TILT_SELECTOR);
  if (!el) {
    // Fallback: use elementsFromPoint to find the topmost element at cursor
    const hits = document.elementsFromPoint(e.clientX, e.clientY);
    for (let i = 0; i < hits.length; i++) {
      el = hits[i].closest(TILT_SELECTOR);
      if (el) break;
    }
  }
  if (!el) return null;
  if (el.closest('.nav-links') || el.classList.contains('mode-tab')) return null;
  // Only tilt elements whose page-section is active (visible)
  const section = el.closest('.page-section');
  if (section && !section.classList.contains('active')) return null;
  return el;
}

function _applyTilt(el, e) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const tx = ((x - cx) / cx) * 8;
  const ty = ((y - cy) / cy) * 8;
  el.style.transition = 'none';
  el.style.transform = 'translateX(' + tx.toFixed(1) + 'px) translateY(' + ty.toFixed(1) + 'px)';
}

function _resetTilt(el) {
  el.style.transition = 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
  el.style.transform = 'translateX(0) translateY(0)';

  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    el.style.transition = '';
    el.style.transform = '';
    el.style.animation = '';
  };
  const onEnd = (ev) => {
    if (ev.propertyName !== 'transform' && ev.propertyName !== 'webkitTransform') return;
    el.removeEventListener('transitionend', onEnd);
    restore();
  };
  el.addEventListener('transitionend', onEnd);
  setTimeout(restore, 500);
}

function initMouseTilt() {
  // Kill any previous listeners (safe to call multiple times)
  // We use document-level delegation, so just attach once.
  if (initMouseTilt._attached) return;
  initMouseTilt._attached = true;

  document.addEventListener('mousemove', (e) => {
    const el = _findTiltTarget(e);

    if (el) {
      if (el !== _tiltCurrent) {
        // Mouse entered a new tilt element
        if (_tiltCurrent) _resetTilt(_tiltCurrent);
        _tiltCurrent = el;
        _tiltLeaving = false;
        el.style.animation = 'none';
      }
      _applyTilt(el, e);
    } else {
      // Mouse is not over any tilt element
      if (_tiltCurrent) {
        _resetTilt(_tiltCurrent);
        _tiltCurrent = null;
      }
    }
  });

  document.addEventListener('mouseleave', () => {
    if (_tiltCurrent) {
      _resetTilt(_tiltCurrent);
      _tiltCurrent = null;
    }
  });
}


function resetAllTilt() {
  if (_tiltCurrent) {
    _tiltCurrent.style.transition = '';
    _tiltCurrent.style.transform = '';
    _tiltCurrent.style.animation = '';
    _tiltCurrent = null;
  }
}
/* ==================== 旅行票根生成器 ==================== */
(function() {
  'use strict';

  const uploadZone = document.getElementById('ticketUploadZone');
  const fileInput = document.getElementById('ticketFileInput');
  const ticketEditorBlk = document.getElementById('ticketEditorBlock');
  const previewPlaceholder = document.getElementById('ticketPreviewPlaceholder');
  const ticketContainer = document.getElementById('ticketContainer');
  const ticketEl = document.getElementById('ticket');

  const inputDestination = document.getElementById('ticketDestination');
  const inputLocationCN = document.getElementById('ticketLocationCN');
  const inputDate = document.getElementById('ticketDate');
  const inputName = document.getElementById('ticketName');
  const inputTicketNo = document.getElementById('ticketTicketNo');
  const inputCode = document.getElementById('ticketCode');

  let _ticketImage = null;
  let _ticketColor = null;
  let _ticketLayout = 'horizontal';
  /* 微信环境检测（IIFE 作用域，供下载函数等复用） */
  var _tkIsWeChat = /MicroMessenger/i.test(navigator.userAgent);

  /* —— EXIF GPS 转十进制 —— */
  function _tkGpsToDecimal(gpsArr, ref) {
    if (!gpsArr || !gpsArr.length) return null;
    var d = toNumber(gpsArr[0]) || 0;
    var m = toNumber(gpsArr[1]) || 0;
    var s = toNumber(gpsArr[2]) || 0;
    var decimal = d + m / 60 + s / 3600;
    if (ref === 'S' || ref === 'W') decimal = -decimal;
    return decimal;
  }

  /* —— 拼音音节拆分（贪心最长匹配）—— */
  /* 将 "sichuan" → "si chuan"，用于英文目的地格式化 */
  var _tkPinyinSyllables = ('a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ' +
    'ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai ' +
    'chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei den deng di dian ' +
    'diao die ding diu dong dou du duan dui dun duo e ei en eng er fa fan fang fei fen feng fo fou fu ga gai ' +
    'gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ha hai han hang hao he hei hen ' +
    'heng hong hou hu hua huai huan huang hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan ' +
    'jue jun ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang ' +
    'lao le lei leng li lia lian liang liao lie lin ling liu long lou lu luan lue lun luo lv lve ma mai man ' +
    'mang mao me mei men meng mi mian miao mie min ming miu mo mou mu na nai nan nang nao ne nei nen neng ni ' +
    'nian niang niao nie nin ning niu nong nou nu nuan nue nun nuo nv nve o ou pa pai pan pang pao pei pen ' +
    'peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ' +
    'ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo sa sai san sang sao se sen seng sha shai ' +
    'shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su ' +
    'suan sui sun suo ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai ' +
    'wan wang wei wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang ' +
    'yao ye yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan zhang ' +
    'zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan ' +
    'zui zun zuo').split(' ');

  function _tkPinyinSplit(str) {
    if (!str) return '';
    var lower = str.toLowerCase().trim();
    var parts = lower.split(/\s+/); // 先按空格分词
    var out = [];
    for (var p = 0; p < parts.length; p++) {
      var word = parts[p];
      var i = 0;
      while (i < word.length) {
        var matched = false;
        for (var len = Math.min(6, word.length - i); len >= 1; len--) {
          if (_tkPinyinSyllables.indexOf(word.substring(i, i + len)) !== -1) {
            out.push(word.substring(i, i + len));
            i += len;
            matched = true;
            break;
          }
        }
        if (!matched) { out.push(word.substring(i)); break; }
      }
    }
    return out.join(' ').toUpperCase();
  }

  /* —— 逆地理编码：GPS 坐标 → 城市/国家 —— */
  /* 使用 BigDataCloud 免费 API（CORS 友好、中国可访问、无需密钥） */
  function _tkReverseGeocode(lat, lon, cb) {
    var done = 0, result = { enCity: null, cnCountry: null, cnCity: null };
    var total = 2;

    function fetchBC(lang, onData) {
      var url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=' + lang;
      var settled = false;
      var timer = setTimeout(function() {
        if (!settled) { settled = true; onData(null); }
      }, 8000);
      fetch(url).then(function(r) { return r.json(); }).then(function(data) {
        if (!settled) { clearTimeout(timer); settled = true; onData(data); }
      }).catch(function(e) {
        console.warn('[ticket] BigDataCloud (' + lang + ') failed:', e);
        if (!settled) { clearTimeout(timer); settled = true; onData(null); }
      });
    }

    fetchBC('en', function(data) {
      if (data) {
        result.enCity = data.city || data.locality || data.principalSubdivision || null;
      }
      done++;
      if (done === total) cb(result);
    });

    fetchBC('zh', function(data) {
      if (data) {
        var country = data.countryName || null;
        if (country === '中华人民共和国') country = '中国';
        result.cnCountry = country;
        var cnCity = data.city || data.locality || data.principalSubdivision || null;
        if (cnCity) cnCity = cnCity.replace(/(市|省|自治区|特别行政区)$/, ''); // 去掉行政后缀
        result.cnCity = cnCity;
      }
      done++;
      if (done === total) cb(result);
    });
  }

  /* —— 从文件提取 GPS 并自动填充目的地 —— */
  function _tkFillLocationFromExif(file) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var exif = parseExifRobust(ev.target.result);
        var lat = _tkGpsToDecimal(exif.gpsLatitude, exif.gpsLatitudeRef);
        var lon = _tkGpsToDecimal(exif.gpsLongitude, exif.gpsLongitudeRef);
        console.log('[ticket] EXIF GPS:', { raw: exif, lat: lat, lon: lon });
        if (lat === null || lon === null) {
          console.log('[ticket] 无 GPS 信息，保持默认');
          return;
        }
        _tkReverseGeocode(lat, lon, function(info) {
          console.log('[ticket] 逆地理编码结果:', info);
          if (!info.enCity && !info.cnCity) return; // 逆地理编码失败，保持默认
          if (info.enCity && inputDestination) {
            // 中国地点：拼音按音节拆分（Sichuan → SI CHUAN）
            if (info.cnCountry === '中国') {
              inputDestination.value = _tkPinyinSplit(info.enCity);
            } else {
              inputDestination.value = info.enCity.toUpperCase().replace(/\s+/g, ' ');
            }
          }
          if (info.cnCountry && info.cnCity && inputLocationCN) {
            inputLocationCN.value = info.cnCountry + ' · ' + info.cnCity;
          }
          _tkUpdate(); // 刷新预览
        });
      } catch (e) {
        console.warn('[ticket] EXIF 解析异常:', e);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function initTicket() {
    if (!uploadZone || !fileInput) return;
    uploadZone.addEventListener('click', function() { fileInput.click(); });
    uploadZone.addEventListener('dragover', _tkDragOver);
    uploadZone.addEventListener('dragleave', _tkDragLeave);
    uploadZone.addEventListener('drop', _tkDrop);
    fileInput.addEventListener('change', _tkFileSelect);
    [inputDestination, inputLocationCN, inputDate, inputName, inputTicketNo].forEach(function(inp) {
      if (inp) inp.addEventListener('input', _tkUpdate);
      if (inp) inp.addEventListener('blur', _tkFixViewport);
      // 微信键盘弹出后会遮挡输入框，聚焦时将输入框滚入可视区
      if (inp) inp.addEventListener('focus', function() {
        if (window.innerWidth > 768) return;
        setTimeout(function() { inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 350);
      });
    });
    regenerateTicketCode();
  }

  function _tkDragOver(e) { e.preventDefault(); e.stopPropagation(); uploadZone.classList.add('drag-over'); }
  function _tkDragLeave(e) { e.preventDefault(); e.stopPropagation(); uploadZone.classList.remove('drag-over'); }
  function _tkDrop(e) {
    e.preventDefault(); e.stopPropagation();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) _tkProcess(e.dataTransfer.files[0]);
  }
  function _tkFileSelect(e) {
    if (e.target.files.length) _tkProcess(e.target.files[0]);
  }

  function _tkProcess(file) {
    if (!file.type.match(/image\/(jpeg|png|webp)/)) { alert('请选择 JPG / PNG / WebP 格式'); return; }
    vibrate(10);
    // 异步提取 EXIF GPS 并自动填充目的地（不阻塞主流程）
    _tkFillLocationFromExif(file);
    var reader = new FileReader();
    reader.onload = function(ev) {
      _ticketImage = ev.target.result;
      var img = new Image();
      img.onload = function() {
        // 竖构图：逆时针旋转90°，统一按横版左图右文显示
        if (img.width < img.height) {
          var c = document.createElement('canvas');
          c.width = img.height; c.height = img.width;
          var ctx = c.getContext('2d');
          ctx.translate(img.height / 2, img.width / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(img, -img.width / 2, -img.height / 2);
          _ticketImage = c.toDataURL('image/jpeg', 0.95);
          _ticketLayout = 'horizontal';
        } else {
          _ticketImage = ev.target.result;
          _ticketLayout = 'horizontal';
        }
        // 用旋转后的图片提取颜色
        var tmp = new Image();
        tmp.onload = function() {
          _tkExtractColor(tmp, function(color) {
            _ticketColor = color;
            _tkRender();
            _tkShowEditor();
            if (window.PrismDenStats) window.PrismDenStats.incTicket();
          });
        };
        tmp.src = _ticketImage;
      };
      img.src = _ticketImage;
    };
    reader.readAsDataURL(file);
  }

  function _tkExtractColor(img, cb) {
    var c = document.createElement('canvas');
    var ctx = c.getContext('2d');
    var s = Math.min(100 / img.width, 100 / img.height);
    c.width = Math.floor(img.width * s);
    c.height = Math.floor(img.height * s);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var d = ctx.getImageData(0, 0, c.width, c.height).data;
    var buckets = {};
    for (var i = 0; i < d.length; i += 16) {
      var qr = Math.floor(d[i] / 32) * 32, qg = Math.floor(d[i + 1] / 32) * 32, qb = Math.floor(d[i + 2] / 32) * 32;
      var k = qr + ',' + qg + ',' + qb;
      if (!buckets[k]) buckets[k] = { r: qr, g: qg, b: qb, n: 0 };
      buckets[k].n++;
    }
    var max = 0, dom = { r: 100, g: 80, b: 60 };
    Object.values(buckets).forEach(function(b) { if (b.n > max) { max = b.n; dom = b; } });
    var f = 0.65;
    var hex = '#' + [Math.round(dom.r * f), Math.round(dom.g * f), Math.round(dom.b * f)].map(function(v) {
      var h = v.toString(16); return h.length === 1 ? '0' + h : h;
    }).join('');
    cb(hex);
  }

  var _tkBars = null;  // 缓存的条码数据，保证预览和下载一致

  function _tkGenBars() {
    _tkBars = [];
    for (var i = 0; i < 35; i++) {
      _tkBars.push({
        w: Math.random() < 0.3 ? 3 : (Math.random() < 0.5 ? 2 : 1),
        h: 28 + Math.floor(Math.random() * 12),
        o: 0.25 + Math.random() * 0.35
      });
    }
    return _tkBars;
  }

  function _tkBarcode() {
    var bars = _tkGenBars();
    var x = 0, svg = '';
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      svg += '<rect x="' + x + '" y="' + (40 - b.h) + '" width="' + b.w + '" height="' + b.h + '" fill="rgba(255,255,255,' + b.o.toFixed(2) + ')"/>';
      x += b.w + 1;
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + x + ' 40" width="' + x + '" height="40">' + svg + '</svg>';
  }

  function _tkEsc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function _tkRender() {
    if (!_ticketImage || !ticketEl) return;
    var dest = inputDestination ? inputDestination.value || 'CHUAN XI' : 'CHUAN XI';
    var locCN = inputLocationCN ? inputLocationCN.value || '中国 · 川西' : '中国 · 川西';
    var date = inputDate ? inputDate.value || '2026 · 7' : '2026 · 7';
    var name = inputName ? inputName.value || 'Young__Yang' : 'Young__Yang';
    var tno = inputTicketNo ? inputTicketNo.value || '' : '';
    var code = inputCode ? inputCode.value || '' : '';
    var bg = _ticketColor || '#5a3a28';

    ticketEl.className = 'ticket layout-' + _ticketLayout;
    ticketEl.innerHTML = 
      '<div class="ticket-photo"><img src="' + _ticketImage + '" alt=""></div>' +
      '<div class="ticket-info" style="background-color:' + bg + ';">' +
        '<div class="ticket-info-top">' +
          '<div class="ticket-destination-en">' + _tkEsc(dest) + '</div>' +
          (locCN ? '<div class="ticket-destination-cn">' + _tkEsc(locCN) + '</div>' : '') +
        '</div>' +
        '<div class="ticket-divider"></div>' +
        '<div class="ticket-date">' + _tkEsc(date) + '</div>' +
        '<div class="ticket-traveler">' + _tkEsc(name) + '</div>' +
        '<div class="ticket-divider" style="margin-top:0.4em;"></div>' +
        '<div class="ticket-info-footer">' +
          '<div class="ticket-number">' + _tkEsc(tno) + '</div>' +
          '<div class="ticket-code">' + _tkEsc(code) + '</div>' +
          '<div class="ticket-barcode">' + _tkBarcode() + '</div>' +
        '</div>' +
      '</div>';

    if (previewPlaceholder) previewPlaceholder.style.display = 'none';
    if (ticketContainer) ticketContainer.style.display = 'flex';
    // 编辑文字时实时更新弹窗预览（仅当 sheet 已打开时）
    if (window.innerWidth <= 768) {
      var pnl = document.getElementById('ticketPanel');
      if (pnl && pnl.classList.contains('sheet-open')) _tkShowSheetPreview();
    }
  }

  // 防抖：打字时延迟渲染，避免每次按键都重建整个票根 HTML（含条形码 SVG）
  var _tkRenderTimer = null;
  function _tkUpdate() {
    if (!_ticketImage) return;
    if (_tkRenderTimer) clearTimeout(_tkRenderTimer);
    _tkRenderTimer = setTimeout(function() {
      _tkRender();
      _tkRenderTimer = null;
    }, 200);
  }

  /* ── 微信 / iOS 键盘收起后页面缩放不还原修复 ── */
  /* 微信内置浏览器（iOS WKWebView / Android X5）对 viewport 的处理各有差异，
     需要多种手段组合出击才能覆盖全部场景 */
  var _tkLastInputBlur = 0;      // 记录最后 blur 时间
  var _tkVpFixTimer = null;      // viewport 修复计时器
  var _tkResizeFixBinded = false; // resize 监听是否已绑定

  function _tkFixViewport() {
    if (window.innerWidth > 768) return;
    _tkLastInputBlur = Date.now();

    // 方案 A：强制滚动后再回弹（Safari / WKWebView 通用）
    var prevY = window.scrollY || window.pageYOffset;
    window.scrollTo(0, 0);
    window.scrollTo(0, prevY);

    // 方案 B：短暂修改 viewport meta（覆盖大部分 WebView）
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp && !_tkVpFixTimer) {
      var orig = vp.getAttribute('content') || '';
      // 清除之前可能残留的临时值
      if (orig.indexOf(', maximum-scale=1.0,') >= 0) {
        orig = orig.replace(/, maximum-scale=1\.0,?/g, '');
      }
      vp.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
      _tkVpFixTimer = setTimeout(function() {
        vp.setAttribute('content', orig);
        _tkVpFixTimer = null;
      }, 350);
    }

    // 方案 C：微信专用 - 微信 WKWebView 有时需要更长的等待 + 多点触发布局重算
    if (_tkIsWeChat) {
      // 第一次：blur 后立即做一次
      // 第二次：延迟 200ms 再做一次（微信 WKWebView 偶尔需要二次矫正）
      setTimeout(function() {
        window.scrollTo(0, 0);
        var bodyH = document.body.style.height;
        // 强制触发 reflow：短暂改变 body 高度再恢复
        document.body.style.height = (window.innerHeight + 1) + 'px';
        document.body.style.minHeight = '';
        void document.body.offsetHeight; // 强制 reflow
        document.body.style.height = bodyH || '';
      }, 200);
      // 第三次：延迟 500ms 最终保险
      setTimeout(function() {
        window.scrollTo(0, 0);
        // 使用 WeixinJSBridge 调用 native 刷新（如果可用）
        if (typeof WeixinJSBridge !== 'undefined') {
          try { WeixinJSBridge.invoke('setPageScale', { scale: 1 }); } catch(e) {}
        }
      }, 500);
    }

    // 方案 D：监听 resize 事件作为兜底（微信键盘收起会触发 resize）
    if (!_tkResizeFixBinded) {
      _tkResizeFixBinded = true;
      var _tkResizeRAF = null;
      window.addEventListener('resize', function() {
        if (window.innerWidth > 768) return;
        if (_tkResizeRAF) cancelAnimationFrame(_tkResizeRAF);
        _tkResizeRAF = requestAnimationFrame(function() {
          _tkResizeRAF = null;
          // 键盘收起后 300ms 内的 resize 才处理
          var sinceBlur = Date.now() - _tkLastInputBlur;
          if (sinceBlur < 0 || sinceBlur > 2000) return;
          window.scrollTo(0, 0);
          if (typeof WeixinJSBridge !== 'undefined') {
            try { WeixinJSBridge.invoke('setPageScale', { scale: 1 }); } catch(e) {}
          }
        });
      });
    }
  }

  function _tkShowEditor() {
    if (ticketEditorBlk) ticketEditorBlk.style.display = 'block';
    var content = document.getElementById('ticketUploadContent');
    var preview = document.getElementById('ticketUploadPreview');
    var previewImg = document.getElementById('ticketUploadPreviewImg');
    if (content) content.style.display = 'none';
    if (window.innerWidth <= 768) {
      // 移动端：隐藏上传区域，显示票根弹窗预览
      if (uploadZone) uploadZone.style.display = 'none';
      if (preview) preview.style.display = 'none';
      var panel = document.getElementById('ticketPanel');
      var backdrop = document.getElementById('ticketMobileBackdrop');
      var toggleBtn = document.getElementById('ticketMobileToggle');
      // 先打开弹窗（如果还没打开）
      if (panel && !panel.classList.contains('sheet-open')) {
        panel.offsetHeight;
        panel.classList.add('sheet-open');
        if (backdrop) backdrop.classList.add('show');
        if (toggleBtn) toggleBtn.classList.add('hidden');
        document.body.style.overflow = 'hidden';
        panel.scrollTop = 0;
      }
      // 展开到全屏方便编辑
      if (panel && !panel.classList.contains('sheet-expanded')) {
        panel.classList.add('sheet-expanded');
      }
      // 面板打开后再生成预览
      _tkShowSheetPreview();
    } else {
      // 桌面端：上传区显示原始图片（但票根会显示在右侧预览区）
      if (preview && previewImg) {
        previewImg.src = _ticketImage;
        preview.style.display = 'block';
      }
    }
  }

  function _tkShowSheetPreview() {
    if (window.innerWidth > 768) return;
    var sheetPreview = document.getElementById('ticketSheetPreview');
    var sheetInner = document.getElementById('ticketSheetPreviewInner');
    if (!sheetPreview || !sheetInner || !ticketContainer || !ticketContainer.innerHTML) return;

    // 直接把 ticketContainer 的 HTML 内容复制到弹窗预览（左图+右文完整票根）
    sheetInner.innerHTML = ticketContainer.innerHTML;
    // 移除克隆元素的重复 id，避免 getElementById 冲突
    var clonedTicket = sheetInner.querySelector('#ticket');
    if (clonedTicket) clonedTicket.removeAttribute('id');
    sheetPreview.style.display = 'block';
  }

  window.regenerateTicketCode = function() {
    vibrate(8);
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', code = '';
    for (var i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    if (inputCode) inputCode.value = code;
    // 同时生成票号
    var nums = '0123456789', tno = 'T-';
    for (var j = 0; j < 8; j++) tno += nums.charAt(Math.floor(Math.random() * nums.length));
    if (inputTicketNo) inputTicketNo.value = tno;
    if (_ticketImage) _tkRender();
  };

  // 下载：离屏克隆(960×400 固定尺寸)，显式设置所有字号(px)确保与参考图一致
  /* ── 微信环境：长按保存图片（微信禁止 a.click() 下载）── */
  function _tkWechatSaveImage(canvas) {
    // 移除旧遮罩（如果存在）
    var old = document.getElementById('wechat-save-overlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'wechat-save-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';

    var imgWrapper = document.createElement('div');
    imgWrapper.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;max-width:95vw;max-height:75vh;overflow:hidden;border-radius:12px;';

    var img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.style.cssText = 'display:block;max-width:100%;max-height:75vh;object-fit:contain;border-radius:12px;';

    var hint = document.createElement('p');
    hint.style.cssText = 'color:#fff;font-size:16px;margin-top:20px;text-align:center;font-weight:500;line-height:1.6;';
    hint.textContent = '长按图片保存到相册';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ 关闭';
    closeBtn.style.cssText = 'margin-top:24px;padding:10px 40px;border:1px solid rgba(255,255,255,0.3);border-radius:24px;background:rgba(255,255,255,0.1);color:#fff;font-size:15px;cursor:pointer;';
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      overlay.remove();
    });

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });

    imgWrapper.appendChild(img);
    overlay.appendChild(imgWrapper);
    overlay.appendChild(hint);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);
  }

  window.downloadTicket = function() {
    if (!_ticketImage) { alert('请先上传照片'); return; }
    var el = document.getElementById('ticket');
    if (!el || !el.innerHTML) { alert('请先上传照片生成票根'); return; }
    vibrate(12);

    var clone = el.cloneNode(true);
    // 移除 layout 类，断开与响应式 CSS 的关联
    clone.classList.remove('layout-horizontal', 'layout-vertical', 'ticket-preview-clone');
    // clone 自身填满 wrapper，不设固定 px（由外层 wrapper 控制尺寸）
    clone.style.cssText = 'width:100%;height:100%;padding:0;margin:0;display:flex;flex-direction:row;overflow:hidden;background:transparent;border-radius:0;box-shadow:none;';

    // ── 外层 wrapper：强制 960×400 输出尺寸，裁剪一切溢出 ──
    var wrapper = document.createElement('div');
    wrapper.id = 'tk-render-wrapper';
    wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:960px;height:400px;overflow:hidden;background:#fff;z-index:-1;';
    wrapper.appendChild(clone);

    // ── photo 区域（左 71.43%）──
    var photo = clone.querySelector('.ticket-photo');
    if (photo) {
      photo.style.cssText = 'position:static;width:71.43%;height:400px;border-radius:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#1a1a1a;';
      var pImg = photo.querySelector('img');
      if (pImg) { pImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;'; }
    }

    // ── info 区域（右 28.57%）—— 显式设置每个子元素的 px 字号，匹配参考图 @ 960px 宽度 ──
    var info = clone.querySelector('.ticket-info');
    if (info) {
      // 保留下行内背景色
      var bgStyle = info.getAttribute('style') || '';
      info.style.cssText = 'position:relative;width:28.57%;height:400px;left:auto;right:auto;top:auto;bottom:auto;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;padding:24px 20px;' + bgStyle;
    }

    // 各文字元素：用 px 硬编码，对应 960px 设计宽度下 clamp 的计算值
    function setStyle(sel, css) {
      var n = clone.querySelector(sel);
      if (n) { var s = n.getAttribute('style') || ''; n.style.cssText = css + s; }
    }
    setStyle('.ticket-destination-en', 'font-size:33px;line-height:1.05;margin-bottom:6px;');
    setStyle('.ticket-destination-cn', 'font-size:14px;margin-bottom:16px;');
    setStyle('.ticket-divider', 'height:1px;background:rgba(255,255,255,0.25);margin:10px 0;');
    setStyle('.ticket-date', 'font-size:17px;margin-bottom:4px;');
    setStyle('.ticket-traveler', 'font-size:15px;');
    setStyle('.ticket-info-footer', 'text-align:left;');
    setStyle('.ticket-info-footer .ticket-divider', 'height:1px;background:rgba(255,255,255,0.25);margin:8px 0;');
    setStyle('.ticket-number', 'text-align:left;font-size:12px;');
    setStyle('.ticket-code', 'text-align:left;font-size:10px;margin-top:4px;');
    setStyle('.ticket-barcode', 'text-align:left;margin-top:auto;padding-top:8px;');
    var bcSvg = clone.querySelector('.ticket-barcode svg');
    if (bcSvg) bcSvg.setAttribute('height', '36');

    document.body.appendChild(wrapper);

    // 对 wrapper（而非 clone）渲染，确保输出严格 960×400
    html2canvas(wrapper, {
      width: 960,
      height: 400,
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#fff'
    }).then(function(canvas) {
      try { document.body.removeChild(wrapper); } catch(e) {}
      // 微信内置浏览器不支持 a.click() 下载，改为展示长按保存
      if (_tkIsWeChat) {
        _tkWechatSaveImage(canvas);
      } else {
        var a = document.createElement('a');
        a.download = 'travel-ticket.png';
        a.href = canvas.toDataURL('image/png');
        a.click();
      }
    }).catch(function(err) {
      try { document.body.removeChild(wrapper); } catch(e) {}
      console.error('票根下载失败:', err);
      alert('下载失败，请重试');
    });
  };

  window.resetTicketAll = function() {
    _ticketImage = null; _ticketColor = null;
    if (ticketEl) { ticketEl.innerHTML = ''; ticketEl.className = 'ticket'; }
    if (previewPlaceholder) previewPlaceholder.style.display = '';
    if (ticketContainer) ticketContainer.style.display = 'none';
    if (ticketEditorBlk) ticketEditorBlk.style.display = 'none';
    if (uploadZone) { uploadZone.style.opacity = '1'; uploadZone.style.display = ''; }
    if (fileInput) fileInput.value = '';
    // 重置上传区预览
    var content = document.getElementById('ticketUploadContent');
    var preview = document.getElementById('ticketUploadPreview');
    if (content) content.style.display = '';
    if (preview) preview.style.display = 'none';
    // 重置弹窗内票根预览
    var sheetPreview = document.getElementById('ticketSheetPreview');
    var sheetInner = document.getElementById('ticketSheetPreviewInner');
    if (sheetPreview) sheetPreview.style.display = 'none';
    if (sheetInner) sheetInner.innerHTML = '';
    regenerateTicketCode();
  };

  // ── 移动端弹窗打开/关闭时控制状态栏 + 导航栏 ──
  function lockBodyForSheet() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    // 阻止背景滚动穿透
    document.body.style.touchAction = 'none';
    // 微信下拉刷新 / 右滑返回防护
    document.body.style.overscrollBehavior = 'contain';
    // 隐藏导航栏
    var navbar = document.getElementById('navbar');
    if (navbar) navbar.classList.add('sheet-visible');
  }
  function unlockBodyForSheet() {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    document.body.style.overscrollBehavior = '';
    // 恢复导航栏
    var navbar = document.getElementById('navbar');
    if (navbar) navbar.classList.remove('sheet-visible');
  }

  // ── 弹窗拖拽展开/收起 ──
  var _sheetDragData = null;
  function initSheetDrag(panelId, backdropId, toggleId, pageClass) {
    var panel = document.getElementById(panelId);
    if (!panel) return;

    var handle = panel.querySelector('.sheet-drag-handle');
    if (!handle) return;

    handle.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      var touch = e.touches[0];
      _sheetDragData = {
        panel: panel,
        backdrop: document.getElementById(backdropId),
        toggle: document.getElementById(toggleId),
        pageEl: pageClass ? document.querySelector('.' + pageClass) : null,
        startY: touch.clientY,
        currentY: touch.clientY,
        isExpanded: panel.classList.contains('sheet-expanded'),
        isClosed: !panel.classList.contains('sheet-open'),
        delta: 0,
        origOverflow: panel.style.overflow || ''
      };
      panel.classList.add('dragging');
      panel.style.overflow = 'hidden';  // 拖拽时禁止内容滚动
      e.preventDefault();
    }, { passive: false });

    handle.addEventListener('touchmove', function(e) {
      if (!_sheetDragData || _sheetDragData.panel !== panel) return;
      var touch = e.touches[0];
      _sheetDragData.currentY = touch.clientY;
      _sheetDragData.delta = touch.clientY - _sheetDragData.startY;

      // 实时跟随手指
      if (_sheetDragData.isExpanded) {
        // 展开状态下，向下拖拽
        var shrinkPercent = Math.min(100, Math.max(0, _sheetDragData.delta / 3));
        var translate = shrinkPercent * 0.45;
        panel.style.transform = 'translateY(' + translate + '%)';
        panel.style.maxHeight = 'calc(100vh - ' + (8 + shrinkPercent * 0.08) + 'px)';
      } else if (!_sheetDragData.isClosed) {
        // 普通打开状态下
        if (_sheetDragData.delta < 0) {
          // 向上拖拽：放大
          var expandPercent = Math.min(100, Math.abs(_sheetDragData.delta) / 3);
          panel.style.transform = 'translateY(0)';
          panel.style.maxHeight = 'calc(100vh - ' + (8 - expandPercent * 0.08) + 'px)';
        } else {
          // 向下拖拽：关闭
          panel.style.transform = 'translateY(' + _sheetDragData.delta + 'px)';
        }
      }
    }, { passive: false });

    handle.addEventListener('touchend', function(e) {
      if (!_sheetDragData || _sheetDragData.panel !== panel) return;
      panel.classList.remove('dragging');

      var delta = _sheetDragData.delta;
      var isExpanded = _sheetDragData.isExpanded;
      var isClosed = _sheetDragData.isClosed;

      if (isClosed) {
        // 已经在关闭状态，不处理
        panel.style.overflow = _sheetDragData.origOverflow || '';  // 恢复滚动
        _sheetDragData = null;
        return;
      }

      if (isExpanded && delta > 60) {
        // 向下拖拽超过阈值 → 缩小到普通状态
        panel.classList.remove('sheet-expanded');
        panel.style.transform = 'translateY(0)';
        panel.style.maxHeight = '70vh';
        if (_sheetDragData.pageEl) _sheetDragData.pageEl.classList.remove('sheet-expanded-active');
      } else if (!isExpanded && delta < -70) {
        // 向上拖拽超过阈值 → 展开
        panel.classList.add('sheet-expanded');
        panel.style.transform = 'translateY(0)';
        panel.style.maxHeight = 'calc(100vh - 8px)';
        if (_sheetDragData.pageEl) _sheetDragData.pageEl.classList.add('sheet-expanded-active');
      } else if (!isExpanded && delta > 60) {
        // 向下拖拽超过阈值 → 关闭
        panel.classList.remove('sheet-open');
        panel.classList.remove('sheet-expanded');
        panel.style.transform = '';
        panel.style.maxHeight = '';
        if (_sheetDragData.backdrop) _sheetDragData.backdrop.classList.remove('show');
        if (_sheetDragData.toggle) _sheetDragData.toggle.classList.remove('hidden');
        if (_sheetDragData.pageEl) {
          _sheetDragData.pageEl.classList.remove('sheet-active');
          _sheetDragData.pageEl.classList.remove('sheet-expanded-active');
        }
        unlockBodyForSheet();
      } else {
        // 回弹
        panel.style.transform = 'translateY(0)';
        panel.style.maxHeight = isExpanded ? 'calc(100vh - 8px)' : '70vh';
      }

      panel.style.overflow = _sheetDragData.origOverflow || '';  // 恢复滚动
      _sheetDragData = null;
    });
  }

  // 移动端底部弹窗切换（旅行票根）
  window.toggleTicketMobileSheet = function() {
    var panel    = document.getElementById('ticketPanel');
    var backdrop = document.getElementById('ticketMobileBackdrop');
    var toggleBtn= document.getElementById('ticketMobileToggle');
    if (!panel || !backdrop) return;

    var isOpen = panel.classList.contains('sheet-open');

    if (isOpen) {
      // 取消可能正在进行的关闭 timer
      if (panel._closeTimer) {
        clearTimeout(panel._closeTimer);
        panel._closeTimer = null;
      }

      // 关闭：如果是全屏，先降到半屏，再降到底部
      if (panel.classList.contains('sheet-expanded')) {
        panel.classList.remove('sheet-expanded');
        // 等全屏→半屏动画完成（350ms），再关闭
        panel._closeTimer = setTimeout(function() {
          // 如果又被打开了，跳过
          if (panel.classList.contains('sheet-open')) return;
          panel.classList.remove('sheet-open');
          backdrop.classList.remove('show');
          if (toggleBtn) toggleBtn.classList.remove('hidden');
          document.body.style.overflow = '';
          panel._closeTimer = null;
        }, 380);
      } else {
        panel.classList.remove('sheet-open');
        backdrop.classList.remove('show');
        if (toggleBtn) toggleBtn.classList.remove('hidden');
        document.body.style.overflow = '';
      }
    } else {
      // 取消可能正在进行的关闭 timer
      if (panel._closeTimer) {
        clearTimeout(panel._closeTimer);
        panel._closeTimer = null;
      }

      // 打开（面板已常驻 body 下，直接 toggle class + rAF 确保动画）
      void panel.offsetHeight; // 触发回流
      requestAnimationFrame(function() {
        panel.classList.add('sheet-open');
        backdrop.classList.add('show');
        if (toggleBtn) toggleBtn.classList.add('hidden');
        document.body.style.overflow = 'hidden';
        panel.scrollTop = 0;
      });
    }
  };

  // 票根弹窗展开/收起（带动画）
  window.toggleTicketSheetExpand = function() {
    var panel = document.getElementById('ticketPanel');
    if (!panel || !panel.classList.contains('sheet-open')) return;
    panel.classList.toggle('sheet-expanded');
    panel.scrollTop = 0;
  };

  document.addEventListener('DOMContentLoaded', function() {
    initTicket();
    // 初始化弹窗拖拽（等待 DOM 就绪后绑定）
    initSheetDrag('ticketPanel', 'ticketMobileBackdrop', 'ticketMobileToggle', 'ticket-page');
  });

})();

