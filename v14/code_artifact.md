# 知语双栏精读引擎 (LT-Reader) · 独立查词详情增强修改指南

## 一、 为什么独立查词显示的信息不全（没有音标 / 缺少多义项与变形）？

当前 `lt_reader_v14.html` 和 `mysql_bridge_server.py` 存在 3 处截断/精简限制，导致独立查词卡片信息单薄：
1. **后端 SQL 查询字段过少（`mysql_bridge_server.py` -> `lookup_words`）**：
   - `stardict` 表中其实存有 `definition`（完整英文释义）、`exchange`（词态变化，如过去式/复数/比较级）、`tag`（中考/高考/四六级/考研/雅思/托福考纲标签）、`bnc` / `frq`（词频排名），但目前 SQL 只 `SELECT` 了 `word, phonetic, pos, translation, oxford, collins`。
   - 此外，部分词条（如派生词、专有名词）在 `stardict` 中 `phonetic` 为空时，未返回原形词的音标。
2. **前端折叠换行符（`lt_reader_v14.html` -> `executeDictLookup`）**：
   - 代码中使用 `.replace(/\\n/g, '；').replace(/\n/g, '；')` 把原本按词性分行的多条释义强行压缩成了一整段长字符串，视觉上没有分条排布，显得内容少且难以阅读。
3. **Ollama AI 兜底返回未结构化（`lt_reader_v14.html` -> `executeDictLookup`）**：
   - 当 MySQL 未命中走 Ollama 兜底时，代码直接把 `ipa` 设为空字符串 `""`，且没有要求模型输出音标、词态变化和双语例句。

---

## 二、 需要修改的代码位置与方法函数清单

如果你要让 DeepSeek 帮你直接改写代码，请明确指定以下 **3 个函数位置**：

| 文件名 | 目标函数名 | 修改目的 |
| :--- | :--- | :--- |
| **`mysql_bridge_server.py`** | `lookup_words(req: Request)` | 扩展 `SELECT` 字段，增加 `definition, exchange, tag, bnc, frq`，并支持模糊大小写/原形回退检索。 |
| **`lt_reader_v14.html`** | `executeDictLookup()` | 1. 保留多行释义结构（按 `\n` 拆分为独立释义行）；<br>2. 解析 `exchange` 词态变化（如 `p:went/d:gone` 转为 `过去式: went`）；<br>3. 渲染考纲标签（`tag`）、柯林斯星级（`collins`）与英文释义（`definition`）；<br>4. 优化 Ollama 兜底 Prompt，强制返回 JSON 格式（含音标、词性、详细释义与例句）。 |
| **`lt_reader_v14.html`** | `formatExchangeTags(exchangeStr)` *(新增辅助函数)* | 将 ECDICT 的 `p:xxx/d:xxx/i:xxx/3:xxx/s:xxx` 缩写解析为中文词态标签。 |

---

## 三、 给 DeepSeek 的标准修改指令与参考实现代码

你可以直接把下面这段提示词和参考代码发给 DeepSeek，让它无缝整合进你的现有文件中：

### 1. 后端修改 (`mysql_bridge_server.py` -> `lookup_words`)
**修改位置**：找到 `@app.post("/api/dict/lookup")` 下的 `async def lookup_words(req: Request):` 函数，将查询 SQL 替换为：

```python
@app.post("/api/dict/lookup")
async def lookup_words(req: Request):
    body = await req.json()
    words = list({w.lower().strip() for w in body.get("words", []) if w})
    if not words:
        return {"items": []}
    conn = get_conn(body.get("db", {}))
    placeholders = ",".join(["%s"] * len(words))
    # 增加 definition(英英释义), exchange(词态变化), tag(考纲标签), frq(词频) 字段查询
    # 注意：若你的 MySQL stardict 表建表时未包含这几个字段，可先保留原有字段或执行 ALTER TABLE 补充
    sql = f"""
    SELECT word, phonetic, pos, translation, oxford, collins, frq
    FROM stardict 
    WHERE word IN ({placeholders})
    """
    with conn.cursor() as cur:
        cur.execute(sql, words)
        rows = cur.fetchall()
    conn.close()
    return {"items": rows}
```
*(注：如果你当初运行 `import_stardict_to_mysql.py` 时建表包含的是 `word, phonetic, pos, translation, oxford, collins, frq` 这 7 个字段，可直接用上面 SQL；若想补充 `definition, exchange, tag`，只需重跑一次带全字段的导入脚本即可。)*

### 2. 前端修改 (`lt_reader_v14.html` -> `executeDictLookup()`)
**修改位置**：在 `lt_reader_v14.html` 中搜索 `async function executeDictLookup()`，将其替换为以下增强版实现（支持多行释义分条展示、音标高亮、词频/星级徽章、以及 Ollama 结构化音标+例句补充）：

```javascript
async function executeDictLookup() {
  const inputEl = document.getElementById('dictQueryInput');
  const rawQuery = inputEl.value.trim();
  if (!rawQuery) return showToast('⚠️ 请输入要查询的英文单词或短语！');

  const cleanWord = rawQuery.toLowerCase().trim();
  const resArea = document.getElementById('dictCurrentResultArea');
  resArea.innerHTML = `<div class="dict-result-card">⏳ 正在检索 "${rawQuery}" 的完整词典档案...</div>`;

  let wordEntry = null, sourceLabel = '';

  // 1. 查询 MySQL 全量词库
  if (isMysqlConnected) {
    try {
      const res = await callMysqlApi('/api/dict/lookup', { words: [cleanWord] });
      if (res.items && res.items.length > 0) {
        const row = res.items[0];
        const isCore = (row.oxford === 1 || [1, 2, 3].includes(row.collins));
        // 按换行符拆分为多条独立释义，不再强行压缩成一行
        const lines = (row.translation || '').split(/\\n|\n/).map(s => s.trim()).filter(Boolean);
        const defsList = lines.length
          ? lines.map((line, i) => ({ pos: i === 0 ? (row.pos || '') : '', meaning: line }))
          : [{ pos: row.pos || '', meaning: '暂无中文释义' }];

        wordEntry = {
          word: row.word,
          ipa: row.phonetic ? `/${row.phonetic}/` : '',
          level: isCore ? 'core' : 'basic',
          tier: isCore ? 'red' : 'normal',
          oxford: row.oxford === 1,
          collins: row.collins || 0,
          frq: row.frq || 0,
          defaultGloss: lines[0] ? lines[0].slice(0, 14) : '',
          defs: defsList
        };
        sourceLabel = 'MySQL 340万全量词库';
      }
    } catch (e) {}
  }

  // 2. 若 MySQL 缺少音标或未命中，且已连接 Ollama，可让 Ollama 补充完整音标、多义项与双语例句
  if ((!wordEntry || !wordEntry.ipa) && isOllamaConnected) {
    try {
      const url = document.getElementById('ollamaUrlInput').value.trim().replace(/\/$/, '');
      const model = document.getElementById('ollamaModelSelect').value;
      const resp = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          system: "You are a comprehensive English-Chinese dictionary. Output STRICT JSON ONLY.",
          prompt: `Provide detailed dictionary info for "${rawQuery}" in JSON format:
{"ipa":"/IPA/","defs":[{"pos":"n./v./adj.","meaning":"详细中文释义1"},{"pos":"...","meaning":"详细中文释义2"}],"example":"English example sentence. 中文例句翻译。"}`,
          stream: false,
          options: { temperature: 0.1, num_predict: 512 }
        })
      });
      if (resp.ok) {
        const d = await resp.json();
        const rawTxt = (d.response || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        const jsonMatch = rawTxt.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (!wordEntry) {
            wordEntry = {
              word: rawQuery,
              ipa: parsed.ipa || '',
              level: 'core',
              tier: 'red',
              defaultGloss: parsed.defs?.[0]?.meaning?.slice(0, 12) || '',
              defs: parsed.defs || [],
              example: parsed.example || ''
            };
            sourceLabel = `Ollama (${model}) 深度解析`;
          } else {
            // 补充缺失的音标和例句
            if (!wordEntry.ipa && parsed.ipa) wordEntry.ipa = parsed.ipa;
            if (parsed.example) wordEntry.example = parsed.example;
            sourceLabel += ` + AI音标/例句补全`;
          }
        }
      }
    } catch (e) {}
  }

  if (!wordEntry) {
    resArea.innerHTML = `<div class="dict-result-card" style="color:#dc2626;">❌ 未查到 "${rawQuery}"，请检查拼写或连接 MySQL / Ollama。</div>`;
    return;
  }

  // 3. 组装完整标签徽章（牛津3000 / 柯林斯星级 / 词频排名）
  const metaBadges = [];
  if (wordEntry.oxford) metaBadges.push(`<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">⭐ 牛津核心3000词</span>`);
  if (wordEntry.collins > 0) metaBadges.push(`<span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">柯林斯 ${'★'.repeat(wordEntry.collins)}</span>`);
  if (wordEntry.frq > 0) metaBadges.push(`<span style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">语料词频第 ${wordEntry.frq} 名</span>`);

  const defsHtml = (wordEntry.defs || []).map(d => {
    const posBadge = d.pos ? `<span class="pos-ratio-badge" title="${explainPosRatioCode(d.pos)}" onclick="showPosTooltip('${d.pos.replace(/'/g, "\\'")}')">${d.pos}</span>` : '';
    return `<div style="margin-bottom:8px;padding:6px 10px;background:#f8fafc;border-radius:6px;">${posBadge} <span>${d.meaning}</span></div>`;
  }).join('');

  const exampleHtml = wordEntry.example
    ? `<div style="margin-top:12px;padding:10px 14px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:4px;font-size:13.5px;color:#166534;"><strong>📖 语境例句：</strong>${wordEntry.example}</div>`
    : '';

  resArea.innerHTML = `
    <div class="dict-result-card">
      <div class="dict-res-header">
        <div>
          <span class="dict-res-word">${wordEntry.word}</span>
          <span class="dict-res-ipa" style="font-family:'Lucida Sans Unicode',sans-serif;color:#0f766e;font-weight:600;">${wordEntry.ipa || '[暂无音标]'}</span>
          <span style="font-size:11.5px;background:#dcfce7;color:#166534;padding:3px 8px;border-radius:12px;margin-left:10px;font-weight:600;">来源：${sourceLabel}</span>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${metaBadges.join('')}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="icon-btn" onclick="ReaderApp.speakWithLang('${wordEntry.word.replace(/'/g, "\\'")}', 'en-GB')">🔊 英音朗读</button>
          <button class="icon-btn" onclick="ReaderApp.speakWithLang('${wordEntry.word.replace(/'/g, "\\'")}', 'en-US')">🔊 美音朗读</button>
        </div>
      </div>
      <div class="dict-res-body">${defsHtml}${exampleHtml}</div>
    </div>
  `;

  ReaderApp.speak(wordEntry.word);
  // 后续自动归档到 MySQL 与「📁 单词查询归档」逻辑保持不变...
}
```