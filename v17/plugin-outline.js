/**
 * LT-Reader v15 内置插件：章节大纲（双模式）
 *
 * 模式一「全量章节大纲」：列出 nodes 表里全部 chapter，点章节跳文。
 * 模式二「当前范围大纲」：本篇段落 + 同书 / 同文件夹 / 同一试卷的兄弟章节。
 *
 * ⚠️ 本文件已内联进 v15/lt_reader_v15.html 的 bootstrap()，无需再手动导入。
 *    改逻辑时两处要同步。默认关闭：defaultEnabled=false。
 */
(function () {
  'use strict';

  var ID = 'plugin-outline-float';
  var LS_MODE = 'lt_outline_mode_v15';
  var LS_GEOM = 'lt_outline_geom_v15';
  var LS_RAIL = 'lt_outline_rail_v15';
  var bus = window.ReaderFeaturePlugins;
  if (!bus || bus.registry.has(ID)) return;

  var panel = null;
  var rail = null;
  var styleTag = null;
  var open = false;
  var mode = localStorage.getItem(LS_MODE) === 'all' ? 'all' : 'scope';
  var nodesSig = '';
  var pollTimer = null;
  var rafId = null;
  var refreshToken = 0;
  var listeners = [];
  var drag = null;
  var railExpanded = false;
  var railOn = localStorage.getItem(LS_RAIL) !== '0';
  var geom = loadGeom();
  var resizing = null;

  function loadGeom() {
    try { return JSON.parse(localStorage.getItem(LS_GEOM) || 'null'); } catch (e) { return null; }
  }

  function saveGeom() {
    if (!panel) return;
    var r = panel.getBoundingClientRect();
    geom = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    try { localStorage.setItem(LS_GEOM, JSON.stringify(geom)); } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function on(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  function readNodes() {
    try {
      if (typeof LocalDB === 'undefined' || !LocalDB.db) return Promise.resolve([]);
      return LocalDB.getAll('nodes');
    } catch (e) {
      console.warn('[outline] 读取 nodes 失败', e);
      return Promise.resolve([]);
    }
  }

  function currentId() {
    return (window.ReaderApp && window.ReaderApp.currentArticle && window.ReaderApp.currentArticle.id) || null;
  }

  function ensureStyle() {
    if (document.getElementById('style-outline-float')) return;
    styleTag = document.createElement('style');
    styleTag.id = 'style-outline-float';
    styleTag.textContent = [
      '#ltOutlinePanel{position:fixed;z-index:860;width:300px;min-width:210px;max-width:640px;box-sizing:border-box;',
      '  background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 10px 30px rgba(15,23,42,.16);',
      '  display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}',
      '#ltOutlinePanel[hidden]{display:none !important;}',
      '.lt-out-head{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;',
      '  padding:8px 10px;border-bottom:1px solid #e2e8f0;background:#f8fafc;cursor:move;user-select:none;}',
      '.lt-out-title{font-size:13px;font-weight:600;color:#1e293b;}',
      '.lt-out-count{font-size:11px;color:#94a3b8;margin-left:6px;font-weight:400;}',
      '.lt-out-title-row{display:flex;align-items:center;gap:7px;}',
      '.lt-out-toggle{display:inline-flex;align-items:center;gap:4px;cursor:pointer;user-select:none;}',
      '.lt-out-toggle-label{font-size:11px;color:#64748b;}',
      '.lt-out-switch{position:relative;width:30px;height:16px;border-radius:8px;background:#cbd5e1;',
      '  border:0;padding:0;cursor:pointer;transition:background .15s;flex-shrink:0;}',
      '.lt-out-switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;',
      '  border-radius:50%;background:#fff;transition:transform .15s;}',
      '.lt-out-switch.is-on{background:#0f766e;}',
      '.lt-out-switch.is-on::after{transform:translateX(14px);}',
      '.lt-out-close{width:24px;height:24px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;',
      '  color:#64748b;font-size:15px;line-height:1;cursor:pointer;}',
      '.lt-out-close:hover{background:#f1f5f9;color:#0f766e;}',
      '.lt-out-rz{position:absolute;z-index:5;}',
      '.lt-out-rz.lt-rz-l{left:0;top:0;bottom:0;width:8px;cursor:ew-resize;}',
      '.lt-out-rz.lt-rz-r{right:0;top:0;bottom:0;width:8px;cursor:ew-resize;}',
      '.lt-out-rz.lt-rz-br{right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;}',
      '.lt-out-rz.lt-rz-br::after{content:"";position:absolute;right:3px;bottom:3px;width:7px;height:7px;',
      '  border-right:2px solid #94a3b8;border-bottom:2px solid #94a3b8;}',
      '#ltRail{position:fixed;left:6px;top:96px;width:34px;z-index:855;background:#ffffff;',
      '  border:1px solid #cbd5e1;border-radius:17px;box-shadow:0 4px 16px rgba(15,23,42,.12);',
      '  display:flex;flex-direction:column;align-items:center;overflow:hidden;}',
      '#ltRail[hidden]{display:none !important;}',
      '.lt-rail-cap{padding:7px 0 4px;font-size:10px;color:#0f766e;line-height:1;flex-shrink:0;}',
      '.lt-rail-list{width:100%;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;',
      '  scrollbar-width:none;padding:2px 0 6px;}',
      '.lt-rail-list::-webkit-scrollbar{display:none;}',
      '.lt-rail-dot{display:block;width:22px;height:22px;margin:2px auto;border:1px solid #e2e8f0;',
      '  border-radius:50%;background:#f8fafc;color:#64748b;font-size:10px;cursor:pointer;',
      '  line-height:20px;text-align:center;padding:0;}',
      '.lt-rail-dot:hover{border-color:#0f766e;color:#0f766e;}',
      '.lt-rail-dot.is-active{background:#0f766e;border-color:#0f766e;color:#fff;font-weight:600;}',
      '.lt-out-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px 6px 12px;}',
      '.lt-out-group{padding:8px 8px 3px;font-size:11px;font-weight:600;color:#94a3b8;',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.lt-out-item{display:block;width:100%;text-align:left;border:0;border-left:3px solid transparent;',
      '  border-radius:0 5px 5px 0;background:transparent;color:#475569;cursor:pointer;',
      '  font-size:12.5px;line-height:1.5;padding:6px 8px;white-space:nowrap;',
      '  overflow:hidden;text-overflow:ellipsis;}',
      '.lt-out-item:hover{background:#f1f5f9;color:#0f766e;}',
      '.lt-out-item.is-active{background:#e6f5f2;border-left-color:#0f766e;color:#0f6e64;font-weight:600;}',
      '.lt-out-foot{flex-shrink:0;border-top:1px solid #e2e8f0;padding:6px 10px;',
      '  font-size:11px;color:#94a3b8;background:#f8fafc;}',
      '.lt-out-empty{padding:14px 10px;font-size:12px;color:#94a3b8;line-height:1.7;}',
      '#btn-outline-toggle{order:-1;}',
      '@media (max-width:900px){#ltOutlinePanel{width:260px;}}'
    ].join('\n');
    document.head.appendChild(styleTag);
  }

  function ensureDOM() {
    if (panel && panel.isConnected) return;
    ensureStyle();
    panel = document.createElement('div');
    panel.id = 'ltOutlinePanel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="lt-out-head"><div class="lt-out-title-row">' +
      '<span class="lt-out-title">章节大纲</span>' +
      '<span class="lt-out-count" id="ltOutCount"></span>' +
      '<label class="lt-out-toggle" title="开=全量章节，关=当前页面与本书范围">' +
      '<span class="lt-out-toggle-label">全量</span>' +
      '<button type="button" class="lt-out-switch" data-mode="all" role="switch"></button></label>' +
      '</div><button type="button" class="lt-out-close" data-act="close" title="收起">×</button></div>' +
      '<div class="lt-out-scroll" id="ltOutList"></div>' +
      '<div class="lt-out-foot" id="ltOutProgress"></div>' +
      '<div class="lt-out-rz lt-rz-l" data-rz="l"></div>' +
      '<div class="lt-out-rz lt-rz-r" data-rz="r"></div>' +
      '<div class="lt-out-rz lt-rz-br" data-rz="br"></div>';

    rail = document.createElement('div');
    rail.id = 'ltRail';
    rail.innerHTML =
      '<div class="lt-rail-cap" id="ltRailCap" title="点击折叠 / 展开章节条">章</div>' +
      '<div class="lt-rail-list" id="ltRailList"></div>';
    document.body.appendChild(panel);
    document.body.appendChild(rail);

    function clickHandler(e) {
      if (e.target.closest('[data-act="close"]')) { e.preventDefault(); setOpen(false); return; }
      if (e.target.closest('#ltRailCap')) { e.preventDefault(); toggleRail(); return; }
      var mb = e.target.closest('[data-mode]');
      if (mb) { e.preventDefault(); setMode(mode === 'all' ? 'scope' : 'all'); return; }
      var chap = e.target.closest('[data-chap-id]');
      if (chap) {
        e.preventDefault();
        var id = chap.getAttribute('data-chap-id');
        if (typeof window.openArticleById === 'function') window.openArticleById(id);
        return;
      }
      var para = e.target.closest('[data-para-idx]');
      if (para) {
        e.preventDefault();
        jumpParagraph(Number(para.getAttribute('data-para-idx')));
      }
    }
    on(panel, 'click', clickHandler);
    on(rail, 'click', clickHandler);

    var head = panel.querySelector('.lt-out-head');
    on(head, 'pointerdown', function (e) {
      if (e.target.closest('button, label')) return;
      var r = panel.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      head.setPointerCapture(e.pointerId);
    });
    on(head, 'pointermove', function (e) {
      if (!drag) return;
      var w = panel.getBoundingClientRect().width;
      var left = Math.max(0, Math.min(drag.left + e.clientX - drag.x, window.innerWidth - w - 4));
      var top = Math.max(4, Math.min(drag.top + e.clientY - drag.y, window.innerHeight - 140));
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panel.style.maxHeight = Math.max(200, window.innerHeight - top - 16) + 'px';
    });
    on(head, 'pointerup', function () { if (drag) { drag = null; saveGeom(); } });

    // 边缘手柄：左右缩宽 / 右下角同时缩放
    panel.querySelectorAll('[data-rz]').forEach(function (h) {
      on(h, 'pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        var r = panel.getBoundingClientRect();
        resizing = { kind: h.getAttribute('data-rz'), x: e.clientX, y: e.clientY,
          left: r.left, top: r.top, width: r.width, height: r.height };
        h.setPointerCapture(e.pointerId);
      });
      on(h, 'pointermove', function (e) {
        if (!resizing) return;
        var k = resizing.kind, w = resizing.width, h2 = resizing.height;
        var left = resizing.left;
        if (k === 'l') {
          w = Math.max(210, Math.min(640, w + (resizing.x - e.clientX)));
          left = Math.max(0, resizing.left + (e.clientX - resizing.x));
        } else if (k === 'r') {
          w = Math.max(210, Math.min(640, w + (e.clientX - resizing.x)));
        } else {
          w = Math.max(210, Math.min(640, w + (e.clientX - resizing.x)));
          h2 = Math.max(180, Math.min(window.innerHeight - resizing.top - 8, h2 + (e.clientY - resizing.y)));
        }
        panel.style.left = left + 'px';
        panel.style.width = w + 'px';
        if (k === 'br') panel.style.height = h2 + 'px';
      });
      on(h, 'pointerup', function () { if (resizing) { resizing = null; saveGeom(); } });
    });

    on(window, 'resize', function () { schedule(place); });
    on(window, 'scroll', function () { schedule(scrollReflect); }, { passive: true });
    var rr = document.getElementById('readerRoot');
    if (rr) on(rr, 'scroll', function () { schedule(scrollReflect); }, { passive: true });
  }

  function schedule(fn) {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(function () { rafId = null; fn(); });
  }

  /** 优先用用户拖过的位置；默认落在工具栏下方、rail 右侧，不遮挡左侧菜单 */
  function place() {
    if (!panel) return;
    var bar = document.querySelector('.top-bar');
    var defTop = bar ? bar.getBoundingClientRect().bottom + 6 : 80;
    defTop = Math.max(8, Math.min(defTop, window.innerHeight - 200));
    var left = (geom && geom.left != null) ? geom.left : 48;
    var top = (geom && geom.top != null) ? geom.top : defTop;
    var width = (geom && geom.width != null) ? geom.width : 300;
    left = Math.max(0, Math.min(left, window.innerWidth - width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - 140));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.width = width + 'px';
    panel.style.maxHeight = Math.max(200, window.innerHeight - top - 16) + 'px';
    if (geom && geom.height) panel.style.height = geom.height + 'px';
  }

  /** 滚动时只更新左侧窄条高亮，不重绘面板 */
  function scrollReflect() {
    if (!open || !rail) return;
    var list = document.getElementById('ltRailList');
    if (!list) return;
    var idx = mode === 'all' ? -1 : inferParaIndex();
    list.querySelectorAll('[data-para-idx]').forEach(function (el) {
      el.classList.toggle('is-active', Number(el.getAttribute('data-para-idx')) === idx);
    });
  }

  function jumpParagraph(idx) {
    var root = document.getElementById('readerRoot');
    var blocks = root && root.querySelectorAll('.para-block');
    var target = blocks && blocks[idx];
    if (!target) return;
    if (document.body.classList.contains('view-horizontal')) {
      root.scrollTo({ left: Math.max(0, target.offsetLeft - 24), behavior: 'smooth' });
    } else {
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
    }
  }

  function group(title, itemsHtml, countText) {
    return '<div class="lt-out-group">' + esc(title) + (countText ? ' · ' + countText : '') + '</div>' + itemsHtml;
  }

  function buildAll(nodes) {
    var byId = {};
    nodes.forEach(function (n) { if (n && n.id) byId[n.id] = n; });
    var readable = nodes.filter(function (n) {
      return n && (n.type === 'chapter' || n.type === 'article') && n.id;
    }).sort(function (a, b) {
      var ga = a.parentId ? String((byId[a.parentId] || {}).title || '') : '';
      var gb = b.parentId ? String((byId[b.parentId] || {}).title || '') : '';
      if (ga !== gb) return ga.localeCompare(gb, 'zh-CN');
      return (a.orderIndex || 0) - (b.orderIndex || 0);
    });
    if (!readable.length) return { html: '<div class="lt-out-empty">暂无章节，导入书籍后自动生成。</div>', count: '' };

    var html = '', lastGroup = null;
    var active = currentId();
    readable.forEach(function (n) {
      var parent = byId[n.parentId];
      var g = parent ? String(parent.title || '') : '独立文章';
      if (g !== lastGroup) {
        var total = readable.filter(function (x) {
          var p = byId[x.parentId];
          return (p ? String(p.title || '') : '独立文章') === g;
        }).length;
        html += '<div class="lt-out-group">' + esc(g) + ' · ' + total + ' 章</div>';
        lastGroup = g;
      }
      html += '<button type="button" class="lt-out-item' + (n.id === active ? ' is-active' : '') +
        '" data-chap-id="' + esc(n.id) + '" title="' + esc(n.title) + '">' + esc(n.title) + '</button>';
    });
    return { html: html, count: readable.length + ' 章' };
  }

  function buildScope(nodes) {
    var art = window.ReaderApp && window.ReaderApp.currentArticle;
    if (!art) return { html: '<div class="lt-out-empty">尚未打开文章。</div>', count: '' };

    var html = '';
    var paras = art.paragraphs || [];
    if (paras.length) {
      var items = '', activeIdx = inferParaIndex();
      paras.forEach(function (p, i) {
        var text = (p.tokens || []).slice(0, 6).map(function (t) { return t.text; }).join(' ');
        items += '<button type="button" class="lt-out-item' + (i === activeIdx ? ' is-active' : '') +
          '" data-para-idx="' + i + '" title="' + esc(text) + '">' +
          esc('第 ' + (i + 1) + ' 段 · ' + text) + '</button>';
      });
      html += group('本篇段落', items, paras.length + ' 段');
    }

    var id = art.id;
    var node = nodes.find(function (n) { return n && n.id === id; });
    var siblings = [];
    if (node && node.parentId) {
      siblings = nodes.filter(function (n) {
        return n && n.id !== id && n.parentId === node.parentId &&
          (n.type === 'chapter' || n.type === 'article');
      }).sort(function (a, b) { return (a.orderIndex || 0) - (b.orderIndex || 0); });
    }
    if (siblings.length) {
      var parent = nodes.find(function (n) { return n && n.id === node.parentId; });
      var items2 = siblings.map(function (n) {
        return '<button type="button" class="lt-out-item" data-chap-id="' + esc(n.id) +
          '" title="' + esc(n.title) + '">' + esc(n.title) + '</button>';
      }).join('');
      html += group('同组章节 · ' + (parent ? parent.title : '未分组'), items2, siblings.length + ' 章');
    }

    if (!html) html = '<div class="lt-out-empty">当前文章没有段落，也没有同组章节。</div>';
    return { html: html, count: paras.length + ' 段' };
  }

  function inferParaIndex() {
    var root = document.getElementById('readerRoot');
    var blocks = root && root.querySelectorAll('.para-block');
    if (!blocks || !blocks.length) return 0;
    var horizontal = document.body.classList.contains('view-horizontal');
    var marker = horizontal ? root.getBoundingClientRect().left : 0;
    var idx = 0, best = Infinity;
    for (var i = 0; i < blocks.length; i++) {
      var r = blocks[i].getBoundingClientRect();
      var d = Math.abs((horizontal ? r.left : r.top) - marker);
      if (d < best) { best = d; idx = i; }
    }
    return idx;
  }

  function signature(nodes) {
    return JSON.stringify(nodes.map(function (n) { return [n.id, n.title, n.parentId, n.orderIndex]; }));
  }

  function updateModeButtons() {
    panel.querySelectorAll('[data-mode]').forEach(function (b) {
      b.classList.toggle('is-on', mode === 'all');
      b.setAttribute('aria-checked', mode === 'all' ? 'true' : 'false');
    });
  }

  /** 正文左侧可滚动窄条：全量=章节序号，当前范围=本篇段落序号 */
  function renderRail(nodes) {
    var list = document.getElementById('ltRailList');
    if (!rail || !list) return;
    rail.hidden = !railOn;
    var items = [];
    if (mode === 'all') {
      var readable = nodes.filter(function (n) {
        return n && (n.type === 'chapter' || n.type === 'article') && n.id;
      });
      var activeId = currentId();
      readable.forEach(function (n, i) {
        items.push('<button type="button" class="lt-rail-dot' + (n.id === activeId ? ' is-active' : '') +
          '" data-chap-id="' + esc(n.id) + '" title="' + esc(n.title) + '">' + (i + 1) + '</button>');
      });
    } else {
      var art = window.ReaderApp && window.ReaderApp.currentArticle;
      var count = (art && art.paragraphs) ? art.paragraphs.length : 0;
      var activeIdx = inferParaIndex();
      for (var i = 0; i < count; i++) {
        items.push('<button type="button" class="lt-rail-dot' + (i === activeIdx ? ' is-active' : '') +
          '" data-para-idx="' + i + '" title="第 ' + (i + 1) + ' 段">' + (i + 1) + '</button>');
      }
    }
    list.innerHTML = items.join('');
    var act = list.querySelector('.is-active');
    if (act) {
      var ar = act.getBoundingClientRect(), lr = list.getBoundingClientRect();
      if (ar.top < lr.top) list.scrollTop -= lr.top - ar.top;
      else if (ar.bottom > lr.bottom) list.scrollTop += ar.bottom - lr.bottom;
    }
  }

  function refresh(force) {
    var token = ++refreshToken;
    return readNodes().then(function (nodes) {
      if (token !== refreshToken || !panel || !panel.isConnected) return;
      var sig = signature(nodes);
      var changed = force || sig !== nodesSig;
      nodesSig = sig;
      var list = document.getElementById('ltOutList');
      var count = document.getElementById('ltOutCount');
      var foot = document.getElementById('ltOutProgress');
      if (!list) return;
      if (changed) {
        var data = mode === 'all' ? buildAll(nodes) : buildScope(nodes);
        list.innerHTML = data.html;
        if (count) count.textContent = data.count || '';
      } else if (mode === 'all') {
        var active = currentId();
        list.querySelectorAll('[data-chap-id]').forEach(function (el) {
          el.classList.toggle('is-active', el.getAttribute('data-chap-id') === active);
        });
      }
      if (foot) {
        var blocks = document.querySelectorAll('#readerRoot .para-block');
        foot.textContent = '读到第 ' + (inferParaIndex() + 1) + ' / ' + blocks.length + ' 段';
      }
      renderRail(nodes);
    }).catch(function (e) { console.warn('[outline] 刷新失败', e); });
  }

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    localStorage.setItem(LS_MODE, mode);
    updateModeButtons();
    refresh(true);
  }

  /** 左侧章节条独立开关，不与面板联动 */
  function toggleRail() {
    railOn = !railOn;
    if (rail) rail.hidden = !railOn;
    try { localStorage.setItem(LS_RAIL, railOn ? '1' : '0'); } catch (e) {}
    var cap = document.getElementById('ltRailCap');
    if (cap) cap.textContent = railOn ? '章' : '›';
  }

  function setOpen(next) {
    open = !!next;
    ensureDOM();
    panel.hidden = !open;
    var btn = document.getElementById('btn-outline-toggle');
    if (btn) {
      btn.textContent = open ? '📑 收起大纲' : '📑 章节大纲';
      btn.style.background = open ? '#e6f5f2' : '';
    }
    if (open) {
      place();
      updateModeButtons();
      refresh(true);
    }
  }

  function destroy() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    listeners = [];
    if (panel) panel.remove();
    if (rail) rail.remove();
    if (styleTag) styleTag.remove();
    panel = rail = styleTag = null;
  }

  bus.register({
    id: ID,
    name: '章节大纲（全量 / 当前范围）',
    description: '工具栏内的双模式目录：全量章节，或本篇段落 + 同书 / 同文件夹 / 同试卷章节。',
    defaultEnabled: false,

    renderToolbar: function () {
      return '<button class="icon-btn" id="btn-outline-toggle">📑 章节大纲</button>';
    },

    onMount: function (el) {
      // renderPluginUI 把每个插件包了一层 div，order 必须加在外层才能排到第二行最左
      if (el && el.style) el.style.order = '-1';
      var btn = el && el.querySelector('#btn-outline-toggle');
      if (btn) btn.onclick = function () { setOpen(!open); };
    },

    onEnable: function () {
      ensureDOM();
      rail.hidden = !railOn;
      var cap = document.getElementById('ltRailCap');
      if (cap) cap.textContent = railOn ? '章' : '›';
      setOpen(open);
      refresh(true);
      if (!pollTimer) {
        pollTimer = setInterval(function () {
          if (document.hidden) return;
          refresh(false);
        }, 3000);
      }
    },

    onDisable: destroy,

    onArticleRendered: function () { refresh(false); }
  });
})();
