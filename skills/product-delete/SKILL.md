---
name: product-delete
description: >-
  删除商品。支持两条路径：单条按商品 ID 删除，或按 filters 条件批量删除。
  批量删除会先 dry_run 预览命中列表，再做最终确认。关键词：删除商品、批量删除、删掉所有、移除商品、清理商品
version: 1.1.0
author: Jane
license: MIT
metadata:
  hermes:
    tags: [product, delete, crud, hitl, bulk]
    related_skills: [product-query, product-update, product-create]
---

# Product Delete — 删除商品

> 删除商品支持两条路径：
> - **单条**：按 `id` 精确删除，调用 `DELETE /api/products/{id}`
> - **批量**：按 `filters` 条件删除，调用 `POST /api/products/bulk_delete`
>
> 批量删除必须先 `dry_run` 预览，再最终确认。删除不可恢复。

## Overview

本 skill 支持以下参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | 定位二选一 | 单条删除的商品 ID |
| `filters` | object | 定位二选一 | 批量删除条件，协议与 `POST /api/products/query` / `POST /api/products/bulk_update` 完全一致 |

> **两条定位路径**：必须提供 `id` / `filters` 之一。
>
> | 用户表达 | 走哪条路径 | endpoint |
> |---------|-----------|----------|
> | “删除 id=3 的商品” / “删除 3 号商品” | 单条按 ID | `DELETE /api/products/3` |
> | “删除所有饮料商品” / “删掉价格低于 5 的饮料” / “删除名称含牛奶的所有商品” | 批量按条件 | `POST /api/products/bulk_delete` |
> | “删掉可乐” 这种只有单个名称、没有明确批量语义 | **不要猜** | 先收集 `id`，不要直接删 |

> **🔴 不要输出 `POST /api/products/query` 用作定位**——查询结果不会自动回传给 LLM，会卡死流程。
>
> - 单条路径：缺 `id` 时只收集 `id`
> - 批量路径：直接走 `bulk_delete` 的 `dry_run` 预览，前端展示命中列表

所有需要用户确认的步骤，必须通过 ```hitl` JSON 块完成。

## 运行时硬规则

- **你是在运行这个 skill，不是在复述文档。**
- **如果用户表达的是集合 / 条件删除（如“所有、全部、名称含、价格低于、分类是...”），优先走 `filters` 批量路径，不要退化成逐条删。**
- **如果是单条删除且 `id` 缺失，只能输出 CP-1 参数收集块；绝对不能提前输出删除确认。**
- **如果是批量删除，必须先输出 `dry_run` 的 ```apicall`，再输出批量预览确认 `hitl`。**
- **删除最终确认必须是 `choice` 类型，且 checkpoint 顶层不得有全局 `default`。**
- **严禁输出模板占位符**，如 `<id>`、`<商品ID>`、`<filters>`、`{{id}}`。实际输出时必须替换成真实值。
- **每次只输出当前一步需要的内容**：一个 `hitl` 块，或一个 `apicall` + 一个紧随其后的 `hitl` 块。
- **实际运行时，凡是 checkpoint JSON 都必须使用 ```hitl 代码块，不要用 ```text 包裹。**
- **收到批量预览确认后的用户回执时，要优先识别结构化 JSON**，例如 `{"action":"approve","expected_count":3}`；其中 `expected_count` 要用于最终正式删除的 body。

## 边界

- **进入条件**：用户说“删除商品”“删掉商品”“移除商品”“批量删除商品”“删掉所有 XX 商品”
- **不处理**：创建/查询/修改商品（分别用 `product-create` / `product-query` / `product-update`）
- **禁止行为**：
  - 没拿到 `id` 就做单条删除
  - 没有明确批量语义却把单个名称直接当 filters 删除
  - 批量场景跳过 `dry_run`
  - 省略最终确认直接删除
  - 输出独立 ```apicall` 去执行单条删除以绕过 delete HITL

---

## 工作流总览

```text
用户输入删除意图
   ▼
Phase 0    Intake         判定走【单条】还是【批量】
                         - 有明确 id              → 单条
                         - 有“所有/全部/条件组合” → 批量 filters
                         - 只有单个名字            → 不猜，收集 id
   ▼
Phase 1    参数收集
   ├─【单条】★ Checkpoint 1 — 收集 id（仅在 id 缺失时）
   └─【批量】无需补 id，直接进入 dry_run
   ▼
Phase 2    删除执行前确认
   ├─【单条】★ Checkpoint 2 — 最终确认 + 内嵌 DELETE apicall
   └─【批量】Step 1: dry_run 预览 apicall
             ★ Checkpoint 2a — 预览确认
             ★ Checkpoint 2b — 最终确认 + 内嵌正式删除 apicall
```

---

## Phase 0 — Intake

从用户话术中提取以下信息：

### 1) 单条定位：`id`

以下表达都应提取为 `id`：

- “删除 id 为 3 的商品” → `id=3`
- “删掉 3 号商品” → `id=3`
- “把编号 8 的商品移除” → `id=8`

### 2) 批量定位：`filters`

以下信号进入批量路径：

- 范围词：**所有 / 全部 / 每个 / 一批 / 批量**
- 模糊名：**名称含 / 名字里有 / 包含 / 叫 XX 的所有商品**
- 维度组合：**分类、价格区间、创建时间、更新时间** 等

示例：

- “删除所有饮料商品” → `filters={"category":["饮料"]}`
- “删除价格低于 5 元的饮料” → `filters={"category":["饮料"],"price":{"lte":5}}`
- “删除名称含‘牛奶’的所有商品” → `filters={"name":"牛奶"}`

### 3) 单个名称不是批量信号

- “把可乐删了”
- “删除名叫可乐的商品”

这类话术如果**没有**“所有 / 全部 / 批量 / 条件组合”等集合语义，**不要直接构造 filters 删除**。
因为它可能只是在描述一个具体商品，且名称可能重名。此时应进入 CP-1 收集 `id`。

---

## Phase 1 — 参数收集（仅单条且 id 缺失时）

### 触发条件

| 条件 | 触发 HITL | 块类型 | 说明 |
|------|----------|--------|------|
| 单条删除且 `id` 缺失 | ✅ | `input` | 收集要删除的商品 ID |
| 已有 `id` | ❌ | — | 直接进入单条最终确认 |
| 已识别 `filters` | ❌ | — | 直接进入批量 `dry_run` |

### ★ Checkpoint 1 — 参数收集块

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-1",
    "name": "参数收集",
    "phase": "Phase 1",
    "summary": "请提供要删除的商品 ID",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "input",
        "question": "要删除哪个商品？请提供商品 ID（如不确定，可先用查询功能查找）",
        "fields": [
          {"name": "id", "type": "string", "label": "商品ID（数字）", "required": true}
        ]
      }
    ]
  }
}
```

---

## Phase 2 — 删除确认

## 【单条】最终确认 + 删除

### ★ Checkpoint 2 — Final: 单条删除确认 + apicall

> 只有在 `id` 已明确时，才允许输出此块。
> `summary` 和 `endpoint` 中的 id 必须替换成真实数字。

下面是 **id=3** 时的正确示例：

```text
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-delete-single",
    "name": "删除确认",
    "phase": "Phase 2",
    "summary": "即将永久删除商品 ID=3，此操作不可恢复",
    "action": "wait",
    "apicall": {"method": "DELETE", "endpoint": "/api/products/3"},
    "decisions": [
      {
        "id": "d-1",
        "type": "choice",
        "question": "确认删除这个商品？",
        "options": [
          {"value": "confirm", "label": "⚠️ 确认删除", "desc": "永久删除该商品，不可恢复"},
          {"value": "cancel", "label": "❌ 取消", "desc": "不执行删除"}
        ]
      }
    ]
  }
}
```

---

## 【批量】dry_run 预览 → 两段确认

### Step 1：先输出 dry_run 预览 apicall

> 批量删除时，LLM 负责输出 `dry_run` apicall；前端负责展示命中商品列表。
> **不要**在这一阶段直接输出正式删除请求。

示例：删除所有饮料商品

```apicall
{
  "method": "POST",
  "endpoint": "/api/products/bulk_delete",
  "body": {
    "filters": {"category": ["饮料"]},
    "dry_run": true
  }
}
```

后端会返回：

```json
{
  "dry_run": true,
  "matched": 3,
  "items": [
    {"id": 6, "name": "可乐", "price": 3.5, "category": "饮料", "created": "...", "updated": "..."},
    {"id": 12, "name": "雪碧", "price": 4.0, "category": "饮料", "created": "...", "updated": "..."},
    {"id": 15, "name": "纯牛奶", "price": 2.0, "category": "饮料", "created": "...", "updated": "..."}
  ]
}
```

### ★ Checkpoint 2a — 批量预览确认

> 该 `hitl` 必须与 Step 1 的 `dry_run apicall` **同一回复输出**。

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-bulk-preview",
    "name": "批量预览确认",
    "phase": "Phase 2",
    "summary": "上方已展示将被删除的商品列表，请先核对范围",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "choice",
        "question": "是否继续对上方预览中的全部商品执行删除？",
        "options": [
          {"value": "approve", "label": "继续确认", "desc": "进入最终删除确认"},
          {"value": "refine", "label": "✏️ 调整条件", "desc": "范围不对，重新提需求"},
          {"value": "cancel", "label": "❌ 取消", "desc": "放弃删除"}
        ]
      }
    ]
  }
}
```

### ★ Checkpoint 2b — Final: 批量删除最终确认 + apicall

> 当用户在 CP-2a 选择 `approve` 后，输出最终确认块。
>
> 如果用户回执是结构化 JSON，例如：
>
> ```json
> {"action":"approve","expected_count":3}
> ```
>
> 那么要把 `expected_count=3` 带进正式删除 apicall，作为双保险。

下面是 **filters={"category":["饮料"]} 且 expected_count=3** 时的正确示例：

```text
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-delete-bulk",
    "name": "批量删除最终确认",
    "phase": "Phase 2",
    "summary": "即将永久删除预览中的 3 个商品，此操作不可恢复",
    "action": "wait",
    "apicall": {
      "method": "POST",
      "endpoint": "/api/products/bulk_delete",
      "body": {
        "filters": {"category": ["饮料"]},
        "dry_run": false,
        "expected_count": 3
      }
    },
    "decisions": [
      {
        "id": "d-1",
        "type": "choice",
        "question": "确认批量删除？",
        "options": [
          {"value": "confirm", "label": "⚠️ 确认批量删除", "desc": "永久删除预览中的全部商品，不可恢复"},
          {"value": "cancel", "label": "❌ 取消", "desc": "不执行删除"}
        ]
      }
    ]
  }
}
```

> **批量删除铁律：**
> - Step 1 和 Step 2 的 `filters` 必须完全一致
> - 正式删除时，若已知 `expected_count`，必须带上
> - 最终确认仍然不能设置 checkpoint 顶层 `default`

---

## 典型对话示例

### 示例 1：单条按 ID 删除

> 用户：删除 id 为 3 的商品
> Agent：已识别商品 ID=3。删除不可恢复，请确认。
>
> ```text
> {"version":"1.0","checkpoint":{"id":"cp-delete-single","name":"删除确认","phase":"Phase 2","summary":"即将永久删除商品 ID=3，此操作不可恢复","action":"wait","apicall":{"method":"DELETE","endpoint":"/api/products/3"},"decisions":[{"id":"d-1","type":"choice","question":"确认删除这个商品？","options":[{"value":"confirm","label":"⚠️ 确认删除","desc":"永久删除该商品，不可恢复"},{"value":"cancel","label":"❌ 取消","desc":"不执行删除"}]}]}}
> ```

### 示例 2：单条但缺少 ID

> 用户：把可乐删了
> Agent：为了避免删错，需要商品 ID。请先提供 ID。
>
> ```text
> {"version":"1.0","checkpoint":{"id":"cp-1","name":"参数收集","phase":"Phase 1","summary":"请提供要删除的商品 ID","action":"wait","decisions":[{"id":"d-1","type":"input","question":"要删除哪个商品？请提供商品 ID（如不确定，可先用查询功能查找）","fields":[{"name":"id","type":"string","label":"商品ID（数字）","required":true}]}]}}
> ```

### 示例 3：按条件批量删除

> 用户：删除所有饮料分类价格低于 5 元的商品
> Agent：识别到批量删除条件，先预览命中商品。
>
> ```text
> {"method":"POST","endpoint":"/api/products/bulk_delete","body":{"filters":{"category":["饮料"],"price":{"lte":5}},"dry_run":true}}
> ```
>
> ```text
> {"version":"1.0","checkpoint":{"id":"cp-bulk-preview","name":"批量预览确认","phase":"Phase 2","summary":"上方已展示将被删除的商品列表，请先核对范围","action":"wait","decisions":[{"id":"d-1","type":"choice","question":"是否继续对上方预览中的全部商品执行删除？","options":[{"value":"approve","label":"继续确认","desc":"进入最终删除确认"},{"value":"refine","label":"✏️ 调整条件","desc":"范围不对，重新提需求"},{"value":"cancel","label":"❌ 取消","desc":"放弃删除"}]}]}}
> ```
>
> 用户：approve（前端可能回传 `{"action":"approve","expected_count":3}`）
> Agent：输出批量最终确认。
>
> ```text
> {"version":"1.0","checkpoint":{"id":"cp-delete-bulk","name":"批量删除最终确认","phase":"Phase 2","summary":"即将永久删除预览中的 3 个商品，此操作不可恢复","action":"wait","apicall":{"method":"POST","endpoint":"/api/products/bulk_delete","body":{"filters":{"category":["饮料"],"price":{"lte":5}},"dry_run":false,"expected_count":3}},"decisions":[{"id":"d-1","type":"choice","question":"确认批量删除？","options":[{"value":"confirm","label":"⚠️ 确认批量删除","desc":"永久删除预览中的全部商品，不可恢复"},{"value":"cancel","label":"❌ 取消","desc":"不执行删除"}]}]}}
> ```

---

## Common Pitfalls

1. **🔴 把单个名称直接当批量 filters 删除**：只有名称、没有明显集合语义时，应该收集 `id`，不要直接删。
2. **🔴 批量删除跳过 dry_run**：禁止。必须先预览命中范围。
3. **🔴 正式删除时漏掉 `expected_count`**：如果用户回执或上下文里已经给出 matched 数量，就要带上它做双保险。
4. **🔴 Step 2 偷偷改 filters**：正式删除必须与 dry_run 的 filters 完全一致。
5. **🔴 删除确认设置 checkpoint 顶层 `default`**：禁止，避免误删。
6. **🔴 输出 `POST /api/products/query` 做定位**：禁止。查询结果不会自动回传给 LLM。
7. **🔴 输出占位符**：`<商品ID>`、`<filters>` 之类的模板文本绝不能直接发给用户。
8. **🔴 在未确认前执行删除**：删除不可逆，必须经过最终确认。

## Verification Checklist

- [ ] 单条删除支持 `DELETE /api/products/{id}`
- [ ] 批量删除支持 `POST /api/products/bulk_delete`
- [ ] 单条缺 `id` 时会输出 CP-1 收集块
- [ ] 批量场景先输出 `dry_run` 预览，再输出 CP-2a
- [ ] 批量 approve 后输出 CP-2b 最终确认
- [ ] 单条/批量最终确认都使用 `choice`，且无 checkpoint 顶层 `default`
- [ ] 正式批量删除时 `filters` 与 dry_run 完全一致
- [ ] 已知 `expected_count` 时会带进正式批量删除 body
- [ ] 不输出 `POST /api/products/query` 做定位
- [ ] 不直接输出任何模板占位符
