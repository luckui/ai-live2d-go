# Skills 目录

此目录遵循 [Agent Skills 开放标准](https://agentskills.io)。

## 目录结构

```
skills/
  skill-name/
    SKILL.md          ← 必须。YAML frontmatter + Markdown 正文
    scripts/          ← 可选。辅助脚本
    assets/           ← 可选。图片、示例数据等
  category/
    skill-name/
      SKILL.md        ← 支持嵌套分类
```

## SKILL.md 格式

```markdown
---
name: skill-name          # 必须，小写 + 连字符
description: 一句话描述   # 必须，≤100 字，显示在系统提示目录中
version: 1.0.0            # 可选
---

# Skill 标题

正文内容（Markdown 格式）。
这部分只在 AI 调用 read_manual(topic="skill-name") 时才加载（渐进式披露）。
```

## 兼容性

- **本目录**（skills/）：Agent Skills 标准格式，`SKILL.md` 文件
- **manual/ 目录**：传统格式，`*.md` 文件，支持可选 YAML frontmatter

两种格式都会被 `read_manual` 工具扫描并展示给 AI。

## 兼容外部 Skills 包

将外部 Skills 包（如 scientific-agent-skills、hermes-agent skills）的内容
复制或软链接到此目录下，即可让 AI 通过 `read_manual` 使用这些 Skills。
