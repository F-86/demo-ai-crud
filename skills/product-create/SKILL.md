---
name: product-create
description: >-
  创建新的商品。收集 name、price、category 三个必填参数，创建前需最终确认。
  关键词：商品创建、新增商品、添加商品
version: 1.0.0
author: Jane
license: MIT
metadata:
  hermes:
    tags: [product, create, crud, hitl]
    related_skills: [product-query, product-update, product-delete]
---

# Product Create — 创建商品

> 创建新的商品，三个参数全部必填，创建前需最终确认。

## Overview

本 skill 提供商品创建能力。需要收集以下三个必填参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| name | string | 商品名称 |
| price | number | 商品价格（数字） |
| category | string | 商品分类（玩具/服装/饮料/食品/数码） |

所有需要用户确定的参数，通过 ````hitl` JSON 块让用户确认。确认后通过 ````apicall` 块执行创建。

> HITL 协议完整规范见 `references/hitl-protocol.md`。

## 边界

- **进入条件**：用户说"添加商品"、"新增商品"、"创建商品"、"加一个商品"
- **不处理**：查询/修改/删除商品（分别用 product-query / product-update / product-delete）

---

## Harness 视角

| 维度 | 设计 |
|------|------|
| **CONTEXT** | 用户输入创建意图，LLM 用 ````hitl` 块收集缺失参数 |
| **TOOLS** | 输入：用户自然语言；输出：```hitl JSON 块 + 最终 ````apicall` 块 |
| **ORCHESTRATION** | 2 Phase 线性管道 + 2 个 Checkpoint（含最终确认） |
| **MEMORY** | 无跨步骤持久化状态 |
| **EVALUATION** | 参数必填校验 + price 数字格式校验 + category 枚举校验 |
| **RECOVERY** | 用户可在任意 CP 取消操作；参数格式错误时提示重输 |

---

## HITL 交互协议

本 skill 使用 ````hitl` JSON 代码块作为人机交互协议。协议完整规范见 `references/hitl-protocol.md`。

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

本 skill 的 HITL 触发是**精确约束的**。只在以下明确条件下才允许输出 ````hitl` 块。

### 参数触发矩阵

| 条件 | 触发 HITL | 块类型 | 说明 |
|------|----------|--------|------|
| `name` 缺失且必填 | ✅ | `input` | 收集缺少的商品名称 |
| `price` 缺失且必填 | ✅ | `input` | 收集缺少的商品价格 |
| `category` 缺失且必填 | ✅ | `input` | 收集缺少的商品分类 |
| 全部参数明确且齐全 | ❌ | — | 不触发参数收集 HITL，进入 ★ Checkpoint 确认 |
| 用户已明确跳过确认 | ❌ | — | 跳过 HITL，直接进行 |

> **铁律 1：不在上表中的情况，一律不触发参数收集阶段的 HITL。禁止在参数收集过程中自由发挥添加额外确认点。**
>
> **铁律 2：触发 HITL 时必须附带自然语言说明，让用户知道为什么需要介入。**
>
> **铁律 3：每个 ````hitl` 块的 `decisions` 至少 1 项，每项独立。**

### 最终确认触发条件

| 条件 | 触发 HITL | 块类型 | 说明 |
|------|----------|--------|------|
| 参数已齐全、操作即将执行 | ✅ | `confirm` | 展示将要创建的商品信息，等待用户最终确认，然后输出 ````apicall` |

---

## 工作流总览

```
用户输入创建意图
   ▼
Phase 0  Intake      判断操作意图 + 提取已有参数
   ▼
Phase 1  参数收集    收集 name / price / category（轮换图）
         ★ Checkpoint 1 — 参数收集（3 项）
         ★ Checkpoint 1b — 参数确认
   ▼
Phase 2  创建 + 确认 创建预览 → 最终确认
         ★ Checkpoint 2 (final) — 最终确认 + apicall
```

---

## Phase 0 — Intake

从用户描述中判断操作类型，提取已提供的参数。如果用户已提供了部分或全部参数，不要重复询问，只补缺失的。

## Phase 1 — 参数收集

### 参数清单

| 参数 | 必填 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `name` | 是 | string | — | 商品名称 |
| `price` | 是 | number | — | 商品价格，必须为数字 |
| `category` | 是 | choice | — | 商品分类：玩具/服装/饮料/食品/数码 |

### 执行逻辑

1. 从用户输入中提取参数
2. **已提取到的参数不要重复问**。只输出缺失字段的 ````hitl` `input` 块
   - **必须输出 ````hitl` 块**。禁止用自然语言提问。
   - 如果 `name` 拿到了 → 不在 hitl 中展示名称字段；只展示缺失的 price 和 category
   - 如果三个字段都齐了 → 直接进入 CP-1b 确认
3. 用户填写后，展示参数摘要，进入下一阶段

### 禁止行为

- **🔴 铁律：禁止用自然语言询问参数——必须输出 ````hitl` 块。** 即使只有一个字段缺失，也要输出 ````hitl` 块。
- **禁止**在参数齐全时触发额外 HITL
- **category 处理规则**：用户明确说了枚举值（"服装"、"数码"、"食品"等）→ 直接使用，不要质疑。只有模糊描述（"吃的"、"穿的"）时才需要 HITL
- **禁止**跳过必填参数直接执行
- **禁止**在确认最终前调用 API

#### ★ Checkpoint 1 — 参数收集块

**决策收集铁律：** 以下决策项每项独立列出。Agent **可以推荐**（用 `default` 标记），但**不能静默替用户选择**。

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-1",
    "name": "参数收集",
    "phase": "Phase 1",
    "summary": "请填写商品信息（每项一屏，可左右切换）",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "input",
        "question": "商品名称是什么？",
        "field": "name",
        "label": "商品名称",
        "fields": [
          {"name": "name", "type": "string", "label": "商品名称", "required": true}
        ]
      },
      {
        "id": "d-2",
        "type": "input",
        "question": "商品价格是多少？",
        "field": "price",
        "label": "商品价格",
        "fields": [
          {"name": "price", "type": "string", "label": "商品价格（数字）", "required": true}
        ]
      },
      {
        "id": "d-3",
        "type": "input",
        "question": "商品属于哪个分类？",
        "field": "category",
        "label": "商品分类",
        "fields": [
          {"name": "category", "type": "choice", "label": "商品分类", "required": true, "options": ["玩具", "服装", "饮料", "食品", "数码"]}
        ]
      }
    ]
  }
}
```

#### ★ Checkpoint 1b — 参数确认

展示用户填写的参数摘要，让用户确认：

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-1b",
    "name": "参数确认",
    "phase": "Phase 1",
    "summary": "已完成参数收集，请确认",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "choice",
        "question": "是否确认以上参数？",
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

## Phase 2 — 创建 + 确认

### 创建预览

清晰展示即将创建的商品信息：

```
📋 商品信息
名称: 测试商品
价格: ¥99.99
分类: 数码
```

#### ★ Checkpoint 2 — Final: 最终确认 + apicall

展示预览后，输出最终确认 ````hitl` 块：

```hitl
{
  "version": "1.0",
  "checkpoint": {
    "id": "cp-final",
    "name": "最终确认",
    "phase": "Phase 2",
    "summary": "即将创建新商品，请确认",
    "action": "wait",
    "decisions": [
      {
        "id": "d-1",
        "type": "confirm",
        "question": "确认执行创建操作？"
      }
    ]
  }
}
```

用户确认后，输出 ````apicall` 块让前端执行创建：

```apicall
{
  "method": "POST",
  "endpoint": "/api/products",
  "body": {
    "name": "<商品名称>",
    "price": "<商品价格>",
    "category": "<商品分类>"
  }
}
```

---

## 典型对话示例

> 用户：帮我添加一个商品
> Agent：需要收集以下信息
>
> ```text
> {"checkpoint":{"id":"cp-1","name":"参数收集","phase":"Phase 1","summary":"请提供商品信息","action":"wait","decisions":[{"id":"d-1","type":"input","question":"请提供商品信息：","fields":[{"name":"name","type":"string","label":"商品名称","required":true},{"name":"price","type":"string","label":"商品价格（数字）","required":true},{"name":"category","type":"choice","label":"商品分类","options":["玩具","服装","饮料","食品","数码"]}]}]}}
> ```
>
> 用户：名称叫测试可乐，价格5.5，分类饮料
> Agent：已识别参数，请确认
>
> ```text
> {"checkpoint":{"id":"cp-1-confirm","name":"参数确认","phase":"Phase 1","summary":"已完成参数收集","action":"wait","decisions":[{"id":"d-1","type":"choice","question":"是否确认以上参数？","options":[{"value":"approve","label":"✅ 确认","desc":"进入最终确认"},{"value":"modify","label":"✏️ 修改","desc":"调整参数"},{"value":"cancel","label":"❌ 取消","desc":"放弃操作"}]}]}}
> ```
>
> 用户：确认
> Agent：展示预览信息，输出最终确认
>
> ```text
> {"checkpoint":{"id":"cp-final","name":"最终确认","phase":"Phase 2","summary":"即将创建新商品","action":"wait","decisions":[{"id":"d-1","type":"confirm","question":"确认执行创建操作？"}]}}
> ```
>
> 用户：确认
> Agent：执行创建
>
> ```text
> {"method":"POST","endpoint":"/api/products","body":{"name":"测试可乐","price":5.5,"category":"饮料"}}
> ```

---

## Common Pitfalls

1. **price 不是数字**：必须校验并提示用户重新输入，不能自动设为 0。
2. **category 不在枚举内**：必须校验，提示用户从正确选项中选择。
3. **跳过最终确认**：创建是危险操作，必须经过 CP1 + CP2 两个 Checkpoint。
4. **参数齐全后仍问用户"要添加吗"**：参数齐全后直接展示预览进入 CP2，不要额外确认。
5. **没有输出 apicall 块**：最终确认后必须输出 ````apicall` 块让前端执行。

## Verification Checklist

- [ ] 3 个参数必填校验已实现
- [ ] price 数字格式校验
- [ ] category 枚举校验（只允许 5 个值）
- [ ] Checkpoint 1 参数确认存在
- [ ] Checkpoint 2 (final) 最终确认存在
- [ ] 最终确认后输出 ````apicall` 块
- [ ] 所有 ````hitl` 块 JSON 语法合法
- [ ] 决策收集铁律已写入每个 CP
- [ ] HITL 触发条件表已填充
- [ ] 边界条件已写明
