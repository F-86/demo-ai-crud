"""
Product CRUD skill — LLM understands intent, then executes real DB operations.
Real data is fetched and injected into the LLM prompt to prevent hallucination.
"""

from skill_framework import register_skill
import json

async def product_skill_handler(message: str, db, system_prompt: str, client, model: str) -> str:
    """
    Two-phase execution:
    1. LLM identifies intent and extracts parameters (as JSON)
    2. Execute real DB operation
    3. LLM formats the real results
    """
    
    # Phase 1: intent + parameter extraction
    extract_prompt = f"""用户说: "{message}"

请从用户消息中提取操作意图和参数。只返回 JSON，不要其他内容。

可选操作: query, create, update, delete

返回格式:
- 查询: {{"action": "query", "params": {{"id": null, "name": null, "price_min": null, "price_max": null, "category": null}}}}
- 创建: {{"action": "create", "params": {{"name": "...", "price": 0.0, "category": "..."}}}}
- 修改: {{"action": "update", "params": {{"id": 0, "name": null, "price": null, "category": null}}}}
- 删除: {{"action": "delete", "params": {{"id": 0}}}}

如果用户意图不明确，返回: {{"action": "unknown", "reason": "..."}}
如果缺少必填参数，在 params 中标记缺失字段为 MISSING。
分类必须是: 玩具, 服装, 饮料, 食品, 数码
"""

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "你是一个精确的参数提取器。只返回 JSON。"},
                {"role": "user", "content": extract_prompt}
            ],
            temperature=0.1,
            max_tokens=300,
            response_format={"type": "json_object"},
        )
        intent = json.loads(resp.choices[0].message.content)
    except Exception as e:
        return f"❌ 意图识别失败: {str(e)}"
    
    action = intent.get("action", "unknown")
    params = intent.get("params", {})
    
    # Phase 2: execute real DB operation
    if action == "query":
        return await _do_query(message, params, db, system_prompt, client, model)
    elif action == "create":
        return _check_create_params(params, message, db, system_prompt, client, model)
    elif action == "update":
        return _check_update_params(params, message, db, system_prompt, client, model)
    elif action == "delete":
        return _check_delete_params(params, message, db, system_prompt, client, model)
    else:
        return "抱歉，我没有理解你的意图。请描述你想做什么操作，例如「查一下商品」「帮我添加一个商品」「修改商品」「删除商品」。"


async def _do_query(message, params, db, system_prompt, client, model):
    """Execute query and let LLM format results."""
    query = "SELECT * FROM products WHERE 1=1"
    vals = []
    
    if params.get("id"): query += " AND id=?"; vals.append(int(params["id"]))
    if params.get("name"): query += " AND name LIKE ?"; vals.append(f"%{params['name']}%")
    if params.get("price_min"): query += " AND price>=?"; vals.append(float(params["price_min"]))
    if params.get("price_max"): query += " AND price<=?"; vals.append(float(params["price_max"]))
    if params.get("category"): query += " AND category=?"; vals.append(params["category"])
    
    query += " ORDER BY id ASC"
    rows = db.execute(query, vals).fetchall()
    products = [dict(r) for r in rows]
    
    if not products:
        return "没有找到符合条件的商品。"
    
    data_json = json.dumps(products, ensure_ascii=False, indent=2)
    
    format_prompt = f"""用户说: "{message}"

以下是数据库查询结果 (JSON):
{data_json}

请用友好的中文展示这些商品信息。用表格或列表形式。如果是单条数据，展示详细信息。
"""
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": format_prompt}
        ],
        temperature=0.3,
        max_tokens=800,
    )
    return resp.choices[0].message.content


def _check_create_params(params, message, db, system_prompt, client, model):
    """Check create params — if missing, generate HITL block via LLM."""
    missing = []
    if not params.get("name") or params.get("name") == "MISSING":
        missing.append("商品名称")
    if not params.get("price") or params.get("price") == "MISSING":
        missing.append("商品价格")
    if not params.get("category") or params.get("category") == "MISSING":
        missing.append("商品分类（玩具/服装/饮料/食品/数码）")
    
    if missing:
        return f"需要补充以下信息：{', '.join(missing)}。\n\n```hitl\n{{\"version\": \"1.0\", \"checkpoint\": {{\"id\": \"cp-create\", \"name\": \"创建商品\", \"phase\": \"Phase 1\", \"summary\": \"缺少必填参数\", \"action\": \"wait\", \"decisions\": [{{\"id\": \"d-1\", \"type\": \"input\", \"question\": \"请补充：{', '.join(missing)}\", \"fields\": [{{\"name\": \"field\", \"type\": \"string\", \"label\": \"信息\", \"required\": true}}]}}]}}}}\n```"
    
    # Insert
    cur = db.execute("INSERT INTO products (name, price, category) VALUES (?,?,?)",
                     (params["name"], params["price"], params["category"]))
    db.commit()
    row = db.execute("SELECT * FROM products WHERE id=?", (cur.lastrowid,)).fetchone()
    return f"✅ 商品已成功创建！\nID: {row['id']}\n名称: {row['name']}\n价格: ¥{row['price']:.2f}\n分类: {row['category']}"


def _check_update_params(params, message, db, system_prompt, client, model):
    """Check update params."""
    pid = params.get("id")
    if not pid or pid == "MISSING":
        return "请提供要修改的商品ID。"
    
    row = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if not row:
        return f"未找到 ID 为 {pid} 的商品。"
    
    # Build update
    sets = []
    vals = []
    if params.get("name") and params["name"] != "MISSING":
        sets.append("name=?")
        vals.append(params["name"])
    if params.get("price") and params["price"] != "MISSING":
        sets.append("price=?")
        vals.append(float(params["price"]))
    if params.get("category") and params["category"] != "MISSING":
        sets.append("category=?")
        vals.append(params["category"])
    
    if not sets:
        return f"当前商品「{row['name']}」(ID: {pid})，请指定要修改的字段。"
    
    vals.append(pid)
    db.execute(f"UPDATE products SET {', '.join(sets)}, updated=datetime('now','localtime') WHERE id=?", vals)
    db.commit()
    row = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    return f"✅ 商品已更新：\n名称: {row['name']}\n价格: ¥{row['price']:.2f}\n分类: {row['category']}"


def _check_delete_params(params, message, db, system_prompt, client, model):
    """Check delete params."""
    pid = params.get("id")
    if not pid or pid == "MISSING":
        return "请提供要删除的商品ID。"
    
    row = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if not row:
        return f"未找到 ID 为 {pid} 的商品。"
    
    return f"确认删除以下商品？\nID: {row['id']}\n名称: {row['name']}\n价格: ¥{row['price']:.2f}\n分类: {row['category']}\n\n```hitl\n{{\"version\": \"1.0\", \"checkpoint\": {{\"id\": \"cp-delete\", \"name\": \"删除确认\", \"phase\": \"Phase 2\", \"summary\": \"即将永久删除商品\", \"action\": \"wait\", \"decisions\": [{{\"id\": \"d-1\", \"type\": \"choice\", \"question\": \"确认删除？\", \"options\": [{{\"value\": \"confirm\", \"label\": \"确认删除\", \"desc\": \"永久删除\"}}, {{\"value\": \"cancel\", \"label\": \"取消\", \"desc\": \"不执行\"}}]}}]}}}}\n```"


# Register
register_skill(
    name="product-crud",
    description="商品管理：对商品数据进行增删改查操作。",
    capabilities=[
        {"trigger": "查询、搜索、显示、查看、列出商品", "params": {"id": "可选", "name": "可选", "price": "范围可选", "category": "可选"}, "steps": "查询数据库并展示结果"},
        {"trigger": "添加、新增、创建商品", "params": {"name": "必填", "price": "必填", "category": "必填(玩具/服装/饮料/食品/数码)"}, "steps": "收集参数 → 创建"},
        {"trigger": "修改、更新、编辑商品", "params": {"id": "必填", "name": "可选", "price": "可选", "category": "可选"}, "steps": "获取ID → 展示 → 修改"},
        {"trigger": "删除、删掉、移除商品", "params": {"id": "必填"}, "steps": "获取ID → 确认 → 删除"},
    ],
    handler=product_skill_handler,
)
