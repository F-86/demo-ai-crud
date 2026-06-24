---
name: product-query
description: >-
  根据指定条件查询商品列表，支持按 id、名称、分类、价格范围、上架时间、更新时间进行组合筛选。
version: 2.0.0
author: F-86
license: MIT
---

# Product Query — 商品查询

## 边界

- **进入条件**：用户意图为查询/搜索/列出商品
- **不处理**：创建/修改/删除商品（走其他 skill）

---

## 参数规范

`POST /api/products/query` 的 `body.filters` 支持以下字段，全部可选。

### 字段定义

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `number[]` | 商品 ID 精确匹配，如 `[1, 3, 5]` |
| `name` | `string` | 商品名称模糊匹配，如 `"MacBook Pro"` |
| `category` | `string[]` | 分类精确匹配，枚举值由 `GET /api/products/categories` 返回，如 `["数码", "玩具"]` |
| `price` | `{gte?, lte?}` | 价格区间（元），如 `{"gte": 10, "lte": 100}` 或只填一端 `{"lte": 500}` |
| `created` | `{gte?, lte?}` | 上架时间区间，如 `{"gte": "2024-01-01", "lte": "2024-12-31"}` |
| `updated` | `{gte?, lte?}` | 更新时间区间，格式同上 |

### filters 示例

```json
// 全量
{}

// 按名称
{"name": "MacBook Pro"}

// 按 ID
{"id": [1, 3, 5]}

// 按分类
{"category": ["数码", "玩具"]}

// 按价格区间
{"price": {"gte": 10, "lte": 100}}

// 按价格上限
{"price": {"lte": 500}}

// 组合
{"category": ["数码"], "price": {"gte": 1000, "lte": 10000}}

// 时间区间
{"created": {"gte": "2024-01-01", "lte": "2024-12-31"}}
```

### apicall 格式

```apicall
{"method": "POST", "endpoint": "/api/products/query", "body": {"filters": { ... }}}
```

---

## 从用户输入提取参数

你（LLM）每次收到用户消息时，判断能从消息中提取出哪些查询参数。

### 核心规则（最高优先级）

**只有用户明确说"查全部/所有商品/列出全部"时才跳过表单直接执行。其他一切情况，即使你已经提取到了部分参数，也必须输出 CP-1a 询问用户剩余条件怎么填。** 用户跳过所有 decision 再提交，才是真正的全量查询。

### 提取原则

1. **能确定的就直接提取**——数值、名称、日期等明确信息，直接填入对应 decision 的 `default` 值
2. **category 必须通过 combobox 让用户选择**——枚举值来自后端 `GET /api/products/categories`，不可自行猜测映射（"吃的"→"食品"不行）
3. **拿不准的不猜**——模糊表述如"便宜的"、"最近的"不要假设数值，留给用户填写
4. **总是展示所有查询参数的 decision**——即使用户已提供了部分参数（如名称），也展示 CP-1a 列出全部可选字段，让用户补全或直接提交

### 识别示例

| 用户输入 | 行为 |
|---------|------|
| "列出所有商品" | `{}` → 直接输出 apicall（明确全量查询） |
| "查 MacBook Pro" | 提取 name="MacBook Pro" 作为 default，但仍输出 CP-1a 展示所有字段让用户补充 |
| "价格在 10～100 的商品" | 提取 price={gte:10, lte:100} 作为 default，仍输出 CP-1a |
| "帮我查一下商品" | 无任何可提取的，输出 CP-1a 全部为空 |
| "查一下数码分类的" | 输出 CP-1a，category 预填为 default（通过 combobox `default` 字段标记） |

---

## 工作流

```
用户输入
   ▼
Phase 0  提取已明确的参数
   ├─ 明确说"查全部/所有商品/列出全部" → 跳 Phase 2，filters: {}
   └─ 其他一切情况 → 进入 Phase 1，输出 CP-1a
   ▼
Phase 1  补全缺失参数
   ★ CP-1a — 展示全部 decision，已提取的参数用 default 预填值
   ★ CP-1b — 展示已填写的条件 + readonly 可视化组件 + hitl 确认块
   ▼
Phase 2  输出 apicall（inline 在 CP-1b checkpoint 中，前端直接执行）
```

### 关键规则

- **禁止用 `input` 类型收集查询字段**——查询条件只用 `combobox` / `number_range` / `datetime_range`
- **已提取的参数用 `default` 字段标记**，展示在 decision 中，用户可修改或跳过
- **CP-1b hitl checkpoint 必须包含 `apicall` 字段**——前端点"执行查询"时直接执行，无需 LLM 再生成
- **只有用户明确说"查全部"才跳过 Phase 1**，其他情况一律展示 CP-1a

---

## HITL 决策类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `combobox` | 分类选择，前后端拉取值 | `{"type": "combobox", "field": "category", "options_from": {"method": "GET", "endpoint": "/api/products/categories", ...}}` |
| `number_range` | 价格范围 | `{"type": "number_range", "field": "price", "label": "价格区间", "unit": "元"}` |
| `datetime_range` | 时间范围 | `{"type": "datetime_range", "field": "created", "label": "上架时间区间"}` |
| `choice` | 确认/重填/取消 | CP-1b 使用 |

---

## ★ CP-1a — 条件收集

**始终展示全部决策字段**（combobox / number_range / datetime_range）。已从用户输入中提取的参数用 `default` 字段预填值，其他字段留空让用户自行填写或跳过。

`default` 格式：
- `number_range`：`"default": {"gte": 10, "lte": 100}`
- `datetime_range`：`"default": {"gte": "2024-01-01", "lte": "2024-12-31"}`
- `combobox`：`"default": ["数码"]`

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

---

## ★ CP-1b — 条件确认

输出格式（严格按此顺序）：
1. 一句自然语言引导（如"请确认以下查询条件："）
2. ```hitl 确认块，包含 `readonly` decision 展示已收集的值 + `choice` decision 让用户确认

> **关键**：`readonly` decision 用可视化组件（number_range / datetime_range / combobox_tags）展示已提取的参数值，`choice` decision 放最后让用户选择操作。

示例（用户输入"价格 10-100"，提取后）：

```text
请确认以下查询条件：

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-1b",
    "name": "查询条件确认",
    "phase": "Phase 1",
    "summary": "已收集查询条件，请确认后执行查询",
    "action": "wait",
    "apicall": {"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {"price": {"gte": 10, "lte": 100}}}},
    "decisions": [
      {
        "id": "d-readonly-price",
        "type": "readonly",
        "field": "price",
        "label": "价格区间",
        "unit": "元",
        "value": {"gte": 10, "lte": 100}
      },
      {
        "id": "d-1",
        "type": "choice",
        "question": "是否确认以上查询条件？",
        "options": [
          {"value": "execute", "label": "✅ 执行查询"},
          {"value": "重新填写查询条件", "label": "✏️ 重新填写"},
          {"value": "取消查询", "label": "❌ 取消"}
        ],
        "default": "execute"
      }
    ]
  }
}
```

### readonly decision 规范

| 字段 | 说明 |
|------|------|
| `type` | `"readonly"` |
| `field` | 字段名（price / created / updated / category / name / id） |
| `label` | 显示标签 |
| `unit` | 单位（price 用） |
| `value` | 已收集的值：数值范围用 `{"gte": x, "lte": y}`，分类用 `["数码", "玩具"]`，name/id 用字符串/数组 |

前端根据 `field` 和 `value` 类型渲染对应的只读组件（number_range 框、日期区间、标签列表等）。

### 用户选择路由

- `execute` → 前端直接使用 checkpoint 中的 `apicall` 执行查询，**无需再经 LLM**
- `重新填写查询条件` → 返回 CP-1a
- `取消查询` → 结束

---

## Phase 2 — 执行（仅全量查询使用）

当用户意图为全量查询时，直接输出 apicall 块：

```apicall
{"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {}}}
```

结果由前端渲染表格（id / 名称 / 分类 / 价格 / 上架时间 / 更新时间），agent 不描述数据。

---

## 常见错误

1. **用 `input` 收集查询字段** → 查询只用 combobox / number_range / datetime_range
2. **全量查询触发 CP-1a** → `filters: {}` 直接 Phase 2
3. **CP-1b 漏写 `apicall`** → checkpoint 内必须包含完整 apicall JSON
4. **category 猜值映射** → 必须 combobox，禁止"吃的→食品"
5. **模糊表述自设数值** → "便宜的"、"最近的"不猜
6. **已提取的参数重复展示 decision** → 只对缺失的字段展示
