---
name: product-query
description: >-
  根据指定条件查询商品列表，支持按 id、名称、分类、价格范围、上架时间、更新时间进行组合筛选。
  支持全量查询和条件查询两种模式。
version: 1.1.0
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
| **CONTEXT** | 按需加载 | Phase 0 只读边界；Phase 1 加载参数清单 |
| **TOOLS** | 输入/输出 | 用户自然语言输入；`hitl` 块收集结构化条件；`apicall` 块触发查询 |
| **ORCHESTRATION** | 线性 Phase 管道 | Phase 0 → 1 → 2，全量查询可跳过 Phase 1 |
| **MEMORY** | 无持久化 | 单次查询无需跨会话状态 |
| **EVALUATION** | 参数校验 | 范围参数合法性（gte ≤ lte） |
| **RECOVERY** | CP 重填 | CP-1b 提供"重新填写"选项，回到 CP-1a |

---

## HITL 交互协议

本 skill 使用 `` ```hitl `` JSON 代码块作为标准人机交互协议。每个需要人类介入的节点输出以下格式的块：

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

### 本 skill 使用的 decision 类型

| 类型 | 用途 | 关键字段 |
|------|------|---------|
| `combobox` | 从后端拉取可选值后由用户选择（如分类） | `field`, `options_from.endpoint` |
| `number_range` | 数值范围筛选（如价格） | `field`, `label`, `unit` |
| `datetime_range` | 时间范围筛选（如上架时间） | `field`, `label` |
| `choice` | 多选一确认（如 CP-1b） | `options` |

---

## 工作流总览

```
Phase 0  Intake
         从用户输入判断查询模式
         ├─ 全量查询 ──────────────────────────────────→ Phase 2（跳过 Phase 1）
         ├─ 含确定性参数（id/name）─────────────────→ CP-1b（跳过 CP-1a）
         └─ 其他条件查询意图（category/price/时间等）→ Phase 1
              ▼
Phase 1  条件收集
         ★ CP-1a — 多 decision 块，各字段独立展示
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
| **含确定性参数**（用户提供了具体的 id 或 name） | ✅ | choice | 跳过 CP-1a，直接输出 CP-1b 回显并确认 |
| **其他条件查询**（含模糊表达如"帮我查一下"、category/price/时间等条件） | ✅ | 多 decision | 输出 CP-1a，让用户填写或跳过各筛选条件 |
| 用户已明确说"直接执行"/"不用确认" | ❌ | — | 跳过 CP-1b，直接输出 apicall |

> **铁律 1：禁止在 Phase 0 用自然语言提问意图**（如"你想按什么条件查？"）。意图不明时直接输出 CP-1a。
>
> **铁律 2：查询字段禁止使用 `input` 类型**。`input` 仅限 Create/Update 场景。查询条件通过 `combobox`/`number_range`/`datetime_range` decision 收集。
>
> **铁律 3：每个 `` ```hitl `` 块的 `decisions` 至少 1 项，每项独立。Agent 可推荐默认值（用 `default` 字段），但不能静默替用户选择。**

### 不触发最终确认

查询操作在参数确认（CP-1b）后直接执行并展示结果，**无最终确认环节**。

---

## Phase 0 — Intake

### 判断查询模式

从用户输入中判断，**三种路径任选其一**：

| 用户意图 | 判断标准 | 动作 |
|---------|---------|------|
| **明确全量查询** | 说了"查全部"、"所有商品"、"列出全部"且无任何筛选词 | 直接跳到 Phase 2，输出 `filters: {}` 的 apicall |
| **含确定性参数** | 用户提供了具体的 id 或 name，如"查 iPhone 15"、"找 MacBook Pro"、"查 id=3 的商品" | 从输入中提取 id/name，直接跳 CP-1b 回显确认（跳过 CP-1a） |
| **其他条件查询** | 涉及 category/price/时间等非确定性条件，或完全模糊如"帮我查一下" | 进入 Phase 1，输出 CP-1a HITL 块 |

**禁止在 Phase 0 输出任何文字提问**。意图不明时默认进入 Phase 1，所有 decision 均非必填，全部跳过等同于查全部。

### 含确定性参数时的处理

当用户提供了明确的 id 或 name，agent 应当：
1. 从输入中提取 `id`（多个逗号分隔时拆为数组）或 `name`（字符串）
2. 直接输出 CP-1b，在 `summary` 中回显已提取的条件（如"将按 商品名称='MacBook Pro' 查询"）
3. 用户确认 `execute` 后进入 Phase 2 输出 apicall

---

## Phase 1 — 条件收集

### 参数清单

| 参数 | 必填 | decision 类型 | 说明 |
|------|------|--------------|------|
| `id` | 否 | 确定性参数，LLM 直接提取，不触发 HITL | 商品 ID，精确查询，多个逗号分隔 |
| `name` | 否 | 确定性参数，LLM 直接提取，不触发 HITL | 商品名称，模糊查询 |
| `category` | 否 | `combobox`（`GET /api/products/categories`） | 商品分类，支持多选 |
| `price` | 否 | `number_range`（单位：元） | 价格区间，gte=下限，lte=上限 |
| `created` | 否 | `datetime_range` | 上架时间区间 |
| `updated` | 否 | `datetime_range` | 更新时间区间 |

`id` / `name` 为确定性参数，LLM 从用户输入中直接提取，不触发 HITL；提取到的值预填入 filters，未提及则不放入 filters。

### 执行逻辑

1. 一句话告知用户正在准备查询条件，输出 CP-1a
2. 用户填写各 decision 后，agent 将非空字段构建 `filters` 对象：
   - `combobox` → 用户所选值数组：`{"category": ["数码", "玩具"]}`
   - `number_range` → `{"price": {"gte": 100, "lte": 500}}`（只填一端时只出现对应算符）
   - `datetime_range` → `{"created": {"gte": "2024-01-01", "lte": "2024-12-31"}}`
   - `id` → 从用户原始输入中提取后拆分为数组：`{"id": [1, 3, 5]}`
   - `name` → 字符串：`{"name": "iPhone"}`
3. 范围参数校验：`price.gte ≤ price.lte`，时间同理；不合法时告知用户并重新输出 CP-1a
4. 输出 CP-1b `choice` 块，用自然语言列出将使用的筛选条件

### 禁止行为

- **禁止**用 `input` 类型收集查询字段
- **禁止**猜测 category 的模糊描述（如"吃的" → 直接填食品），必须通过 combobox 让用户自行选择
- **禁止**为 price/created/updated 的不明确表述（如"便宜的"）自行假设数值
- **禁止**在 CP-1b 之前输出 apicall

#### ★ CP-1a — 查询条件收集

输出前一句话说明："我来帮你查询商品，请选择筛选条件，不需要的直接跳过。"

**决策收集铁律：** 以下决策项每项独立列出。Agent **可以推荐**（用 `default` 字段标记），但**不能静默替用户选择**。

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-1a",
    "name": "查询条件收集",
    "phase": "Phase 1",
    "summary": "请选择筛选条件，不需要的直接跳过，所有条件均为可选",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "combobox",
        "question": "选择商品分类（可多选，不选则不按分类筛选）",
        "field": "category",
        "label": "商品分类",
        "multiple": true,
        "options_from": {
          "method": "GET",
          "endpoint": "/api/products/categories",
          "label_field": "label",
          "value_field": "value"
        }
      },
      {
        "id": "d-2",
        "type": "number_range",
        "question": "设置价格区间（留空则不按价格筛选）",
        "field": "price",
        "label": "价格区间",
        "unit": "元"
      },
      {
        "id": "d-3",
        "type": "datetime_range",
        "question": "设置上架时间区间（留空则不按上架时间筛选）",
        "field": "created",
        "label": "上架时间区间"
      },
      {
        "id": "d-4",
        "type": "datetime_range",
        "question": "设置更新时间区间（留空则不按更新时间筛选）",
        "field": "updated",
        "label": "更新时间区间"
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
- `id` 为数组；`name` 为字符串；`category` 为字符串数组
- 范围字段序列化为 `{"gte": x, "lte": y}`，只填了一端时只出现对应算符
- 全量查询时 `filters` 为空对象 `{}`

**示例（分类为数码、价格 1000-10000）：**

```apicall
{"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {"category": ["数码"], "price": {"gte": 1000, "lte": 10000}}}}
```

**示例（全量查询）：**

```apicall
{"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {}}}
```

**示例（上架时间在 2024 年内，价格不超过 500）：**

```apicall
{"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {"created": {"gte": "2024-01-01", "lte": "2024-12-31"}, "price": {"lte": 500}}}}
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

结果返回后，agent 提示可进行的后续操作（修改条件重查、查看某商品详情等）。

---

## Common Pitfalls

1. **Phase 0 用自然语言反问意图**：严禁输出"你是想查全部还是按条件？"等提问，意图不明时直接输出 CP-1a。
2. **含 name/id 的查询仍触发 CP-1a**：用户说"查 MacBook Pro"时，id/name 是确定性参数，LLM 应直接提取后跳 CP-1b，禁止走 CP-1a 空表单。
3. **查询字段用 `input` 类型**：`input` 仅限 Create/Update 填写新数据，查询条件必须用 `combobox`/`number_range`/`datetime_range`。
4. **category 枚举硬编码在 decision 里**：应通过 `combobox` 的 `options_from` 让前端动态拉取，不要在 SKILL.md 里写死枚举值。
5. **全量查询也触发 HITL**：用户说"查全部商品"时，直接输出 `filters: {}` 的 apicall。
6. **CP-1b 之前就输出 apicall**：apicall 必须在 CP-1b 用户选择 `execute` 之后输出。
7. **filters 包含空字段**：用户未填写的字段不能出现在 `filters` 对象中。
8. **范围参数校验遗漏**：`price.gte > price.lte` 等非法范围应在 Phase 1 检测后返回 CP-1a。
9. **范围字段格式错误**：`price`/`created`/`updated` 必须序列化为 `{"gte": x, "lte": y}` 格式。
10. **`name` 字段模糊查询变精确匹配**：后端应使用 `LIKE %name%`。

---

## Verification Checklist

- [ ] Phase 0 正确区分全量查询、确定性参数查询、条件查询，无自然语言反问
- [ ] 全量查询直接输出 apicall，未触发任何 HITL
- [ ] 含 name/id 的查询跳过 CP-1a，直接输出 CP-1b 回显条件
- [ ] CP-1a 使用 `combobox`/`number_range`/`datetime_range` decision，**未使用 `input`**
- [ ] CP-1a 的 `combobox` decision 含 `field`、`options_from.endpoint`、`label_field`、`value_field`
- [ ] CP-1a 的 `number_range` decision 含 `field`、`label`、`unit`
- [ ] CP-1a 的 `datetime_range` decision 含 `field`、`label`
- [ ] CP-1b choice 块 JSON 语法合法，包含 execute / 重新填写查询条件 / 取消查询三个选项
- [ ] 决策收集铁律已写入两个 CP
- [ ] apicall 在 CP-1b 确认（execute）之后输出
- [ ] apicall 使用 `POST /api/products/query`，body 含 `filters` 对象
- [ ] filters 范围字段序列化为 `{"gte": x, "lte": y}` 格式
- [ ] 无最终确认 CP（查询操作不需要）
- [ ] 后端 `GET /api/products/categories` 路由已存在
