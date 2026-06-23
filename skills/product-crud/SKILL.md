---
name: product-crud
description: 商品管理技能：对商品数据进行增、改、删操作。当用户提到添加、新增、创建、修改、更新、编辑、删除、移除商品时使用。不处理查询/搜索/列出商品（由 product-query 负责）。
---

# 商品管理（Product CRUD）

根据用户意图，输出一段简短的确认文字 + 对应的 `apicall` 或 `hitl` 块。不要自己编造数据，不要描述结果，前端会执行 apicall 并渲染。

**本 skill 只处理增/改/删。查询商品请交给 `product-query` skill，不要在这里处理。**

## 分类约束

商品分类只能是以下五种（见 [categories.md](references/categories.md)）：`玩具` `服装` `饮料` `食品` `数码`

## 操作规则

### 创建
必填：名称、价格、分类。缺少任意一项时输出 hitl 块收集信息，全部具备时输出 POST apicall。

缺参数时：
```hitl
{"version": "1.0", "checkpoint": {"id": "cp-create", "name": "创建商品", "phase": "Phase 1", "summary": "缺少必填参数", "action": "wait", "decisions": [{"id": "d-1", "type": "input", "question": "请补充：<缺少的字段>", "fields": [{"name": "info", "type": "string", "label": "信息", "required": true}]}]}}
```

参数齐全时：
```apicall
{"method": "POST", "endpoint": "/api/products", "body": {"name": "...", "price": 0.0, "category": "..."}}
```

### 修改
必填：商品 ID。可选：名称、价格、分类（至少提供一个）。缺少 ID 时用文字提示用户补充。

```apicall
{"method": "PUT", "endpoint": "/api/products/<id>", "body": {"name": "...", "price": 0.0, "category": "..."}}
```

body 中只包含用户实际要修改的字段。

### 删除
必填：商品 ID。缺少 ID 时用文字提示用户补充。有 ID 时输出 hitl 确认块，将 apicall 内嵌在 checkpoint 中，用户点确认后前端直接执行。

```hitl
{"version": "1.0", "checkpoint": {"id": "cp-delete", "name": "删除确认", "phase": "Phase 2", "summary": "即将永久删除商品 <id>", "action": "wait", "apicall": {"method": "DELETE", "endpoint": "/api/products/<id>"}, "decisions": [{"id": "d-1", "type": "choice", "question": "确认删除？", "options": [{"value": "confirm", "label": "确认删除", "desc": "永久删除"}, {"value": "cancel", "label": "取消", "desc": "不执行"}]}]}}
```

## 输出格式

- 一句话说明正在做什么（如"好的，正在查询商品..."）
- 紧跟对应的 `apicall` 或 `hitl` 块
- 不输出其他内容，不描述预期结果
