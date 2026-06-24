---
name: product-update
description: >-
  修改已有商品。支持三种定位方式：商品 ID（首选）、单一名称、多条件 filters（批量）。
  可修改 name、price、category。批量场景支持 name 表达式（suffix/prefix/replace）和 price 表达式（set/multiply/add）。
  所有修改前需最终确认；批量需先 dry_run 预览。
  关键词：商品修改、更新商品、编辑商品、改商品、批量修改、批量改价、全部涨价、按比例
version: 1.0.0
author: Jane
license: MIT
metadata:
  hermes:
    tags: [product, update, crud, hitl, bulk]
    related_skills: [product-create, product-query, product-delete]
---

# Product Update — 修改商品

> 修改已有商品信息。三种定位方式（id / locate_name / filters），批量场景支持 name/price 表达式，所有修改前需最终确认，批量场景需先 dry_run 预览。

## Overview

本 skill 提供商品修改能力。需要以下参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | number | 定位三选一 | 商品 ID，用于精确定位单条商品（首选） |
| locate_name | string | 定位三选一 | 商品名称（旧），按精确名称匹配单条商品 |
| filters | object | 定位三选一 | 多条件 filter 对象，用于**批量**定位（含 category/价格区间/模糊名等） |
| name | string \| object | 否 | **新**商品名称。单条：字符串；批量：可用 `{"suffix": "..."}` / `{"prefix": "..."}` / `{"replace": ["旧","新"]}` |
| price | number \| object | 否 | 新价格。单条：数字；批量：可用 `{"set": x}` / `{"multiply": x}` / `{"add": x}` |
| category | string | 否 | 新分类：玩具/服装/饮料/食品/数码 |

> **三条定位路径**：必须提供 `id` / `locate_name` / `filters` 之一。
>
> | 用户表达 | 走哪条路径 | endpoint |
> |---------|-----------|----------|
> | "id=3 / 编号3 / 3号商品" | 单条按 ID | `PUT /api/products/{id}` |
> | "名叫 XX 的商品"（一个名字，无其他条件） | 单条按名 | `PUT /api/products?locate_name=<旧名称>` |
> | "所有饮料分类的商品" / "名称含'牛奶'的商品" / "价格<5 的商品" / 多条件组合 | **批量** | `POST /api/products/bulk_update` |
>
> **🔴 不要输出 `POST /api/products/query` 用作定位**——查询结果不会回传 LLM 会卡死。
> - 单条路径：endpoint 一步定位+修改
> - 批量路径：用 `bulk_update` 的 `dry_run` 模式做预览，前端在 UI 展示匹配列表给用户看
>
> `name`/`price`/`category` 均为**新值**（要改成什么），均为可选，但至少需修改一项。

所有需要用户确定的参数，通过 ```hitl` JSON 块让用户确认。确认后通过 ```apicall` 块执行修改。

> HITL 协议完整规范见 `references/hitl-protocol.md`。

## 边界

- **进入条件**：用户说"修改商品"、"更新商品"、"编辑商品"、"改一下商品"、"把商品XX改成YY"
- **不处理**：创建/查询/删除商品（分别用 product-create / product-query / product-delete）

---

## Harness 视角

| 维度 | 设计 |
|------|------|
| **CONTEXT** | 用户输入修改意图，LLM 提取 id 和要修改的字段，用 ```hitl` 块收集缺失参数 |
| **TOOLS** | 输入：用户自然语言；输出：```hitl JSON 块 + 最终 ```apicall` 块 |
| **ORCHESTRATION** | 2 Phase 线性管道 + 2 个 Checkpoint（含最终确认） |
| **MEMORY** | 无跨步骤持久化状态 |
| **EVALUATION** | id 必填校验 + 至少一项修改字段校验 + price 数字格式校验 + category 枚举校验 |
| **RECOVERY** | 用户可在任意 CP 取消操作；商品不存在（404）时提示用户；参数格式错误时提示重输 |

---

## HITL 交互协议

本 skill 使用 ```hitl` JSON 代码块作为人机交互协议。协议完整规范见 `references/hitl-protocol.md`。

```text
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-n",
    "name": "名称",
    "phase": "阶段",
    "summary": "当前状态",
    "action": "wait",
    "decisions": [
      {"id": "d-1", "type": "choice", "question": "问题"}
    ]
  }
}
```

**决策收集铁律：** 以下决策项每项独立列出。Agent **可以推荐**（用 `default` 标记），但**不能静默替用户选择**。

---

## HITL 触发条件

本 skill 的 HITL 触发是**精确约束的**。只在以下明确条件下才允许输出 ```hitl` 块。

### 参数触发矩阵

| 条件 | 触发 HITL | 块类型 | 说明 |
|------|----------|--------|------|
| `id` / `locate_name` / `filters` 都缺失 | ✅ | `input` | 收集要修改的商品 ID 或名称 |
| 只给了 `locate_name`（单条按名） | ❌ | — | 不查询、不收集，直接走 PUT 按名称定位（见 Phase 2-单条） |
| 给了 `filters`（批量定位） | ❌（在 Phase 2 处理） | — | 先输出 dry_run apicall 让前端展示匹配列表，然后再进 CP2 终确认 |
| 用户想修改某字段但未给值（如"改名"但没说改成什么） | ✅ | `input` | 收集缺失的修改字段值 |
| 用户未指明要修改哪些字段（如"修改id为3的商品"） | ✅ | `input` | 收集要修改的字段（全可选，至少填一项） |
| 定位齐全 + 至少一项修改字段 | ❌ | — | 不触发参数收集 HITL，进入 ★ Checkpoint 确认 |
| 用户已明确跳过确认 | ❌ | — | 跳过 HITL，直接进行 |

> **铁律 1：不在上表中的情况，一律不触发参数收集阶段的 HITL。禁止在参数收集过程中自由发挥添加额外确认点。**
>
> **铁律 2：触发 HITL 时必须附带自然语言说明，让用户知道为什么需要介入。**
>
> **铁律 3：每个 ```hitl` 块的 `decisions` 至少 1 项，每项独立。**
>
> **铁律 4：```hitl` 块必须用代码块包裹（``` ```hitl ```），禁止直接输出裸 JSON，否则前端无法渲染。**

### 最终确认触发条件

| 条件 | 触发 HITL | 块类型 | 说明 |
|------|----------|--------|------|
| 参数已齐全、操作即将执行 | ✅ | `confirm` | 展示将要修改的商品信息，等待用户最终确认，然后输出 ```apicall` |

---

## 工作流总览

```
用户输入修改意图
   ▼
Phase 0    Intake         判定走【单条】还是【批量】
                          - 给了 id 或 单一 locate_name → 单条
                          - 给了多条件 filters         → 批量
   ▼
Phase 1    参数收集       收集缺失的定位信息和/或修改字段
           ★ Checkpoint 1 — 参数收集
           ★ Checkpoint 1b — 参数确认
   ▼
Phase 2    修改 + 确认
   ├─【单条】★ Checkpoint 2 (final) — 最终确认 + apicall
   │         - 有 id     → PUT /api/products/{id}
   │         - 只有 name → PUT /api/products?locate_name=<旧名称>
   │
   └─【批量】★ Checkpoint 2a — dry_run 预览（前端展示匹配列表，用户在 UI 看数量）
            ★ Checkpoint 2b (final) — 终确认 + apicall
            - POST /api/products/bulk_update（带 expected_count 作为双保险）
```

---

## Phase 0 — Intake

从用户描述中提取以下信息：

1. **定位信息**（id / locate_name / filters 三选一）：
   - **优先 id**：从"id为3"、"编号3"、"3号商品"等表述中提取数字 → `id=3`
   - **单一 name**：用户只用一个具体名字指代（"名叫XX的商品"、"XX商品"、"把XX改成..."） → `locate_name="XX"`
   - **多条件 / 集合表达 → 批量**：以下信号触发批量路径，构造 `filters` 对象
     - 范围词："所有"、"全部"、"每个"、"凡是"
     - 模糊名："名字含XX"、"名称包含XX"、"叫XX的"（复数语义）
     - 维度叠加：分类、价格区间、时间区间等
     - 例：
       - "所有饮料分类的商品" → `filters={"category":["饮料"]}`
       - "名称含'牛奶'的商品" → `filters={"name":"牛奶"}`（注意：query filter 的 name 是模糊匹配，与 locate_name 的"精确匹配"语义不同）
       - "价格<5 的饮料" → `filters={"category":["饮料"],"price":{"lte":5}}`
   - **🔴 注意**：用户说"把苹果+1改成..."时，"苹果+1"是**旧名称**（用于定位），不是要改成的新名称

2. **修改字段**（新值，要改成什么）：
   - **单条场景**：name/price/category 都是直接设值
     - "改名成可乐" → name="可乐"
     - "价格改成10" → price=10
     - "分类改成饮料" → category="饮料"
   - **批量场景**：name 和 price 支持表达式
     - "名字后面加'易过期'" → `name={"suffix":"易过期"}`
     - "把'旧'替换成'新'" → `name={"replace":["旧","新"]}`
     - "全部涨价 10%" → `price={"multiply":1.1}`
     - "全部降价 5 毛" → `price={"add":-0.5}`
     - "都改成饮料分类" → `category="饮料"`（category 仍是直接设值）
   - **🔴 批量 name 不允许"set"为同一字面值**：用户说"所有 X 改名为 Y"（Y 是固定字符串）时，直接改会触发 `name_collision_in_batch`（N 条同名）。在 Phase 1 就要识别并 HITL 询问澄清：
     - 是否其实想要 `{"suffix":"·Y"}` / `{"prefix":"Y-"}` / `{"replace":["X","Y"]}` 之类的表达式？
     - 或者只想改某一条具体商品，应走单条路径？
     - 不要先盲发 dry_run 看后端报错才反应。

**提取规则：**
- 已提取到的参数不要重复问
- 用户明确说了枚举值（"服装"、"数码"、"食品"等）→ 直接使用，不要质疑
- 只有模糊描述（"吃的"、"穿的"）时才需要 HITL
- **🔴 区分定位和修改**：句式"把 X 的 Y 改成 Z" 中，X 是定位（locate_name 或 id 或 filters），Y 是字段名，Z 是新值
- **🔴 区分 locate_name 与 filters.name**：
  - "把名叫'苹果+1'的商品改成..."（指一个具体商品）→ `locate_name="苹果+1"`，走单条
  - "把名称含'苹果'的商品都改成..."（指一批）→ `filters={"name":"苹果"}`，走批量

## Phase 0.5 — 定位策略（不需要单独的查询 apicall）

> ⚠️ **架构约束**：当前架构下，LLM 输出 apicall 后**前端执行结果不会回传**给 LLM。所以**禁止输出 `POST /api/products/query` 用作定位**——查到结果也走不下去。

三条定位路径都靠 Phase 2 的 apicall 一站式完成：

| 用户给了什么 | apicall |
|--------------|---------|
| `id` | `PUT /api/products/{id}` |
| 单一 `locate_name` | `PUT /api/products?locate_name=<旧名称>` |
| `filters` 多条件 | `POST /api/products/bulk_update`（先 dry_run 预览，再正式执行） |

单条路径的错误处理：
- 0 条命中 → 404
- 多条命中 → 409（候选列表），LLM 提示用户改用 ID 或换批量路径

批量路径的错误处理：
- 0 条命中 → 404，提示 filters 无结果
- 修改后批内/库内重名 → 409（带冲突信息），LLM 提示用户调整 name 表达式
- 价格表达式算出非正数 → 400

## Phase 1 — 参数收集

### 参数清单

| 参数 | 必填 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | 是 | number | — | 商品 ID，定位要修改的商品 |
| `name` | 否 | string | — | 新商品名称（不修改则不填） |
| `price` | 否 | number | — | 新商品价格，必须为数字（不修改则不填） |
| `category` | 否 | choice | — | 新商品分类：玩具/服装/饮料/食品/数码（不修改则不填） |

> `name`/`price`/`category` 均为可选，但至少需修改一项。

### 执行逻辑

1. 从用户输入中提取 id 和修改字段
2. **已提取到的参数不要重复问**。只输出缺失字段的 ```hitl` `input` 块
   - **🔴 铁律：必须输出 ```hitl` 块。禁止用自然语言提问。** 即使只有一个字段缺失，也要输出 ```hitl` 块
   - 如果 `id` 拿到了 → 不在 hitl 中展示 id 字段
   - 如果用户已提供要修改的字段值 → 不在 hitl 中展示已提供的字段
   - 如果用户说了"修改id为3的商品"但没说改什么 → 展示 name/price/category 三个修改字段（均非必填，但至少填一项）
   - 如果 id 和至少一项修改字段都齐了 → 直接进入 CP-1b 确认
3. 用户填写后，展示参数摘要，进入下一阶段

### 禁止行为

- **🔴 铁律：禁止用自然语言询问参数——必须输出 ```hitl` 块。** 即使只有一个字段缺失，也要输出 ```hitl` 块。
- **禁止**在参数齐全时触发额外 HITL
- **category 处理规则**：用户明确说了枚举值（"服装"、"数码"、"食品"等）→ 直接使用，不要质疑。只有模糊描述（"吃的"、"穿的"）时才需要 HITL
- **禁止**在未拿到 id 时跳过直接执行
- **禁止**在没有任何修改字段时直接执行（至少需修改一项）
- **禁止**在确认最终前调用 API

#### ★ Checkpoint 1 — 参数收集块

> 以下为完整模板。实际输出时**只展示缺失的字段**，已从用户输入提取到的字段不要重复展示。

**决策收集铁律：** 以下决策项每项独立列出。Agent **可以推荐**（用 `default` 标记），但**不能静默替用户选择**。

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-1",
    "name": "参数收集",
    "phase": "Phase 1",
    "summary": "请提供要修改的商品信息（每项一屏，可左右切换）",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "input",
        "question": "要修改哪个商品？请提供商品 ID",
        "field": "id",
        "label": "商品ID",
        "fields": [
          {"name": "id", "type": "string", "label": "商品ID（数字）", "required": true}
        ]
      },
      {
        "id": "d-2",
        "type": "input",
        "question": "新商品名称是什么？（不修改可留空）",
        "field": "name",
        "label": "商品名称（新）",
        "fields": [
          {"name": "name", "type": "string", "label": "商品名称（新）", "required": false}
        ]
      },
      {
        "id": "d-3",
        "type": "input",
        "question": "新商品价格是多少？（不修改可留空）",
        "field": "price",
        "label": "商品价格（新）",
        "fields": [
          {"name": "price", "type": "string", "label": "商品价格（新，数字）", "required": false}
        ]
      },
      {
        "id": "d-4",
        "type": "input",
        "question": "新商品分类是什么？（不修改可留空）",
        "field": "category",
        "label": "商品分类（新）",
        "fields": [
          {"name": "category", "type": "choice", "label": "商品分类（新）", "required": false, "options": ["玩具", "服装", "饮料", "食品", "数码"]}
        ]
      }
    ]
  }
}
```

#### ★ Checkpoint 1b — 参数确认

展示用户填写的参数摘要（商品 ID + 将要修改的字段），让用户确认：

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-1b",
    "name": "参数确认",
    "phase": "Phase 1",
    "summary": "已完成参数收集，请确认修改内容",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "choice",
        "question": "是否确认以上修改内容？",
        "options": [
          {"value": "approve", "label": "✅ 确认", "desc": "进入最终确认"},
          {"value": "modify", "label": "✏️ 修改", "desc": "调整参数"},
          {"value": "cancel", "label": "❌ 取消", "desc": "放弃操作"}
        ]
      }
    ]
  }
}
```

---

## Phase 2 — 修改 + 确认

### 单条 vs 批量分叉

根据 Phase 0 判定的路径分别走：

- **单条**（id / locate_name）：直接进入终确认 + apicall
- **批量**（filters）：先 dry_run 预览 → 终确认 + 正式 apicall（带 `expected_count`）

---

### 【单条】修改预览 + 最终确认

清晰展示即将修改的商品信息，只列出将要变更的字段：

```
📋 修改预览
定位：商品ID=3（或 名称='苹果+1'）
修改内容:
  名称: → 可乐
  价格: → 5.5
  分类: （不修改）
```

#### ★ Checkpoint 2 — Final: 最终确认 + apicall（单条）

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-final",
    "name": "最终确认",
    "phase": "Phase 2",
    "summary": "即将修改商品信息，请确认",
    "action": "wait",
    "decisions": [
      {"id": "d-1", "type": "confirm", "question": "确认执行修改操作？"}
    ]
  }
}
```

用户确认后，输出 ```apicall` 块。**body 中只包含用户实际要修改的字段，未修改的字段不放入 body。endpoint 取决于定位方式：**

**情况 A：有 id 时**

```apicall
{
  "method": "PUT",
  "endpoint": "/api/products/<商品ID>",
  "body": {
    "name": "<新商品名称>",
    "price": "<新商品价格>",
    "category": "<新商品分类>"
  }
}
```

**情况 B：只有 locate_name 时**

```apicall
{
  "method": "PUT",
  "endpoint": "/api/products?locate_name=<旧名称>",
  "body": {
    "price": "<新商品价格>"
  }
}
```

> **URL 编码提示**：`locate_name` 的值需要进行 URL 编码（特别是包含 `+`、` `、`&`、`#`、中文等特殊字符时）。例如：
> - `苹果+1` → `%E8%8B%B9%E6%9E%9C%2B1`（`+` 必须编码为 `%2B`，否则会被解析为空格）
> - 实际输出 endpoint：`/api/products?locate_name=%E8%8B%B9%E6%9E%9C%2B1`
> - 纯中文名（如 `可乐`）可写 `/api/products?locate_name=可乐`，浏览器会自动编码，但显式编码更稳妥

---

### 【批量】dry_run 预览 → 终确认

#### Step 1：dry_run 预览（让前端展示匹配列表）

> 因为 LLM 看不到 apicall 结果，所以**靠前端 UI 把匹配数和 before/after 对比展示给用户**。LLM 只负责输出 dry_run apicall 和后续的终确认 ```hitl` 块。

> **🔴 铁律 B0（前置）**：dry_run 本身也可能 4xx/409 失败（如 `name_collision_in_batch`、`name_collision_with_existing`、0 条命中）。
> - 这类错误前端会在 UI 上**显式展示红色错误卡片**给用户。
> - 此时 **绝对不要**继续输出 CP2a 的"批量预览确认" hitl 块，也不要输出 Step 2 的正式 apicall。
> - 正确做法：在 dry_run apicall 之后输出一条**询问类 hitl**（input 块），告知用户报错并请其调整 name 表达式 / filters / 改走单条路径。
> - 用户通常会在新一轮对话告诉你新的表达式，那时再重新发起 dry_run。

输出 dry_run apicall：

```apicall
{
  "method": "POST",
  "endpoint": "/api/products/bulk_update",
  "body": {
    "filters": { "category": ["饮料"], "price": {"lte": 5} },
    "update": { "price": {"multiply": 1.1} },
    "dry_run": true
  }
}
```

后端响应（前端展示）：
```json
{
  "dry_run": true,
  "matched": 3,
  "items": [...],
  "preview": [
    {"id":6,  "before":{...,"price":3.5}, "after":{"price":3.85}},
    {"id":12, "before":{...,"price":4.0}, "after":{"price":4.4}},
    {"id":15, "before":{...,"price":2.0}, "after":{"price":2.2}}
  ]
}
```

#### ★ Checkpoint 2a — 批量预览确认

紧跟 dry_run apicall **同一回复中**输出确认 ```hitl` 块，让用户看完 UI 上的列表后做决策：

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-bulk-preview",
    "name": "批量预览确认",
    "phase": "Phase 2",
    "summary": "上方已展示匹配商品的修改预览，请仔细核对再决定",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "choice",
        "question": "是否对预览中的所有商品执行修改？",
        "options": [
          {"value": "approve", "label": "✅ 全部执行", "desc": "对预览列表中的全部商品执行修改"},
          {"value": "refine",  "label": "✏️ 调整条件", "desc": "条件不对，重新提需求"},
          {"value": "cancel",  "label": "❌ 取消",     "desc": "放弃操作"}
        ]
      }
    ]
  }
}
```

#### Step 2：正式执行（带 expected_count）

用户选 approve 后，输出正式 apicall。**必须带上 `expected_count`，值是 dry_run 返回的 `matched`**，作为防误改的双保险（若期间数据被改动导致匹配数变化，后端会拒绝）：

```apicall
{
  "method": "POST",
  "endpoint": "/api/products/bulk_update",
  "body": {
    "filters": { "category": ["饮料"], "price": {"lte": 5} },
    "update": { "price": {"multiply": 1.1} },
    "dry_run": false,
    "expected_count": 3
  }
}
```

> **铁律 B1**：批量正式执行必须带 `expected_count`，不能省略。
>
> **铁律 B2**：`filters` 和 `update` 在 Step 1 和 Step 2 中必须**完全一致**，不要在 Step 2 偷偷改条件。
>
> **铁律 B3**：`expected_count` 必须取自 Step 1 dry_run 响应中前端展示给用户的 `matched` 值。LLM 自己看不到这个数字时，可以让用户在 cp-bulk-preview 的 hitl 里告知，或者在 prompt 中根据上下文推断。如果实在不确定，可以省略 `expected_count`（但失去双保险）。

---

### 单条/批量通用铁律

> **铁律 1：** body 中只包含用户实际要修改的字段。例如用户只改名称，body 为 `{"name": "可乐"}`；用户只改价格，body 为 `{"price": 10}`。
>
> **铁律 2：** `locate_name`（旧名称）是 query 参数，**不能**写到 body 里；body 里的 `name` 字段是**新名称**。
>
> **铁律 3：** 后端错误响应处理：
> - 404：未匹配到商品（单条/批量通用）
> - 409 `name_ambiguous`：单条按名定位匹配多条 → 提示用户改用 ID 或换批量
> - 409 `name_collision_in_batch` / `name_collision_with_existing`：批量改名后重名 → 提示用户调整 name 表达式（比如换 suffix 文本）
> - 409 `count_mismatch`：批量 expected_count 与实际不符 → 提示数据可能被并发改动，建议重新 dry_run

---

## 典型对话示例

### 示例 1：用 id 定位（最常见）

> 用户：把 id 为 3 的商品价格改成 10
> Agent：已识别参数：商品ID=3，价格=10。请确认修改内容。
>
> ```text
> {"checkpoint":{"id":"cp-1b","name":"参数确认","phase":"Phase 1","summary":"已完成参数收集，请确认修改内容","action":"wait","decisions":[{"id":"d-1","type":"choice","question":"是否确认以上修改内容？","options":[{"value":"approve","label":"✅ 确认","desc":"进入最终确认"},{"value":"modify","label":"✏️ 修改","desc":"调整参数"},{"value":"cancel","label":"❌ 取消","desc":"放弃操作"}]}]}}
> ```
>
> 用户：确认
> Agent：展示修改预览，输出最终确认
>
> ```text
> {"checkpoint":{"id":"cp-final","name":"最终确认","phase":"Phase 2","summary":"即将修改商品信息，请确认","action":"wait","decisions":[{"id":"d-1","type":"confirm","question":"确认执行修改操作？"}]}}
> ```
>
> 用户：确认
> Agent：执行修改
>
> ```text
> {"method":"PUT","endpoint":"/api/products/3","body":{"price":10}}
> ```

### 示例 2：用名称定位（单次 PUT，无需查询）

> 用户：帮我修改一下名叫"苹果+1"商品的信息，把价格设置成 4 元
> Agent：识别到 locate_name="苹果+1"，price=4。请确认修改内容。
>
> ```text
> {"checkpoint":{"id":"cp-1b","name":"参数确认","phase":"Phase 1","summary":"已完成参数收集，请确认修改内容（按名称『苹果+1』定位）","action":"wait","decisions":[{"id":"d-1","type":"choice","question":"是否确认以上修改内容？","options":[{"value":"approve","label":"✅ 确认","desc":"进入最终确认"},{"value":"modify","label":"✏️ 修改","desc":"调整参数"},{"value":"cancel","label":"❌ 取消","desc":"放弃操作"}]}]}}
> ```
>
> 用户：确认 → 最终确认 → apicall
>
> ```text
> {"method":"PUT","endpoint":"/api/products?locate_name=%E8%8B%B9%E6%9E%9C%2B1","body":{"price":4}}
> ```
>
> （`苹果+1` 经 URL 编码后为 `%E8%8B%B9%E6%9E%9C%2B1`，其中 `+` → `%2B`）

### 示例 3：名称命中多条（后端 409，提示用 ID）

> 用户：把"可乐"的价格改成 5
> Agent：（与示例 2 同样流程，直接走 PUT）
>
> ```text
> {"method":"PUT","endpoint":"/api/products?locate_name=可乐","body":{"price":5}}
> ```
>
> 后端返回 409：`{"error":"name_ambiguous","candidates":[{"id":6,"name":"可乐"},{"id":15,"name":"可口可乐"}]}`
>
> Agent：名称『可乐』匹配到 2 个商品（id=6 可乐、id=15 可口可乐），请告诉我要修改的具体 ID。

### 示例 4：只给 id 没说改什么

> 用户：修改 id 为 5 的商品
> Agent：需要收集要修改的字段
>
> ```text
> {"checkpoint":{"id":"cp-1","name":"参数收集","phase":"Phase 1","summary":"请提供要修改的商品信息（每项一屏，可左右切换）","action":"wait","decisions":[{"id":"d-2","type":"input","question":"新商品名称是什么？（不修改可留空）","field":"name","label":"商品名称（新）","fields":[{"name":"name","type":"string","label":"商品名称（新）","required":false}]},{"id":"d-3","type":"input","question":"新商品价格是多少？（不修改可留空）","field":"price","label":"商品价格（新）","fields":[{"name":"price","type":"string","label":"商品价格（新，数字）","required":false}]},{"id":"d-4","type":"input","question":"新商品分类是什么？（不修改可留空）","field":"category","label":"商品分类（新）","fields":[{"name":"category","type":"choice","label":"商品分类（新）","required":false,"options":["玩具","服装","饮料","食品","数码"]}]}]}}
> ```

### 示例 5：批量加后缀（按名称模糊批量改名）

> 用户：给所有名称中含'牛奶'的商品名字后面加上'易过期'
> Agent：识别到批量场景，filters={"name":"牛奶"}，update={"name":{"suffix":"易过期"}}。先 dry_run 看看影响范围。
>
> ```text
> {"method":"POST","endpoint":"/api/products/bulk_update","body":{"filters":{"name":"牛奶"},"update":{"name":{"suffix":"易过期"}},"dry_run":true}}
> ```
>
> ```text
> {"checkpoint":{"id":"cp-bulk-preview","name":"批量预览确认","phase":"Phase 2","summary":"上方已展示匹配商品的修改预览，请仔细核对再决定","action":"wait","decisions":[{"id":"d-1","type":"choice","question":"是否对预览中的所有商品执行修改？","options":[{"value":"approve","label":"✅ 全部执行","desc":"对预览列表中的全部商品执行修改"},{"value":"refine","label":"✏️ 调整条件","desc":"条件不对，重新提需求"},{"value":"cancel","label":"❌ 取消","desc":"放弃操作"}]}]}}
> ```
>
> （假设前端展示 matched=4）
>
> 用户：approve
>
> ```text
> {"method":"POST","endpoint":"/api/products/bulk_update","body":{"filters":{"name":"牛奶"},"update":{"name":{"suffix":"易过期"}},"dry_run":false,"expected_count":4}}
> ```

### 示例 6：批量按比例涨价

> 用户：把所有饮料分类价格小于 5 的商品全部涨价 10%
> Agent：filters={"category":["饮料"],"price":{"lte":5}}，update={"price":{"multiply":1.1}}
>
> ```text
> {"method":"POST","endpoint":"/api/products/bulk_update","body":{"filters":{"category":["饮料"],"price":{"lte":5}},"update":{"price":{"multiply":1.1}},"dry_run":true}}
> ```
>
> ```text
> {"checkpoint":{"id":"cp-bulk-preview","name":"批量预览确认","phase":"Phase 2","summary":"上方已展示匹配商品的修改预览，请仔细核对再决定","action":"wait","decisions":[{"id":"d-1","type":"choice","question":"是否对预览中的所有商品执行修改？","options":[{"value":"approve","label":"✅ 全部执行","desc":"对预览列表中的全部商品执行修改"},{"value":"refine","label":"✏️ 调整条件","desc":"条件不对，重新提需求"},{"value":"cancel","label":"❌ 取消","desc":"放弃操作"}]}]}}
> ```
>
> 用户：approve（假设 matched=3）
>
> ```text
> {"method":"POST","endpoint":"/api/products/bulk_update","body":{"filters":{"category":["饮料"],"price":{"lte":5}},"update":{"price":{"multiply":1.1}},"dry_run":false,"expected_count":3}}
> ```

### 示例 7：批量改名后重名冲突

> 用户：把所有饮料分类商品都改名为'统一饮料'
> Agent：（先 dry_run）
>
> ```text
> {"method":"POST","endpoint":"/api/products/bulk_update","body":{"filters":{"category":["饮料"]},"update":{"name":{"set":"统一饮料"}},"dry_run":true}}
> ```
>
> 后端返回 409 `name_collision_in_batch`：批量内 3 条都将改成"统一饮料"
> Agent：批量改名后会出现同名商品（3 条都将变成『统一饮料』），数据库不允许重名。请改用 suffix 表达式，比如『统一饮料-1、统一饮料-2...』，或先确认是否真的需要让它们重名。

---

## Common Pitfalls

1. **price 不是数字 / category 不在枚举内**：必须校验并提示用户重新输入。
2. **🔴 输出 `POST /api/products/query` 查询定位**：禁止。查询结果不会回传给 LLM，会卡住流程。单条按名直接走 `PUT /api/products?locate_name=...`；批量走 `POST /api/products/bulk_update`。
3. **🔴 把旧名称当成新名称**：用户说"把苹果+1的价格改成 4"，"苹果+1"是**定位用的旧名称**（放 query 参数 `locate_name`），不要写到 PUT body 的 `name` 字段里。
4. **🔴 locate_name 写到 body 里**：`locate_name` 是 URL query 参数，不是 body 字段。
5. **🔴 单条/批量路径混淆**：
   - 一个具体名字 → 单条 `locate_name`
   - "所有 / 名称含..." / 多条件 → 批量 `filters`
   - 决策表见 Overview「三条定位路径」
6. **🔴 批量场景丢掉 dry_run**：批量修改必须先 dry_run（前端给用户看影响范围），再正式执行。禁止跳过 dry_run 直接 `dry_run:false`。
7. **🔴 Step 2 与 Step 1 条件不一致**：正式执行的 `filters` 和 `update` 必须与 dry_run 完全相同，否则数据被改但用户没确认。
8. **🔴 批量改名忽略重名风险**：批量改名时，如果新名称会与库内其他商品或批内其他商品重名，后端会返回 409。LLM 应建议用户改用 `{"suffix":"-N"}` 或带索引的命名。
9. **🔴 价格表达式方向错误**：
   - "涨价 10%" → `{"multiply": 1.1}`（不是 1.0 也不是 0.1）
   - "降价 10%" → `{"multiply": 0.9}`
   - "涨 0.5 元" → `{"add": 0.5}`；"降 0.5 元" → `{"add": -0.5}`
10. **没定位信息就执行 / 没修改字段就执行**：均必须拒绝。
11. **body 包含未修改的字段**：body 中只应包含用户实际要修改的字段。
12. **跳过最终确认**：修改是危险操作，必须经过 CP1 + CP2 / CP2a + CP2b。
13. **没有输出 apicall 块**：最终确认后必须输出 ```apicall` 块。
14. **错误码处理**：
    - 404 → 提示无匹配
    - 409 `name_ambiguous` → 提示改用 ID 或换批量
    - 409 `name_collision_*` → 提示调整 name 表达式
    - 409 `count_mismatch` → 提示数据并发改动，重新 dry_run

## Verification Checklist

- [ ] id / locate_name / filters 三选一必填校验
- [ ] 至少一项修改字段校验
- [ ] price 数字/表达式格式校验
- [ ] category 枚举校验（只允许 5 个值）
- [ ] 有 id 时 endpoint = `/api/products/{id}`
- [ ] 只有 locate_name 时 endpoint = `/api/products?locate_name=<旧名称>`，body 不含 locate_name
- [ ] filters 多条件时走 `POST /api/products/bulk_update`
- [ ] 批量场景先 dry_run 再正式执行，Step1/Step2 条件完全一致
- [ ] 批量正式执行带上 `expected_count`
- [ ] 不输出 `POST /api/products/query`（查询结果不会回传 LLM）
- [ ] Checkpoint 1 / 1b 参数收集存在
- [ ] Checkpoint 2 (单条 final) 或 2a/2b (批量预览+终确认) 存在
- [ ] 最终确认后输出 ```apicall` 块
- [ ] apicall body 只包含用户实际要修改的字段
- [ ] 所有 ```hitl` 块 JSON 语法合法，且用 ``` ```hitl ``` ` 包裹
- [ ] 决策收集铁律已写入每个 CP
- [ ] HITL 触发条件表已填充
- [ ] 边界条件已写明
- [ ] category 用 `fields[].type: "choice"` + options（前端兼容性）
- [ ] 处理 404 / 409（ambiguous / collision / count_mismatch）错误响应
- [ ] 单条/批量路径判定信号写清（"所有"、"含"、多维条件 → 批量）
