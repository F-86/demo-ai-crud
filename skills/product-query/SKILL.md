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

1. **CP-1a 一轮查询只出一次**：用户的一次查询请求，从输入到执行只允许出现一次 CP-1a。无论是否已提取到部分参数，都把它们用 `default` 预填到同一个 CP-1a 中一次性收集，**禁止分多轮询问**（先问价格、再问分类、再问时间是错误的）。
2. **CP-1a 提交由前端直接执行，不再经过 LLM**：前端把表单值注入 `checkpoint.apicall.body.filters` 后直接 fetch，LLM 不会收到提交结果，也不需要生成下一轮回复。
3. **只有用户明确说"查全部/所有商品/列出全部"时才跳过 CP-1a 直接执行**。

### 提取原则

1. **能确定的就直接提取**——数值、名称、日期等明确信息，直接填入对应 decision 的 `default` 值
2. **category 必须通过 combobox 让用户选择**——枚举值来自后端 `GET /api/products/categories`，不可自行猜测映射（"吃的"→"食品"不行）
3. **拿不准的不猜**——模糊表述如"便宜的"、"最近的"不要假设数值，留给用户填写
4. **CP-1a 展示全部查询参数**——已提取的用 `default` 预填，未提取的留空，让用户在**同一个表单内**一次性补全或跳过

### 时间表达式解析规则

提取时间范围时，按以下规则将自然语言转换为具体日期：

| 表达式 | gte（起始） | lte（结束） |
|--------|------------|------------|
| "今年" / "本年" | `{YYYY}-01-01` | `{YYYY}-12-31` |
| "去年" | `{YYYY-1}-01-01` | `{YYYY-1}-12-31` |
| "今年上半年" | `{YYYY}-01-01` | `{YYYY}-06-30` |
| "今年下半年" | `{YYYY}-07-01` | `{YYYY}-12-31` |
| "本月" | `{YYYY}-{MM}-01` | 本月最后一天 |
| "2024年" | `2024-01-01` | `2024-12-31` |
| "2024年到今年" | `2024-01-01` | `{YYYY}-12-31` |

其中 `{YYYY}` 为系统注入的当前年份，`{MM}` 为当前月份。**结束时间取所在区间的最后一天（年底、月末），而非今天。**

### 识别示例

| 用户输入 | 行为 |
|---------|------|
| "列出所有商品" | `{}` → 直接输出 apicall（明确全量查询） |
| "查 MacBook Pro" | 提取 name="MacBook Pro" 作为 default，但仍输出 CP-1a 展示所有字段让用户补充 |
| "价格在 10～100 的商品" | 提取 price={gte:10, lte:100} 作为 default，仍输出 CP-1a |
| "帮我查一下商品" | 无任何可提取的，输出 CP-1a 全部为空 |
| "查一下数码分类的" | 输出 CP-1a，category 预填为 default（通过 combobox `default` 字段标记） |
| "2024年到今年的商品"（当前 2026 年） | created default: `{"gte": "2024-01-01", "lte": "2026-12-31"}` |

---

## 工作流

```
用户输入
   ▼
路由识别（看当前用户消息）
   ├─ ① 明确说"查全部/所有商品/列出全部" → 直接输出 apicall，filters: {}
   └─ ② 其他（含查询语义/有可提取参数/模糊查询）→ 输出 CP-1a（整轮对话只输出一次）
   ▼
CP-1a — 一次性收集
   展示全部 decision，已提取的参数用 default 预填
   checkpoint 内嵌 apicall 模板（filters 为空，由前端在用户提交时填充）
   用户点击【提交】→ 前端直接用表单值填充 apicall 并执行，不再发给 LLM
```

### 关键规则

- **CP-1a 一轮查询只出一次**——不论是否预填了 default、不论提取到几个参数，都只展示一次 CP-1a。**禁止"先提取部分参数 → 出 CP-1a → 再次确认 → 再出 CP-1a 询问其他条件"**
- **CP-1a 提交由前端直接执行**——前端把表单值注入 checkpoint.apicall.body.filters 后直接 fetch，不再经过 LLM
- **禁止用 `input` 类型收集查询字段**——查询条件只用 `combobox` / `number_range` / `datetime_range`
- **已提取的参数用 `default` 字段预填**，用户可在 CP-1a 中修改/补充/跳过
- **只有用户明确说"查全部"才跳过 CP-1a**，其他情况一律展示一次 CP-1a

---

## HITL 决策类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `combobox` | 分类选择，前端拉取值 | CP-1a |
| `number_range` | 价格范围 | CP-1a |
| `datetime_range` | 时间范围 | CP-1a |

---

## ★ CP-1a — 条件收集

**始终展示全部决策字段**（combobox / number_range / datetime_range）。已从用户输入中提取的参数用 `default` 字段预填值，其他字段留空让用户自行填写或跳过。

**checkpoint 必须包含 `apicall` 模板**（`filters` 留空 `{}`），前端提交时会把表单值注入 `apicall.body.filters` 后直接执行，不再发给 LLM。

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
    "apicall": {"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {}}},
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

用户点击【提交】后，前端把表单值注入 `apicall.body.filters` 并直接执行查询，结果持久化到数据库，**不再经过 LLM**。

---

## Phase 3 — 执行（全量查询）

当用户意图为全量查询时，直接输出 apicall 块：

```apicall
{"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {}}}
```

结果由前端渲染表格（id / 名称 / 分类 / 价格 / 上架时间 / 更新时间），agent 不描述数据。

---

## 常见错误

1. **用 `input` 收集查询字段** → 查询只用 combobox / number_range / datetime_range
2. **非"查全部"时跳过 CP-1a** → 除非明确说"查全部/所有商品"，否则必须走 CP-1a
3. **category 猜值映射** → 必须 combobox，禁止"吃的→食品"
4. **模糊表述自设数值** → "便宜的"、"最近的"不猜，展示空 decision 让用户填
5. **已提取的参数忘记设 default** → 用 `default` 字段预填，用户可跳过或修改
6. **CP-1a 出现两次** → 一轮查询只允许一次 CP-1a。**反例**：用户说"价格 10~100"，先出一次 CP-1a 预填价格，又出一次 CP-1a 写 summary"价格已设置，请补充其他条件"。正确做法：第一次 CP-1a 就要把价格 default 预填好同时展示其他字段，用户在同一个表单内一次性补全。
7. **CP-1a 缺少 `apicall` 模板** → checkpoint 必须带 `"apicall": {"method": "POST", "endpoint": "/api/products/query", "body": {"filters": {}}}`，前端提交时注入 filters 直接执行
