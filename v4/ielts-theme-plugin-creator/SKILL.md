---
name: ielts-theme-plugin-creator
description: 为“双栏逐词精读电子书引擎”生成可热插拔的外部样式插件（.js 文件）。当用户要求“制作新阅读皮肤”、“设计新排版主题插件”时调用。
---

# 精读电子书样式插件生成 Skill (Theme Plugin Contract)

## 1. 核心目标
生成一段独立、自包含的 JavaScript 样式插件代码（用户保存为 `theme-xxx.js` 后，可在阅读器 `Setting -> 导入样式插件` 中直接读取加载）。

## 2. 强约束输出契约 (Deterministic Output)
- **ONLY Output JavaScript Code Block**：只输出纯 JS 代码，禁止输出完整 HTML 页面，禁止任何多余解释。
- **必须调用全局注册接口**：`window.ReaderThemePlugins.register({ ... })`。

## 3. 样式插件代码模板规范
```javascript
window.ReaderThemePlugins.register({
  id: "theme-custom-dark",               // 唯一英文 ID（必须以 theme- 开头）
  name: "样式4：深邃暗夜（护眼夜间版）",    // 显示在 Setting 列表中的中文名称
  dotColor: "#1e293b",                   // 主题预览圆点色值
  cssVars: {
    "--bg-outer": "#0f172a",             // 网页最外层背景色
    "--bg-paper": "#1e293b",             // 书页纸张背景色
    "--banner-bg": "#334155",            // 顶部横幅背景色
    "--meta-bg": "#475569",              // 词数与日期栏背景色
    "--title-color": "#f8fafc",          // 文章英文主标题颜色
    "--tier-red-color": "#f87171",       // 核心高频词（暗红梯度）字体色
    "--tier-red-bg": "rgba(248,113,113,0.15)", // 核心高频词底色
    "--tier-normal-color": "#e2e8f0",    // 普通实词字体色
    "--tier-normal-bg": "rgba(255,255,255,0.06)", // 普通实词底色
    "--func-color": "#94a3b8",           // 虚词字体色
    "--rt-color": "#cbd5e1",             // 字下中文注音颜色
    "--trans-bg": "#0f172a",             // 整段意译框背景色
    "--trans-border": "#64748b",         // 整段意译框左侧边框色
    "--dashed-color": "#475569",         // 左右双栏中间虚线颜色
    "--vocab-def-bg": "#0f172a",         // 右侧生词释义卡片背景色
    "--pos-color": "#38bdf8",            // 词性标签（n./vt.）颜色
    "--text-sub": "#94a3b8"              // 副标题及次要文字颜色
  },
  extraCss: `
    /* 可选：针对该主题的额外精细 CSS 覆写，例如自定义字体、圆角或阴影 */
    body.theme-custom-dark .page-container {
      border: 1px solid #334155;
    }
  `
});