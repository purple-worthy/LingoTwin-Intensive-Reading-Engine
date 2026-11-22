# 项目长期记忆 — 英语精读器（LT Reader）

## ⭐ 发音/朗读（2026-11-22 定稿，别再重复排查）

**本机 Chrome 没有任何本地英文音色**（实测只有 3 个中文 OneCore 音色 + 一批 Google 网络音色），
所以 `speechSynthesis` 读英文必然走在线合成 → 卡 30~60 秒。这就是"点喇叭很慢"的根因。
（注册表里的 `Microsoft Zira Desktop` 属 SAPI5，Chrome 不上报，别指望它。）

现有四级降级链（`lt_reader_v15.html` 的 `SpeechEngine`）：
1. **本地 Kokoro** `F:\EnglishReaderDataDict\tts\tts_server.py`（端口 **37702**）
2. 本地真人音：朗文 mp3（`/dict-assets/ldoce6/...`，0.1s）→ 欧路补位 → 有道
3. Google `translate_tts`（整句，按句切块 + 预取下一句）
4. 浏览器 `speechSynthesis`（离线兜底，显式锁定音色并按语族过滤）

### ⭐ 端口已迁移（2026-11-22 起，别再用 8080/8081）

| 服务 | 旧端口 | **新端口** |
|---|---|---|
| MySQL 桥接（2mysql_bridge_server.py） | 8080 | **37701** |
| Kokoro TTS（tts/tts_server.py） | 8081 | **37702** |
| LT-Reader 专属段 | — | **37700-37799**（新服务从 37703 往上排，禁用 8080/8000 等常见端口） |

权威文档：`F:\EnglishReaderDataDict\端口与服务说明.md`（端口分配、13 处修改点、故障排查速查都在这）。
**页面"MySQL 连不上/查词面板不显示"先查 localStorage 脏数据**（2026-11-22 深夜已修，见下方 v15.5）。

### 启动方式（2026-11-22 集中到 F:\EnglishReaderDataDict）

| 脚本 | 作用 |
|---|---|
| `start-all.bat` | 拉起桥接 37701 + 发音 37702，已在跑就跳过，不阻塞 |
| `start-all-silent.vbs` | 隐藏窗口版，WebStorm「Before launch」用 |
| `stop-all.bat` | 按端口停这两个服务 |
| `tts\start-tts.bat` | 只起发音服务 |

⚠️ 写 .bat 铁律：**CRLF + GBK**（`chcp 936`）。LF 单独存在会让 cmd 拆错 `(` 块；
UTF-8 中文会被按 GBK 解析成乱码。最省事是文案全 ASCII。

**Kokoro 服务四条铁律**（改代码前先读 `v15/tts/README.md`）：
- 推理必须在**主线程**（Python 工作线程里慢 10~20 倍）→ HTTP 收包放后台线程，推理走主线程 `JOBS` 队列
- `session.intra_op.allow_spinning=0`（不关会先快后慢，掉到 4s）
- 不要显式设 `intra_op_num_threads`（混合架构反而更慢）
- int8 动态量化不可用（`ConvInteger` CPU EP 未实现）

模型：`D:\ollama\voice-assistant\kokoro-v1.0.onnx` + `voices-v1.0.bin`；
音色：**Setting → 2.5 本地发音服务** 里可换（美音 20 个 / 英音 8 个，从 `/voices` 拉取，
默认 `af_heart` / `bf_emma`，选完立即试听并写 localStorage `lt_tts_voice_v152`）；
Kokoro 限速 0.5~2.0，页面 0.25x/3x 用 playbackRate 补齐。

### PotPlayer 那条线（2026-11-22 查清，别再想）

PotPlayer 没有自带语音包 —— TTS 面板只有「语音引擎 / 输出设备 / 速度 / 音量」，
走的是 Windows SAPI5，本机就 Zira(en-US) + Huihui(zh-CN) 两个，音质远不如 Kokoro。
它的「无回音速度控制」= 时域变速不变调，和我们用 playbackRate 等价，DSP 也没法单独复用。
`Module\Whisper` 是 whisper.cpp 语音识别（生成字幕），与 TTS 无关。

### Python 环境（一律用 `D:\Software\python3.10.9\python.exe`，**不要用沙箱 3.13**）

- 已装：numpy 2.2.6 / onnxruntime 1.23.2 / av 17.1.0 / kokoro-onnx 0.6.1 /
  phonemizer / espeakng-loader / onnx / sympy / faster-whisper 1.2.1 / sounddevice
- ⚠️ 曾把 **cp313 的 numpy/onnxruntime 装进这个 3.10 环境**（`lib\numpy\_core\*.cp313-win_amd64.pyd`），
  导致 import 全失败；还曾把包装到 `lib\` 而非 `lib\site-packages\`。**装完必须 `python -c "import X"` 验证**。
- pip 走公网经常中断，**用 curl 下 wheel 再本地 install** 最稳（`--resume-retries` 有用）
- `v15/tts` 的服务不需要 soundfile / sounddevice（自己写 WAV，不直接放声）；av 只有 faster-whisper 用

## Python 环境（2026-11-17 用户手动装包）

用户于 2026-11-17 手动批量下载/安装 Python 包，用于「考研真题 PDF 解析 Agent」链路。

### 可用能力分组

- ✅ **PDF 文本提取**：`pymupdf`（fitz）、`pypdfium2`、`pdfplumber`（未确认）、`python-docx`
- ✅ **OCR**：`paddleocr` + `paddlex` + `opencv-contrib-python==4.10.0.84` + `pyclipper` + `shapely`
- ✅ **NLP**：`spacy`（+ legacy/loggers）、`nltk`、`regex`、`textblob`(未确认)
- ✅ **LLM/Agent**：`langchain` / `langgraph` / `langchain-core` / `langgraph-checkpoint` / `langgraph-prebuilt` / `langgraph-sdk` / `langsmith` / `openai`(原有)
- ✅ **工具库**：`chardet` `colorlog` `prettytable` `py-cpuinfo` `ruamel.yaml` `ujson` `imagesize` `python-bidi` `defusedxml` `joblib` `xxhash` `jsonpatch` `jsonpointer` `ormsgpack` `zstandard` `async-timeout` `cryptography` `cffi` `pycparser` `scikit-learn` `threadpoolctl` `cloudpickle` `sympy` `networkx` `mpmath`
- ✅ **模型/SDK**：`modelscope` `modelscope-hub` `aistudio-sdk` `bce-python-sdk` `pycryptodome` `future` `crc32c` `transformers` `safetensors` `huggingface-hub`(原有)
- ⚠️ **暂不可用**：`sentence-transformers` —— 强依赖 `torch`，torch 下载到 ~30MB 时用户取消，未装成功；`scipy` 状态不明（日志显示下载完了但未确认安装）
- ✅ 原有已存在：`openai` `python-dotenv` `pydantic` `rich` `tenacity` `pandas` `lxml` `pyyaml` `requests` `aiohttp` `filelock` `pillow` `packaging` `tqdm` `jinja2` `httpx` `psutil` 等

### ⚠️ 已查清（实测 2026-11-17 16:01）：那 70 个包其实一个都没装上

> 2026-11-22 补注：numpy / onnxruntime 的“损坏”其实是**被装了 cp313 版本的轮子**，
> 用户已手工换成 cp310 版（numpy 2.2.6 / ort 1.23.2），现在 `import numpy` 正常。
> 本节其余内容（哪些包从来没装上）仍然成立，但**用前先 `pip list | grep` + import 验证**。

用户自述"本机只剩 `D:\Software\python3.10.9\`，PATH 里没有 3.13"——**对系统 PATH 而言正确**。
但WorkBuddy 自带一个**内置解释器** `C:/Users/袁新波/.workbuddy/binaries/python/versions/3.13.12/python.exe`，
它不进系统 PATH，所以用户在 PATH 里看不到；之前我 import fitz 失败用的就是它。

实测两个解释器都没装用户说的那批包：

- **3.10.9**（`D:\Software\python3.10.9\python.exe`）：`Lib\site-packages` 有 137 个包，
  但是 fastapi / pydantic / rich / lxml / requests / pymysql / readmdict 这批**老包**，
  `pip list | grep` 只命中 numpy，**没有** pymupdf / spacy / paddleocr / langchain / python-docx。
  另注意该环境包被装在**小写 `lib\`**（不是 `Lib\site-packages`），numpy 2.5.1 从 `lib\numpy` 加载，
  且 `import numpy` 报 `No module named 'numpy._core._multiarray_umath'`（环境已损坏/版本不匹配）。
- **3.13.12 内置**：site-packages 同样无 fitz/pymupdf 等。
- Downloads 无 `.whl`，pip wheel 缓存为空。

**结论**：用户日志里"下载完成，大概率安装成功"是误判——下载完 ≠ install 成功，
实际 install 没落地。sentence-transformers 缺 torch 只是最明显的一个，其余包同样不可用。

**下次策略**：不要再假设包装好了。真需要 pymupdf 时，先跟用户确认用哪个解释器
（推荐系统 3.10.9，完整路径 `D:\Software\python3.10.9\python.exe`），
用 `python.exe -m pip install pymupdf` 显式安装并 `import fitz` 验证后再动手。
好消息：V15 的 PDF 提取已用 `workbuddy-pdf` CLI 完成，不依赖这些包。

### 能力边界与策略

- 若 RAG 向量检索暂时不需要 → **不用装 torch**，直接用 PDF 解析 + Ollama/LLM 做试卷解读。
- 扫描版试卷 → paddleocr + opencv 链路可用。
- 文字版试卷 → pymupdf（需先定位解释器）或项目内 pdf.js（见下）。

## 项目架构约定

- 主线版本目录 `vN/`，当前最新 `v14/`（主文件 `v14/lt_reader_v14.html`，约 187KB，单文件 HTML）。
- 项目已用 pdf.js 3.11.174 支持 PDF 导入；`parsePdfClean` 早期只是 `join(' ')` + 每 3 页一章，排版丢失。
- 2026-11-17 已重写为视觉坐标重组 `rebuildPdfLineObjects()`：
  - `transform[5]` → `pageH-y` 取视觉坐标，按 y 聚行、按 x 拼字，大间隙拆左右栏，整页双栏先左后右。
  - Section/Part/Passage 做章节（连续标题各自成章）；Directions 独立段；A/B/C/D 选项独立段；
    题号合并续行；缩进阈值区分段首(1.6×h)与续行(3.2×h)；换页断段。
  - 测试：行重组 11/11、两页模拟考研阅读 9/9。
  - 限制：图表不保留（readers paragraphs 无图片字段）；双栏靠间隙启发式。
- 后端桥接 `F:/EnglishReaderDataDict/2mysql_bridge_server.py`；词典 MySQL + ECDICT；Ollama 本地模型。
- 浏览器插件 `v14/extension/lt-lookup/`：双击查词 / 划词放大镜 / 长文本段落分析；面板可拖拽缩放、
  ⇋ 切位置、📌 图钉、◐ 透明度、historyStack 嵌套查询与逐层返回。
