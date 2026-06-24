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

### 提取原则

1. **能确定的就直接提取**——数值、名称、日期等明确信息，直接填入 filters
2. **category 需要用户确认**——枚举值来自后端 `GET /api/products/categories`，不可自行猜测映射（"吃的"→"食品"不行）
3. **拿不准的不猜**——模糊表述如"便宜的"、"最近的"不要假设数值，留给用户填写
4. **已提取的不重复问**，只对缺失的参数展示 decision

### 识别示例

| 用户输入 | 可直接提取的 filters |
|---------|---------------------|
| "查 MacBook Pro" | `{"name": "MacBook Pro"}` |
| "价格在 10～100 的商品" | `{"price": {"gte": 10, "lte": 100}}` |
| "100 块以下的" | `{"price": {"lte": 100}}` |
| "2024 年上架的" | `{"created": {"gte": "2024-01-01", "lte": "2024-12-31"}}` |
| "找一下 id 3 和 5" | `{"id": [3, 5]}` |
| "2024 年上架的数码产品，5000 以内" | `{"created": {"gte": "2024-01-01", "lte": "2024-12-31"}, "price": {"lte": 5000}}` → category 缺失，需 combobox |
| "查一下数码分类的" | → category 需 combobox 选择（后端拉枚举） |
| "帮我查一下商品" | → 没有任何可提取的，展示全部 decision |
| "列出所有商品" | `{}` → 直接输出 apicall |

---

## 工作流

```
用户输入
   ▼
Phase 0  提取已明确的参数，构建 filters 草图
   ├─ 所有参数都齐了 → 跳 Phase 2 直接输出 apicall
   ├─ 只有 category 缺失或有模糊参数 → 跳 Phase 1，展示缺失字段的 decision
   └─ 全量查询 → 跳 Phase 2，filters: {}
   ▼
Phase 1  补全缺失参数
   ★ CP-1a — 只展示还没拿到的字段（用 combobox / number_range / datetime_range）
   ★ CP-1b — 用自然语言列出条件 + 输出 ```filters 块 + ```hitl 确认块
   ▼
Phase 2  输出 apicall（filters 从上一轮 ```filters 块逐字复制）
```

### 关键规则

- **禁止用 `input` 类型收集查询字段**——查询条件只用 `combobox` / `number_range` / `datetime_range`
- **CP-1b hitl checkpoint 必须包含 `apicall` 字段**——前端点"执行查询"时直接执行，无需 LLM 再生成

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

只展示**还没拿到的字段**，已提取的参数不出现在 decisions 中。每个 decision 独立，可用 `default` 推荐默认值。

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
1. 自然语言条件摘要 + 问句
2. ```hitl 确认块，**checkpoint 中必须包含 `apicall` 字段**（前端点"执行查询"时直接执行，无需再问 LLM）

示例（用户输入"价格 10-100"，提取后）：

```text
将按 价格≥10元且≤100元 查询商品，确认吗？

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-1b",
    "name": "查询条件确认",
    "phase": "Phase 1",
    "summary": "已收集查询条件：价格≥10元且≤100元，请确认后执行查询",
    "action": "wait",
    "apicall": {"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {"price": {"gte": 10, "lte": 100}}}},
    "decisions": [
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
