/**
 * 知语精读引擎 (LT-Reader) 扩展功能插件
 * 插件名称：段落同步滑动词释窗 (Paragraph-Sync Vocab Slider)
 * 功能说明：
 * 1. 开启后：右侧改为随当前阅读/点击段落同步切换的局部滑动释义窗（最小高度容纳≥4词，长段自动拉长），全量词汇自动平铺至文章最下方；
 * 2. 关闭后：自动恢复默认的“右侧等高保留 + 超出自动转下方多列”布局。
 *
 * 插件的显示效果(优势)：
 * 一、零侵入热插拔：通过 Setting -> 3. 功能插件与开关 加载后，自动出现滑动开关；开启时，自动把模式切换为“右侧段落同步滑动释义 + 底部全量词表”
 * 并自动选中；关闭滑动开关时，瞬间无损恢复为你原本的 词表排布：右侧等高保留 + 超出自动转下方多列。
 *
 * 二、数据精准映射：插件通过读取当前段落的 tokens 数组，精准过滤出只属于当前这一段的词汇，按出现顺序装入右侧同步滚动的小窗口中，彻底告别全局找词。
 *
 * 三、动态跟随视口（Sticky Viewport Sync）：右侧滑动窗口不仅从第一段第一行起始、高度自适应（至少容纳 4 个词条的最小高度 min-height: 290px，
 * 长段落则自动随段落撑高），当你往下滚动阅读长文时，右侧窗口还会智能跟随你当前正在读的段落动态切换词条（或者你可以直接点击任意段落，
 * 右侧滑动窗瞬间定位到该段的专属词汇）。
 */
window.ReaderFeaturePlugins.register({
    id: "plugin-para-vocab-slider",
    name: "段落同步滑动释义窗",
    description: "开启后右侧仅展示当前段词汇滑动窗（≥4词高度），全量词表移至底部；关闭则恢复默认双栏分流",
    defaultEnabled: true,

    // 1. 注入插件专属样式与 Setting 选项同步逻辑
    initPluginAssets() {
        if (document.getElementById("style-para-vocab-slider")) return;

        const style = document.createElement("style");
        style.id = "style-para-vocab-slider";
        style.textContent = `
      /* 开启滑动窗口插件后的专属布局 */
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
        top: 16px; /* 随页面滚动吸附在视口顶部，始终与当前阅读段落齐平 */
      }

      /* 右侧段落专属滑动窗口容器 */
      .para-slider-box {
        border: 1.5px solid var(--banner-bg);
        border-radius: 8px;
        background: var(--bg-paper);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: height 0.2s ease;
        min-height: 310px; /* 严格保证至少能完整显示 4 个单词及对应释义的高度 */
      }
      .para-slider-header {
        background: var(--banner-bg);
        color: #ffffff;
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
      /* 定制精致滚动条 */
      .para-slider-scroll::-webkit-scrollbar { width: 5px; }
      .para-slider-scroll::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.35); border-radius: 4px; }

      /* 当前激活段落的左侧微高亮提示 */
      body.para-slider-active .para-block.slider-focused {
        background: rgba(0, 0, 0, 0.018);
        border-radius: 6px;
        padding: 4px 6px;
        margin-left: -6px;
        margin-right: -6px;
      }
    `;
        document.head.appendChild(style);

        // 在 Setting -> 4. 词表分流与显示模式中动态增加对应的选项卡片
        const optGrid = document.getElementById("viewAndVocabOptions");
        if (optGrid && !optGrid.querySelector('[data-val="para-slider"]')) {
            const card = document.createElement("div");
            card.className = "radio-card";
            card.setAttribute("data-val", "para-slider");
            card.innerHTML = `<span>词表排布：右侧段落滑动窗 + 底部全量词表</span><span>✓</span>`;
            card.onclick = () => {
                // 如果插件被关掉了，点击此选项会自动打开插件开关
                if (!window.ReaderFeaturePlugins.states["plugin-para-vocab-slider"]) {
                    window.ReaderFeaturePlugins.toggle("plugin-para-vocab-slider", true);
                } else {
                    this.activateSliderMode();
                }
            };
            optGrid.insertBefore(card, optGrid.firstChild);
        }
    },

    // 2. 激活滑动窗口模式并自动选中 Setting 里的对应选项
    activateSliderMode() {
        this.initPluginAssets();
        document.body.classList.add("para-slider-active");

        // 同步 Setting 面板中的高亮选中状态
        const optGrid = document.getElementById("viewAndVocabOptions");
        if (optGrid) {
            optGrid.querySelectorAll('[data-val="auto"], [data-val="right-side"], [data-val="para-slider"]').forEach(c => c.classList.remove("active"));
            const sliderCard = optGrid.querySelector('[data-val="para-slider"]');
            if (sliderCard) sliderCard.classList.add("active");
        }

        if (window.ReaderApp && window.ReaderApp.currentArticle) {
            this.renderSliderForArticle(window.ReaderApp.currentArticle, 0);
        }
    },

    // 3. 停用插件时：恢复默认“右侧等高保留 + 超出自动转下方多列”
    deactivateSliderMode() {
        document.body.classList.remove("para-slider-active");
        const optGrid = document.getElementById("viewAndVocabOptions");
        if (optGrid) {
            optGrid.querySelectorAll('[data-val="auto"], [data-val="right-side"], [data-val="para-slider"]').forEach(c => c.classList.remove("active"));
            const autoCard = optGrid.querySelector('[data-val="auto"]');
            if (autoCard && typeof applyVocabLayout === "function") {
                applyVocabLayout("auto", autoCard, true);
            }
        }
    },

    // 4. 提取指定段落的专属词汇，并把全量词表放到页面下方
    renderSliderForArticle(art, targetParaIdx = 0) {
        if (!document.body.classList.contains("para-slider-active") || !art) return;

        const rightCol = document.getElementById("rightColBox");
        const overflowSection = document.getElementById("vocabOverflowSection");
        const overflowGrid = document.getElementById("overflowVocabGrid");
        const overflowHeader = overflowSection ? overflowSection.querySelector(".vocab-overflow-header") : null;
        if (!rightCol || !overflowSection || !overflowGrid) return;

        // A. 将本章所有词汇完整平铺到正文下方 4 列网格
        const allVocab = art.vocabulary || [];
        if (allVocab.length > 0) {
            overflowSection.style.display = "block";
            if (overflowHeader) overflowHeader.textContent = `📚 本章全量词汇总览（共 ${allVocab.length} 词，已全部置于段落下方多列展示）`;
            overflowGrid.innerHTML = allVocab.map(v => buildSingleVocabCardHTML(v)).join("");
        } else {
            overflowSection.style.display = "none";
        }

        // B. 筛选出当前段落（targetParaIdx）中出现的所有词汇
        const para = art.paragraphs[targetParaIdx] || art.paragraphs[0];
        const vocabMap = new Map(allVocab.map(v => [v.word.toLowerCase(), v]));
        const paraWords = [];
        const seen = new Set();

        if (para && para.tokens) {
            para.tokens.forEach(t => {
                const clean = t.text.replace(/[.,!?;:"'()—\[\]]/g, "").toLowerCase().trim();
                if (!clean || seen.has(clean)) return;
                // 匹配原形或简单词形变化
                const hit = vocabMap.get(clean)
                    || vocabMap.get(clean.slice(0, -1))
                    || vocabMap.get(clean.slice(0, -2))
                    || vocabMap.get(clean.slice(0, -3));
                if (hit) {
                    seen.add(clean);
                    paraWords.push(hit);
                } else if (t.gloss) {
                    // 若词库未收录但行间有语境注释，也生成轻量词条卡片保证不错过任何词
                    seen.add(clean);
                    paraWords.push({
                        word: t.text.replace(/[.,!?;:"'()—\[\]]/g, ""),
                        ipa: "",
                        level: t.tier === "red" ? "core" : "basic",
                        defs: [{ pos: "语境义", meaning: t.gloss }]
                    });
                }
            });
        }

        // C. 计算滑动窗口高度：严格对齐当前段落高度，但至少保证 310px（容纳 ≥4 个单词及释义）
        const paraBlocks = document.querySelectorAll(".para-block");
        paraBlocks.forEach((b, idx) => b.classList.toggle("slider-focused", idx === targetParaIdx));
        const activeParaEl = paraBlocks[targetParaIdx];
        const paraHeight = activeParaEl ? activeParaEl.offsetHeight : 320;
        const boxHeight = Math.max(paraHeight, 310);

        const cardsHtml = paraWords.length
            ? paraWords.map(v => buildSingleVocabCardHTML(v)).join("")
            : `<div style="color:#64748b;font-size:12.5px;padding:12px;">本段暂无匹配词条（请先连接 MySQL 或导入词典）。</div>`;

        rightCol.innerHTML = `
      <div class="para-slider-box" style="height: ${boxHeight}px;">
        <div class="para-slider-header">
          <span>🎯 第 ${targetParaIdx + 1} 段专属词释（${paraWords.length} 词）</span>
          <span style="font-size:11px;opacity:0.85;">点击左侧段落切换</span>
        </div>
        <div class="para-slider-scroll">
          ${cardsHtml}
        </div>
      </div>
    `;
    },

    // 5. 插件挂载生命周期：劫持文章渲染钩子并绑定段落点击/滚动联动
    onMount(toolbarWrap, app) {
        this.initPluginAssets();

        // 监听状态开关变化（启用 -> 开启滑动窗；停用 -> 恢复默认模式）
        const origToggle = window.ReaderFeaturePlugins.toggle.bind(window.ReaderFeaturePlugins);
        if (!window._sliderToggleHooked) {
            window._sliderToggleHooked = true;
            window.ReaderFeaturePlugins.toggle = async (id, enabled) => {
                await origToggle(id, enabled);
                if (id === "plugin-para-vocab-slider") {
                    if (enabled) this.activateSliderMode();
                    else this.deactivateSliderMode();
                }
            };
        }

        // 劫持全局 renderArticleView，确保每次切换章节/翻页/翻译更新后自动刷新右侧滑动窗
        if (typeof window.renderArticleView === "function" && !window._sliderRenderHooked) {
            window._sliderRenderHooked = true;
            const origRender = window.renderArticleView;
            window.renderArticleView = (art) => {
                origRender(art);
                if (document.body.classList.contains("para-slider-active")) {
                    this.renderSliderForArticle(art, this.currentParaIdx || 0);
                }
            };
        }

        // 绑定左侧段落点击事件 & 滚动自动追踪当前阅读段落
        if (!window._sliderEventsBound) {
            window._sliderEventsBound = true;
            this.currentParaIdx = 0;

            // 点击任意段落，右侧滑动窗立刻切换为该段落的单词
            document.addEventListener("click", (e) => {
                if (!document.body.classList.contains("para-slider-active")) return;
                const paraEl = e.target.closest(".para-block");
                if (paraEl) {
                    const allParas = Array.from(document.querySelectorAll(".para-block"));
                    const idx = allParas.indexOf(paraEl);
                    if (idx >= 0 && idx !== this.currentParaIdx) {
                        this.currentParaIdx = idx;
                        this.renderSliderForArticle(app.currentArticle, idx);
                    }
                }
            });

            // 页面滚动时，自动检测当前视口最上方正在阅读的段落并同步右侧词汇窗
            let scrollTimer = null;
            window.addEventListener("scroll", () => {
                if (!document.body.classList.contains("para-slider-active") || !app.currentArticle) return;
                clearTimeout(scrollTimer);
                scrollTimer = setTimeout(() => {
                    const blocks = Array.from(document.querySelectorAll(".para-block"));
                    if (!blocks.length) return;
                    let bestIdx = 0;
                    for (let i = 0; i < blocks.length; i++) {
                        const rect = blocks[i].getBoundingClientRect();
                        if (rect.top <= 160 && rect.bottom > 80) {
                            bestIdx = i;
                            break;
                        }
                    }
                    if (bestIdx !== this.currentParaIdx) {
                        this.currentParaIdx = bestIdx;
                        this.renderSliderForArticle(app.currentArticle, bestIdx);
                    }
                }, 120);
            }, { passive: true });
        }

        // 初始化状态检查
        if (window.ReaderFeaturePlugins.states["plugin-para-vocab-slider"]) {
            this.activateSliderMode();
        }
    }
});