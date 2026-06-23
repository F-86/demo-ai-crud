---
name: product-query
description: >-
  根据指定条件查询商品列表，支持按 id、名称、分类、价格范围、上架时间、更新时间进行组合筛选。
  支持全量查询和条件查询两种模式。
version: 1.0.0
author: F-86
license: MIT
metadata:
  hermes:
    tags: [product, query, crud, hitl]
    related_skills: [product-create, product-update, product-delete]
---

# Product Query — 商品查询

## Overview

根据用户给出的筛选条件查询商品。支持全量查询（不带任何条件）和条件查询（按 id、名称、分类、价格范围、上架时间、更新时间任意组合）。前端负责执行 `apicall` 并渲染结果列表，agent 不编造数据。

---

## 边界

- **进入条件**：用户意图为查询/搜索/列出商品，如"查一下商品"、"列出所有食品"、"找找有没有 iPhone"、"价格在 100 以下的有哪些"
- **不处理**：创建商品（走 `product-create`）、修改商品（走 `product-update`）、删除商品（走 `product-delete`）、查询非商品资源

---

## Harness 视角

| 维度 | 设计 | 实现手段 |
|------|------|---------|
| **CONTEXT** | 按需加载 | Phase 0 只读边界；Phase 1 加载参数清单和枚举值 |
| **TOOLS** | 输入/输出 | 用户自然语言输入；`hitl` 块收集结构化条件；`apicall` 块触发查询 |
| **ORCHESTRATION** | 线性 Phase 管道 | Phase 0 → 1 → 2，全量查询可跳过 Phase 1 |
| **MEMORY** | 无持久化 | 单次查询无需跨会话状态 |
| **EVALUATION** | 参数校验 | 检查范围参数合法性（min ≤ max）；category 枚举匹配 |
| **RECOVERY** | CP 重填 | CP-1b 提供"重新填写"选项，回到 CP-1a |

---

## HITL 交互协议

本 skill 使用 `` ```hitl `` JSON 代码块作为标准人机交互协议。每个需要人类介入的节点，agent 输出以下格式的块：

```text
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-n",
    "name": "名称",
    "phase": "阶段",
    "summary": "当前状态描述",
    "action": "wait",
    "decisions": [
      {"id": "d-1", "type": "choice", "question": "问题"}
    ]
  }
}
```

协议完整规范见 `references/hitl-protocol.md`。

本 skill 同时使用 `` ```apicall `` 块表示 API 调用节点（机器执行，不等待人类决策）：

```text
{"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {}}}
```

apicall 协议完整规范见 `references/hitl-protocol.md` apicall 章节。

---

## 工作流总览

```
Phase 0  Intake
         从用户输入判断是全量查询还是条件查询
         ├─ 全量查询 ──────────────────────────→ Phase 2（跳过 Phase 1）
         └─ 条件查询 → Phase 1
              ▼
Phase 1  条件收集
         ★ CP-1a — input 块，展示所有可筛选字段（均非必填，留空=不筛选）
         用户填写后 agent 构建 filters 对象
         ★ CP-1b — choice 块，回显条件，等待确认/重填/取消
              ▼
Phase 2  执行 & 展示
         输出独立 apicall：POST /api/products/query
         前端执行并渲染结果列表
         （展示字段：id / 商品名称 / 分类 / 价格 / 上架时间 / 更新时间）
```

---

## HITL 触发条件

本 skill 的 HITL 触发是**精确约束的**，只在以下明确条件下才允许输出 `` ```hitl `` 块。

### 参数触发矩阵

| 条件 | 触发 HITL | 块类型 | 说明 |
|------|----------|--------|------|
| 用户意图为全量查询（明确说"查全部"/"所有商品"且无筛选词） | ❌ | — | 直接跳 Phase 2，输出 `filters: {}` |
| **其他一切查询意图**（含模糊表达如"帮我查一下"） | ✅ | `input` | 直接输出 CP-1a，让用户填写或跳过筛选条件 |
| `category` 存在歧义（如用户说"电子"、"吃的"） | ✅ | `input` | CP-1a 的 category 字段（choice 类型）让用户从枚举中选 |
| `price` 范围边界不明确（如"便宜的"、"贵的"） | ✅ | `input` | CP-1a 的 price 字段（number_range）让用户填写具体数值 |
| `created` 范围边界不明确（如"最近上架的"、"今年的"） | ✅ | `input` | CP-1a 的 created 字段（datetime_range）让用户填写具体日期 |
| `updated` 范围边界不明确（如"最近更新的"） | ✅ | `input` | CP-1a 的 updated 字段（datetime_range）让用户填写具体日期 |
| 用户已明确说"直接执行"/"不用确认" | ❌ | — | 跳过 CP-1b，直接输出 apicall |

> **铁律 1：不在上表中的情况，一律不触发额外 HITL。禁止在参数收集过程中自由发挥添加确认点。**
>
> **铁律 2：触发 HITL 时必须附带自然语言说明，让用户知道为什么需要介入、当前是什么状态。**
>
> **铁律 3：每个 `` ```hitl `` 块的 `decisions` 至少 1 项，每项独立。Agent 可推荐默认值（用 `default` 字段），但不能静默替用户选择。**

### 不触发最终确认

查询操作在参数确认（CP-1b）后直接执行并展示结果，**无最终确认环节**。

---

## Phase 0 — Intake

### 判断查询模式

从用户输入中判断，**只有两种路径，没有第三条**：

| 用户意图 | 判断标准 | 动作 |
|---------|---------|------|
| **明确全量查询** | 说了"查全部"、"所有商品"、"列出全部"且无任何筛选词 | 直接跳到 Phase 2，输出 `filters: {}` 的 apicall |
| **其他一切情况** | 包括"帮我查一下"、"找找商品"、"查个商品"等模糊表达 | 直接进入 Phase 1，输出 CP-1a HITL 块 |

**禁止在 Phase 0 输出任何文字提问**（如"你是想查全部还是按条件筛选？"）。意图不明时默认进入 Phase 1，让用户通过 HITL 表单自己决定填不填条件。CP-1a 的所有字段均非必填，留空全部等同于查全部。

---

## Phase 1 — 条件收集

### 参数清单

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `id` | 否 | string（多值逗号分隔） | 商品 ID，精确查询 |
| `name` | 否 | string | 商品名称，模糊查询 |
| `category` | 否 | choice | 分类，枚举：`玩具 / 服装 / 饮料 / 食品 / 数码` |
| `price` | 否 | number_range | 价格区间（gte=下限，lte=上限） |
| `created` | 否 | datetime_range | 上架时间区间（gte/lte，格式 YYYY-MM-DD） |
| `updated` | 否 | datetime_range | 更新时间区间（gte/lte，格式 YYYY-MM-DD） |

所有参数均为非必填，留空代表不按该字段筛选。所有字段留空等同于全量查询。

### 执行逻辑

1. 输出 CP-1a `input` 块，展示所有可筛选字段；已从用户输入中识别出的参数预填为 `default`
2. 用户填写后，agent 将非空字段收集为 `filters` 对象（多值字段拆分为数组）
3. 范围参数校验：`price_min ≤ price_max`，`created_from ≤ created_to`，`updated_from ≤ updated_to`；不合法时告知用户并回到 CP-1a
4. 输出 CP-1b `choice` 块，回显将使用的筛选条件

### 禁止行为

- **禁止**在字段全部为空时（全量查询意图）触发 HITL，应直接输出 apicall
- **禁止**猜测 category 的模糊描述（如"吃的" → 直接填食品），必须让用户在 CP-1a 明确选择
- **禁止**为 price/created/updated 的不明确表述（如"便宜的"）自行假设数值

#### ★ CP-1a — 查询条件收集

输出前先用一句话说明当前状态，例如："我来帮你查询商品，请填写筛选条件，留空的字段不参与筛选。"

**决策收集铁律：** 以下决策项每项独立列出。Agent **可以推荐**（用 `default` 字段标记），但**不能静默替用户选择**。

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-1a",
    "name": "查询条件收集",
    "phase": "Phase 1",
    "summary": "请填写要筛选的字段，所有字段均为可选，留空代表不按该字段筛选",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "input",
        "question": "请填写查询条件（留空的字段不参与筛选）",
        "fields": [
          {"name": "id", "type": "string", "label": "商品 ID（多个 ID 用逗号分隔）", "required": false},
          {"name": "name", "type": "string", "label": "商品名称（模糊匹配）", "required": false},
          {"name": "category", "type": "choice", "label": "商品分类", "required": false, "options": ["玩具", "服装", "饮料", "食品", "数码"]},
          {"name": "price", "type": "number_range", "label": "价格区间（元）", "required": false},
          {"name": "created", "type": "datetime_range", "label": "上架时间区间", "required": false},
          {"name": "updated", "type": "datetime_range", "label": "更新时间区间", "required": false}
        ]
      }
    ]
  }
}
```

#### ★ CP-1b — 查询条件确认

收到用户填写的条件后，用自然语言列出将使用的筛选条件（忽略空字段），再输出以下块：

**决策收集铁律：** 以下决策项每项独立列出。Agent **可以推荐**（用 `default` 字段标记），但**不能静默替用户选择**。

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-1b",
    "name": "查询条件确认",
    "phase": "Phase 1",
    "summary": "已收集查询条件，请确认后执行查询",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "choice",
        "question": "是否确认以上查询条件？",
        "options": [
          {"value": "execute", "label": "✅ 执行查询", "desc": "用当前条件向后端发起查询"},
          {"value": "重新填写查询条件", "label": "✏️ 重新填写", "desc": "返回条件收集，调整筛选参数"},
          {"value": "取消查询", "label": "❌ 取消", "desc": "放弃此次查询"}
        ],
        "default": "execute"
      }
    ]
  }
}
```

**用户选择路由：**
- `execute` → Phase 2 输出 apicall
- `重新填写查询条件` → 返回 CP-1a，重新输出条件收集块
- `取消查询` → 结束，告知用户查询已取消

---

## Phase 2 — 执行 & 展示

### 执行

用户在 CP-1b 选择 `execute`（或全量查询跳过 Phase 1）后，立即输出 `apicall` 块。

- `filters` 只包含用户实际填写的非空字段
- 多值字段（`id`）拆分为数组；`name` 为字符串；`category` 为字符串数组
- 范围字段（`price`/`created`/`updated`）序列化为 `{"gte": x, "lte": y}`，只填了一端时只出现对应算符
- 全量查询时 `filters` 为空对象 `{}`

**示例（条件查询——分类为数码、价格 1000-10000）：**

```apicall
{"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {"category": ["数码"], "price": {"gte": 1000, "lte": 10000}}}}
```

**示例（全量查询）：**

```apicall
{"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {}}}
```

**示例（上架时间在 2024 年内）：**

```apicall
{"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {"created": {"gte": "2024-01-01", "lte": "2024-12-31"}}}}
```

### 结果展示

前端执行 apicall 后渲染结果列表，agent 不描述数据内容。结果列表展示字段：

| 列 | 字段 | 说明 |
|----|------|------|
| ID | `id` | 商品编号 |
| 商品名称 | `name` | |
| 分类 | `category` | |
| 价格 | `price` | 单位：元 |
| 上架时间 | `created` | |
| 更新时间 | `updated` | |

结果返回后，agent 提示可进行的后续操作（修改条件重查、查看某商品详情、导出等）。

---

## Common Pitfalls

1. **Phase 0 用自然语言反问意图**：严禁输出"你是想查全部还是按条件？"等提问。意图不明时直接输出 CP-1a，由用户通过表单决定。
2. **category 歧义直接猜测**：用户说"电子产品"时不能自行映射为"数码"，CP-1a 的 category 字段是 choice 类型，让用户自己选。
2. **price/time 不明确直接假设**：用户说"便宜的"不能假设为 `price_max=100`，必须让用户在 CP-1a 填写具体数值。
3. **全量查询也触发 HITL**：用户说"查全部商品"时，直接输出 `filters: {}` 的 apicall，不要弹出条件收集框。
4. **CP-1b 之前就输出 apicall**：apicall 必须在 CP-1b 用户选择 `execute` 之后输出，不能在确认之前发出请求。
5. **filters 包含空字段**：用户未填写的字段不能出现在 `filters` 对象中，空字符串也不放入。
6. **范围参数校验遗漏**：`price.gte > price.lte` 等非法范围应在 Phase 1 检测，告知用户后返回 CP-1a，不能带着非法参数输出 apicall。
7. **范围字段格式错误**：`price`/`created`/`updated` 必须序列化为 `{"gte": x, "lte": y}` 格式，不能用旧的 `price_min`/`price_max` 数组格式。
8. **模糊名称查询精确匹配**：`name` 字段是模糊查询，后端应使用 `LIKE %name%`，不是精确等值匹配。

---

## Verification Checklist

- [ ] Phase 0 正确区分全量查询与条件查询
- [ ] 全量查询直接输出 apicall，未触发任何 HITL
- [ ] CP-1a input 块 JSON 语法合法，所有字段 `required: false`
- [ ] CP-1b choice 块 JSON 语法合法，包含 execute / modify / cancel 三个选项
- [ ] 决策收集铁律已写入两个 CP
- [ ] apicall 在 CP-1b 确认（execute）之后输出，不在之前
- [ ] apicall 使用 `POST /api/products/query`，body 含 `filters` 对象
- [ ] filters 只包含用户实际填写的非空字段
- [ ] 无最终确认 CP（查询操作不需要）
- [ ] category 枚举值与数据库 CHECK 约束一致（玩具/服装/饮料/食品/数码）
- [ ] 范围参数合法性校验已在执行逻辑中说明
- [ ] 结果展示字段包含：id / 商品名称 / 分类 / 价格 / 上架时间 / 更新时间
