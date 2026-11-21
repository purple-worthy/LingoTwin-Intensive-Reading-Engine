# 知语双栏精读引擎 (LingoTwin Reader / LT-Reader) 完整工程档案

---

## 第一部分：整体系统架构信息

### 1. 项目命名规范
- **中文全称**：知语双栏精读引擎
- **英文全称**：LingoTwin Intensive Reading Engine
- **工程简写**：`LT-Reader`
- **核心文件组成**：
  - `lt_reader_v14.html`：单文件纯原生前端微内核主程序（Zero-Build，零构建依赖）。
  - `mysql_bridge_server.py`：基于 Python FastAPI + PyMySQL 的本地轻量数据库网关服务（端口 `8080`）。
  - `import_stardict_to_mysql.py`：ECDICT 全量 340 万词库一次性幂等导入脚本。
  - `start_bridge.vbs`：Windows 静默无黑框后台拉起脚本（配合 WebStorm / IDEA `Before launch` 任务）。
  - `plugin-para-vocab-slider.js`：外部热插拔扩展功能插件（段落同步滑动释义窗）。

### 2. 四层混合架构图

```text
+-----------------------------------------------------------------------------------+
| 1. 前端交互与微内核视图层 (lt_reader_v14.html)                                    |
|   ├── 双视图切换：📖 精读正文视图 (双栏排版/下划线逐词注音) | 🔍 独立查词工作台   |
|   ├── 插件总线：ReaderFeaturePlugins (功能插槽) + ReaderThemePlugins (主题皮肤)   |
|   ├── 电子书引擎：JSZip (EPUB) + PDF.js (PDF) + MOBI/AZW3/TXT 章节解析器          |
|   └── 语音合成：Web Speech API (支持 en-GB 英音 / en-US 美音 + 0.25x~3.0x 7档语速) |
+-----------------------------------------+-----------------------------------------+
                                          | HTTP REST / JSON (CORS放行)
                    +---------------------+---------------------+
                    v                                           v
+---------------------------------------+   +---------------------------------------+
| 2. 本地数据持久层 (MySQL 8.0 + 网关)  |   | 3. 本地大模型推理层 (Ollama API)      |
|   ├── 网关：mysql_bridge_server.py    |   |   ├── 端点：http://localhost:11434    |
|   ├── 守护：Heartbeat(3s) + Watchdog  |   |   ├── 推荐模型：tencent/Hy-MT2-1.8B   |
|   ├── stardict (340万全量词典主键表)  |   |   └── 职责：断点续译纯中文 + 新词兜底 |
|   ├── reader_nodes (5层树形目录表)    |   +---------------------------------------+
|   ├── reader_articles (精读正文JSON)  |
|   └── reader_settings (配置/插件状态) |
+---------------------------------------+
```

### 3. MySQL 数据库表结构 (`database: ecdict`, `charset: utf8mb4`)
1. **`stardict`**：`word` (`VARCHAR(128) PRIMARY KEY`), `phonetic`, `pos`, `translation`, `oxford`, `collins`, `frq`。利用聚簇 B+ 树索引实现批量 `IN (...)` 查询耗时 `< 5ms`。
2. **`reader_nodes`**：`id`, `parent_id`, `type` (`folder` / `book` / `chapter` / `article`), `title`, `order_index`, `created_at`, `expanded`。
3. **`reader_articles`**：`id`, `data_json` (`LONGTEXT` 存储完整 `paragraphs`、`tokens`、`vocabulary` 及 `isTranslated` 断点标记)。
4. **`reader_settings`**：`cfg_key`, `cfg_val`（持久化保存 Ollama 地址/模型、语速、主题、词表排布偏好）。

---

## 第二部分：核心开发日志与技术演进点

| 版本阶段 | 核心解决痛点 | 关键技术点与架构影响 | 涉及核心 JS / Python 函数名 |
| :--- | :--- | :--- | :--- |
| **v8.0** | Ollama 虚假模型显示、段落无编号、C盘沙盒限制 | 移除硬编码假模型，建立真实 `/api/tags` 连通探测状态机；新增段落编号徽章；支持 File System Access API 绑定任意磁盘目录。 | `fetchOllamaModels()`<br>`setOllamaUIState()`<br>`bindLocalDirectory()` |
| **v9.0** | 大模型输出复杂 JSON 慢且易中断、重译从头开始 | **职责分离架构**：本地词库 0ms 标注所有单词音标与词性，Ollama 剥离 JSON 负担仅输出纯中文译文，速度提升 5~8 倍；段落增加 `isTranslated` 标记实现断点续译与手动中止。 | `translateParagraphsFast()`<br>`analyzeChapterResume()`<br>`abortOllamaTask()` |
| **v10.0** | 打通 340 万全量词库与书籍落库 MySQL、提示框遮挡 | 编写 FastAPI 桥接服务与幂等导入脚本 (`INSERT IGNORE`)；设置与文章全量存入 MySQL；Toast 提示条移至屏幕左下角避免遮挡按钮。 | `connectAndSyncMysql()`<br>`callMysqlApi()`<br>`persistSettingsToStorage()`<br>`autoAnnotateTokensWithDict()` |
| **v11.0** | 朗读语速不可调、长译文按钮挤压文字、词性比例难懂 | 内置「朗读语速插件」(0.25x~3.0x)；译文区改用 `flex-wrap` + `min-width: 240px` 防挤压排版；实现 ECDICT `c:88/n:12` 语料占比中文解析器。 | `explainPosRatioCode()`<br>`showPosTooltip()`<br>`speakParagraph()` |
| **v12.0** | 全量词表把右侧栏拉得过长、左侧底部大面积留白 | **动态视口高度平衡算法**：测量左侧正文总高度 `leftBox.offsetHeight`，右侧保留等高范围内词条，超出部分自动溢出到底部 4 列网格。 | `renderArticleView()`<br>`balanceSideAndBottomVocab()` |
| **v13.0** | 进程残留、独立查词需求、专有翻译模型适配 | 后端加入 `3s 心跳 + 10s 看门狗 + pagehide sendBeacon` 自动退出；新增「🔍 独立查词」页面及自动归档至 `📁 单词查询归档`；适配 `Hy-MT2-1.8B`。 | `switchMainPage()`<br>`executeDictLookup()`<br>`ensureQueryArchiveFolder()` |
| **v14.0 & 滑动窗插件** | 刷新丢失外部插件、局部查词不便 | 修复启动时从数据库恢复外部插件；新增插件 `删除` 按钮与 `onEnable/onDisable/onArticleRendered` 钩子；开发 `plugin-para-vocab-slider.js` 实现当前段专属滑动词释窗（高度对齐段落且支持拉长至 11 词高度）。 | `loadExternalFeaturePlugin()`<br>`removeExternalPlugin()`<br>`notifyArticleRendered()`<br>`renderSliderWindow()` |

---

## 第三部分：关键技术难点与工程影响点分析

1. **浏览器安全沙盒与原生能力桥接（影响点：前后端通信与生命周期）**
   - *难点*：纯静态 HTML 无法直连 MySQL TCP 3306 端口，也无法直接控制操作系统进程生命周期。
   - *解法*：通过 WebStorm/IDEA 的 `Before launch` 调用 `wscript.exe` 静默执行 `start_bridge.vbs` 拉起 Python 服务；关闭页面时利用 `navigator.sendBeacon` 触发 `0.8s` 延迟退出（防止 `F5` 刷新误杀），并辅以后台线程看门狗兜底，实现零进程残留。
2. **小参数本地模型（1.8B ~ 4B）防截断与高吞吐推理（影响点：翻译稳定性与速度）**
   - *难点*：4B 以下本地模型直接生成嵌套词典 JSON 时极易发生格式破坏或 Token 耗尽中断。
   - *解法*：将词法解析（音标、词性、分级、`<rt>` 字下释义）100% 卸载给 MySQL 聚簇索引批量查询（`2~5ms`），大模型仅承担纯文本翻译，单段耗时降至 `0.5~1.5s`，且每段完成即刻落库，支持随时中断与断点续传。
3. **非侵入式微内核插件总线（影响点：功能扩展与状态一致性）**
   - *难点*：外部插件加载后不仅要修改界面，还需与 `Setting` 面板中的单选状态互斥同步，并在刷新页面后持久化保留。
   - *解法*：所有外部 `.js` 插件源码文本直接序列化存入本地数据库 `plugins` 表，启动时自动重放执行，并通过 `onEnable` / `onDisable` 钩子双向同步 `vocabLayoutPref` 全局状态。

---

## 第四部分：标准 Agent 协作规范 (`SKILL.md`)

```markdown
---
name: lt-reader-architect
description: 知语双栏精读引擎 (LingoTwin Reader / LT-Reader) 全栈架构与插件开发技能。当用户需要修改双栏精读 HTML 引擎、开发外部功能/样式插件、优化 MySQL 340万词库查询接口或调整 Ollama/Hy-MT2 翻译流水线时触发。
---

# 知语双栏精读引擎 (LT-Reader) 开发规范

## 1. 核心数据契约 (Article JSON Schema)
任何导入、AI 生成或渲染的文章对象必须严格遵循以下结构：
- `id`: 字符串唯一标识（与目录树节点 `reader_nodes.id` 一一对应）
- `category`: 所属书籍或分类名称
- `titleEn` / `titleCn`: 英文标题与中文标题
- `paragraphs`: 数组，每项包含：
  - `isTranslated`: 布尔值（标记是否已完成译文，供 Ollama 断点续译跳过）
  - `tokens`: 逐词数组 `[{ "text": "word", "gloss": "字下简明义", "tier": "red|normal|func" }]`
  - `translation`: 整段中文翻译文本
- `vocabulary`: 数组，每项包含 `{ "word": "小写词头", "ipa": "[音标]", "level": "core|basic", "defs": [{ "pos": "词性/占比", "meaning": "释义" }] }`

## 2. 外部插件开发 SDK 规范
外部功能插件必须通过 `window.ReaderFeaturePlugins.register({...})` 注册，并实现标准生命周期钩子：
- `id` (string) & `name` (string) & `description` (string)
- `renderToolbar(app)`: 可选，返回插入顶部工具栏的 HTML 字符串
- `onMount(el, app)`: 绑定工具栏 DOM 事件
- `onEnable(app)` / `onDisable(app)`: 插件开关切换或被删除时的状态清理与样式还原
- `onArticleRendered(art, app)`: 每次主视图 `renderArticleView()` 完成后的回调钩子

## 3. 修改约束与红线
1. **保持单文件零构建架构**：前端 HTML 不引入 Webpack/Vite 等打包工具，所有依赖通过 CDN 或原生 ES2022 实现。
2. **禁止硬编码虚假连接状态**：Ollama 与 MySQL 状态必须经真实 API 探测（`/api/tags` 与 `/api/ping`）后方可点亮绿灯。
3. **非侵入式提示**：所有全局操作反馈统一调用左下角 `showToast(msg)`，禁止使用遮挡顶部工具栏的居中浮层。
```