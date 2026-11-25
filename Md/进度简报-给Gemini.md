# LT-Reader 最新进度简报（供 Gemini 参考）

> 更新时间：2026-11-25（v17 升级）
> 用途：纠正此前对话中传递的过时信息，让后续建议基于当前真实工程状态。
> 项目：英语精读器 LT-Reader（知语 · LingoTwin Reader）

---

## ⚠️ 一、请优先更正这几条过时信息

| 过时说法 | 当前事实 |
|---|---|
| 主线是 v14 / v15 / v16 | **主线已是 v17**：`E:\Code\WebCode\Demo01\v17\lt_reader_v17.html`，另有 3 个本地插件 JS：`plugin-outline.js`、`plugin-para-vocab-slider.js`、`plugin-vocab-srs.js`。v17 核心变化=模型接口改 OpenAI 兼容形式（见下） |
| 服务在 8080 / 8081 | **2026-11-22 已迁到专属段**：MySQL 桥接 **37701**、Kokoro TTS **37702**、Ollama **11434**（系统级）。全局搜 `37701/37702` 涉及 13 处，已全部改完验证 |
| 需要"把 HTML 套壳成桌面软件" | **已有 pywebview 桌面壳**：`F:\EnglishReaderDataDict\lt_app.py` + `start-desktop.bat`，WebView2 窗口加载页面。2026-11-24 已修正指向 v16 |
| 浏览器插件还在 v14 | **2026-11-25 已迁入主线**：现为 `v17\extension\lt-lookup\`（manifest 1.1.0）；v14、v16 目录仅作历史留存 |
| 模型接口是 Ollama 原生 `/api/generate` | **v17 已全改 OpenAI 兼容接口**：前端 4 处生成 + 1 处探测改为 `/v1/chat/completions`、`/v1/models`；后端桥接加 `_openai_chat()` 统一封装。Ollama 仅作可选本地实现，可无缝换 Llama.cpp / LM Studio / vLLM / 云 API。详见 `v17/问题总览.md` 的 v17 升级记录 |
| 页面还有外部 CDN 依赖 | **2026-11-24 已全部本地化**：jszip 3.10.1 / pdf.js 3.11.174（含 worker）已下载到 `v16\vendor\`，HTML 的 `:22-23`、`:3631` 改为相对路径。现在断网可完整运行 |
| "进程残留 / 手动启动"是待修 bug | **不是 bug，是设计**：`start-all.vbs` 零窗口幂等启动（端口探活，已在跑就跳过），服务刻意常驻到关机，不需要时 `stop-all.bat` 全停 |

---

## 二、当前架构（一句话 + 图）

厚 Python 后端 + 薄 HTML 前端，三个本地服务缺一不可：

```
v17/lt_reader_v17.html  (单文件 SPA + 3 个本地 plugin JS)
   │  fetch（79 处 localStorage / fetch / 端口逻辑）
   ├── 桥接 37701   FastAPI + pymysql，339 万词库；查词/中文词典/翻译日志/真人音 mp3
   ├── TTS 37702    Kokoro-82M ONNX + phonemizer + espeakng，54 音色，句子朗读
   └── 模型 11434   OpenAI 兼容 /v1/chat/completions（Ollama 可作本地实现，可换任意兼容服务）
                    生成 IPA / 例句 / 段落翻译 / AI 问答
```

前端关键位置（v17，行号为约数）：
- 桥接地址默认 `http://127.0.0.1:37701`；模型地址默认 `http://localhost:11434`（自动补 `/v1`）
- `callOpenAI()` / `getModelApiBase()`：v17 新增的统一模型调用封装（4 处生成共用）
- `fetchOllamaModels()`：`GET /v1/models` 探测（旧 `/api/tags`）
- TTS `/voices`、`/health`；本地插件 3 个 JS
- ⚠️ 上面这几行"前端关键位置"的旧行号（`:905` 等）是 v16 快照，v17 已变动，以函数名搜索为准

---

## 三、已完成功能（基础需求 1~22）

| # | 需求 | 状态 | 关键实现 |
|---|---|---|---|
| 1 | 中文查词 | ✅ | CC-CEDICT 125,450 条导入 MySQL `cedict` 表，`/api/dict/zh`；用 `translation LIKE '%中文%'` 全表扫描要 16.5s，故单独建表 |
| 2 | 整段翻译 + 日志落库 | ✅ | `translate_logs` 表 + 3 接口；时间范围 + 关键词模糊查询，1 万行内 <20ms |
| 3 | 喇叭响应慢（30~60s） | ✅ | 根因：Chrome 无本地英文音色→走 Google 在线。建本地 Kokoro TTS 37702 |
| 4 | 左上角软件名 + 图标 | ✅ | 内联 SVG favicon + 品牌标识 |
| 5 | 查词卡片精简 | ✅ | 去掉占空间的说明文字 |
| 6 | 返回顶部 | ✅ | 悬浮工具条 `#ltDock`，含透明度滑块 / 图钉 / 拖拽 / 麦克风停止 |
| 7 | 悬浮工具栏增强 | ✅ | 抓手 / 侧边隐藏 / 横竖切换 / 回到上次位置（`ProgressStore.readLastSync()` 同源） |
| 8 | coherent 发音错 | ✅ | 音素本身对；真因是美音栏回退显示英式音标 + 0.5x 拉伸糊音。改固定 1.0x 合成 + playbackRate |
| 9 | 查词弹窗同步插件功能 | ✅ | 几何命中取词算法；Setting「2.6 查词浮层行为」默认版本2（3s 自动关，鼠标进入则不关） |
| 10 | 整段翻译页双击查词 + 例句喇叭 | ✅ | 中文 `mode=segment` 最长前缀匹配；例句全覆盖 🔊 |
| 11/12 | 英美发音 + 音标标注 | ✅ | 三轮实测结论：**Kokoro 美音音素串词首 /p/ 是模型级缺陷，与声线无关**（频谱余弦相似度验证）。终极方案：**单词发音本地化为朗文6 真人 mp3**（58,218 个，~0.1s），欧路独有 51,975 词补位；词条挂英/美双喇叭 |
| 13 | 最近查询可管理 | ✅ | `localStorage` 持久化，上限 50 条，单删/清空，中英统一进历史，删历史≠删归档 |
| 14~20 | 备份恢复/生词复习/字号行距/全局搜索/快捷键/服务健康/阅读统计 | 📋 候选池 | 已登记"为什么有这个需求"，未实现 |
| 21 | 插件查词记录自动保留 | ✅（2026-11-24 补齐，当日修订） | 浏览器插件 `lt-lookup` 原先**没有**此功能（只有会话内返回栈、面板几何存储）。现新增 `chrome.storage.local`：查词只存**基础索引**（词/音标/释义摘要/时间，**不存完整 html**），标题栏 `🕘` 查看，点条目**重新查词库拿最新结果**，去重/置顶/**无上限**。13 项断言全过。详见 `v14/extension/lt-lookup/README.md` 2.4 节 |
| 22 | 整理进度给 Gemini | ✅ | 本简报 |
| 23 | 自然语言 AI 对比问答 | ✅（2026-11-24） | 搜索框问「A 和 B 有什么区别」→ Ollama 抽词 → 分别查词库取精简字段 → AI 按**常用解释/计算机行业解释/最新用法变化**三段解答。复用 callMysqlApi + Ollama，不新增服务；21 项断言 + 真实 qwen3:4b 端到端验证通过 |
| 24 | 查词结果加"我的笔记" | ✅（2026-11-25） | 借鉴欧路：`renderDictResultCard` 释义下方加笔记区（查看/编辑/保存/删除），独立查词页+正文浮层两处共用。**双写**：IndexedDB 主存（LocalDB v2 加 `word_notes` store）+ MySQL 备份（桥接加 `word_notes` 表 + `/api/wordnote/get\|save`）。同步函数用「占位+异步填充」+ 竞态保护。备份导出导入同步。真实接口联调受 sandbox 服务回收限制未完成，代码侧 py_compile/语法/17 项 mock 全过 |
| 25 | 欧路/有道释义方法调研 | ✅（2026-11-25） | 文档 `Md\词典释义方法论调研.md`。核心：贴合真实需求 = 频率排序 + 真实语境例句 + 场景/学科标注 + 个人化闭环。欧路=词典容器+辨析词根+笔记；有道=网页萃取网络释义（按网页频次排序）+海量例句+学科标注。LT-Reader 已具备 7 项，建议补"义项按常用度排序/近义词辨析" |
| 26 | 关闭后能否快速拉起 | ✅（2026-11-25） | 文档 `Md\项目快速拉起评估.md`。关页面<1s；冷启动原 7~8s（模型加载仅 1.4s 非瓶颈）。🔴 实测抓到 37701 桥接曾挂掉；🔴 隐藏瓶颈=XMLHTTP 探死端口 2s/次 vs netstat 0.05s/次（慢 44 倍）。**已优化** `start-all.vbs` 的 `PortAlive()` 改 netstat，真实输出 4/4 验证。TTS 常驻 426MB，建议不做定时全关 |

---

## 四、2026-11-22 深夜 ~ 11-24 的工程化改动

- **v15 → v16**（23:50~00:10）：v15 冻结，防护层落地
- **localStorage 脏数据根治**：桥接地址恢复加 37700-37799 白名单（旧 8080 残留自动忽略）；查词面板几何恢复加可见率校验（<25% 自动回正）；`callMysqlApi` 加 15s `AbortController` 超时
- **TTS 启动闪退根治**：bat 的 GBK 环境打印 emoji 触发 `UnicodeEncodeError` → 代码层 `sys.stdout.reconfigure(utf-8, replace)` + bat 层 `PYTHONIOENCODING=utf-8` 双保险
- **start-all.vbs 正式版**：零窗口、端口探活、幂等、日志落 `start-all.log`
- **v16 插件副本恢复**：从 v14 拷回 `plugin-para-vocab-slider.js` + `plugin-vocab-srs.js`，包成注册队列
- **2026-11-24**：CDN 全本地化（`v16\vendor\`）；桌面壳指向 v16；JS 语法全量 `vm.Script` 检查通过
- **2026-11-25**：需求 24 个人笔记（前后端双写）；需求 25/26 两份调研/评估文档；`start-all.vbs` 端口探测从 XMLHTTP(2s) 优化为 netstat(0.05s)，备份 `.bak_20261125_req26`；浏览器插件从 v14 迁入主线（现 `v17\extension\lt-lookup\`，manifest 1.1.0）
- **v17 升级（2026-11-25）**：模型接口全面改 OpenAI 兼容 `/v1/chat/completions` + `/v1/models`。前端新增 `callOpenAI()`/`getModelApiBase()`，4 处生成 + 1 处探测全改；后端桥接加 `_openai_chat()`/`_openai_chat_url()`，备份 `.bak_20261125_v17`；补全改动笔记 `v17/skill.md`（架构图/版本表/铁律）+ `v17/问题总览.md`（接口映射表）。本机 Ollama 端到端验证通过

---

## 五、当前待决策事项

**桌面端技术选型**（对应"进阶需求 2"）：Rust(Tauri v2) / Go(Wails v2) / Python(pywebview)。

已完成的独立分析见 `Md\桌面端选型分析-Tauri-vs-Wails.md`，核心结论：

1. **壳不是瓶颈**——架构是厚 Python 后端，Tauri/Wails 的 Rust/Go 后端无法替代 Kokoro TTS 和 Ollama，所谓"重写后端省掉本地端口"不成立；
2. Gemini 此前对比表的端口（8080）、痛点（进程残留）、方案（pywebview 套壳）均已过时或已实现；
3. 自用 → 继续 pywebview（已可用）；要分发 / 全局快捷键 / 划词翻译 → Tauri v2；不想学 Rust → Wails v2。

---

## 六、开发环境固定项（别再探测）

- Python：`D:\Software\python3.10.9\python.exe`（已装 numpy 2.2.6 / onnxruntime 1.23.2 / kokoro-onnx 0.6.1 等，**cp310 轮子**；曾有 cp313 轮子误装事故，装完必须 `import` 验证）
- Node：`D:\nodejs\node.exe`
- 数据根：`F:\EnglishReaderDataDict\`
- 写 .bat 铁律：**CRLF + ASCII**（中文走 GBK 会乱码；emoji 会让 Python 打印崩溃）
