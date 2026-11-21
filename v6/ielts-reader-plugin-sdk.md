---
name: ielts-reader-plugin-sdk
description: 为“全格式双栏精读电子书阅读器 v6.0”开发外部功能插件（Feature Plugin）或样式插件（Theme Plugin）。输出可直接导入 Setting 的纯 JS 文件。
---

# 双栏精读电子书阅读器插件开发 SDK (v6.0)

## 1. 插件类型与注册接口
严禁修改主 HTML 骨架，只输出纯 JavaScript 代码块（保存为 `.js` 后在阅读器 `Setting` 中加载）：

### 类型 A：功能插件 (Feature Plugin — 自带启用/停用滑动开关)
```javascript
window.ReaderFeaturePlugins.register({
  id: "plugin-word-counter",
  name: "生词本统计与导出",
  description: "统计当前章节高频红词并支持一键导出 TXT",
  defaultEnabled: true,
  // 挂载到顶部工具栏（启用时显示，关闭滑动开关时自动隐藏）
  renderToolbar(ctx) {
    return `<button class="icon-btn" id="btn-export-vocab">📊 导出本章红词</button>`;
  },
  onMount(el, ctx) {
    el.querySelector('#btn-export-vocab').onclick = () => {
      const art = ctx.getCurrentArticle();
      const reds = (art.vocabulary || []).filter(v => v.level === 'core').map(v => `${v.word} ${v.ipa || ''}`).join('\n');
      alert('本章核心高频词：\n' + (reds || '暂无解析词汇'));
    };
  },
  onArticleChange(article, ctx) {
    // 切换章节时触发
  }
});