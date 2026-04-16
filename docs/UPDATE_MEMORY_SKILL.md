# 🔄 update_memory Skill - 两阶段交互式更新记忆

## ✨ 设计理念

**放弃智能冲突检测**（过于复杂、预料不到），改为 **AI 主导的两阶段更新流程**：

1. **第一阶段**：AI 描述想要更新什么 → 工具返回当前记忆 + 暂停
2. **第二阶段**：AI 看到当前记忆后，给出最终完整记忆文本 → 保存

---

## 🎯 解决的问题

### 旧方案的问题（只会堆积）

**用户**："我不是学生，是研究生"

**旧的 memory(add_user) 行为**：
```
用户身份：学生          ← 旧条目（错误）
身份为研究生            ← 新条目（新增）
```

❌ **问题**：只会堆积，不会替换旧条目

---

### 新方案（update_memory Skill）

**用户**："我不是学生，是研究生"

**AI 行为**：

**第一次调用**：
```typescript
update_memory({
  target: "user",
  intent: "将身份从学生改为研究生"
})
```

**工具返回**（暂停）：
```
📋 当前USER（用户画像）内容：

  1. 常用Discord频道ID：1484202499320578170
  2. Discord用户名：louis066505
  3. 用户身份：学生
  4. 从事设计相关工作
  5. Discord用户louis066505会使用VSCode编写web相关项目代码
  6. 编写web相关项目时习惯同期打开文件资源管理器、必应搜索页面

────────────────────────────────────────

💭 你的更新意图：将身份从学生改为研究生

📝 请基于以上内容，给出最终的完整记忆文本（条目之间用 § 分隔）：
   • 保留：需要保留的条目照写
   • 修改：需要修改的条目直接改写
   • 删除：不需要的条目直接不写
   • 新增：新增的条目直接加入
```

**AI 第二次调用**（整理后）：
```typescript
update_memory({
  target: "user",
  final_content: "Discord用户名：louis066505§Discord频道ID：1484202499320578170§身份为研究生§从事设计相关工作§使用VSCode编写web项目§习惯同时打开文件管理器和必应搜索"
})
```

**工具返回**：
```
✅ USER（用户画像）更新成功！（65% — 715/1100 字）

📊 变化统计：
  • 原条目数：6
  • 新条目数：6
  • 变化：无变化

📝 当前USER（用户画像）：
  1. Discord用户名：louis066505
  2. Discord频道ID：1484202499320578170
  3. 身份为研究生
  4. 从事设计相关工作
  5. 使用VSCode编写web项目
  6. 习惯同时打开文件管理器和必应搜索

💡 此记忆将在所有未来对话中持续生效。
```

✅ **完美整理**：
- ✅ 删除重复（"Discord用户louis066505会使用VSCode" → "使用VSCode"）
- ✅ 更新错误（"学生" → "研究生"）
- ✅ 合并关联信息（Discord 信息放一起）

---

## 📖 使用场景

### 场景 1：更新错误信息

**用户**："我不是学生，是研究生"

```typescript
// 第一次调用
update_memory({
  target: "user",
  intent: "将身份从学生改为研究生"
})

// 工具返回当前记忆...

// 第二次调用
update_memory({
  target: "user",
  final_content: "Discord用户名：louis066505§身份为研究生§从事设计相关工作"
})
```

---

### 场景 2：删除敏感信息

**用户**："删除我的 Discord 频道 ID"

```typescript
// 第一次调用
update_memory({
  target: "user",
  intent: "删除Discord频道ID"
})

// 工具返回当前记忆...

// 第二次调用（不包含频道ID）
update_memory({
  target: "user",
  final_content: "Discord用户名：louis066505§身份为研究生§从事设计相关工作"
})
```

---

### 场景 3：整理冗余信息

**用户**："帮我整理一下记忆，太乱了"

```typescript
// 第一次调用
update_memory({
  target: "user",
  intent: "整理冗余和重复的条目"
})

// 工具返回当前记忆...

// 第二次调用（合并、精简）
update_memory({
  target: "user",
  final_content: "Discord：louis066505（频道1484202499320578170）§身份：研究生，从事设计工作§技术栈：VSCode、web开发§工作习惯：同时打开文件管理器和必应搜索"
})
```

---

### 场景 4：更新环境配置

**用户**："我把 Python 环境从 sharp 改成 dev 了"

```typescript
// 第一次调用
update_memory({
  target: "memory",
  intent: "更新Python环境名称从sharp到dev"
})

// 工具返回当前记忆...

// 第二次调用
update_memory({
  target: "memory",
  final_content: "conda环境名称：dev§Python版本：3.10§已安装：numpy、pandas、matplotlib"
})
```

---

## 🎨 核心优势

### 1. AI 主导，不依赖规则

**旧方案**（智能冲突检测）：
```typescript
// ❌ 预设关键词规则
const CONFLICT_PATTERNS = [
  { keywords: ['身份', '职业', '学历'], category: '身份职业' },
  { keywords: ['Discord', 'discord'], category: '联系方式' },
];
```
- ❌ 规则复杂且预料不到
- ❌ "从事设计" vs "设计师" 无法匹配
- ❌ "学生" vs "研究生" 可能被判断为不冲突

**新方案**（AI 主导）：
```typescript
// ✅ AI 看到完整记忆后自己判断
// ✅ 可以合并、删除、重组、精简
// ✅ 灵活适应各种场景
```

---

### 2. 两阶段交互，透明可控

**第一阶段**（展示当前记忆）：
- ✅ AI 知道当前记忆的完整内容
- ✅ 可以做出准确判断（是替换还是删除）

**第二阶段**（确认最终结果）：
- ✅ AI 给出完整的新记忆文本
- ✅ 用户可以看到完整变化（透明）

**对比 add_user**（单阶段盲目添加）：
- ❌ AI 不知道已有什么（可能重复）
- ❌ 只能堆积，不能替换

---

### 3. 支持多种操作

| 操作 | 旧方案 | 新方案 |
|------|--------|--------|
| **新增** | ✅ add_user | ✅ 加入 final_content |
| **更新** | ❌ 只能堆积 | ✅ 修改条目后加入 |
| **删除** | ❌ 无法删除 | ✅ 不包含在 final_content |
| **合并** | ❌ 无法合并 | ✅ AI 自己合并 |
| **重组** | ❌ 无法重组 | ✅ AI 自己重排序 |

---

## 🔧 技术实现

### Skill 定义

```typescript
const updateMemorySkill: SkillDefinition<UpdateMemoryParams> = {
  isSkill: true,  // 标记为 Skill（支持两阶段）
  
  async execute({ target, intent, final_content }) {
    // 第一阶段：返回当前记忆 + 暂停
    if (!final_content) {
      return {
        type: 'pause',
        message: '当前记忆内容 + 提示',
        tool_name: 'update_memory',
        tool_params: { target, intent },
      } as SkillPauseResult;
    }
    
    // 第二阶段：保存最终记忆
    const newEntries = final_content.split('§').map(e => e.trim()).filter(Boolean);
    setStructuredGlobalMemory(current);
    return '✅ 更新成功';
  }
};
```

---

### 条目分隔符：§

**为什么用 § 而不是换行或逗号？**

| 分隔符 | 问题 |
|--------|------|
| 换行 `\n` | ❌ LLM 输出的 JSON 字符串中换行会被转义为 `\\n` |
| 逗号 `,` | ❌ 条目内容可能包含逗号（"Discord：louis066505，频道1234"） |
| `§` | ✅ 罕见字符，不会出现在普通文本中 |

**数据库存储**：
```typescript
// 实际存储格式
setSetting('global_memory_user', 'Discord用户名：louis066505§身份为研究生§从事设计');
```

**读取时自动分割**：
```typescript
const user = getSetting('global_memory_user');
const entries = user.split('§').map(s => s.trim()).filter(Boolean);
// → ["Discord用户名：louis066505", "身份为研究生", "从事设计"]
```

---

## 📊 与 memory tool 的关系

| 功能 | memory (Tool) | update_memory (Skill) |
|------|---------------|----------------------|
| **新增记忆** | ✅ `add_user` / `add_memory` | ⚠️ 可以，但不是主要用途 |
| **搜索记忆** | ✅ `action=search` | ❌ 不支持 |
| **读取记忆** | ✅ `action=read` | ⚠️ 第一阶段会展示 |
| **更新记忆** | ❌ 只能堆积 | ✅ **核心功能** |
| **删除记忆** | ❌ 不支持 | ✅ **核心功能** |
| **整理记忆** | ❌ 不支持 | ✅ **核心功能** |

**建议使用策略**：
- ✅ **首次记录信息** → `memory(add_user/add_memory)`（快速）
- ✅ **搜索历史记忆** → `memory(search)`
- ✅ **更新/删除/整理** → `update_memory`（精确）

---

## 🎯 总结

### ✅ 解决的问题

1. **只会堆积，不会更新** → ✅ 支持更新/删除/整理
2. **重复冗余条目** → ✅ AI 可以合并精简
3. **错误信息难以修正** → ✅ 两阶段交互，精确替换
4. **智能冲突检测不可靠** → ✅ AI 主导，灵活判断

### 🌟 核心优势

1. **简单优雅**：无复杂规则，AI 自己判断
2. **透明可控**：两阶段交互，用户可见完整变化
3. **灵活强大**：支持任意操作（增删改合并重组）
4. **安全可靠**：容量检查、格式验证

### 📝 使用示例（完整流程）

```typescript
// 用户："我不是学生，是研究生"

// 第一次调用
update_memory({
  target: "user",
  intent: "将身份从学生改为研究生"
})

// 🔄 工具暂停，返回当前记忆...

// 第二次调用（AI 整理后）
update_memory({
  target: "user",
  final_content: "Discord用户名：louis066505§身份为研究生§从事设计相关工作§使用VSCode编写web项目"
})

// ✅ 更新成功！
```

**完美解决记忆更新问题！**🎉
