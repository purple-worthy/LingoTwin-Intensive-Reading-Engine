# LT-Reader 桌面端选型分析：Rust (Tauri v2) vs Go (Wails v2)

> 分析时间：2026-11-24
> 依据：真实源码核对（`v16/lt_reader_v16.html`、`lt_app.py`、`2mysql_bridge_server.py`、`tts/tts_server.py`、`端口与服务说明.md`）
> 输入：Gemini 给出的四框架对比表 + 选型建议

---

## 一、结论先行

**推荐 Rust (Tauri v2)，但理由和 Gemini 完全不同——而且当前阶段更该做的是先把 pywebview 方案修好。**

三档决策：

| 场景 | 推荐 | 成本 | 理由 |
|---|---|---|---|
| A. 自己用、不分发 | **继续 pywebview**，修 `lt_app.py` 指向 v16 + CDN 本地化 | ~1 小时 | 壳已经写好，瓶颈不在壳 |
| B. 要分发给别人 / 追求极致启动 / 未来做全局快捷键、划词翻译 | **Rust + Tauri v2** | 2~4 周（主要是学 Rust + 进程管理） | 生态成熟度、系统级扩展能力最强 |
| C. 不想碰 Rust 所有权机制 | **Go + Wails v2** | 2~3 周 | 完全可接受的平替，开发心智负担最低 |

**核心判断**：你的架构是「**厚 Python 后端 + 薄 HTML 前端**」。无论 Tauri 还是 Wails，都只是「壳 + 进程管理器」——后端那三个服务一个都绕不开。Gemini 说的"用 Rust 把桥接重写进 Tauri 后端、直接用 invoke"听起来很美，但它只覆盖了 1/3，而且是最简单的 1/3。

---

## 二、Gemini 分析的四处事实错误

| # | Gemini 的说法 | 你的真实代码 | 影响 |
|---|---|---|---|
| 1 | `fetch('http://127.0.0.1:8080/...')` | 端口早在 2026-11-22 迁到 **37701 / 37702**（`端口与服务说明.md`）；`lt_reader_v16.html:905` 默认 `http://127.0.0.1:37701` | 它拿的是旧上下文，按它说的改会直接把能跑的地址改坏 |
| 2 | 只需处理 MySQL 桥接 | 实际有 **三个本地服务**：桥接 37701（FastAPI+pymysql，74KB）、Kokoro TTS 37702（ONNX+phonemizer+espeakng）、**Ollama 11434**（`lt_reader_v16.html:1449/3490` 做 IPA/例句/段落翻译） | 漏掉的 Ollama 和 TTS 恰恰是"Rust 重写"最难啃的两块 |
| 3 | "彻底解决进程残留与手动启动痛点" | `start-all.vbs` 已做到**零窗口、端口探活、幂等跳过**（端口文档第 40 行）；服务刻意设计为**常驻不自动退出**（第 22 行） | 这个"痛点"是你刻意的设计选择，不是待修的 bug |
| 4 | "今天下午就上线"的 pywebview 方案 | 你已经做了：`F:\EnglishReaderDataDict\lt_app.py` + `start-desktop.bat` | 它推荐的"快速过渡"你已经走完，真正的问题是"要不要升级"，不是"要不要套壳" |

附带一个版本问题：**你现在最新是 v16**（370KB / 6322 行），而 `lt_app.py:24` 还指向 `v15\lt_reader_v15.html`——桌面壳打开的是旧版。这个先修。

---

## 三、你的真实架构（证据链）

```
┌─────────────────────────────────────────────┐
│  v16/lt_reader_v16.html  (370KB, 6322 行)   │  ← 薄前端
│  + 3 个本地 plugin JS（相对路径引用）        │
│  + CDN: jszip 3.10.1 / pdf.js 3.11.174      │
└──────────────┬──────────────────────────────┘
               │ fetch (79 处 localStorage/fetch/端口相关)
   ┌───────────┼────────────┬─────────────────┐
   ▼           ▼            ▼                 ▼
桥接 37701   TTS 37702   Ollama 11434   在线兜底
FastAPI      Kokoro-82M   /api/generate  Google TTS
+pymysql     ONNX+G2P     /api/tags      有道发音
339万词库    54音色        qwen3:4b
   └───────────┴────────────┴─────────────────┘
              ↑ 三个都是独立 Python/外部进程   ← 厚后端
   start-all.vbs 幂等拉起 / stop-all.bat 统一停止
```

关键代码位置：

| 依赖 | 位置 | 说明 |
|---|---|---|
| CDN 脚本 | `lt_reader_v16.html:22-23` | jszip、pdf.min.js（还有 `:3631` 的 pdf.worker.min.js） |
| 本地插件 | `lt_reader_v16.html:6320-6321` | `plugin-para-vocab-slider.js`、`plugin-vocab-srs.js`（相对路径，Tauri/Wails 直接可用） |
| 桥接地址 | `lt_reader_v16.html:905, 2680` | `getBridgeUrl()` 从输入框读，默认 37701 |
| Ollama | `lt_reader_v16.html:1449, 3446, 3490` | IPA/例句生成、段落翻译 |
| TTS | `lt_reader_v16.html:4311, 4339` | `/voices`、`/health` |
| 桌面壳 | `lt_app.py:24` | **指向 v15，需修正** |

**这说明什么**：Tauri 的 `invoke('lookup_word')` 替代 fetch，只涉及桥接 37701 这一条链路。TTS 的 Kokoro 推理（onnxruntime + phonemizer + espeakng）在 Rust 里没有成熟对等实现；Ollama 本来就是独立进程。所以"把后端用 Rust 重写掉、连本地端口都省了"在你的项目里**不成立**。

---

## 四、Rust (Tauri v2) vs Go (Wails v2) —— 针对本项目的对比

两者在**壳的功能上几乎等价**：调用系统 WebView2、单 exe、进程生命周期一体、前端 95% 不用改。真正的差异在这几处：

| 维度 | Rust + Tauri v2 | Go + Wails v2 | 谁赢 |
|---|---|---|---|
| **生态与文档** | 社区大、插件多（全局快捷键/系统托盘/窗口透明等），遇到问题好查 | 社区小一档，部分 Windows 细节坑需自己踩 | **Tauri** |
| **进程管理** | 能写，但 `std::process` + 所有权要处理 | `os/exec` 直观，拉起/回收 3 个服务写起来更顺 | **Wails** |
| **前后端通信** | `invoke` + 事件系统，心智模型清晰、类型可生成 | 方法绑定（直接把 Go 方法暴露给 JS），更简单但类型弱 | 平手 |
| **学习成本** | 所有权/生命周期，心智负担陡 | 语法接近 Python，编译极快 | **Wails** |
| **单 exe 体积** | ~5-10 MB | ~8-15 MB | Tauri 略优（但都不是决策点） |
| **长期维护** | 你和这个项目还要活很久，Tauri 的生态红利会持续兑现 | 够用，但生态更新慢 | **Tauri** |
| **WebView2** | 都调用系统自带，不内嵌 Chrome | 同左 | 平手 |

**我的倾向**：如果决定换壳，**Tauri v2** 略优——不是因为体积小几 MB，而是因为：
1. 你的前端会持续加插件（v16 已经有 3 个 JS 插件），未来大概率要加全局快捷键、划词翻译、系统托盘，Tauri 的插件生态更省心；
2. 壳本身要写的 Rust 代码量很小（就是"启动/回收子进程 + 窗口配置"），所有权机制不会成为主战场——**你真正的复杂逻辑还在 Python 和 JS 里**；
3. 你此前对 Rust 有过关注，这条路和你的技术兴趣一致。

但如果 Rust 的所有权让你写个进程管理都卡住，**果断转 Wails**——因为你的核心价值不在壳上，没必要为一个壳耗死自己。

---

## 五、落地路径（按推荐顺序）

### 阶段 0：先做无论选什么都要做的事

1. **修 `lt_app.py:24`**：`v15\lt_reader_v15.html` → `v16\lt_reader_v16.html`
2. **CDN 本地化**（Gemini 这点说对了）：把 3 个文件下载到 `v16\vendor\`，改 `:22-23` 和 `:3631` 为相对路径
   - `jszip.min.js`（3.10.1）
   - `pdf.min.js` + `pdf.worker.min.js`（3.11.174）
   - 顺带把 `pdfjsLib.GlobalWorkerOptions.workerSrc` 改成相对路径
3. **验证**：断网双击 `start-desktop.bat`，PDF 导入 + 查词 + TTS + Ollama 翻译全部可用

做完这三步，你就有一个**完全离线、零浏览器、双击即开**的桌面软件了。先享用一段时间，再决定要不要换壳。

### 阶段 1（可选）：换 Tauri v2

```
项目结构：
lt-tauri/
├── src-tauri/
│   ├── src/main.rs          # 只做：启动/回收 37701+37702+Ollama，配置窗口
│   ├── src/process.rs       # 幂等拉起服务（端口探活）+ 退出时 kill 进程组
│   └── tauri.conf.json      # 窗口 1500x950, min 900x600, 单实例
└── frontend/                # 直接 copy v16 整个目录（含 plugin JS + vendor）
```

关键原则：
- **保留所有 fetch 到 37701/37702/11434**，不要第一步就改成 invoke
- Rust 侧只负责：启动时确保服务就绪（复用 `start-all.vbs` 的端口探活逻辑）、窗口关闭时回收子进程
- 等壳稳定了，再考虑把桥接的 1~2 个高频接口（如 `lookup_word`）改成 invoke，做 A/B 对比

### 阶段 2（可选）：系统级集成

全局快捷键划词翻译、系统托盘、剪贴板监听——这些是 Tauri 相对 pywebview 的**真实增量价值**，也是值得换壳的理由。

---

## 六、需要你确认的三个问题

1. 你要"独立 exe"的动机是什么？**自己用得爽**，还是要**发给别人**（比如分享给学英语的朋友）？后者才真正需要单 exe 分发。
2. 你说的"进程残留痛点"具体指什么？`start-all.vbs` 的零窗口幂等方案现在还在出问题吗？还是 Gemini 替你总结出来的？
3. 未来 6 个月会不会加**全局快捷键 / 划词翻译 / 系统托盘**？会 → Tauri 的收益才真正兑现；不会 → pywebview 修一修就够。

---

## 七、一句话总结

> 壳不是你的瓶颈，三个 Python 服务才是。先把 pywebview 的路径和 CDN 修好（1 小时），跑稳了再谈 Tauri vs Wails；真要换壳，选 Tauri 是因为它的生态能陪你走下一步，不是因为它比 Wails 小 5MB。
