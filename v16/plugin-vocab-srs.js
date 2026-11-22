/* v15 挂载包装：同 slider，等 bootstrap 尾部分发注册。 */
window.LT_registerExternalPlugin = window.LT_registerExternalPlugin || [];
window.LT_registerExternalPlugin.push(function () {
    if (window.ReaderFeaturePlugins && window.ReaderFeaturePlugins.registry.has('plugin-vocab-srs')) return;
/**
 * 知语精读引擎 (LT-Reader v14) 外部功能插件
 * 插件名称：生词本 + 间隔复习闪卡 (plugin-vocab-srs.js)  v3
 *
 * v3 变化：
 *   1. 点击 ★ 立即变色（乐观更新）—— 之前要等目录树写完，停顿 2~4 秒
 *   2. 收藏图标换成 iconfont 的 favorite / favorite-filling（SVG symbol + currentColor）
 *   3. 收藏有弹跳动效 + 琥珀色填充
 *   4. 复习面板加进度条，卡片/按钮/间距重做
 *
 * 图标来源：E:\Code\WebCode\font_u0e2kw0g4hs\iconfont.js 里的 <symbol>，
 *          已剥掉硬编码的 fill="#666666"，改由 CSS currentColor 上色。
 *
 * v2 变化：
 *   1. 右侧词表的每一张卡片上加 ★ 收藏按钮（段落滑动窗 / 底部多列同样生效）
 *   2. 收藏时按「年-月-日」归档到目录树：📁 生词复习 / 📁 2026-11-17 / 📄 单词卡片
 *      没有词的那天不会建文件夹；某天的词被清空后，空文件夹会自动删掉
 *   3. 双击正文单词仍然可以收藏（快捷手势保留，且是开关式的）
 *
 * 双层存储（有意为之）：
 *   - 复习调度数据 → localStorage['lt_srs_v1']：单一真相，不依赖 MySQL 连接。
 *   - 目录树节点 + 文章卡片 → LocalDB（nodes / articles）：只负责"看得见、点得开"。
 *   不用 articles 存调度，是因为 MySQL 模式下 LocalDB.getAll('articles') 不走桥接，
 *   靠它枚举待复习词会漏数据。
 */
window.ReaderFeaturePlugins.register({
    id: 'plugin-vocab-srs',
    name: '生词本 + 间隔复习闪卡',
    description: '词表卡片上的 ★ 一键收藏，按日期归档到「生词复习」目录；SM-2 间隔复习',
    defaultEnabled: true,

    STORAGE_KEY: 'lt_srs_v1',
    DAY: 86400000,
    ROOT_ID: 'fld-srs-root',
    ROOT_TITLE: '生词复习',

    queue: [],
    idx: 0,
    flipped: false,

    /* ==================== 存储 ==================== */
    load() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            const d = raw ? JSON.parse(raw) : {};
            return {
                words: d.words || {},
                stats: d.stats || { date: '', reviewed: 0 }
            };
        } catch (e) {
            console.warn('[srs] 读取失败', e);
            return { words: {}, stats: { date: '', reviewed: 0 } };
        }
    },

    save(data) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            showToast('⚠️ 生词本保存失败：浏览器本地存储可能已满');
            return false;
        }
    },

    dateKeyOf(ts) {
        const d = new Date(ts || Date.now());
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    todayKey() { return this.dateKeyOf(Date.now()); },

    normalize(raw) {
        return String(raw || '')
            .replace(/[^A-Za-z'\- ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    },

    dueCount() {
        const now = Date.now();
        return Object.values(this.load().words).filter(x => (x.due || 0) <= now).length;
    },

    dueText(due) {
        if (!due) return '现在';
        const diff = due - Date.now();
        if (diff <= 0) return '现在';
        if (diff < 3600000) return `${Math.ceil(diff / 60000)} 分钟后`;
        return `${Math.ceil(diff / this.DAY)} 天后`;
    },

    /* ==================== 目录树归档 ==================== */
    nextOrder(nodes, pid) {
        const s = nodes.filter(n => (n.parentId || null) === (pid || null));
        return s.length ? Math.max(...s.map(x => x.orderIndex || 0)) + 1 : 1;
    },

    wordNodeId(word, dateKey) {
        return `srs-${dateKey}-${String(word).replace(/[^a-z0-9]+/g, '_')}`;
    },

    /** 保证「生词复习 / yyyy-mm-dd」两级文件夹存在（只在真的要存词时调用，没词不建） */
    async ensureFolderPath(dateKey) {
        if (typeof LocalDB === 'undefined') throw new Error('LocalDB 不可用');
        const nodes = await LocalDB.getAll('nodes');

        let root = nodes.find(n => n.id === this.ROOT_ID);
        if (!root) {
            root = {
                id: this.ROOT_ID, parentId: null, type: 'folder', title: this.ROOT_TITLE,
                orderIndex: this.nextOrder(nodes, null), createdAt: Date.now(), expanded: true
            };
            await LocalDB.put('nodes', root);
            nodes.push(root);
        }

        const dateId = 'fld-srs-' + dateKey;
        let day = nodes.find(n => n.id === dateId);
        if (!day) {
            day = {
                id: dateId, parentId: this.ROOT_ID, type: 'folder', title: dateKey,
                orderIndex: this.nextOrder(nodes, this.ROOT_ID), createdAt: Date.now(), expanded: true
            };
            await LocalDB.put('nodes', day);
            nodes.push(day);
        }
        return { rootId: this.ROOT_ID, dateId, nodes };
    },

    /** 写一个单词节点 + 对应文章卡片。返回 true 表示新建，false 表示已存在 */
    async putWordNode(word, ipa, def, dateKey, dateId, nodes) {
        const nodeId = this.wordNodeId(word, dateKey);
        if (nodes.some(n => n.id === nodeId)) return false;

        const meanShort = (def || '').split(/[,，;；]/)[0].slice(0, 24) || '（无释义）';
        const node = {
            id: nodeId, parentId: dateId, type: 'article',
            title: `${word} · ${meanShort}`,
            orderIndex: this.nextOrder(nodes, dateId), createdAt: Date.now()
        };
        await LocalDB.put('nodes', node);
        nodes.push(node);

        await LocalDB.put('articles', {
            id: nodeId,
            category: `生词复习 · ${dateKey}`,
            titleEn: `${word}${ipa ? ' ' + ipa : ''}`,
            titleCn: meanShort,
            wordCount: word.split(/\s+/).length,
            paragraphs: [{
                isTranslated: true,
                tokens: word.split(/\s+/).map(t => ({ text: t, gloss: meanShort, tier: 'red' })),
                translation: `【词典详释】${def || '（未取到释义）'}`
            }],
            vocabulary: [{
                word, ipa: ipa || '', level: 'core', tier: 'red', defaultGloss: meanShort,
                defs: [{ pos: '', meaning: def || '（未取到释义）' }]
            }]
        });
        return true;
    },

    /** 删掉空壳文件夹：某天没词了就删那天的，连根都空了就删根 */
    async cleanupEmptyFolders() {
        if (typeof LocalDB === 'undefined') return;

        // 第 1 趟：删空的日期文件夹（删一个就同步一次快照，
        // 否则同一份快照里根目录还"看得到"子节点，会误判成非空）
        let nodes = await LocalDB.getAll('nodes');
        for (const n of nodes) {
            if (n.type !== 'folder' || n.parentId !== this.ROOT_ID) continue;
            if (nodes.some(c => c.parentId === n.id)) continue;
            await LocalDB.deleteManyNodes([n.id]);
            nodes = nodes.filter(x => x.id !== n.id);
        }

        // 第 2 趟：日期文件夹都清完了，再看根是不是也空了
        const hasRoot = nodes.some(n => n.id === this.ROOT_ID);
        const rootHasChild = nodes.some(n => n.parentId === this.ROOT_ID);
        if (hasRoot && !rootHasChild) {
            await LocalDB.deleteManyNodes([this.ROOT_ID]);
        }
    },

    /* ==================== 收藏 / 取消收藏（乐观更新） ==================== */
    async toggleWord(rawWord, ipa, def) {
        const w = this.normalize(rawWord);
        if (!w || w.length < 2) return showToast('⚠️ 没有识别到有效的英文单词');
        const data = this.load();
        if (data.words[w]) await this.removeWord(w);
        else await this.addWord(w, ipa, def);
    },

    async addWord(rawWord, ipa, def) {
        const w = this.normalize(rawWord);
        if (!w || w.length < 2) return showToast('⚠️ 没有识别到有效的英文单词');

        const data = this.load();
        if (data.words[w]) {
            this.paintWord(w, true);   // 万一 UI 没同步，纠正一下
            return showToast(`📌 「${w}」已在生词本（${data.words[w].dateKey || ''}）`, 1800);
        }

        const now = Date.now();
        const dateKey = this.dateKeyOf(now);
        data.words[w] = {
            w, ipa: ipa || '', def: def || '', dateKey,
            ease: 2.5, interval: 0, reps: 0, lapses: 0,
            due: now, addedAt: now, lastReview: 0
        };
        if (!this.save(data)) return;

        // ★ 先把界面点亮，再去写库。
        // localStorage 是同步的，这一步零延迟；慢的是目录树写入（MySQL 模式下每次都是 HTTP 往返）。
        this.paintWord(w, true, true);
        this.updateBadge();
        showToast(`⭐ 已收藏到「${this.ROOT_TITLE} / ${dateKey}」`, 2000);

        this.writeWordToTree(w, ipa, def, dateKey);   // 不 await，后台慢慢写
    },

    async removeWord(rawWord) {
        const w = this.normalize(rawWord);
        const data = this.load();
        const item = data.words[w];
        if (!item) return;

        const dateKey = item.dateKey || this.dateKeyOf(item.addedAt || Date.now());
        delete data.words[w];
        this.save(data);

        this.paintWord(w, false);
        this.updateBadge();
        showToast(`已取消收藏「${w}」`, 1600);

        this.removeWordFromTree(w, dateKey);          // 同样不 await
    },

    /* 后台写盘：串行排队，避免连点收藏时并发建目录；失败不回滚星标，下次刷新 migrate 会自动补 */
    writeWordToTree(w, ipa, def, dateKey) {
        this._writeChain = (this._writeChain || Promise.resolve()).then(async () => {
            try {
                const { dateId, nodes } = await this.ensureFolderPath(dateKey);
                await this.putWordNode(w, ipa, def, dateKey, dateId, nodes);
                if (typeof refreshDirectoryTree === 'function') await refreshDirectoryTree();
            } catch (e) {
                console.warn('[srs] 写入目录树失败（下次刷新会自动补上）', e);
            }
        });
        return this._writeChain;
    },

    removeWordFromTree(w, dateKey) {
        this._writeChain = (this._writeChain || Promise.resolve()).then(async () => {
            try {
                if (typeof LocalDB === 'undefined') return;
                await LocalDB.deleteManyNodes([this.wordNodeId(w, dateKey)]);
                await this.cleanupEmptyFolders();
                if (typeof refreshDirectoryTree === 'function') await refreshDirectoryTree();
            } catch (e) {
                console.warn('[srs] 删除目录节点失败', e);
            }
        });
        return this._writeChain;
    },

    /** 把旧版（只存了 localStorage）的生词补进目录树 */
    async migrateExistingWords() {
        const data = this.load();
        const list = Object.values(data.words);
        if (!list.length || typeof LocalDB === 'undefined') return;

        const byDate = {};
        list.forEach(it => {
            const dk = it.dateKey || this.dateKeyOf(it.addedAt || Date.now());
            if (!it.dateKey) it.dateKey = dk;
            (byDate[dk] = byDate[dk] || []).push(it);
        });

        let created = 0;
        for (const dk of Object.keys(byDate)) {
            try {
                const { dateId, nodes } = await this.ensureFolderPath(dk);
                for (const it of byDate[dk]) {
                    if (await this.putWordNode(it.w, it.ipa, it.def, dk, dateId, nodes)) created++;
                }
            } catch (e) {
                console.warn('[srs] 补目录失败', dk, e);
            }
        }
        this.save(data);
        if (created) {
            if (typeof refreshDirectoryTree === 'function') await refreshDirectoryTree();
            showToast(`📁 已把 ${created} 个旧生词补进「${this.ROOT_TITLE}」目录`, 3000);
        }
    },

    /* ==================== 词表卡片上的 ★ ==================== */
    decorateVocabCards() {
        const have = new Set(Object.keys(this.load().words));
        document.querySelectorAll('.vocab-item').forEach(card => {
            if (card.dataset.srsStar === '1') return;
            const head = card.querySelector('.vocab-head');
            const wordEl = card.querySelector('.vocab-word');
            if (!head || !wordEl) return;
            const word = wordEl.textContent.trim();
            if (!word) return;
            card.dataset.srsStar = '1';

            const ipa = (card.querySelector('.vocab-ipa') || {}).textContent || '';
            const def = Array.from(card.querySelectorAll('.vocab-def > div'))
                .map(d => d.textContent.trim()).filter(Boolean).join('；');

            const on = have.has(this.normalize(word));
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'srs-star' + (on ? ' on' : '');
            btn.dataset.word = word;
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.title = on ? '已收藏（点击取消）' : `加入生词本（归档到「${this.ROOT_TITLE}/今天」）`;
            btn.innerHTML = this.starHTML(on);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();          // 别触发卡片头上的朗读
                const P = window.__srsPlugin;
                if (P) P.toggleWord(word, ipa, def);
            });

            // 和右侧的 🔊 放一起，整体靠右
            const kids = Array.from(head.children);
            const speaker = kids.length > 1 ? kids[kids.length - 1] : null;
            const wrap = document.createElement('span');
            wrap.className = 'srs-head-actions';
            wrap.appendChild(btn);
            if (speaker && speaker !== kids[0]) {
                head.removeChild(speaker);
                wrap.appendChild(speaker);
            }
            head.appendChild(wrap);
        });
    },

    starHTML(on) {
        return `<svg class="srs-ic" aria-hidden="true"><use href="${on ? '#srs-i-star-fill' : '#srs-i-star'}"></use></svg>`;
    },

    /** 只改某个词的星（同一个词可能在正文词表 / 底部多列出现多处） */
    paintWord(word, on, pop = false) {
        const key = this.normalize(word);
        document.querySelectorAll('.srs-star').forEach(btn => {
            if (this.normalize(btn.dataset.word) !== key) return;
            btn.classList.toggle('on', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.title = on ? '已收藏（点击取消）' : `加入生词本（归档到「${this.ROOT_TITLE}/今天」）`;
            const use = btn.querySelector('use');
            if (use) use.setAttribute('href', on ? '#srs-i-star-fill' : '#srs-i-star');
            if (pop) {
                btn.classList.remove('pop');
                void btn.offsetWidth;      // 强制重排，让动画能重新播放
                btn.classList.add('pop');
            }
        });
    },

    refreshStars() {
        const have = new Set(Object.keys(this.load().words));
        document.querySelectorAll('.srs-star').forEach(btn => {
            this.paintWord(btn.dataset.word, have.has(this.normalize(btn.dataset.word)));
        });
    },

    /** 正文每次重绘都会把词表重建，用 observer 兜住，比挂 onArticleRendered 更抗造 */
    observeReader() {
        const root = document.getElementById('readerRoot');
        if (!root || window._srsObserver) return;
        let timer = null;
        window._srsObserver = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const P = window.__srsPlugin;
                if (P) P.decorateVocabCards();
            }, 60);
        });
        window._srsObserver.observe(root, { childList: true, subtree: true });
    },

    /* ==================== 复习流程 ==================== */
    openReview() {
        this.ensureUIInjected();
        const data = this.load();
        const now = Date.now();
        this.queue = Object.values(data.words)
            .filter(x => (x.due || 0) <= now)
            .sort((a, b) => (a.due || 0) - (b.due || 0))
            .slice(0, 30);

        if (!this.queue.length) {
            const total = Object.keys(data.words).length;
            showToast(total
                ? `🎉 今天没有待复习的词了（生词本共 ${total} 个）`
                : '生词本还是空的：点词表卡片上的 ☆，或双击正文单词');
            return;
        }
        this.idx = 0;
        document.getElementById('srs-mask').classList.add('open');
        this.showCard();
    },

    showCard() {
        const item = this.queue[this.idx];
        const body = document.getElementById('srs-body');
        if (!body) return;
        if (!item) return this.finishReview();

        this.flipped = false;
        const data = this.load();
        const today = data.stats.date === this.todayKey() ? data.stats.reviewed : 0;
        const pct = Math.round((this.idx / this.queue.length) * 100);

        body.innerHTML = `
      <div class="srs-progress"><i style="width:${pct}%"></i></div>
      <div class="srs-card" id="srs-card">
        <div class="srs-word">${item.w}</div>
        ${item.ipa ? `<div class="srs-ipa">${item.ipa}</div>` : ''}
        <button class="srs-speak" id="srs-speak">🔊 发音</button>
        <div class="srs-hint">点击卡片翻面 · 空格</div>
      </div>
      <div class="srs-actions">
        <button class="srs-again" data-r="0" disabled><b>1</b>忘了</button>
        <button class="srs-hard"  data-r="1" disabled><b>2</b>模糊</button>
        <button class="srs-good"  data-r="2" disabled><b>3</b>记得</button>
        <button class="srs-easy"  data-r="3" disabled><b>4</b>简单</button>
      </div>
      <div class="srs-foot">
        <span>${this.idx + 1} / ${this.queue.length}　·　今日复习 ${today}　·　收录于 ${item.dateKey || '—'}</span>
        <button class="srs-del" id="srs-del">移除</button>
      </div>`;

        body.querySelector('#srs-card').onclick = () => this.flipCard();
        body.querySelector('#srs-speak').onclick = (e) => {
            e.stopPropagation();
            if (window.ReaderApp) window.ReaderApp.speakWithLang(item.w, 'en-US');
        };
        body.querySelectorAll('.srs-actions button').forEach(btn => {
            btn.onclick = () => this.rate(parseInt(btn.dataset.r, 10));
        });
        body.querySelector('#srs-del').onclick = () => {
            if (!confirm(`确定把「${item.w}」从生词本移除吗？（目录里的卡片也会一起删掉）`)) return;
            this.removeWord(item.w);
            this.queue.splice(this.idx, 1);
            this.showCard();
        };
    },

    flipCard() {
        const card = document.getElementById('srs-card');
        const item = this.queue[this.idx];
        if (!card || !item) return;
        this.flipped = true;
        card.classList.add('flipped');
        card.innerHTML = `
      <div class="srs-word" style="font-size:24px;">${item.w}</div>
      ${item.ipa ? `<div class="srs-ipa">${item.ipa}</div>` : ''}
      <div class="srs-def">${item.def || '（这个词没有存到释义）'}</div>
      <div class="srs-meta">已复习 ${item.reps} 次 · 答错 ${item.lapses} 次 · 当前间隔 ${item.interval || 0} 天</div>`;
        card.onclick = null;
        document.querySelectorAll('.srs-actions button').forEach(b => { b.disabled = false; });
    },

    rate(rating) {
        const item = this.queue[this.idx];
        if (!item) return;
        if (!this.flipped) return showToast('先点一下卡片看释义，再评分');

        const data = this.load();
        const t = this.todayKey();
        if (data.stats.date !== t) { data.stats.date = t; data.stats.reviewed = 0; }
        data.stats.reviewed++;

        const updated = this.schedule(item, rating);
        data.words[updated.w] = updated;
        this.save(data);

        const tip = ['⏰ 10 分钟后再来', '📈 间隔小幅增加', '✅ 按倍率延长', '🚀 快速拉长'][rating];
        // 答错的词不塞回本轮队尾：due 已经是 10 分钟后，立刻重复会变成"死磕"
        this.idx++;
        this.showCard();
        showToast(`${tip}（下次：${this.dueText(updated.due)}）`, 1800);
    },

    schedule(item, rating) {
        let ease = item.ease || 2.5;
        let interval = item.interval || 0;
        let reps = item.reps || 0;
        let lapses = item.lapses || 0;

        if (rating === 0) {
            lapses++; reps = 0; interval = 0;
            ease = Math.max(1.3, ease - 0.2);
            item.due = Date.now() + 10 * 60000;
        } else {
            reps++;
            if (rating === 1) {
                interval = Math.max(1, interval * 1.2);
                ease = Math.max(1.3, ease - 0.15);
            } else if (rating === 2) {
                interval = interval ? interval * ease : 1;
            } else {
                interval = (interval ? interval * ease : 3) * 1.3;
                ease = Math.min(3.0, ease + 0.15);
            }
            interval = Math.min(365, Math.round(interval * 10) / 10);
            item.due = Date.now() + interval * this.DAY;
        }
        item.ease = Math.round(ease * 100) / 100;
        item.interval = interval;
        item.reps = reps;
        item.lapses = lapses;
        item.lastReview = Date.now();
        return item;
    },

    finishReview() {
        const left = this.dueCount();
        const data = this.load();
        const today = data.stats.date === this.todayKey() ? data.stats.reviewed : 0;
        document.getElementById('srs-body').innerHTML = `
      <div class="srs-progress"><i style="width:100%"></i></div>
      <div class="srs-empty">
        <div class="srs-empty-ic">🎉</div>
        本轮复习完成<br>
        今日累计复习 <b>${today}</b> 个词${left > 0 ? `<br>还有 <b>${left}</b> 个词待复习（答错的 10 分钟后重新出现）` : '<br>生词本待办已清空'}
      </div>`;
        this.updateBadge();
    },

    closeReview() {
        const mask = document.getElementById('srs-mask');
        if (mask) mask.classList.remove('open');
        this.updateBadge();
    },

    /* ==================== UI 注入 ==================== */
    ensureUIInjected() {
        window.__srsPlugin = this;

        // 图标 sprite：来自 E:\Code\WebCode\font_u0e2kw0g4hs 的 iconfont.js，
        // 原 symbol 里硬编码的 fill="#666666" 已剥掉，改由 CSS 的 currentColor 上色。
        if (!document.getElementById('srs-sprite')) {
            const holder = document.createElement('div');
            holder.id = 'srs-sprite';
            holder.setAttribute('aria-hidden', 'true');
            holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
            holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
<symbol id="srs-i-star" viewBox="0 0 1024 1024"><path d="M934.4 356.266667c-8.533333-10.666667-21.333333-19.2-34.133333-21.333334l-234.666667-34.133333-104.533333-213.333333c-6.4-8.533333-14.933333-17.066667-25.6-23.466667-12.8-6.4-27.733333-6.4-40.533334-2.133333-12.8 4.266667-23.466667 14.933333-29.866666 27.733333l-104.533334 213.333333-234.666666 34.133334c-10.666667 2.133333-21.333333 6.4-29.866667 14.933333-21.333333 21.333333-19.2 55.466667 0 74.666667l170.666667 166.4-40.533334 234.666666c-2.133333 10.666667 0 23.466667 6.4 34.133334 12.8 25.6 46.933333 36.266667 72.533334 21.333333l211.2-110.933333 211.2 110.933333c8.533333 4.266667 17.066667 6.4 25.6 6.4h8.533333c14.933333-2.133333 25.6-10.666667 34.133333-21.333333 8.533333-10.666667 10.666667-25.6 8.533334-40.533334l-40.533334-234.666666 170.666667-166.4c8.533333-8.533333 14.933333-19.2 14.933333-29.866667-2.133333-14.933333-6.4-27.733333-14.933333-40.533333z m-224 194.133333c-12.8 12.8-19.2 29.866667-14.933333 46.933333l38.4 217.6L512 699.733333l-221.866667 115.2L328.533333 597.333333c2.133333-17.066667-2.133333-34.133333-14.933333-46.933333l-157.866667-153.6 219.733334-32c17.066667-2.133333 32-12.8 40.533333-29.866667L512 136.533333l98.133333 198.4c8.533333 14.933333 23.466667 27.733333 40.533334 29.866667l219.733333 32-160 153.6z"></path></symbol>
<symbol id="srs-i-star-fill" viewBox="0 0 1024 1024"><path d="M465.066667 89.6l-104.533334 213.333333-234.666666 34.133334c-10.666667 2.133333-21.333333 6.4-29.866667 14.933333l-2.133333 2.133333c-17.066667 21.333333-17.066667 53.333333 4.266666 72.533334l170.666667 166.4-40.533333 234.666666c-2.133333 10.666667 0 23.466667 6.4 34.133334l2.133333 2.133333c14.933333 23.466667 44.8 32 70.4 19.2l211.2-110.933333 211.2 110.933333c10.666667 6.4 21.333333 6.4 34.133333 6.4h4.266667c27.733333-6.4 44.8-32 40.533333-61.866667l-40.533333-234.666666 170.666667-166.4c8.533333-8.533333 12.8-19.2 14.933333-29.866667v-4.266667c2.133333-27.733333-17.066667-53.333333-44.8-57.6l-234.666667-34.133333-104.533333-213.333333c-14.933333-8.533333-23.466667-17.066667-34.133333-23.466667-25.6-12.8-57.6-2.133333-70.4 25.6z"></path></symbol>
</svg>`;
            document.body.appendChild(holder);
        }

        if (!document.getElementById('style-vocab-srs')) {
            const style = document.createElement('style');
            style.id = 'style-vocab-srs';
            style.textContent = `
.srs-mask {
  position: fixed; inset: 0; background: rgba(15,23,42,0.45);
  z-index: 2600; display: none; align-items: center; justify-content: center; padding: 16px;
}
.srs-mask.open { display: flex; }
.srs-panel {
  width: 100%; max-width: 470px; background: #ffffff; border-radius: 16px;
  box-shadow: 0 24px 60px rgba(15,23,42,0.28); overflow: hidden;
  display: flex; flex-direction: column; max-height: 88vh;
  animation: srsIn .18s ease-out;
}
@keyframes srsIn { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
.srs-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  font-size: 14px; font-weight: 700; color: #0f172a;
}
.srs-close {
  border: none; background: transparent; font-size: 15px;
  color: #94a3b8; cursor: pointer; padding: 4px 7px; border-radius: 6px; line-height: 1;
}
.srs-close:hover { background: #e2e8f0; color: #334155; }
.srs-body { padding: 18px; overflow-y: auto; }

.srs-progress { height: 3px; background: #e2e8f0; border-radius: 2px; overflow: hidden; margin-bottom: 16px; }
.srs-progress > i { display: block; height: 100%; background: #0f766e; border-radius: 2px; transition: width .25s ease; }

.srs-card {
  min-height: 196px; border: 1.5px solid #e2e8f0; border-radius: 12px;
  background: linear-gradient(#fbfdff, #f7fafc); display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px;
  padding: 24px 18px; cursor: pointer; user-select: none;
  transition: border-color .16s, box-shadow .16s, transform .16s;
}
.srs-card:hover { border-color: #99f6e4; box-shadow: 0 6px 18px rgba(15,118,110,.08); }
.srs-card.flipped { background: #f0fdfa; border-color: #5eead4; }
.srs-word {
  font-family: Georgia, "Times New Roman", serif; font-size: 34px;
  font-weight: 700; color: #0f766e; word-break: break-word; text-align: center; line-height: 1.25;
}
.srs-ipa { font-family: 'Lucida Sans Unicode', sans-serif; font-size: 14.5px; color: #64748b; }
.srs-hint { font-size: 11.5px; color: #a3aebd; margin-top: 8px; letter-spacing: .3px; }
.srs-def { font-size: 14px; line-height: 1.9; color: #1e293b; text-align: left; width: 100%; margin-top: 4px; }
.srs-meta { font-size: 11.5px; color: #94a3b8; margin-top: 10px; }
.srs-speak {
  border: 1px solid #cbd5e1; background: #ffffff; color: #475569;
  font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 14px;
  cursor: pointer; margin-top: 4px; transition: all .15s;
}
.srs-speak:hover { background: #f1f5f9; border-color: #94a3b8; color: #0f172a; }

.srs-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 16px; }
.srs-actions button {
  border: none; border-radius: 9px; padding: 10px 4px; font-size: 12.5px;
  font-weight: 700; cursor: pointer; color: #ffffff;
  transition: transform .12s, filter .12s;
}
.srs-actions button b { font-size: 10.5px; opacity: .7; margin-right: 2px; }
.srs-actions button:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
.srs-actions button:active:not(:disabled) { transform: translateY(0); }
.srs-actions button:disabled { opacity: .35; cursor: not-allowed; }
.srs-actions button:disabled { opacity: .38; cursor: not-allowed; filter: none; }
.srs-again { background: #dc2626; }
.srs-hard  { background: #d97706; }
.srs-good  { background: #0f766e; }
.srs-easy  { background: #2563eb; }

.srs-foot {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 12px; font-size: 11.5px; color: #94a3b8; gap: 8px;
}
.srs-del {
  border: 1px solid #fecaca; background: #fef2f2; color: #dc2626;
  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
  cursor: pointer; flex-shrink: 0;
}
.srs-empty { text-align: center; padding: 26px 10px 30px; font-size: 13px; color: #64748b; line-height: 2; }
.srs-empty-ic { font-size: 34px; margin-bottom: 8px; }

/* 词表卡片上的收藏星 */
.srs-head-actions { display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; }
.srs-star {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0; border: none; border-radius: 50%;
  background: transparent; cursor: pointer; color: #c8d0da;
  transition: color .15s, background .15s, transform .15s;
}
.srs-star:hover { color: #f59e0b; background: rgba(245,158,11,.12); transform: scale(1.1); }
.srs-star.on { color: #f59e0b; }
.srs-star.on:hover { color: #d97706; }
.srs-ic { width: 15px; height: 15px; fill: currentColor; display: block; pointer-events: none; }
@keyframes srsPop {
  0% { transform: scale(1); }
  42% { transform: scale(1.45); }
  100% { transform: scale(1); }
}
.srs-star.pop { animation: srsPop .34s cubic-bezier(.34, 1.56, .64, 1); }
`;
            document.head.appendChild(style);
        }

        if (!document.getElementById('srs-mask')) {
            const mask = document.createElement('div');
            mask.className = 'srs-mask';
            mask.id = 'srs-mask';
            mask.innerHTML = `
        <div class="srs-panel">
          <div class="srs-head">
            <span>🃏 生词复习 · 间隔重复</span>
            <button class="srs-close" id="srs-close">✕</button>
          </div>
          <div class="srs-body" id="srs-body"></div>
        </div>`;
            document.body.appendChild(mask);
            mask.addEventListener('click', (e) => {
                if (e.target === mask) { const P = window.__srsPlugin; if (P) P.closeReview(); }
            });
            mask.querySelector('#srs-close').addEventListener('click', () => {
                const P = window.__srsPlugin; if (P) P.closeReview();
            });
        }

        if (!window._srsEventsBound) {
            window._srsEventsBound = true;

            // 双击正文单词 -> 收藏（快捷手势）
            document.addEventListener('dblclick', (e) => {
                const P = window.__srsPlugin;
                if (!P || !document.body.classList.contains('srs-enabled')) return;
                const ruby = e.target.closest && e.target.closest('ruby');
                if (!ruby || !ruby.closest('.gloss-paragraph')) return;

                if (window.speechSynthesis) window.speechSynthesis.cancel();  // 抵消两次单击触发的朗读

                const clone = ruby.cloneNode(true);
                clone.querySelectorAll('rt').forEach(n => n.remove());
                const word = clone.textContent;

                const art = window.ReaderApp && window.ReaderApp.currentArticle;
                const vocab = (art && art.vocabulary) || [];
                const key = P.normalize(word);
                const hit = vocab.find(v => String(v.word || '').toLowerCase() === key);

                let ipa = '', def = '';
                if (hit) {
                    ipa = hit.ipa || '';
                    def = (hit.defs || []).map(d => `${d.pos ? '[' + d.pos + '] ' : ''}${d.meaning || ''}`).join('；');
                }
                if (!def) {
                    const rt = ruby.querySelector('rt');
                    def = rt ? rt.textContent.trim() : '';
                }
                P.toggleWord(word, ipa, def);
            });

            document.addEventListener('keydown', (e) => {
                const P = window.__srsPlugin;
                const mask = document.getElementById('srs-mask');
                if (!P || !mask || !mask.classList.contains('open')) return;
                if (e.key === 'Escape') { P.closeReview(); return; }
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    if (!P.flipped) P.flipCard(); else P.rate(2);
                    return;
                }
                if (['1', '2', '3', '4'].includes(e.key)) {
                    e.preventDefault();
                    P.rate(parseInt(e.key, 10) - 1);
                }
            });
        }
    },

    /* ==================== 工具栏 ==================== */
    renderToolbar() {
        return `<button class="icon-btn" id="btn-vocab-srs"
      style="background:#0f766e;color:#ffffff;border-color:#0f766e;">生词复习</button>`;
    },

    onMount(el) {
        const btn = el.querySelector('#btn-vocab-srs');
        if (btn) btn.onclick = () => this.openReview();
        this.updateBadge();
    },

    updateBadge() {
        const btn = document.getElementById('btn-vocab-srs');
        if (!btn) return;
        const n = this.dueCount();
        btn.textContent = n > 0 ? `生词复习 (${n})` : '生词复习';
        btn.style.background = n > 0 ? '#b45309' : '#0f766e';
        btn.style.borderColor = btn.style.background;
    },

    /* ==================== 生命周期 ==================== */
    onEnable(app) {
        this.ensureUIInjected();
        document.body.classList.add('srs-enabled');
        this.updateBadge();
        this.observeReader();
        this.decorateVocabCards();
        this.migrateExistingWords();
        showToast('⭐ 生词本已启用：点词表卡片上的 ☆ 收藏（按日期自动归档）', 4000);
    },

    onDisable() {
        document.body.classList.remove('srs-enabled');
        if (window._srsObserver) { window._srsObserver.disconnect(); window._srsObserver = null; }
        document.querySelectorAll('.srs-star').forEach(b => b.remove());
        document.querySelectorAll('[data-srs-star]').forEach(c => delete c.dataset.srsStar);
        document.querySelectorAll('.srs-head-actions').forEach(w => { if (!w.children.length) w.remove(); });
        this.closeReview();
    },

    onArticleRendered() {
        this.updateBadge();
        this.decorateVocabCards();
    }
});

});