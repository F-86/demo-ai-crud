import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from typing import Any
import sqlite3
import json

load_dotenv()  # 加载 .env 文件到环境变量

from database import get_connection, init_db
from models import ProductCreate, ProductUpdate, CATEGORIES
import skill_framework

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    await skill_framework.init_registry()
    yield

app = FastAPI(title="AI CRUD Demo", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def db():
    conn = get_connection()
    return conn

# ─── Product CRUD ──────────────────────────────────────────

@app.get("/api/products")
def list_products(
    id: int = None, name: str = None,
    price_min: float = None, price_max: float = None,
    category: str = None,
    created_after: str = None, created_before: str = None,
    updated_after: str = None, updated_before: str = None,
):
    conn = db()
    query = "SELECT * FROM products WHERE 1=1"
    params = []
    if id: query += " AND id=?"; params.append(id)
    if name: query += " AND name LIKE ?"; params.append(f"%{name}%")
    if price_min: query += " AND price>=?"; params.append(price_min)
    if price_max: query += " AND price<=?"; params.append(price_max)
    if category: query += " AND category=?"; params.append(category)
    if created_after: query += " AND created>=?"; params.append(created_after)
    if created_before: query += " AND created<=?"; params.append(created_before)
    if updated_after: query += " AND updated>=?"; params.append(updated_after)
    if updated_before: query += " AND updated<=?"; params.append(updated_before)
    query += " ORDER BY id ASC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/products/categories")
def list_categories():
    return [{"value": c, "label": c} for c in ["玩具", "服装", "饮料", "食品", "数码"]]

def _build_filter_sql(filters: dict) -> tuple[str, list]:
    """根据 filters 拼出 SQL WHERE 子句（不含 WHERE 关键字，从 ' AND ...' 开始）+ 参数列表。

    供 /api/products/query 和 /api/products/bulk_update 共享。
    """
    where = ""
    params: list = []
    if filters.get("id"):
        placeholders = ",".join("?" * len(filters["id"]))
        where += f" AND id IN ({placeholders})"
        params.extend(filters["id"])
    if filters.get("name"):
        name_val = filters["name"]
        if isinstance(name_val, list):
            if name_val:
                clauses = " OR ".join(["name LIKE ?" for _ in name_val])
                where += f" AND ({clauses})"
                params.extend(f"%{n}%" for n in name_val)
        else:
            where += " AND name LIKE ?"
            params.append(f"%{name_val}%")
    if filters.get("category"):
        placeholders = ",".join("?" * len(filters["category"]))
        where += f" AND category IN ({placeholders})"
        params.extend(filters["category"])
    price = filters.get("price")
    if isinstance(price, dict):
        if price.get("gte") is not None:
            where += " AND price >= ?"; params.append(price["gte"])
        if price.get("lte") is not None:
            where += " AND price <= ?"; params.append(price["lte"])
    else:
        if filters.get("price_min"):
            where += " AND price >= ?"; params.append(filters["price_min"][0])
        if filters.get("price_max"):
            where += " AND price <= ?"; params.append(filters["price_max"][0])
    created = filters.get("created")
    if isinstance(created, dict):
        if created.get("gte"):
            where += " AND created >= ?"; params.append(created["gte"])
        if created.get("lte"):
            where += " AND created <= ?"; params.append(created["lte"])
    else:
        if filters.get("created_from"):
            where += " AND created >= ?"; params.append(filters["created_from"][0])
        if filters.get("created_to"):
            where += " AND created <= ?"; params.append(filters["created_to"][0])
    updated = filters.get("updated")
    if isinstance(updated, dict):
        if updated.get("gte"):
            where += " AND updated >= ?"; params.append(updated["gte"])
        if updated.get("lte"):
            where += " AND updated <= ?"; params.append(updated["lte"])
    else:
        if filters.get("updated_from"):
            where += " AND updated >= ?"; params.append(filters["updated_from"][0])
        if filters.get("updated_to"):
            where += " AND updated <= ?"; params.append(filters["updated_to"][0])
    return where, params


@app.post("/api/products/query")
def query_products(body: dict):
    filters = body.get("filters", {})
    where, params = _build_filter_sql(filters)
    conn = db()
    rows = conn.execute(
        f"SELECT * FROM products WHERE 1=1{where} ORDER BY id ASC", params
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/products")
def create_product(data: ProductCreate):
    if data.category not in CATEGORIES:
        raise HTTPException(400, f"分类必须是 {', '.join(CATEGORIES)}")
    conn = db()
    cur = conn.execute("INSERT INTO products (name, price, category) VALUES (?,?,?)",
                       (data.name, data.price, data.category))
    conn.commit()
    row = conn.execute("SELECT * FROM products WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)

def _resolve_product_id_by_name(conn, locate_name: str) -> int:
    """按名称（精确）定位单个商品 ID。多条或 0 条均报错。"""
    rows = conn.execute(
        "SELECT id, name FROM products WHERE name=?", (locate_name,)
    ).fetchall()
    if len(rows) == 0:
        # 兜底：尝试模糊匹配，仍要求唯一
        rows = conn.execute(
            "SELECT id, name FROM products WHERE name LIKE ?", (f"%{locate_name}%",)
        ).fetchall()
    if len(rows) == 0:
        raise HTTPException(404, f"未找到名称为 '{locate_name}' 的商品")
    if len(rows) > 1:
        candidates = [{"id": r["id"], "name": r["name"]} for r in rows]
        raise HTTPException(
            409,
            {
                "error": "name_ambiguous",
                "message": f"名称 '{locate_name}' 匹配到 {len(rows)} 条商品，请改用 ID 定位",
                "candidates": candidates,
            },
        )
    return rows[0]["id"]


@app.put("/api/products/{pid}")
def update_product(pid: int, data: ProductUpdate):
    conn = db()
    row = conn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "商品不存在")
    sets = []
    vals = []
    if data.name is not None:
        sets.append("name=?")
        vals.append(data.name)
    if data.price is not None:
        sets.append("price=?")
        vals.append(data.price)
    if data.category is not None:
        if data.category not in CATEGORIES:
            conn.close()
            raise HTTPException(400, f"分类必须是{', '.join(CATEGORIES)}")
        sets.append("category=?")
        vals.append(data.category)
    if sets:
        sets.append("updated=datetime('now','localtime')")
        vals.append(pid)
        conn.execute(f"UPDATE products SET {', '.join(sets)} WHERE id=?", vals)
        conn.commit()
    row = conn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    conn.close()
    return dict(row)


@app.put("/api/products")
def update_product_by_name(data: ProductUpdate, locate_name: str = None):
    """按名称定位修改商品。query 参数 locate_name 必填，精确匹配唯一商品后转交常规更新逻辑。

    - 0 条匹配 → 404
    - 多条匹配 → 409（返回候选列表，由前端/LLM 让用户选 id 再走 /api/products/{pid}）
    - 1 条匹配 → 执行更新
    """
    if not locate_name:
        raise HTTPException(400, "缺少 locate_name 参数")
    conn = db()
    try:
        pid = _resolve_product_id_by_name(conn, locate_name)
    finally:
        conn.close()
    return update_product(pid, data)


# ─── 批量修改 ───────────────────────────────────────────────

def _eval_name_update(row_name: str, name_op: Any) -> str:
    """根据 name 更新指令计算新名称。

    支持：
    - 字符串："雪碧"  → 直接替换
    - {"set": "雪碧"}        → 直接替换
    - {"suffix": "（易过期）"} → row_name + 后缀
    - {"prefix": "【新】"}    → 前缀 + row_name
    - {"replace": ["旧", "新"]} → row_name.replace("旧", "新")
    """
    if isinstance(name_op, str):
        return name_op
    if isinstance(name_op, dict):
        if "set" in name_op:
            return str(name_op["set"])
        if "suffix" in name_op:
            return f"{row_name}{name_op['suffix']}"
        if "prefix" in name_op:
            return f"{name_op['prefix']}{row_name}"
        if "replace" in name_op:
            rep = name_op["replace"]
            if isinstance(rep, list) and len(rep) == 2:
                return row_name.replace(rep[0], rep[1])
            raise HTTPException(400, "name.replace 必须是 [旧, 新] 二元数组")
    raise HTTPException(400, f"不支持的 name 更新指令: {name_op!r}")


def _eval_price_update(row_price: float, price_op: Any) -> float:
    """根据 price 更新指令计算新价格。

    支持：
    - 数字：5.5            → 直接设值
    - {"set": 5.5}          → 直接设值
    - {"multiply": 1.1}     → row_price * 1.1（按比例涨价/打折）
    - {"add": 0.5}          → row_price + 0.5（增减固定金额，允许负数）
    """
    if isinstance(price_op, (int, float)) and not isinstance(price_op, bool):
        new_price = float(price_op)
    elif isinstance(price_op, dict):
        if "set" in price_op:
            new_price = float(price_op["set"])
        elif "multiply" in price_op:
            new_price = float(row_price) * float(price_op["multiply"])
        elif "add" in price_op:
            new_price = float(row_price) + float(price_op["add"])
        else:
            raise HTTPException(400, f"不支持的 price 更新指令: {price_op!r}")
    else:
        raise HTTPException(400, f"不支持的 price 更新指令: {price_op!r}")
    # 四舍五入到 2 位
    new_price = round(new_price, 2)
    if new_price <= 0:
        raise HTTPException(400, f"价格计算结果非正数: {new_price}")
    return new_price


@app.post("/api/products/bulk_update")
def bulk_update_products(body: dict):
    """按 filters 批量修改商品。

    Body:
        {
            "filters": {...},          # 同 /api/products/query 的 filter 协议
            "update": {
                "name": "新名" | {"set": "新名"} | {"suffix": "x"} | {"prefix": "x"} | {"replace": ["旧","新"]},
                "price": 5.5 | {"set":5.5} | {"multiply":1.1} | {"add":0.5},
                "category": "饮料"      # 只支持直接设值（枚举校验）
            },
            "dry_run": true|false,     # 默认 false。true 时只返回匹配列表，不修改
            "expected_count": int      # 可选。非 dry_run 且提供时，匹配数与之不一致则 409
        }

    Response:
        - dry_run=true:
            {
                "dry_run": true,
                "matched": N,
                "items": [...匹配商品],
                "preview": [{"id":..., "before": {...}, "after": {...}}, ...]
            }
        - dry_run=false:
            {
                "dry_run": false,
                "updated": N,
                "items": [...更新后的商品]
            }
    """
    filters = body.get("filters") or {}
    update = body.get("update") or {}
    dry_run = bool(body.get("dry_run", False))
    expected_count = body.get("expected_count")

    if not filters:
        raise HTTPException(400, "filters 不能为空（避免误改全表）")
    if not update:
        raise HTTPException(400, "update 不能为空")

    # 提前校验 category 枚举
    if "category" in update and update["category"] is not None:
        if update["category"] not in CATEGORIES:
            raise HTTPException(400, f"分类必须是{', '.join(CATEGORIES)}")

    where, params = _build_filter_sql(filters)
    conn = db()
    rows = conn.execute(
        f"SELECT * FROM products WHERE 1=1{where} ORDER BY id ASC", params
    ).fetchall()
    matched = len(rows)

    if matched == 0:
        conn.close()
        raise HTTPException(404, "未匹配到任何商品，filters 无结果")

    # 计算每条的 after，提前发现表达式错误
    preview = []
    for r in rows:
        before = dict(r)
        after = {}
        if "name" in update and update["name"] is not None:
            after["name"] = _eval_name_update(before["name"], update["name"])
        if "price" in update and update["price"] is not None:
            after["price"] = _eval_price_update(before["price"], update["price"])
        if "category" in update and update["category"] is not None:
            after["category"] = update["category"]
        preview.append({"id": before["id"], "before": before, "after": after})

    # 重名校验（仅当 update 涉及 name 时）：
    # 1) 批量内部不能出现同名（多条新名相同）
    # 2) 新名不能与库内其他非本批商品撞名
    if "name" in update and update["name"] is not None:
        new_names = [p["after"]["name"] for p in preview]
        # 内部重名
        seen = {}
        for p in preview:
            n = p["after"]["name"]
            seen.setdefault(n, []).append(p["id"])
        dup_in_batch = {n: ids for n, ids in seen.items() if len(ids) > 1}
        if dup_in_batch:
            conn.close()
            raise HTTPException(
                409,
                {
                    "error": "name_collision_in_batch",
                    "message": "批量修改后将产生同名商品，请调整 name 表达式",
                    "duplicates": dup_in_batch,
                },
            )
        # 与库内非本批撞名
        batch_ids = [p["id"] for p in preview]
        id_placeholders = ",".join("?" * len(batch_ids))
        name_placeholders = ",".join("?" * len(new_names))
        clash_rows = conn.execute(
            f"SELECT id, name FROM products WHERE name IN ({name_placeholders}) "
            f"AND id NOT IN ({id_placeholders})",
            [*new_names, *batch_ids],
        ).fetchall()
        if clash_rows:
            conn.close()
            raise HTTPException(
                409,
                {
                    "error": "name_collision_with_existing",
                    "message": "新名称与库内其他商品重名",
                    "conflicts": [{"id": r["id"], "name": r["name"]} for r in clash_rows],
                },
            )

    if dry_run:
        conn.close()
        return {
            "dry_run": True,
            "matched": matched,
            "items": [dict(r) for r in rows],
            "preview": preview,
        }

    # expected_count 双保险
    if expected_count is not None and int(expected_count) != matched:
        conn.close()
        raise HTTPException(
            409,
            {
                "error": "count_mismatch",
                "message": f"匹配数 {matched} 与预期 {expected_count} 不一致，操作已中止",
                "matched": matched,
                "expected": int(expected_count),
            },
        )

    # 执行批量更新（逐条 UPDATE，因为 name/price 可能逐行不同）
    updated_ids = []
    for p in preview:
        sets, vals = [], []
        a = p["after"]
        if "name" in a:
            sets.append("name=?"); vals.append(a["name"])
        if "price" in a:
            sets.append("price=?"); vals.append(a["price"])
        if "category" in a:
            sets.append("category=?"); vals.append(a["category"])
        if not sets:
            continue
        sets.append("updated=datetime('now','localtime')")
        vals.append(p["id"])
        conn.execute(f"UPDATE products SET {', '.join(sets)} WHERE id=?", vals)
        updated_ids.append(p["id"])
    conn.commit()

    # TODO(audit): 此处可接入审计日志，记录 before/after/operator/timestamp
    print(f"[bulk_update] filters={filters} update={update} updated_ids={updated_ids}")

    if updated_ids:
        id_placeholders = ",".join("?" * len(updated_ids))
        new_rows = conn.execute(
            f"SELECT * FROM products WHERE id IN ({id_placeholders}) ORDER BY id ASC",
            updated_ids,
        ).fetchall()
        items = [dict(r) for r in new_rows]
    else:
        items = []
    conn.close()
    return {"dry_run": False, "updated": len(updated_ids), "items": items}


@app.post("/api/products/bulk_delete")
def bulk_delete_products(body: dict):
    """按 filters 批量删除商品。

    Body:
        {
            "filters": {...},      # 同 /api/products/query 的 filter 协议
            "dry_run": true|false, # 默认 false。true 时只返回匹配列表，不删除
            "expected_count": int  # 可选。非 dry_run 且提供时，匹配数与之不一致则 409
        }

    Response:
        - dry_run=true:
            {
                "dry_run": true,
                "matched": N,
                "items": [...匹配商品]
            }
        - dry_run=false:
            {
                "dry_run": false,
                "deleted": N,
                "items": [...被删除商品]
            }
    """
    filters = body.get("filters") or {}
    dry_run = bool(body.get("dry_run", False))
    expected_count = body.get("expected_count")

    if not filters:
        raise HTTPException(400, "filters 不能为空（避免误删全表）")

    where, params = _build_filter_sql(filters)
    conn = db()
    rows = conn.execute(
        f"SELECT * FROM products WHERE 1=1{where} ORDER BY id ASC", params
    ).fetchall()
    matched = len(rows)

    if matched == 0:
        conn.close()
        raise HTTPException(404, "未匹配到任何商品，filters 无结果")

    items = [dict(r) for r in rows]

    if dry_run:
        conn.close()
        return {"dry_run": True, "matched": matched, "items": items}

    if expected_count is not None and int(expected_count) != matched:
        conn.close()
        raise HTTPException(
            409,
            {
                "error": "count_mismatch",
                "message": f"匹配数 {matched} 与预期 {expected_count} 不一致，操作已中止",
                "matched": matched,
                "expected": int(expected_count),
            },
        )

    delete_ids = [r["id"] for r in rows]
    placeholders = ",".join("?" * len(delete_ids))
    conn.execute(f"DELETE FROM products WHERE id IN ({placeholders})", delete_ids)
    conn.commit()

    # TODO(audit): 此处可接入审计日志，记录 deleted_ids/operator/timestamp
    print(f"[bulk_delete] filters={filters} deleted_ids={delete_ids}")

    conn.close()
    return {"dry_run": False, "deleted": len(delete_ids), "items": items}


@app.delete("/api/products/{pid}")
def delete_product(pid: int):
    conn = db()
    row = conn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "商品不存在")
    conn.execute("DELETE FROM products WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return {"ok": True, "deleted_id": pid}

# ─── Chat Groups ───────────────────────────────────────────

@app.get("/api/chat/groups")
def list_groups():
    conn = db()
    rows = conn.execute(
        "SELECT id, name, created, updated FROM chat_groups ORDER BY id ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/chat/groups")
def create_group(body: dict = None):
    name = "新分组"
    if body and body.get("name"):
        name = body["name"].strip() or "新分组"
    conn = db()
    cur = conn.execute("INSERT INTO chat_groups (name) VALUES (?)", (name,))
    conn.commit()
    row = conn.execute("SELECT * FROM chat_groups WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)

@app.patch("/api/chat/groups/{gid}")
def rename_group(gid: int, body: dict):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "分组名不能为空")
    conn = db()
    conn.execute(
        "UPDATE chat_groups SET name=?, updated=datetime('now','localtime') WHERE id=?",
        (name, gid)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM chat_groups WHERE id=?", (gid,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "分组不存在")
    return dict(row)

@app.delete("/api/chat/groups/{gid}")
def delete_group(gid: int):
    conn = db()
    row = conn.execute("SELECT id FROM chat_groups WHERE id=?", (gid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "分组不存在")
    # 删除分组后，该分组下的会话 group_id 自动置空 (ON DELETE SET NULL)
    conn.execute("DELETE FROM chat_groups WHERE id=?", (gid,))
    conn.commit()
    conn.close()
    return {"ok": True}

# ─── Chat Sessions ─────────────────────────────────────────

@app.get("/api/chat/sessions")
def list_sessions():
    conn = db()
    rows = conn.execute(
        "SELECT id, title, group_id, created, updated FROM chat_sessions ORDER BY updated DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/chat/sessions")
def create_session(body: dict = None):
    conn = db()
    group_id = None
    if body and body.get("group_id") is not None:
        group_id = body["group_id"]
        g = conn.execute("SELECT id FROM chat_groups WHERE id=?", (group_id,)).fetchone()
        if not g:
            conn.close()
            raise HTTPException(400, "分组不存在")
    cur = conn.execute(
        "INSERT INTO chat_sessions (title, group_id) VALUES (?, ?)", ("新对话", group_id)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM chat_sessions WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)

@app.patch("/api/chat/sessions/{sid}")
def rename_session(sid: int, body: dict):
    conn = db()
    row = conn.execute("SELECT * FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "会话不存在")

    sets = []
    vals = []
    title = body.get("title")
    if title is not None:
        title = title.strip()
        if not title:
            conn.close()
            raise HTTPException(400, "标题不能为空")
        sets.append("title=?")
        vals.append(title)
    # 支持移动会话到分组（group_id 可为 null 表示移出分组）
    if "group_id" in body:
        gid = body["group_id"]
        if gid is not None:
            g = conn.execute("SELECT id FROM chat_groups WHERE id=?", (gid,)).fetchone()
            if not g:
                conn.close()
                raise HTTPException(400, "分组不存在")
        sets.append("group_id=?")
        vals.append(gid)
    if sets:
        sets.append("updated=datetime('now','localtime')")
        vals.append(sid)
        conn.execute(f"UPDATE chat_sessions SET {', '.join(sets)} WHERE id=?", vals)
        conn.commit()
    row = conn.execute("SELECT * FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    conn.close()
    return dict(row)

@app.delete("/api/chat/sessions/{sid}")
def delete_session(sid: int):
    conn = db()
    conn.execute("DELETE FROM chat_sessions WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return {"ok": True}

# ─── Chat History ──────────────────────────────────────────

@app.get("/api/chat/sessions/{sid}/messages")
def get_session_messages(sid: int, limit: int = 200):
    conn = db()
    rows = conn.execute(
        "SELECT id, role, text, hitl, apicall, apicall_result, created FROM chat_messages WHERE session_id=? ORDER BY id ASC LIMIT ?",
        (sid, limit)
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        msg = {"id": r["id"], "role": r["role"], "text": r["text"], "created": r["created"]}
        if r["hitl"]:
            msg["hitl"] = json.loads(r["hitl"])
        if r["apicall"]:
            msg["apicall"] = json.loads(r["apicall"])
        if r["apicall_result"]:
            msg["apicall_result"] = json.loads(r["apicall_result"])
        result.append(msg)
    return result

# ─── Skills ────────────────────────────────────────────────

@app.get("/api/skills")
def list_skills():
    return skill_framework.list_skills()

@app.post("/api/skill/execute")
async def execute_skill(body: dict):
    message = body.get("message", "")
    session_id = body.get("session_id")
    is_hitl_response = body.get("hitl_response", False)
    conn = db()

    if not session_id:
        raise HTTPException(400, "缺少 session_id")

    session = conn.execute("SELECT id FROM chat_sessions WHERE id=?", (session_id,)).fetchone()
    if not session:
        conn.close()
        raise HTTPException(404, "会话不存在")

    conn.execute(
        "INSERT INTO chat_messages (session_id, role, text) VALUES (?, ?, ?)",
        (session_id, "user", message)
    )
    conn.commit()

    # 首条用户消息时，截取前 20 字作为会话标题
    msg_count = conn.execute(
        "SELECT COUNT(*) FROM chat_messages WHERE session_id=? AND role='user'", (session_id,)
    ).fetchone()[0]
    if msg_count == 1:
        title = message[:20] + ("…" if len(message) > 20 else "")
        conn.execute(
            "UPDATE chat_sessions SET title=?, updated=datetime('now','localtime') WHERE id=?",
            (title, session_id)
        )
        conn.commit()

    history_rows = conn.execute(
        "SELECT role, text FROM chat_messages WHERE session_id=? ORDER BY id ASC LIMIT 20",
        (session_id,)
    ).fetchall()
    history = [{"role": r["role"], "text": r["text"]} for r in history_rows]

    # HITL 响应：优先复用上一条 AI 消息记录下来的 skill_name，避免靠文本猜测导致串 skill
    forced_skill = None
    if is_hitl_response:
        last_skill_row = conn.execute(
            """SELECT text, skill_name FROM chat_messages WHERE session_id=? AND role='ai'
               ORDER BY id DESC LIMIT 1""",
            (session_id,)
        ).fetchone()
        if last_skill_row:
            forced_skill = last_skill_row["skill_name"] or await skill_framework.detect_skill_from_reply(last_skill_row["text"])

    result = await skill_framework.execute_skill(message, conn, history=history, forced_skill=forced_skill)
    reply = result.get("reply", "")

    hitl_json = None
    apicall_json = None

    if reply and "```hitl" in reply:
        try:
            hitl_part = reply.split("```hitl")[1].split("```")[0]
            hitl_json = json.loads(hitl_part)
        except Exception:
            pass

    # 兼容：LLM 偶尔把 HITL / apicall JSON 包在 ```text 代码块里
    text_block_json = None
    if reply and "```text" in reply:
        try:
            text_part = reply.split("```text")[1].split("```")[0]
            stripped_text = text_part.strip()
            if stripped_text.startswith("{"):
                text_block_json = json.loads(stripped_text)
        except Exception:
            pass

    if not hitl_json and text_block_json and "checkpoint" in text_block_json:
        hitl_json = text_block_json

    # 兜底：LLM 有时直接输出裸 JSON（没有 ```hitl 包裹），尝试解析整个回复
    if not hitl_json and reply:
        stripped = reply.strip()
        if stripped.startswith("{") and '"checkpoint"' in stripped:
            try:
                hitl_json = json.loads(stripped)
            except Exception:
                pass

    if reply and "```apicall" in reply:
        try:
            apicall_part = reply.split("```apicall")[1].split("```")[0]
            apicall_json = json.loads(apicall_part)
        except Exception:
            pass

    if not apicall_json and text_block_json and "method" in text_block_json:
        apicall_json = text_block_json

    # 如果已解析到 hitl，不再把 hitl 内部的 apicall 字段单独提取为顶层 apicall
    if not hitl_json and not apicall_json and reply:
        stripped = reply.strip()
        if stripped.startswith("{") and '"method"' in stripped:
            try:
                apicall_json = json.loads(stripped)
            except Exception:
                pass

    conn.execute(
        "INSERT INTO chat_messages (session_id, role, text, hitl, skill_name, apicall) VALUES (?, ?, ?, ?, ?, ?)",
        (session_id, "ai", reply,
         json.dumps(hitl_json, ensure_ascii=False) if hitl_json else None,
         result.get("skill"),
         json.dumps(apicall_json, ensure_ascii=False) if apicall_json else None)
    )
    conn.execute(
        "UPDATE chat_sessions SET updated=datetime('now','localtime') WHERE id=?",
        (session_id,)
    )
    conn.commit()
    msg_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()

    if apicall_json:
        result["apicall"] = apicall_json
        result["msg_id"] = msg_id
    if hitl_json:
        result["hitl"] = hitl_json
    return result


@app.post("/api/chat/messages/{msg_id}/apicall_result")
async def save_apicall_result(msg_id: int, request: Request):
    body = await request.json()
    conn = db()
    conn.execute(
        "UPDATE chat_messages SET apicall_result=? WHERE id=?",
        (json.dumps(body, ensure_ascii=False), msg_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True}

@app.post("/api/chat/sessions/{sid}/apicall_from_hitl")
async def save_apicall_from_hitl(sid: int, request: Request):
    """将 HITL 触发的 apicall 执行结果持久化为一条新消息"""
    body = await request.json()
    conn = db()
    apicall_json = json.dumps(body["apicall"], ensure_ascii=False) if body.get("apicall") else None
    result_json = json.dumps(body.get("result"), ensure_ascii=False) if body.get("result") else None
    conn.execute(
        "INSERT INTO chat_messages (session_id, role, text, apicall, apicall_result) VALUES (?, ?, ?, ?, ?)",
        (sid, "ai", "", apicall_json, result_json)
    )
    conn.execute(
        "UPDATE chat_sessions SET updated=datetime('now','localtime') WHERE id=?",
        (sid,)
    )
    conn.commit()
    conn.close()
    return {"ok": True}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
