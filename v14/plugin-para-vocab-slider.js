/**
 * 知语精读引擎 (LT-Reader v14.0) 外部功能插件
 * 插件名称：段落同步滑动释义窗 (plugin-para-vocab-slider.js)
 */
window.ReaderFeaturePlugins.register({
    id: "plugin-para-vocab-slider",
    name: "段落同步滑动释义窗",
    description: "开启后右侧仅展示当前段词汇滑动窗（≥4词高度），全量词表移至底部；关闭则恢复默认双栏分流",
    defaultEnabled: true,
    currentParaIdx: 0,

    ensureUIInjected() {
        // 1. 注入无红框的清爽虚线滑动窗样式
        if (!document.getElementById("style-para-vocab-slider")) {
            const style = document.createElement("style");
            style.id = "style-para-vocab-slider";
            style.textContent = `
        body.para-slider-active .main-grid {
          display: grid !important;
          grid-template-columns: 66% 34% !important;
          align-items: start !important;
        }
        body.para-slider-active .left-column {
          padding-right: 24px !important;
          border-right: 1.5px dashed var(--dashed-color) !important;
          border-bottom: none !important;
        }
        body.para-slider-active .right-column {
          padding-left: 20px !important;
          position: sticky;
          top: 16px;
        }
        .para-slider-box {
          border: 1.5px dashed var(--dashed-color);
          border-radius: 8px;
          background: var(--bg-paper);
          box-shadow: 0 3px 12px rgba(0, 0, 0, 0.04);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          /*min-height: 315px;*/ /* 严格保证至少容纳 4 个单词及释义的高度 */
          min-height: 830px; /* 严格保证至少容纳 11 个单词及释义的高度 */
        }
        .para-slider-header {
          background: rgba(0, 0, 0, 0.04);
          border-bottom: 1px dashed var(--dashed-color);
          color: var(--title-color);
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 700;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-shrink: 0;
        }
        .para-slider-scroll {
          padding: 10px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .para-slider-scroll::-webkit-scrollbar { width: 5px; }
        .para-slider-scroll::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.35); border-radius: 4px; }
        body.para-slider-active .para-block.slider-focused {
          background: rgba(0, 0, 0, 0.018);
          border-radius: 6px;
          padding: 4px 6px;
          margin-left: -6px;
          margin-right: -6px;
        }
      `;
            document.head.appendChild(style);
        }

        // 2. 在 Setting -> 4. 词表分流与显示模式 中插入第 3 种排布方式选项
        const optGrid = document.getElementById("viewAndVocabOptions");
        if (optGrid && !optGrid.querySelector('[data-val="para-slider"]')) {
            const card = document.createElement("div");
            card.className = "radio-card";
            card.setAttribute("data-val", "para-slider");
            card.innerHTML = `<span>词表排布：右侧段落滑动窗 + 底部全量词表</span><span>✓</span>`;
            card.onclick = () => {
                if (!window.ReaderFeaturePlugins.states["plugin-para-vocab-slider"]) {
                    window.ReaderFeaturePlugins.toggle("plugin-para-vocab-slider", true);
                } else {
                    this.onEnable(window.ReaderApp);
                }
            };
            optGrid.insertBefore(card, optGrid.firstChild);
        }

        // 3. 绑定段落点击与滚动同步事件
        if (!window._paraSliderEventsBound) {
            window._paraSliderEventsBound = true;
            document.addEventListener("click", (e) => {
                if (!document.body.classList.contains("para-slider-active")) return;
                const paraEl = e.target.closest(".para-block");
                if (paraEl) {
                    const allParas = Array.from(document.querySelectorAll(".para-block"));
                    const idx = allParas.indexOf(paraEl);
                    if (idx >= 0 && idx !== this.currentParaIdx) {
                        this.currentParaIdx = idx;
                        this.renderSliderWindow(window.ReaderApp.currentArticle, idx);
                    }
                }
            });

            let timer = null;
            window.addEventListener("scroll", () => {
                if (!document.body.classList.contains("para-slider-active") || !window.ReaderApp.currentArticle) return;
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const blocks = Array.from(document.querySelectorAll(".para-block"));
                    if (!blocks.length) return;
                    let bestIdx = 0;
                    for (let i = 0; i < blocks.length; i++) {
                        const rect = blocks[i].getBoundingClientRect();
                        if (rect.top <= 160 && rect.bottom > 80) { bestIdx = i; break; }
                    }
                    if (bestIdx !== this.currentParaIdx) {
                        this.currentParaIdx = bestIdx;
                        this.renderSliderWindow(window.ReaderApp.currentArticle, bestIdx);
                    }
                }, 120);
            }, { passive: true });
        }
    },

    // 统一走主程序 API；拿不到就退回写 window（兼容旧版主程序）
    setLayout(app, mode) {
        if (app && typeof app.setVocabLayout === "function") app.setVocabLayout(mode);
        else window.vocabLayoutPref = mode;
    },

    // 启用插件时触发
    onEnable(app) {
        this.ensureUIInjected();
        document.body.classList.add("para-slider-active");
        this.setLayout(app, "para-slider");

        const optGrid = document.getElementById("viewAndVocabOptions");
        if (optGrid) {
            optGrid.querySelectorAll('[data-val="auto"], [data-val="right-side"], [data-val="para-slider"]').forEach(c => c.classList.remove("active"));
            const sliderCard = optGrid.querySelector('[data-val="para-slider"]');
            if (sliderCard) sliderCard.classList.add("active");
        }

        if (app && app.currentArticle) {
            this.renderSliderWindow(app.currentArticle, this.currentParaIdx || 0);
        }
    },

    // 关闭或删除插件时触发：自动恢复默认“右侧等高保留 + 超出自动转下方多列”
    onDisable(app) {
        document.body.classList.remove("para-slider-active");
        this.setLayout(app, "auto");
        const optGrid = document.getElementById("viewAndVocabOptions");
        const sliderCard = optGrid ? optGrid.querySelector('[data-val="para-slider"]') : null;
        if (sliderCard && !window.ReaderFeaturePlugins.registry.has("plugin-para-vocab-slider")) {
            sliderCard.remove(); // 若插件被彻底删除，同时移除该选项
        }
        const autoCard = optGrid ? optGrid.querySelector('[data-val="auto"]') : null;
        if (typeof applyVocabLayout === "function") {
            applyVocabLayout("auto", autoCard, true);
        }
    },

    // 每次主框架渲染完文章后自动触发
    onArticleRendered(art) {
        if (!document.body.classList.contains("para-slider-active")) return;
        this.ensureUIInjected();
        this.renderSliderWindow(art, this.currentParaIdx || 0);
    },

    renderSliderWindow(art, targetParaIdx = 0) {
        if (!art || !document.body.classList.contains("para-slider-active")) return;
        const rightCol = document.getElementById("rightColBox");
        const overflowSection = document.getElementById("vocabOverflowSection");
        const overflowGrid = document.getElementById("overflowVocabGrid");
        const overflowHeader = overflowSection ? overflowSection.querySelector(".vocab-overflow-header") : null;
        if (!rightCol || !overflowSection || !overflowGrid) return;

        // 1. 全量词表全部放到页面下方多列展示
        const allVocab = art.vocabulary || [];
        if (allVocab.length > 0) {
            overflowSection.style.display = "block";
            if (overflowHeader) overflowHeader.textContent = `📚 本章全量词汇总览（共 ${allVocab.length} 词，已全部置于段落下方多列展示）`;
            overflowGrid.innerHTML = allVocab.map(v => buildSingleVocabCardHTML(v)).join("");
        } else {
            overflowSection.style.display = "none";
        }

        // 2. 筛选出当前段落的专属词汇
        const para = art.paragraphs[targetParaIdx] || art.paragraphs[0];
        const vocabMap = new Map(allVocab.map(v => [v.word.toLowerCase(), v]));
        const paraWords = [];
        const seen = new Set();

        if (para && para.tokens) {
            para.tokens.forEach(t => {
                const clean = t.text.replace(/[.,!?;:"'()—\[\]]/g, "").toLowerCase().trim();
                if (!clean || seen.has(clean)) return;
                const hit = vocabMap.get(clean) || vocabMap.get(clean.slice(0, -1)) || vocabMap.get(clean.slice(0, -2)) || vocabMap.get(clean.slice(0, -3));
                if (hit) {
                    seen.add(clean);
                    paraWords.push(hit);
                } else if (t.gloss) {
                    seen.add(clean);
                    paraWords.push({
                        word: t.text.replace(/[.,!?;:"'()—\[\]]/g, ""), ipa: "",
                        level: t.tier === "red" ? "core" : "basic",
                        defs: [{ pos: "语境义", meaning: t.gloss }]
                    });
                }
            });
        }

/*        // 3. 动态对齐段落高度（最小 315px 容纳≥4词，长段自动拉长）
        const paraBlocks = document.querySelectorAll(".para-block");
        paraBlocks.forEach((b, idx) => b.classList.toggle("slider-focused", idx === targetParaIdx));
        const activeParaEl = paraBlocks[targetParaIdx];
        const paraHeight = activeParaEl ? activeParaEl.offsetHeight : 320;
        const boxHeight = Math.max(paraHeight, 315);

        const cardsHtml = paraWords.length
            ? paraWords.map(v => buildSingleVocabCardHTML(v)).join("")
            : `<div style="color:#64748b;font-size:12.5px;padding:12px;">本段暂无匹配词条。</div>`;*/

        /*
        把它直接加长到 容纳 11 个词的高度（按每个词条卡片约 72px + 顶部标题栏 36px 计算，11 词大约是 830px，同时为了防止超出你的电脑屏幕可视高度导致底部被截断，
        建议用 Math.min(830, window.innerHeight - 40) 做自适应封顶）。
        * */
        // 3. 动态对齐高度（默认基准拉长至约 11 词高度 ~830px，且不超过当前屏幕可视高度，长段继续自动拉长）
        const paraBlocks = document.querySelectorAll(".para-block");
        paraBlocks.forEach((b, idx) => b.classList.toggle("slider-focused", idx === targetParaIdx));
        const activeParaEl = paraBlocks[targetParaIdx];
        const paraHeight = activeParaEl ? activeParaEl.offsetHeight : 320;

        // 11个词条约 830px（若当前显示器高度较小，自动限制在屏幕可视高度内，确保底部滚动条完整可见）
        const elevenWordsHeight = Math.min(830, window.innerHeight - 45);
        const boxHeight = Math.max(paraHeight, elevenWordsHeight);

        const cardsHtml = paraWords.length
            ? paraWords.map(v => buildSingleVocabCardHTML(v)).join("")
            : `<div style="color:#64748b;font-size:12.5px;padding:12px;">本段暂无匹配词条。</div>`;

    /*    rightCol.innerHTML = `
      <div class="para-slider-box" style="height: ${boxHeight}px;">
        <div class="para-slider-header">
          <span>🎯 第 ${targetParaIdx + 1} 段专属词释（${paraWords.length} 词）</span>
          <span style="font-size:11px;opacity:0.75;">点击段落切换</span>
        </div>
        <div class="para-slider-scroll">${cardsHtml}</div>
      </div>`;*/
        rightCol.innerHTML = `
        <div class="para-slider-box" style="height: ${boxHeight}px; min-height: ${elevenWordsHeight}px;">
          <div class="para-slider-header">
            <span>🎯 第 ${targetParaIdx + 1} 段专属词释（${paraWords.length} 词）</span>
            <span style="font-size:11px;opacity:0.75;">点击段落切换</span>
          </div>
          <div class="para-slider-scroll">${cardsHtml}</div>
        </div>`;
    }
});