# Findings — 需求24~26

## 需求24 探查结果（2026-11-25）

### 前端（v16/lt_reader_v16.html）
- `renderDictResultCard(entry, sourceLabel, auth)` @1343 —— 查词卡渲染，**4 个调用点**：
  - 1504（AI 例句刷新）、2370（正文双击浮层）、3531（权威词典兜底）、3544（独立查词页主路径）
  - → 在函数内注入笔记区即可两处生效，无需改 4 个调用点
- `LocalDB` @2789：`dbName='IeltsReaderDB_v14'`, `version:1`
  - 现有 5 个 store：nodes / articles / plugins / global_dict / reading_progress
  - **无 word_notes**，需 version→2 + onupgradeneeded 建 store
  - `LocalDB.put/get` 对 nodes/articles 有 MySQL 分支；新 store 走纯 IndexedDB（笔记单独走自己的双写逻辑）
- 备份导出 `exportFullDatabase()` @5555 只导 nodes/articles/plugins → **需加 word_notes**
- 导入 `importFullDatabase()` @5559 只恢复 nodes/articles → **需加 word_notes**
- `executeDictLookupCore()` @3544 主路径查完词渲染后，还要 LocalDB.put nodes/articles 归档

### 后端（F:/EnglishReaderDataDict/2mysql_bridge_server.py，1810 行）
- FastAPI + get_conn() + init_business_tables(conn) 惯例
- 建表模板：`translate_logs` @783（CREATE TABLE IF NOT EXISTS ... ENGINE=InnoDB utf8mb4）
- 接口模板：`/api/settings/get|save` @1588/1606（get_conn → init → cursor → commit → close → try/except 日志）
- 需新增：`word_notes` 表（word VARCHAR 主键 / note TEXT / created_at / updated_at）
  + `/api/wordnote/get`（body: word） `/api/wordnote/save`（body: word, note）

### 上下文
- 用户明确：IndexedDB 存实际使用（离线快），MySQL 存备份（防丢）—— 双写
- 借鉴欧路词典"个人笔记"：查词时释义下方回显

## 需求25 完成（2026-11-25）
- 产出 `Md/词典释义方法论调研.md`
- 核心结论：贴合真实需求 = 频率驱动排序 + 真实语境例句 + 场景/学科标注 + 个人化闭环
- 欧路=词典容器（牛津/朗文/柯林斯编排）+ 词根词缀/辨析/笔记；有道=网页萃取网络释义（按网页频次排序）+ 2300万例句 + 60万/200学科标注
- LT-Reader 已具备 7 项（多词典/占比条/领域标注/例句/英美音/AI三段问答/个人笔记）；建议补"义项按常用度排序"(d.ratio) 和"近义词辨析"(复用 runAiWordQA)

## 需求26 完成（2026-11-25）
- 产出 `Md/项目快速拉起评估.md`
- 实测：冷启动 7~8s（start-all.log 真实记录）；TTS 模型加载仅 1.4s（非瓶颈）；服务就绪后响应 2~466ms
- 🔴 抓到真实问题：评估当下 37701 桥接挂了（仅 TTS+Ollama 在跑）
- 🔴 隐藏瓶颈：XMLHTTP/TCP 探死端口 ~2s/次，netstat 读状态表 ~0.05s/次（慢 44 倍）
- 已优化 start-all.vbs 的 PortAlive()：XMLHTTP → netstat 逐行解析；备份 .bak_20261125_req26；真实 netstat 输出 4/4 验证通过
- 建议（未做）：lt_app.py 改用 start-all.vbs /nopage；前端加桥接自愈提示；不做"定时全关"

## 需求24 实现结果（2026-11-25）
- P1 后端：加 word_notes 表 + /api/wordnote/get|save，py_compile 通过；备份 .bak_20261125_req24
- P2 前端：LocalDB v1→2 加 word_notes store；renderDictResultCard 注入笔记区（4 调用点自动生效）；
  双写（IndexedDB 主 + MySQL 备份）；备份导出/导入同步 wordNotes；备份 .bak_20261125_req24
- P3 验证：vm.Script 语法 0 错；17 项 mock 断言全 PASS
- ⚠️ 真实接口联调未完成：sandbox 下后台服务随 shell 回收 / start /min 进程被会话隔离，
  37701 无法持续 LISTEN。前台启动时服务正常（日志为证，ping 3397227 词），
  属环境限制非代码问题。用户本机双击 start-all.bat 后可补真调。
