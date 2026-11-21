/**
 * LT 划词词典 · content script
 *
 * 划词 / 双击 → 浮出放大镜或直接查词 → 词典卡。
 * 面板可拖动、任意缩放、预设位置切换；支持段落翻译 + 重难点词；
 * 查询结果内可继续嵌套查词，并逐层返回（不限层数）。
 * 全部 UI 挂在 Shadow DOM 里，不和网页样式互相污染。
 */
(() => {
  'use strict';
  if (window.__ltLookupLoaded) return;
  window.__ltLookupLoaded = true;

  /* ---------------- 常量 ---------------- */
  const TAG_CN = { zk: '中考', gk: '高考', cet4: '四级', cet6: '六级', ky: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE' };
  const POS_CN = {
    n: '名词', v: '动词', adj: '形容词', adv: '副词', prep: '介词', conj: '连词', pron: '代词',
    num: '数词', art: '冠词', int: '感叹词', aux: '助动词', det: '限定词', abbr: '缩写',
    prefix: '前缀', suffix: '后缀', exclam: '感叹词', noun: '名词', verb: '动词',
    adjective: '形容词', adverb: '副词', preposition: '介词', conjunction: '连词',
    pronoun: '代词', determiner: '限定词', interjection: '感叹词', exclamation: '感叹词',
    phrase: '短语', 'modal verb': '情态动词', 'linking verb': '系动词',
    'auxiliary verb': '助动词', 'phrasal verb': '短语动词', 'combining form': '构词成分',
    'definite article': '定冠词', 'indefinite article': '不定冠词'
  };

  const CSS = `
  /* chip 必须压过面板：面板内划词时 chip 的坐标必然落在面板矩形里，
     两者同 z-index 时靠 DOM 顺序决胜（chip 已移到 panel 之后 append） */
  .lt-chip{position:fixed;z-index:2147483647;display:none;font:700 12px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
    color:#fff;background:#0f766e;border:none;border-radius:16px;padding:7px 13px;cursor:pointer;
    box-shadow:0 6px 18px rgba(15,118,110,.38);}
  .lt-chip.para{background:#7c3aed;box-shadow:0 6px 18px rgba(124,58,237,.35)}
  .lt-chip:hover{filter:brightness(1.08)}

  .lt-panel{position:fixed;left:0;top:0;width:410px;height:100vh;background:#fff;display:none;
    border:1px solid #e2e8f0;box-shadow:0 10px 40px rgba(15,23,42,.18);z-index:2147483647;
    flex-direction:column;font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
    color:#0f172a;text-align:left;box-sizing:border-box;min-width:300px;min-height:220px;
    animation:lt-in .14s ease-out}
  @keyframes lt-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  .lt-panel.open{display:flex}

  /* 拖动 / 缩放把手 */
  .lt-rz{position:absolute;z-index:5}
  .lt-rz.l{left:0;top:0;bottom:0;width:10px;cursor:col-resize}
  .lt-rz.r{right:0;top:0;bottom:0;width:10px;cursor:col-resize}
  .lt-rz.t{left:0;right:0;top:0;height:10px;cursor:row-resize}
  .lt-rz.b{left:0;right:0;bottom:0;height:10px;cursor:row-resize}
  .lt-rz.br{right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize}
  .lt-panel.lt-dragging{transition:none;opacity:.97;box-shadow:0 18px 55px rgba(15,23,42,.3)}
  .lt-rz.br::after{content:"";position:absolute;right:3px;bottom:3px;width:7px;height:7px;
    border-right:2px solid #94a3b8;border-bottom:2px solid #94a3b8}

  .lt-head{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;
    border-bottom:1px solid #e2e8f0;background:#f8fafc;flex-shrink:0;cursor:move;user-select:none}
  .lt-head-title{font-size:13px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:7px;min-width:0}
  .lt-head-title .lt-title-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lt-depth{font-size:10.5px;font-weight:600;color:#7c3aed;background:#f5f3ff;border-radius:9px;padding:1px 7px;white-space:nowrap}
  .lt-dot{width:7px;height:7px;border-radius:50%;background:#cbd5e1;display:inline-block;flex-shrink:0}
  .lt-dot.on{background:#10b981}.lt-dot.off{background:#ef4444}
  .lt-act{display:flex;gap:5px;flex-shrink:0}
  .lt-btn{width:24px;height:24px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;
    cursor:pointer;font-size:12px;color:#475569;line-height:1;padding:0;flex-shrink:0}
  .lt-btn:hover:not(:disabled){background:#f1f5f9}
  .lt-btn:disabled{opacity:.35;cursor:default}
  .lt-back{font-size:14px}
  .lt-btn.lt-pin.on{background:#fff1f2;border-color:#fb7185;color:#e11d48}
  .lt-panel.lt-pinned{border-color:#fb7185;box-shadow:0 10px 40px rgba(225,29,72,.22)}
  .lt-alpha{display:none;align-items:center;gap:9px;padding:7px 14px;background:#f8fafc;
    border-bottom:1px solid #e2e8f0;font-size:11.5px;color:#64748b;flex-shrink:0}
  .lt-alpha.open{display:flex}
  .lt-alpha input[type=range]{flex:1;height:4px;accent-color:#0f766e;cursor:pointer}
  .lt-alpha-val{min-width:36px;text-align:right;font-weight:700;color:#0f766e}
  .lt-body{flex:1;overflow-y:auto;padding:13px 15px 44px}
  .lt-loading{padding:22px 0;color:#94a3b8;font-size:13px}
  .lt-err{color:#dc2626;font-size:13px;line-height:1.8}

  .lt-hero-head{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
  .lt-word{font-family:Georgia,"Times New Roman",serif;font-size:26px;font-weight:700;color:#0f172a;line-height:1.2}
  .lt-chips{display:inline-flex;gap:4px;flex-wrap:wrap}
  .lt-tag{font-style:normal;font-size:10.5px;font-weight:700;color:#b45309;background:#fef3c7;
    border-radius:4px;padding:1px 6px;white-space:nowrap}
  .lt-prons{display:flex;gap:16px;flex-wrap:wrap;margin-top:9px;align-items:center}
  .lt-pron{display:inline-flex;align-items:center;gap:5px}
  .lt-ptag{font-style:normal;font-size:10.5px;font-weight:700;color:#fff;border-radius:4px;padding:1px 5px;background:#94a3b8}
  .lt-pron:first-child .lt-ptag{background:#0f766e}
  .lt-pron:nth-child(2) .lt-ptag{background:#2563eb}
  .lt-ipa{font-family:"Lucida Sans Unicode",sans-serif;font-size:14px;font-weight:600;color:#334155}
  .lt-spk{width:20px;height:20px;border:1px solid #cbd5e1;background:#fff;border-radius:50%;
    cursor:pointer;font-size:10px;line-height:1;padding:0}
  .lt-spk:hover{background:#ecfdf5;border-color:#5eead4}
  .lt-src{font-size:11px;color:#94a3b8;margin-left:auto}
  .lt-posrow{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
  .lt-pos{position:relative;display:inline-flex;align-items:center;gap:5px;font-size:11.5px;
    background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:2px 10px;overflow:hidden}
  .lt-pos b{color:#0f766e;font-weight:700}
  .lt-pos em{font-style:normal;color:#64748b}
  .lt-pos i{position:absolute;left:0;bottom:0;height:2px;background:#5eead4}
  .lt-pos u{text-decoration:none;font-size:10px;color:#94a3b8}
  .lt-pos-form{background:#f0f9ff;border-color:#bae6fd}
  .lt-pos-form b{color:#0369a1}
  .lt-defs{margin-top:11px}
  .lt-def{display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border-radius:6px;
    background:#f8fafc;margin-bottom:6px;font-size:13.5px;line-height:1.75}
  .lt-def-pos{flex-shrink:0;font-family:Georgia,serif;font-weight:700;color:#0f766e;min-width:26px}
  .lt-ex{margin-top:11px;border-top:1px dashed #e2e8f0;padding-top:8px}
  .lt-ex-label{font-size:11px;font-weight:700;color:#94a3b8;margin-bottom:4px}
  .lt-ex ul{margin:0;padding-left:16px;font-size:12.5px;color:#475569;line-height:1.75}
  .lt-ex li{margin-bottom:3px}
  .lt-ex-zh{color:#0f766e}
  .lt-auth{margin-top:14px;border-top:1.5px dashed #cbd5e1;padding-top:10px}
  .lt-auth-title{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .lt-auth-sub{font-size:11px;font-weight:500;color:#94a3b8}
  .lt-srcbox{border:1px solid #e2e8f0;border-left-width:3px;border-radius:8px;margin-bottom:8px;background:#fff;overflow:hidden}
  .lt-srcbox[data-src="oald10"]{border-left-color:#0f766e}
  .lt-srcbox[data-src="ldoce6"]{border-left-color:#2563eb}
  .lt-srcbox[data-src="macmillan"]{border-left-color:#d97706}
  .lt-srcbox[data-src="macmillan-thes"]{border-left-color:#7c3aed}
  .lt-src-head{display:flex;align-items:center;gap:7px;padding:7px 10px;cursor:pointer;
    background:#f8fafc;border-bottom:1px solid #eef2f7;user-select:none}
  .lt-srcbox:not(.open) .lt-src-head{border-bottom:none}
  .lt-srcbox:not(.open) .lt-src-body{display:none}
  .lt-badge{font-size:10.5px;font-weight:700;color:#0f766e;background:#ccfbf1;border-radius:5px;padding:2px 7px;white-space:nowrap}
  .lt-src-phon{font-family:"Lucida Sans Unicode",sans-serif;font-size:11.5px;color:#475569}
  .lt-src-pos{font-size:11px;color:#64748b}
  .lt-src-meta{font-size:10.5px;color:#94a3b8;margin-left:auto}
  .lt-caret{font-size:9px;color:#94a3b8;transition:transform .18s}
  .lt-srcbox:not(.open) .lt-caret{transform:rotate(-90deg)}
  .lt-src-body{padding:6px 12px 10px}
  .lt-src-body ol{margin:2px 0 0;padding-left:18px;font-size:12.5px;line-height:1.75;color:#1e293b}
  .lt-src-body li{margin-bottom:5px}
  .lt-zh{color:#0f766e;font-size:12px}
  .lt-extra{margin-top:8px;border-top:1px dashed #e2e8f0;padding-top:7px}
  .lt-extra-row{display:flex;gap:7px;align-items:flex-start;margin-bottom:5px}
  .lt-extra-label{flex-shrink:0;font-size:10.5px;font-weight:700;color:#64748b;background:#f1f5f9;
    border-radius:4px;padding:1px 6px;white-space:nowrap}
  .lt-extra-chips{display:flex;flex-wrap:wrap;gap:4px}
  .lt-echip{font-size:11.5px;color:#0f766e;background:#f0fdfa;border:1px solid #ccfbf1;border-radius:4px;padding:1px 6px}
  .lt-echip.ant{color:#be123c;background:#fff1f2;border-color:#fecdd3}
  .lt-echip.col{color:#7c3aed;background:#f5f3ff;border-color:#ddd6fe}
  .lt-disc{font-size:11.5px;color:#475569;background:#f8fafc;border-left:3px solid #cbd5e1;
    border-radius:0 4px 4px 0;padding:6px 9px;margin-top:5px;line-height:1.7}
  .lt-redirect{font-size:11.5px;color:#b45309;background:#fffbeb;border-left:3px solid #f59e0b;
    border-radius:4px;padding:5px 8px;margin-bottom:7px;line-height:1.6}
  .lt-redirect button{font-size:11.5px;font-weight:700;color:#0f766e;background:none;border:none;
    padding:0;cursor:pointer;text-decoration:underline}

  /* 段落分析结果 */
  .lt-para-label{font-size:11px;font-weight:700;color:#94a3b8;margin:12px 0 5px;display:flex;gap:8px;align-items:center}
  .lt-para-label span{font-weight:500;color:#a78bfa}
  .lt-para-text{font-size:13px;line-height:1.85;color:#334155;background:#f8fafc;border-radius:7px;padding:9px 11px}
  .lt-para-trans{font-size:14px;line-height:1.9;color:#0f172a;background:#f5f3ff;border-left:3px solid #7c3aed;
    border-radius:0 7px 7px 0;padding:9px 12px}
  .lt-para-warn{font-size:11.5px;color:#b45309;background:#fffbeb;border-radius:6px;padding:6px 9px;margin-top:6px}
  .lt-hard{display:flex;gap:7px;align-items:flex-start;flex-wrap:wrap;padding:8px 0;border-bottom:1px dashed #e2e8f0}
  .lt-hard-w{font-family:Georgia,serif;font-size:15px;font-weight:700;color:#0f766e;background:none;border:none;
    padding:0;cursor:pointer;text-decoration:underline dotted #5eead4;text-underline-offset:3px}
  .lt-hard-w:hover{color:#0d9488}
  .lt-lvl{font-size:10px;font-weight:700;color:#fff;background:#94a3b8;border-radius:4px;padding:1px 5px}
  .lt-lvl.C1{background:#d97706}.lt-lvl.C2,.lt-lvl["off-list"]{background:#be123c}.lt-lvl.B2{background:#0f766e}
  .lt-score{font-size:10px;color:#94a3b8;background:#f1f5f9;border-radius:8px;padding:1px 6px}
  .lt-hard-why{flex-basis:100%;font-size:11px;color:#94a3b8;line-height:1.5}
  .lt-hard-zh{flex-basis:100%;font-size:12px;color:#475569}
  `;

  /* ---------------- DOM ---------------- */
  let host, shadow, chip, panel, bodyEl, dotEl, titleEl, depthEl, backBtn, pinBtn, alphaRow, alphaRange, alphaVal;
  let pinned = false;              // 图钉：锁定当前结果与面板位置
  let alpha = 100;                 // 面板透明度（35~100）
  let geom = { left: null, top: null, width: 410, height: null };
  let presetIdx = -1;
  let historyStack = [];           // [{kind, key, html, scrollTop}]
  let currentView = null;          // {kind, key, html}
  let autoCloseTimer = null;       // 空闲自动关闭定时器
  let panelHovered = false;        // 鼠标是否在结果面板内
  const AUTO_CLOSE_MS = 2500;      // 结果显示后，鼠标未进入面板则自动关闭

  const PRESETS = [
    () => ({ left: window.innerWidth - 410, top: 20, width: 410, height: window.innerHeight - 40 }), // 右侧
    () => ({ left: 0, top: 20, width: 410, height: window.innerHeight - 40 }),                        // 左侧
    () => ({ left: 0, top: Math.max(0, window.innerHeight - 440), width: window.innerWidth, height: 440 }), // 底部
    () => ({ left: 0, top: 0, width: window.innerWidth, height: 380 }),                          // 顶部
    () => ({ left: Math.max(8, Math.round((window.innerWidth - 640) / 2)), top: Math.max(8, Math.round((window.innerHeight - 540) / 2)), width: 640, height: 540 }), // 居中
  ];

  function ensureUI() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('div');
    host.id = 'lt-lookup-host';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;

    chip = document.createElement('button');
    chip.className = 'lt-chip';
    chip.type = 'button';

    panel = document.createElement('aside');
    panel.className = 'lt-panel';
    panel.innerHTML = `
      <div class="lt-head">
        <span class="lt-head-title">
          <button class="lt-btn lt-back" data-act="back" title="返回上一个查询结果" disabled>←</button>
          <i class="lt-dot"></i>
          <span class="lt-title-text">划词词典</span>
          <span class="lt-depth" style="display:none"></span>
        </span>
        <span class="lt-act">
          <button class="lt-btn lt-pin" data-act="pin" title="固定当前结果与位置（点一下变色，再点解除）">📌</button>
          <button class="lt-btn" data-act="alpha" title="背景透明度">◐</button>
          <button class="lt-btn" data-act="pos" title="切换预设位置">⇋</button>
          <button class="lt-btn" data-act="close" title="关闭（Esc）">✕</button>
        </span>
      </div>
      <div class="lt-alpha">
        <span>背景透明度</span>
        <input type="range" min="35" max="100" step="1" value="100">
        <span class="lt-alpha-val">100%</span>
      </div>
      <div class="lt-rz l" data-rz="l"></div>
      <div class="lt-rz r" data-rz="r"></div>
      <div class="lt-rz t" data-rz="t"></div>
      <div class="lt-rz b" data-rz="b"></div>
      <div class="lt-rz br" data-rz="br"></div>
      <div class="lt-body"><div class="lt-loading">划词、双击单词，或选中一段英文</div></div>`;
    bodyEl = panel.querySelector('.lt-body');
    dotEl = panel.querySelector('.lt-dot');
    titleEl = panel.querySelector('.lt-title-text');
    depthEl = panel.querySelector('.lt-depth');
    backBtn = panel.querySelector('[data-act="back"]');
    pinBtn = panel.querySelector('[data-act="pin"]');
    alphaRow = panel.querySelector('.lt-alpha');
    alphaRange = alphaRow.querySelector('input[type=range]');
    alphaVal = alphaRow.querySelector('.lt-alpha-val');
    alphaRange.addEventListener('input', (e) => applyAlpha(e.target.value));

    // 顺序决定叠放：chip 在 panel 之后 append，配合同值 z-index 保证放大镜不被面板盖住
    shadow.append(style, panel, chip);
    (document.body || document.documentElement).appendChild(host);

    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('mousedown', onPanelMouseDown);
    // 空闲自动关闭：鼠标进入面板取消计时，离开后若仍开着则重新计时
    panel.addEventListener('mouseenter', () => { panelHovered = true; clearTimeout(autoCloseTimer); });
    panel.addEventListener('mouseleave', () => { panelHovered = false; scheduleAutoClose(); });
    bodyEl.addEventListener('mouseup', onBodyMouseUp);
    bodyEl.addEventListener('mousedown', () => hideChip());
    bodyEl.addEventListener('dblclick', onBodyDblClick);

    chip.addEventListener('mousedown', (e) => e.preventDefault());
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = chip.dataset.text || '';
      const kind = chip.dataset.kind || 'word';
      hideChip();
      if (text) navigate(kind, text);
    });

    // 恢复上次的位置 / 尺寸
    try {
      chrome.storage.local.get(['ltGeom', 'ltPreset', 'ltPinned', 'ltAlpha'], (r) => {
        if (r && r.ltGeom && typeof r.ltGeom === 'object') geom = Object.assign(geom, r.ltGeom);
        if (r && typeof r.ltPreset === 'number') presetIdx = r.ltPreset;
        if (r && typeof r.ltAlpha === 'number') applyAlpha(r.ltAlpha);
        if (r && r.ltPinned) setPinned(true);
        applyGeom();
      });
    } catch { /* ignore */ }
    applyGeom();
    window.addEventListener('resize', applyGeom);
  }

  /* ---------------- 位置 / 缩放 ---------------- */
  function applyGeom() {
    if (!panel) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.max(300, Math.min(geom.width || 410, vw - 16));
    const h = Math.max(220, Math.min(geom.height || vh - 40, vh));
    let l = geom.left, t = geom.top;
    if (l == null || t == null) {
      const p = PRESETS[Math.max(0, presetIdx)](  );
      l = p.left; t = p.top;
      geom.width = p.width; geom.height = p.height;
    }
    l = Math.max(-w + 120, Math.min(l, vw - 120));
    t = Math.max(-h + 80, Math.min(t, vh - 80));
    panel.style.left = l + 'px';
    panel.style.top = t + 'px';
    panel.style.width = w + 'px';
    panel.style.height = h + 'px';
  }

  function saveGeom() {
    try { chrome.storage.local.set({ ltGeom: geom, ltPreset: presetIdx }); } catch { /* ignore */ }
  }

  /* ---------------- 图钉 / 透明度 ---------------- */
  function setPinned(on) {
    pinned = !!on;
    if (pinBtn) {
      pinBtn.classList.toggle('on', pinned);
      pinBtn.title = pinned ? '已固定：结果与位置锁定，点此解除' : '固定当前结果与位置';
    }
    if (panel) panel.classList.toggle('lt-pinned', pinned);
    // 图钉联动空闲关闭：钉住→取消自动关；解除→若面板还开着则重新计时
    if (pinned) clearTimeout(autoCloseTimer);
    else if (panel && panel.classList.contains('open')) scheduleAutoClose();
    try { chrome.storage.local.set({ ltPinned: pinned }); } catch { /* ignore */ }
  }

  function notifyPinned() {
    if (!titleEl) return;
    const old = titleEl.textContent;
    titleEl.textContent = '📌 已固定，先点图钉解除';
    setTimeout(() => { if (titleEl) titleEl.textContent = old; }, 1600);
  }

  function applyAlpha(v) {
    alpha = Math.max(35, Math.min(100, Number(v) || 100));
    if (panel) panel.style.opacity = String(alpha / 100);
    if (alphaRange) alphaRange.value = String(alpha);
    if (alphaVal) alphaVal.textContent = alpha + '%';
    try { chrome.storage.local.set({ ltAlpha: alpha }); } catch { /* ignore */ }
  }

  function onPanelMouseDown(e) {
    if (pinned) return;              // 固定后不允许拖动 / 缩放
    if (e.button !== 0) return;
    const rz = e.target.closest && e.target.closest('[data-rz]');
    const head = e.target.closest && e.target.closest('.lt-head');
    // 标题栏上的按钮交给 click 处理，不当作拖拽起点
    if (!rz && e.target.closest && e.target.closest('button')) return;
    if (!rz && !head) return;
    e.preventDefault();
    e.stopPropagation();

    const mode = rz ? rz.dataset.rz : 'move';
    // 用 getBoundingClientRect 取视口坐标；fixed 元素的 offsetLeft 在某些页面里不可靠
    const rect = panel.getBoundingClientRect();
    const s = { x: e.clientX, y: e.clientY, l: rect.left, t: rect.top, w: rect.width, h: rect.height };
    panel.classList.add('lt-dragging');
    const onMove = (ev) => {
      const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
      if (mode === 'move') { geom.left = s.l + dx; geom.top = s.t + dy; }
      else if (mode === 'l') { geom.left = s.l + dx; geom.width = s.w - dx; }
      else if (mode === 'r') { geom.width = s.w + dx; }
      else if (mode === 't') { geom.top = s.t + dy; geom.height = s.h - dy; }
      else if (mode === 'b') { geom.height = s.h + dy; }
      else if (mode === 'br') { geom.width = s.w + dx; geom.height = s.h + dy; }
      geom.width = Math.max(300, Math.min(geom.width, window.innerWidth));
      geom.height = Math.max(220, Math.min(geom.height, window.innerHeight));
      presetIdx = -1;
      applyGeom();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      panel.classList.remove('lt-dragging');
      document.body.style.userSelect = '';
      saveGeom();
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onPanelClick(e) {
    const btn = e.target.closest('[data-act]');
    if (btn) {
      const act = btn.dataset.act;
      if (act === 'close') panel.classList.remove('open');
      if (act === 'back') goBack();
      if (act === 'pin') setPinned(!pinned);
      if (act === 'alpha') alphaRow.classList.toggle('open');
      if (act === 'pos') {
        if (pinned) { notifyPinned(); return; }
        presetIdx = (presetIdx + 1) % PRESETS.length;
        geom = Object.assign({}, PRESETS[presetIdx]());
        applyGeom();
        saveGeom();
      }
      return;
    }
    const lk = e.target.closest('[data-lookup]');
    if (lk && lk.dataset.lookup) {
      navigate('word', lk.dataset.lookup);
      return;
    }
    const say = e.target.closest('[data-say]');
    if (say) {
      speak(say.dataset.say, say.dataset.lang || 'en-US');
      return;
    }
    const head = e.target.closest('.lt-src-head');
    if (head) head.parentElement.classList.toggle('open');
  }

  function speak(word, lang) {
    try {
      const u = new SpeechSynthesisUtterance(word);
      u.lang = lang;
      u.rate = 0.95;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  /* ---------------- 划词 / 双击 ---------------- */
  function showChip(x, y, text, kind) {
    ensureUI();
    const para = kind === 'paragraph';
    chip.className = 'lt-chip' + (para ? ' para' : '');
    chip.textContent = para
      ? '🌐 翻译 + 难点词'
      : '🔍 查 “' + (text.length > 18 ? text.slice(0, 18) + '…' : text) + '”';
    chip.dataset.text = text;
    chip.dataset.kind = kind || 'word';
    chip.style.left = Math.max(8, Math.min(x, window.innerWidth - 180)) + 'px';
    chip.style.top = Math.max(8, Math.min(y + 8, window.innerHeight - 42)) + 'px';
    chip.style.display = 'block';
  }

  function hideChip() {
    if (chip) chip.style.display = 'none';
  }

  function validWord(text) {
    return !!(text && /^[A-Za-z][A-Za-z'\-]*$/.test(text));
  }

  function isParagraph(text) {
    return text.length > 60 || text.trim().split(/\s+/).length > 4;
  }

  /**
   * 取真实选区。
   * 【2026-11-19 二次修复·根因】Shadow DOM 内 `window.getSelection()` / `document.getSelection()`
   * 拿到的是被 retarget 到文档层的空选区（isCollapsed=true，anchor 落在 HTML 上），
   * 真实选区只有 Chrome 的 `ShadowRoot.getSelection()` 能拿到。
   * 实测同一时刻：shadow → collapsed:false 且几何正确；window → collapsed:true。
   */
  function selectionFor(root) {
    if (root && typeof root.getSelection === 'function') {
      try {
        const s = root.getSelection();
        if (s) return s;
      } catch { /* ignore */ }
    }
    return window.getSelection();
  }

  // 从文本 + 偏移抠出所在的英文词
  function wordAtText(s, offset) {
    if (!s) return '';
    let a = Math.max(0, Math.min(offset, s.length)), b = a;
    while (a > 0 && /[A-Za-z'\-]/.test(s[a - 1])) a--;
    while (b < s.length && /[A-Za-z'\-]/.test(s[b])) b++;
    return s.slice(a, b).trim();
  }

  function wordAtRange(range) {
    if (!range || !range.startContainer || range.startContainer.nodeType !== 3) return '';
    return wordAtText(range.startContainer.textContent || '', range.startOffset);
  }

  // 从选区里取词（双击时浏览器已把整词选中）
  function wordFromSelection(sel) {
    if (!sel || sel.isCollapsed || !sel.rangeCount) return '';

    // ① 选区里只有一个英文词 → 直接用它。
    //    不能先看 focusOffset：双击选中的是 "quick "（带尾随空格），焦点常停在下一个词
    //    首字母上，按 offset 向前/后扩会取成 "brown"（实测踩到过）。
    const words = (String(sel).trim().match(/[A-Za-z][A-Za-z'\-]*/g) || []);
    if (words.length === 1) return words[0];

    // ② 跨多个词（拖选）→ 用光标端定位
    const fn = sel.focusNode, fo = sel.focusOffset;
    if (fn && fn.nodeType === 3) {
      const w = wordAtText(fn.textContent || '', fo);
      if (validWord(w)) return w;
    }
    if (words.length) return words[0];
    try { return wordAtRange(sel.getRangeAt(0)); } catch { return ''; }
  }

  /*
   * 跨节点拼词：不少页面把单词拆在多个内联节点里（逐字母 span、分词 span、ruby 注音）。
   * 只取单个文本节点会得到 "w"、"ab" 这种片段，必须按相邻节点的字母连续性补全。
   * 注音 <rt> 要跳过，否则会把音标拼进单词。
   */
  function siblingTextNode(node, dir) {
    let base = node;
    let n = dir < 0 ? base.previousSibling : base.nextSibling;

    // 文本节点自己没兄弟时，向上借父元素这一层：
    // 逐字母 <span>d</span><span>e</span> 里，文本的兄弟是 null，真正的邻居在父级。
    // 只允许跨内联父级，避免把相邻段落的词拼进来。
    if (!n && base.parentElement) {
      const pe = base.parentElement;
      let inline = false;
      try { inline = /^inline/.test(getComputedStyle(pe).display || ''); } catch { /* ignore */ }
      if (inline) {
        base = pe;
        n = dir < 0 ? base.previousSibling : base.nextSibling;
      }
    }

    while (n) {
      if (n.nodeType === 3) return n;
      if (n.nodeType === 1 && n.tagName !== 'RT' && n.tagName !== 'RP') {
        const t = edgeTextNode(n, dir);
        if (t) return t;
      }
      n = dir < 0 ? n.previousSibling : n.nextSibling;
    }
    return null;
  }

  function edgeTextNode(el, dir) {
    let n = dir < 0 ? el.lastChild : el.firstChild;
    while (n) {
      if (n.nodeType === 3) return n;
      if (n.nodeType === 1) {
        if (n.tagName !== 'RT' && n.tagName !== 'RP') {
          const t = edgeTextNode(n, dir);
          if (t) return t;
        }
      }
      n = dir < 0 ? n.previousSibling : n.nextSibling;
    }
    return null;
  }

  function expandWordAcrossNodes(node, start, end) {
    const isW = (c) => !!c && /[A-Za-z'\-]/.test(c);
    const s = node.nodeValue || '';
    let word = s.slice(start, end);

    if (start === 0) {                       // 词头被节点边界截断 → 向左补
      let prev = siblingTextNode(node, -1);
      while (prev) {
        const ps = prev.nodeValue || '';
        if (!ps) { prev = siblingTextNode(prev, -1); continue; }
        if (!isW(ps[ps.length - 1])) break;
        let i = ps.length;
        while (i > 0 && isW(ps[i - 1])) i--;
        word = ps.slice(i) + word;
        if (i > 0) break;
        prev = siblingTextNode(prev, -1);
      }
    }
    if (end === s.length) {                  // 词尾被节点边界截断 → 向右补
      let next = siblingTextNode(node, 1);
      while (next) {
        const ns = next.nodeValue || '';
        if (!ns) { next = siblingTextNode(next, 1); continue; }
        if (!isW(ns[0])) break;
        let i = 0;
        while (i < ns.length && isW(ns[i])) i++;
        word += ns.slice(0, i);
        if (i < ns.length) break;
        next = siblingTextNode(next, 1);
      }
    }
    return word;
  }

  /**
   * 点位是否落在面板的音标 / 词性 / 级别等标签上。
   * 这些位置的文字（/t/、n.、B2、难度 7）不是正文词，双击不该触发查词。
   */
  function isLabelHit(x, y, root) {
    let el = null;
    try {
      el = (root && typeof root.elementFromPoint === 'function') ? root.elementFromPoint(x, y) : null;
    } catch { return false; }
    return !!(el && el.closest && el.closest('.lt-head, .lt-ipa, .lt-ptag, .lt-pos, .lt-def-pos, .lt-lvl, .lt-score, .lt-tag, .lt-depth, .lt-src, .lt-src-meta, .lt-caret'));
  }

  /**
   * 几何取词：按「词的矩形」命中点击坐标。
   * 【2026-11-19 三次修复·根因】双击落在词尾 1~2px 时浏览器根本不选词（选区 collapsed），
   * `caretRangeFromPoint` 的插入点已经落到下一个词的首字母，再按字符扩词必然查成下一个词。
   * 字符偏移这条路天生不可靠（左缘/右缘/标点各偏一次），只有矩形命中没有歧义。
   */
  function wordAtPoint(x, y, root) {
    let el = null;
    try {
      el = (root && typeof root.elementFromPoint === 'function')
        ? root.elementFromPoint(x, y)
        : document.elementFromPoint(x, y);
    } catch { return ''; }
    if (!el) return '';
    // 面板里的音标 / 词性 / 级别 / 难度等标签不是正文词，双击它们不该查出一个字母
    if (el.closest && el.closest('.lt-head, .lt-ipa, .lt-ptag, .lt-pos, .lt-def-pos, .lt-lvl, .lt-score, .lt-tag, .lt-depth, .lt-src, .lt-src-meta, .lt-caret')) return '';

    // 从命中元素向上最多 4 层：覆盖 <b>bold</b>、<a>linked</a>、逐词 span 等内联包裹
    for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
      if (el === document.body || el === document.documentElement) break;
      const w = findWordInElement(el, x, y);
      if (w) return w;
      // 已经扫到段落级大文本块仍没命中，说明点确实不在词上，别再向上扫整页
      if ((el.textContent || '').length > 120) break;
    }
    return '';
  }

  function findWordInElement(el, x, y) {
    if (!el || !el.childNodes || !el.childNodes.length) return '';
    let best = '', bestDist = Infinity;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && (node.parentElement.tagName === 'RT' || node.parentElement.tagName === 'RP')) continue;
      const s = node.nodeValue || '';
      if (!/[A-Za-z]/.test(s)) continue;
      const re = /[A-Za-z][A-Za-z'\-]*/g;
      let m;
      while ((m = re.exec(s))) {
        const r = document.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        const b = r.getBoundingClientRect();
        if (!b.width && !b.height) continue;
        // 命中（1px 容差，词尾最后 1px 也算词内）
        if (y >= b.top - 1 && y <= b.bottom + 1 && x >= b.left - 1 && x <= b.right + 1) {
          return expandWordAcrossNodes(node, m.index, m.index + m[0].length);
        }
        // 同一行的最近词：双击落在词间空格时取邻近词，别甩到下一行
        if (y >= b.top && y <= b.bottom) {
          const d = x < b.left ? b.left - x : (x > b.right ? x - b.right : 0);
          if (d < bestDist) { bestDist = d; best = expandWordAcrossNodes(node, m.index, m.index + m[0].length); }
        }
      }
    }
    return bestDist <= 6 ? best : '';
  }

  /**
   * 从事件位置取词。root 传 shadow 时按 shadow 选区解析。
   * 【2026-11-19 二次修复】`document.caretRangeFromPoint()` 不穿透 Shadow DOM，
   * 面板内返回的是 HTML 元素（nodeType=1），caret 只对网页正文有效。
   * 【2026-11-19 三次修复】取词顺序改为「几何命中 → 选区 → caret」：
   * 双击词尾时选区是空的、caret 又偏到下一词，只有逐词矩形命中能稳定取对。
   */
  function pickWordFromEvent(e, root) {
    const inShadow = !!(root && root !== document && root !== window);

    // 面板的音标 / 词性 / 级别标签不是正文词：几何和选区兜底都必须停手，
    // 否则双击音标 /t/ 会被选区兜底查出 "t"（实测踩到过）
    if (inShadow && isLabelHit(e.clientX, e.clientY, root)) return '';

    // ① 几何命中（不受选区是否就位、caret 落在词边界哪一侧影响）
    const byPoint = wordAtPoint(e.clientX, e.clientY, root);
    if (byPoint) return byPoint;

    // ② 选区兜底（shadow 内用 ShadowRoot.getSelection，document 层会被 retarget 成空选区）
    //    选区还必须离点击点足够近：浏览器可能把相邻词选进来，无条件信它会跳词
    const sel = selectionFor(root);
    const fromSel = wordFromSelection(sel);
    if (fromSel) {
      let near = true;
      try {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
        const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        near = dx <= 12 && dy <= 12;
      } catch { /* 取不到几何就按"近"处理 */ }
      if (near) return fromSel;
    }

    // ③ 只有网页正文才用光标定位兜底；shadow 内 document 的 caret 不可信
    if (inShadow) return '';
    try {
      let range = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(e.clientX, e.clientY);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
        }
      }
      return wordAtRange(range);
    } catch { return ''; }
  }

  document.addEventListener('mouseup', (e) => {
    if (host && e.composedPath && e.composedPath().includes(host)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text || !/[A-Za-z]/.test(text)) return;
    // 【2026-11-19 二次修复】原判定 `!para && !validWord(text)` 会把 2~4 词的短语直接丢弃
    // （validWord 只认单个词），导致网页上划短语永远不弹放大镜；现与面板内判定统一。
    const para = isParagraph(text);
    try {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      showChip(rect.left + rect.width / 2 - 70, rect.bottom + 6, text, para ? 'paragraph' : 'word');
    } catch { /* ignore */ }
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (host && e.composedPath && e.composedPath().includes(host)) return;
    hideChip();
  }, true);

  // 双击网页正文：直接查词，不用再点放大镜
  document.addEventListener('dblclick', (e) => {
    if (host && e.composedPath && e.composedPath().includes(host)) return;
    const w = pickWordFromEvent(e, document);
    if (w) {
      hideChip();
      navigate('word', w);
    }
  }, true);

  // 查询结果内部：双击继续查词
  function onBodyDblClick(e) {
    const w = pickWordFromEvent(e, shadow);
    if (w) {
      hideChip();          // 双击已直接查词，别让划词放大镜残留
      navigate('word', w);
    }
  }

  // 查询结果内部：划词显示放大镜（可以继续查 / 翻译段落）
  // 【2026-11-19 二次修复】选区必须走 shadowRoot.getSelection()：
  // window.getSelection() 在 panel 内返回的是 collapsed 的假选区，原实现在第一行就 return 了。
  function onBodyMouseUp(e) {
    const sel = selectionFor(shadow);
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text || !/[A-Za-z]/.test(text)) return;   // 纯中文/符号不弹
    const para = isParagraph(text);
    try {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      showChip(rect.left + rect.width / 2 - 70, rect.bottom + 6, text, para ? 'paragraph' : 'word');
    } catch { /* ignore */ }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideChip();
      if (panel) panel.classList.remove('open');
    }
  }, true);

  /* ---------------- 网络请求 ---------------- */
  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, error: '无响应' });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }
  const requestLookup = (word) => sendMessage({ type: 'lookup', word });
  const requestAnalyze = (text) => sendMessage({ type: 'analyze', text, translate: true });

  /* ---------------- 历史栈 / 导航 ---------------- */
  function updateNav() {
    if (!backBtn) return;
    backBtn.disabled = historyStack.length === 0;
    if (historyStack.length) {
      depthEl.style.display = '';
      depthEl.textContent = historyStack.length + ' 层';
      titleEl.textContent = currentView && currentView.kind === 'paragraph' ? '段落分析' : '划词词典';
    } else {
      depthEl.style.display = 'none';
      titleEl.textContent = currentView && currentView.kind === 'paragraph' ? '段落分析' : '划词词典';
    }
  }

  async function navigate(kind, rawText) {
    ensureUI();
    hideChip();                              // 任何新查询都先收起划词放大镜，避免残留
    if (pinned) { notifyPinned(); return; }   // 固定后新查询不覆盖当前结果
    const text = String(rawText || '').trim();
    if (!text) return;
    const key = kind === 'word'
      ? text.toLowerCase().replace(/[^a-z'\- ]/g, ' ').replace(/\s+/g, ' ').trim()
      : text;
    if (!key) return;

    if (currentView) {
      historyStack.push({
        kind: currentView.kind, key: currentView.key,
        html: currentView.html, scrollTop: bodyEl.scrollTop
      });
    }
    panel.classList.add('open');
    bodyEl.innerHTML = '<div class="lt-loading">⏳ ' + (kind === 'paragraph' ? '正在翻译并分析难点词…' : '正在查词…') + '</div>';
    bodyEl.scrollTop = 0;
    updateNav();

    let html;
    if (kind === 'paragraph') {
      const res = await requestAnalyze(key);
      html = renderParagraph(res, key);
    } else {
      const res = await requestLookup(key);
      if (!res.ok) {
        html = errorHtml(res.error || '');
      } else {
        const entry = res.entry ? buildEntry(res.entry, key) : null;
        const auth = res.auth;
        if (!entry && !auth) {
          html = `<div class="lt-err">❌ 没查到 “${esc(key)}”，试试原形或检查拼写。</div>`;
        } else {
          html = renderCard(entry, auth, key);
          dotEl.className = 'lt-dot on';
        }
      }
    }

    currentView = { kind, key, html };
    bodyEl.innerHTML = html;
    bodyEl.scrollTop = 0;
    updateNav();
    scheduleAutoClose();
  }

  /**
   * 空闲自动关闭（2026-11-19）：查完结果后若鼠标没进入面板，AUTO_CLOSE_MS 后自动收起，
   * 避免面板一直挡着网页。图钉固定时永不自动关。
   * 【2026-11-19 二次修复·根因】原实现无条件 `panelHovered = false` 再排期，而 mouseenter
   * 在"面板已打开、鼠标本来就在里面"时不会重新触发，于是面板内双击查词后 2.5s 必然被关掉，
   * 用户看到的就是"双击没反应/结果闪一下就没了"。现改为：悬停中不排期，到点再用 :hover 复核。
   */
  function scheduleAutoClose() {
    clearTimeout(autoCloseTimer);
    if (pinned || panelHovered) return;
    autoCloseTimer = setTimeout(() => {
      if (pinned || panelHovered) return;
      if (panel && panel.matches && panel.matches(':hover')) return;   // 实时复核，别关正在看的面板
      // 鼠标停在放大镜上时也不能关（chip 是 panel 的兄弟节点，不算 panel 的 hover）
      if (chip && chip.style.display !== 'none' && chip.matches && chip.matches(':hover')) return;
      if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
        hideChip();
      }
    }, AUTO_CLOSE_MS);
  }

  function goBack() {
    if (pinned) { notifyPinned(); return; }
    if (!historyStack.length) return;
    const prev = historyStack.pop();
    if (currentView) {
      // 保存当前现场，方便以后再前进（虽然只提供返回按钮）
    }
    currentView = { kind: prev.kind, key: prev.key, html: prev.html };
    bodyEl.innerHTML = prev.html;
    bodyEl.scrollTop = prev.scrollTop || 0;
    updateNav();
    scheduleAutoClose();
  }

  /* ---------------- 渲染 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /**
   * 错误提示按类型分流（2026-11-19）。
   * 之前把所有失败一律说成「连不上本地词典服务」，把扩展上下文失效误导成服务没起。
   */
  function errorHtml(errText) {
    const err = String(errText || '');
    const tail = err ? `<br><span style="color:#94a3b8;font-size:12px;">${esc(err)}</span>` : '';
    // 扩展重载/更新后，旧标签页的 content script 仍在，但消息通道已失效
    if (/Extension context invalidated|context.*invalidat|receiving end does not exist|消息通道|disconnected/i.test(err)) {
      return `<div class="lt-err">插件刚更新或重载，当前网页还是旧脚本。<br>请按 <b>F5 刷新这个网页标签页</b>，再双击查词即可恢复。${tail}</div>`;
    }
    // 真正的本地服务连接失败
    return `<div class="lt-err">连不上本地词典服务。<br>请先启动 <b>F:\\EnglishReaderDataDict\\restart_bridge.bat</b>，再重试。${tail}</div>`;
  }

  function posCn(p) {
    return POS_CN[String(p || '').trim().toLowerCase().replace(/\.$/, '')] || '';
  }

  function buildEntry(row, word) {
    const lines = String(row.translation || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const defs = lines.map((line) => {
      const m = line.match(/^([a-z]+\.)\s*(.*)$/i);
      return { pos: m ? m[1].toLowerCase() : '', meaning: m ? m[2] : line };
    });
    return {
      word: row.word || word,
      ipa: row.phonetic || '',
      defs: defs.length ? defs : [{ pos: '', meaning: '暂无中文释义' }],
      tag: row.tag || '',
      oxford: Number(row.oxford) === 1,
      collins: Number(row.collins) || 0,
      frq: Number(row.frq) || 0,
      exchange: row.exchange || ''
    };
  }

  function chipsHtml(entry, auth) {
    const out = [];
    if (entry && entry.oxford) out.push('<i class="lt-tag" style="background:#dcfce7;color:#166534;">⭐ 牛津3000</i>');
    if (entry && entry.collins > 0) out.push(`<i class="lt-tag" style="background:#e0e7ff;color:#3730a3;">柯林斯 ${'★'.repeat(Math.min(entry.collins, 5))}</i>`);
    if (entry && entry.frq > 0) out.push(`<i class="lt-tag" style="background:#f1f5f9;color:#475569;">词频 #${entry.frq}</i>`);

    const seen = new Set();
    String((entry && entry.tag) || '').split(/\s+/).filter(Boolean).forEach((t) => {
      const cn = TAG_CN[t] || t.toUpperCase();
      if (seen.has(cn)) return;
      seen.add(cn);
      out.push(`<i class="lt-tag">${esc(cn)}</i>`);
    });
    ((auth && auth.tags) || []).forEach((t) => {
      const cn = TAG_CN[t] || String(t).toUpperCase();
      if (seen.has(cn)) return;
      seen.add(cn);
      out.push(`<i class="lt-tag">${esc(cn)}</i>`);
    });
    return out.join('');
  }

  // 词性码归一：后端 posStats 用全称(noun/verb/adjective)，ECDICT defs 用缩写(a./n./v.)
  function normPos(p) {
    const k = String(p || '').toLowerCase().replace(/\.$/, '');
    const map = {
      'n': 'noun', 'noun': 'noun', 'v': 'verb', 'verb': 'verb', 'vt': 'verb', 'vi': 'verb',
      'j': 'adjective', 'a': 'adjective', 'adj': 'adjective', 'adjective': 'adjective',
      'r': 'adverb', 'ad': 'adverb', 'adverb': 'adverb', 'prep': 'preposition',
      'conj': 'conjunction', 'pron': 'pronoun', 'art': 'determiner', 'int': 'interjection',
    };
    return map[k] || k;
  }

  /**
   * 词性胶囊 + 词形双标注。
   * 【2026-11-18 修复】原先只读 oald.posStats，牛津把 tailored 当别名跳到 tailor，
   * 于是拿到 noun/verb 覆盖掉它本身的 adjective。现在优先级：
   *   ① auth.posStats（后端词级权威词性，已按查询词本身解析）→ 最可信
   *   ② oald.posStats（非别名词典正常词性）
   *   ③ entry.defs 的词性缩写兜底
   * 再把 auth.wordForms（过去分词/过去式等）拼成第二组胶囊，
   * 实现「adj. 形容词 + v. 过去分词」双标注。
   */
  function posChipsHtml(oald, entry, auth) {
    const authStats = (auth && auth.posStats) || [];
    const dictStats = (oald && oald.posStats) || [];
    // 别名词条的词典词性不可信（是原型的），直接跳过
    const dictUsable = !(oald && oald.isRedirect) ? dictStats : [];
    let list = authStats.length ? authStats : dictUsable;
    const total = list.reduce((s, x) => s + (x.n || 0), 0);
    if (!list.length) {
      list = ((entry && entry.defs) || []).filter((d) => d.pos).map((d) => ({ pos: normPos(d.pos), n: 0 }));
    }

    const seen = new Set();
    const chips = [];
    // 中文为主：粗体显示中文词性，英文缩写降为小字补充（2026-11-19）
    const POS_ABBR = { noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', preposition: 'prep.',
      conjunction: 'conj.', pronoun: 'pron.', determiner: 'det.', interjection: 'int.' };
    list.forEach((s) => {
      const pos = normPos(s.pos);
      if (!pos || seen.has(pos)) return;
      seen.add(pos);
      const cn = posCn(pos) || pos;              // 中文词性优先
      const abbr = POS_ABBR[pos] || '';          // 英文缩写做小字
      const pct = total ? Math.round((s.n || 0) / total * 100) : 0;
      chips.push(`<span class="lt-pos"><b>${esc(cn)}</b>${abbr ? `<em>${esc(abbr)}</em>` : ''}${
        pct ? `<i style="width:${pct}%"></i><u>${pct}%</u>` : ''}</span>`);
    });

    // 词形标注：中文「动词·过去分词」，含义一眼可见（与词性并列的第二组）
    const forms = (auth && auth.wordForms) || (oald && oald.wordForms) || [];
    forms.forEach((f) => {
      const posCnLabel = posCn(f.pos || 'verb') || '动词';
      chips.push(`<span class="lt-pos lt-pos-form"><b>${esc(posCnLabel)}</b><em>·${esc(f.label)}</em></span>`);
    });

    return chips.join('');
  }

  function exampleHtml(ex) {
    const en = typeof ex === 'string' ? ex : (ex.en || '');
    const zh = typeof ex === 'string' ? '' : (ex.zh || '');
    return `<li>${esc(en)}${zh ? `<div class="lt-ex-zh">${esc(zh)}</div>` : ''}</li>`;
  }

  function extrasHtml(it) {
    const ex = it.extras || {};
    const row = (label, arr, cls) => (arr && arr.length)
      ? `<div class="lt-extra-row"><span class="lt-extra-label">${label}</span><span class="lt-extra-chips">${
          arr.map((x) => `<span class="lt-echip ${cls || ''}">${esc(x)}</span>`).join('')}</span></div>`
      : '';
    const disc = (ex.synDisc || []).filter(Boolean).slice(0, 1).map((t) => {
      const short = t.length > 300 ? t.slice(0, 300) + '…' : t;
      return `<div class="lt-disc">${esc(short)}</div>`;
    }).join('');
    return [
      row('近义词', ex.synonyms),
      row('反义词', ex.antonyms, 'ant'),
      row('短语', ex.phrases),
      row('搭配', ex.collocations, 'col'),
      disc
    ].join('');
  }

  function authHtml(items, word) {
    const cards = items.map((it) => {
      // 后端已跟随别名到原型词：有内容就直接显示，不再留空白
      const resolved = !!(it.resolvedWord && (
        (it.definitions || []).length || (it.definitionsEn || []).length || (it.definitionsZh || []).length
      ));
      const displayWord = it.resolvedWord || word;
      const head = `<div class="lt-src-head">
          <span class="lt-badge">${esc(it.shortName)}</span>
          ${it.phonetic ? `<span class="lt-src-phon">/${esc(it.phonetic)}/</span>` : ''}
          ${it.pos ? `<span class="lt-src-pos">${esc(it.pos)}</span>` : ''}
          <span class="lt-src-meta">${it.isRedirect ? '别名 → ' + esc(displayWord) : it.definitions.length + ' 义'}</span>
          <span class="lt-caret">▼</span>
        </div>`;
      let body;
      if (it.isRedirect && !resolved) {
        const target = it.redirectTo || displayWord;
        body = `<div class="lt-redirect">“${esc(word)}” 是别名，见 <button data-lookup="${esc(target)}">${esc(target)}</button></div>`;
      } else {
        const en = it.definitionsEn || [], zh = it.definitionsZh || [];
        const tip = it.isRedirect
          ? `<div class="lt-redirect">↪ “${esc(word)}” 是别名，下面显示 <b>${esc(displayWord)}</b> 的释义</div>`
          : '';
        const defs = (en.length && en.length === zh.length)
          ? en.map((e, i) => `<li><div>${esc(e)}</div><div class="lt-zh">${esc(zh[i])}</div></li>`).join('')
          : (it.definitions || []).map((d) => `<li>${esc(d)}</li>`).join('');
        const ex = (it.examples || []).length
          ? `<div class="lt-ex"><div class="lt-ex-label">例句</div><ul>${it.examples.slice(0, 3).map(exampleHtml).join('')}</ul></div>`
          : '';
        const ext = extrasHtml(it);
        body = `${tip}<ol>${defs || '<li>（没抽到释义）</li>'}</ol>${ex}${ext ? `<div class="lt-extra">${ext}</div>` : ''}`;
      }
      return `<section class="lt-srcbox open" data-src="${esc(it.source)}">${head}<div class="lt-src-body">${body}</div></section>`;
    }).join('');
    return `<div class="lt-auth">
        <div class="lt-auth-title">📚 词典对照<span class="lt-auth-sub">${items.length} 本 · 点标题可收起 · 双击正文继续查</span></div>
        ${cards}
      </div>`;
  }

  function renderCard(entry, auth, word) {
    const items = (auth && auth.items) || [];
    // 别名已由后端跟随到原型词：按"有没有实际释义"挑主词条
    const hasDef = (x) => ((x.definitionsZh || []).length || (x.definitions || []).length);
    const oald = items.find((x) => x.source === 'oald10' && hasDef(x))
              || items.find(hasDef)
              || items.find((x) => !x.isRedirect) || null;
    const uk = (oald && (oald.phoneticUk || oald.phonetic)) || (entry && entry.ipa) || '';
    const us = (oald && oald.phoneticUs) || '';
    const defs = (entry && entry.defs) || [];
    const zhLines = (oald && oald.definitionsZh) || [];

    const defsHtml = defs.length
      ? defs.map((d) => `<div class="lt-def">${d.pos ? `<span class="lt-def-pos">${esc(d.pos)}</span>` : ''}<span>${esc(d.meaning)}</span></div>`).join('')
      : zhLines.map((z) => `<div class="lt-def"><span>${esc(z)}</span></div>`).join('');

    const authEx = ((oald && oald.examples) || []).slice(0, 4);
    const exHtml = authEx.length
      ? `<div class="lt-ex"><div class="lt-ex-label">例句（其中单词划词 / 双击可继续查）</div><ul>${authEx.map(exampleHtml).join('')}</ul></div>`
      : '';
    const exchange = String((entry && entry.exchange) || '');
    const plural = exchange.split('/').map((s) => s.split(':')).find((p) => p[0] === 's' && p[1]);
    const exchangeHtml = plural ? `<div class="lt-ex" style="border:none;padding-top:4px;"><span class="lt-ex-label">屈折</span> 复数：<b>${esc(plural[1])}</b></div>` : '';
    const chips = posChipsHtml(oald, entry, auth);

    return `<div class="lt-card">
        <div class="lt-hero-head">
          <span class="lt-word">${esc(word)}</span>
          <span class="lt-chips">${chipsHtml(entry, auth)}</span>
        </div>
        <div class="lt-prons">
          <span class="lt-pron"><i class="lt-ptag">英</i><b class="lt-ipa">${uk ? '/' + esc(uk) + '/' : '—'}</b>
            <button class="lt-spk" data-say="${esc(word)}" data-lang="en-GB">🔊</button></span>
          <span class="lt-pron"><i class="lt-ptag">美</i><b class="lt-ipa">${us ? '/' + esc(us) + '/' : (uk ? '/' + esc(uk) + '/' : '—')}</b>
            <button class="lt-spk" data-say="${esc(word)}" data-lang="en-US">🔊</button></span>
          <span class="lt-src">${items.length ? items.length + ' 本词典' : 'ECDICT'}</span>
        </div>
        ${chips ? `<div class="lt-posrow">${chips}</div>` : ''}
        <div class="lt-defs">${defsHtml}</div>
        ${exchangeHtml}
        ${exHtml}
        ${items.length ? authHtml(items, word) : ''}
      </div>`;
  }

  function renderParagraph(res, text) {
    if (!res || !res.ok) {
      return `<div class="lt-err">段落分析失败：${esc((res && res.error) || '未知错误')}</div>`;
    }
    const words = res.words || [];
    const cov = res.coverageTarget ? Math.round(Number(res.coverageTarget) * 100) : 98;
    const warn = res.translationError
      ? `<div class="lt-para-warn">⚠️ ${esc(res.translationError)}。重点词仍由本地词库分析，可正常使用。</div>`
      : '';
    const list = words.length
      ? words.map((w) => {
          const level = String(w.level || '');
          const cls = level === 'off-list' ? 'C2' : level;
          return `<div class="lt-hard">
            <button class="lt-hard-w" data-lookup="${esc(w.word)}" title="点此查这个词">${esc(w.word)}</button>
            <span class="lt-lvl ${esc(cls)}">${esc(level === 'off-list' ? 'C2+' : level)}</span>
            <span class="lt-score">难度 ${esc(w.score)}</span>
            <div class="lt-hard-why">${(w.reasons || []).map(esc).join(' · ')}</div>
            <div class="lt-hard-zh">${esc(w.translation || '')}</div>
          </div>`;
        }).join('')
      : '<div class="lt-loading">没有超出当前水平的词 👍</div>';

    return `<div class="lt-para">
        <div class="lt-para-label">📄 原文</div>
        <div class="lt-para-text">${esc(text)}</div>
        <div class="lt-para-label">🌐 中文翻译 <span>Ollama</span></div>
        ${res.translation ? `<div class="lt-para-trans">${esc(res.translation)}</div>` : '<div class="lt-loading">暂无译文</div>'}
        ${warn}
        <div class="lt-para-label">🎯 重难点词 <span>目标 ${esc(res.level)} · 理解覆盖率 ${cov}%</span></div>
        ${list}
        <div class="lt-para-label" style="margin-top:14px">💡 提示</div>
        <div class="lt-para-text" style="font-size:12px">双击词或选中句子可继续查词，左上角 ← 逐层返回。标准在 <b>F:\\EnglishReaderDataDict\\2mysql_bridge_server.py</b> 的 <b>DIFFICULTY_LEVEL</b> 修改。</div>
      </div>`;
  }

  // 调试出口
  try {
    window.__ltRenderCard = renderCard;
    window.__ltRenderParagraph = renderParagraph;
    window.__ltNavigate = navigate;
    window.__ltBack = goBack;
    window.__ltHistory = () => ({ depth: historyStack.length, current: currentView });
    window.__ltBodyHtml = () => (bodyEl ? bodyEl.innerHTML : '');
    window.__ltSetPin = setPinned;
    window.__ltIsPinned = () => pinned;
    window.__ltAlpha = applyAlpha;
    window.__ltPickWord = pickWordFromEvent;   // 调试：传 {clientX, clientY} + 可选 root 验证取词
  } catch (e) { /* ignore */ }

  // 初始化
  ensureUI();
})();
