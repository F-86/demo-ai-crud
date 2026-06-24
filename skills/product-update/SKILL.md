---
name: product-update
description: >-
  修改已有商品。需要商品ID定位，可修改 name、price、category 字段（至少修改一项），修改前需最终确认。
  关键词：商品修改、更新商品、编辑商品、改商品
version: 1.0.0
author: Jane
license: MIT
metadata:
  hermes:
    tags: [product, update, crud, hitl]
    related_skills: [product-create, product-query, product-delete]
---

# Product Update — 修改商品

> 修改已有商品信息。需要商品 ID 定位，可修改 name、price、category 中的至少一项，修改前需最终确认。

## Overview

本 skill 提供商品修改能力。需要以下参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | number | 是 | 商品 ID，用于定位要修改的商品 |
| name | string | 否 | 新商品名称（不修改则不填） |
| price | number | 否 | 新商品价格，必须为数字（不修改则不填） |
| category | string | 否 | 新商品分类：玩具/服装/饮料/食品/数码（不修改则不填） |

> `id` 必填用于定位商品；`name`/`price`/`category` 均为可选，但至少需修改一项。

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
| `id` 缺失（必填） | ✅ | `input` | 收集要修改的商品 ID |
| 用户想修改某字段但未给值（如"改名"但没说改成什么） | ✅ | `input` | 收集缺失的修改字段值 |
| 用户未指明要修改哪些字段（如"修改id为3的商品"） | ✅ | `input` | 收集要修改的字段（全可选，至少填一项） |
| 全部参数明确且齐全（id + 至少一项修改字段） | ❌ | — | 不触发参数收集 HITL，进入 ★ Checkpoint 确认 |
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
Phase 0  Intake      提取 id + 要修改的字段
   ▼
Phase 1  参数收集    收集缺失的 id 和/或修改字段
         ★ Checkpoint 1 — 参数收集
         ★ Checkpoint 1b — 参数确认
   ▼
Phase 2  修改 + 确认 修改预览 → 最终确认
         ★ Checkpoint 2 (final) — 最终确认 + apicall
```

---

## Phase 0 — Intake

从用户描述中提取以下信息：
1. **商品 ID**（id）：用户要修改哪个商品？从"id为3"、"编号3"、"3号商品"等表述中提取数字
2. **修改字段**：用户要改哪些字段？改成的值是什么？
   - "改名成可乐" → name="可乐"
   - "价格改成10" → price=10
   - "分类改成饮料" → category="饮料"
   - "把id为3的商品价格改成10、分类改成饮料" → id=3, price=10, category="饮料"

**提取规则：**
- 已提取到的参数不要重复问
- 用户明确说了枚举值（"服装"、"数码"、"食品"等）→ 直接使用，不要质疑
- 只有模糊描述（"吃的"、"穿的"）时才需要 HITL

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

### 修改预览

清晰展示即将修改的商品信息，只列出将要变更的字段：

```
📋 修改预览
商品ID: 3
修改内容:
  名称: → 可乐
  价格: → 5.5
  分类: （不修改）
```

#### ★ Checkpoint 2 — Final: 最终确认 + apicall

展示预览后，输出最终确认 ```hitl` 块：

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
      {
        "id": "d-1",
        "type": "confirm",
        "question": "确认执行修改操作？"
      }
    ]
  }
}
```

用户确认后，输出 ```apicall` 块让前端执行修改。**body 中只包含用户实际要修改的字段，未修改的字段不放入 body：**

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

> **铁律：** body 中只包含用户实际要修改的字段。例如用户只改名称，body 为 `{"name": "可乐"}`；用户只改价格，body 为 `{"price": 10}`；用户改名称和分类，body 为 `{"name": "雪碧", "category": "饮料"}`。

---

## 典型对话示例

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

> 用户：修改 id 为 5 的商品
> Agent：需要收集要修改的字段
>
> ```text
> {"checkpoint":{"id":"cp-1","name":"参数收集","phase":"Phase 1","summary":"请提供要修改的商品信息（每项一屏，可左右切换）","action":"wait","decisions":[{"id":"d-2","type":"input","question":"新商品名称是什么？（不修改可留空）","field":"name","label":"商品名称（新）","fields":[{"name":"name","type":"string","label":"商品名称（新）","required":false}]},{"id":"d-3","type":"input","question":"新商品价格是多少？（不修改可留空）","field":"price","label":"商品价格（新）","fields":[{"name":"price","type":"string","label":"商品价格（新，数字）","required":false}]},{"id":"d-4","type":"input","question":"新商品分类是什么？（不修改可留空）","field":"category","label":"商品分类（新）","fields":[{"name":"category","type":"choice","label":"商品分类（新）","required":false,"options":["玩具","服装","饮料","食品","数码"]}]}]}}
> ```
>
> 用户：名称改成雪碧，分类改成饮料
> Agent：已识别修改字段，请确认
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
> {"method":"PUT","endpoint":"/api/products/5","body":{"name":"雪碧","category":"饮料"}}
> ```

---

## Common Pitfalls

1. **price 不是数字**：必须校验并提示用户重新输入，不能自动设为 0。
2. **category 不在枚举内**：必须校验，提示用户从正确选项中选择。
3. **没有 id 就执行**：id 是必填的定位参数，没有 id 禁止执行修改。
4. **没有任何修改字段**：至少需修改一项，不能提交空 body。
5. **body 包含未修改的字段**：body 中只应包含用户实际要修改的字段，未修改的字段不放入 body。
6. **跳过最终确认**：修改是危险操作，必须经过 CP1 + CP2 两个 Checkpoint。
7. **参数齐全后仍问用户"要修改吗"**：参数齐全后直接展示预览进入 CP2，不要额外确认。
8. **没有输出 apicall 块**：最终确认后必须输出 ```apicall` 块让前端执行。
9. **商品不存在（404）**：如果 API 返回 404，提示用户该商品不存在，请确认 ID 是否正确。

## Verification Checklist

- [ ] id 必填校验已实现
- [ ] 至少一项修改字段校验
- [ ] price 数字格式校验
- [ ] category 枚举校验（只允许 5 个值）
- [ ] Checkpoint 1 参数收集存在
- [ ] Checkpoint 1b 参数确认存在
- [ ] Checkpoint 2 (final) 最终确认存在
- [ ] 最终确认后输出 ```apicall` 块
- [ ] apicall body 只包含用户实际要修改的字段
- [ ] 所有 ```hitl` 块 JSON 语法合法
- [ ] 所有 ```hitl` 块用 ``` ```hitl ``` ` 包裹（非裸 JSON）
- [ ] 决策收集铁律已写入每个 CP
- [ ] HITL 触发条件表已填充
- [ ] 边界条件已写明
- [ ] category 用 `fields[].type: "choice"` + options（前端兼容性）
