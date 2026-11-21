---
name: ielts-reading-json-extractor
description: 将用户复制的英文文章或单段英文解析为“全格式双栏精读电子书引擎 v6.0”专用的纯 JSON 数据对象。严禁输出任何 HTML/CSS/JS 代码或多余解释。
---

# 双栏逐词精读 JSON 数据生成规范 (v6.0 专属契约)

## 1. 核心红线 (Strict Rules)
- **ONLY Output Valid JSON**：你的唯一输出必须是一个可直接解析的纯 JSON 代码块（` ```json ... ``` `）。
- **NEVER Output HTML/JS/CSS**：前端渲染器已独立存在，严禁生成任何 `<div>`、`<ruby>`、`<script>` 标签，严禁在 JSON 前后写任何寒暄、思考过程或解释。
- **Complete Token Coverage**：`tokens` 数组必须完整还原原文的每一个单词及紧随其后的标点符号，**严禁省略任何冠词、介词、连词或代词**。

## 2. 必须严格遵守的 JSON 输出骨架 (Output Schema)
收到英文原文后，严格按照以下字段结构填充并输出：

```json
{
  "category": "文章所属书籍或单元名称（如：外刊精读 / 《芒果街上的小屋》）",
  "titleEn": "英文主标题（若用户仅发来单段文本，则提炼本段核心英文短标题）",
  "titleCn": "中文直译主标题",
  "wordCount": 120,
  "paragraphs": [
    {
      "tokens": [
        {
          "text": "单词或短语（保留原标点，如 house,）",
          "gloss": "该词在当前语境下的精准中文释义（2~5字，虚词也必须填写）",
          "tier": "red | normal | func",
          "isPhrase": false
        }
      ],
      "translation": "该自然段的流畅中文整段意译。"
    }
  ],
  "vocabulary": [
    {
      "word": "单词原型（小写，短语保留空格）",
      "ipa": "[国际音标]",
      "level": "core | basic",
      "defs": [
        {
          "pos": "词性缩写（如 n. / vt. / vi. / adj. / adv. / prep. / conj. / art. / phr.）",
          "meaning": "常用中文多义项释义（用分号分隔）"
        }
      ]
    }
  ]
}