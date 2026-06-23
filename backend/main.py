import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv
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

@app.post("/api/products/query")
def query_products(body: dict):
    filters = body.get("filters", {})
    conn = db()
    query = "SELECT * FROM products WHERE 1=1"
    params = []
    if filters.get("id"):
        placeholders = ",".join("?" * len(filters["id"]))
        query += f" AND id IN ({placeholders})"
        params.extend(filters["id"])
    if filters.get("name"):
        query += " AND name LIKE ?"
        params.append(f"%{filters['name'][0]}%")
    if filters.get("category"):
        placeholders = ",".join("?" * len(filters["category"]))
        query += f" AND category IN ({placeholders})"
        params.extend(filters["category"])
    # price：支持新格式 {"gte": x, "lte": y} 和旧格式数组
    price = filters.get("price")
    if isinstance(price, dict):
        if price.get("gte") is not None:
            query += " AND price >= ?"; params.append(price["gte"])
        if price.get("lte") is not None:
            query += " AND price <= ?"; params.append(price["lte"])
    else:
        if filters.get("price_min"):
            query += " AND price >= ?"; params.append(filters["price_min"][0])
        if filters.get("price_max"):
            query += " AND price <= ?"; params.append(filters["price_max"][0])
    # created：支持新格式 {"gte": x, "lte": y} 和旧格式数组
    created = filters.get("created")
    if isinstance(created, dict):
        if created.get("gte"):
            query += " AND created >= ?"; params.append(created["gte"])
        if created.get("lte"):
            query += " AND created <= ?"; params.append(created["lte"])
    else:
        if filters.get("created_from"):
            query += " AND created >= ?"; params.append(filters["created_from"][0])
        if filters.get("created_to"):
            query += " AND created <= ?"; params.append(filters["created_to"][0])
    # updated：支持新格式 {"gte": x, "lte": y} 和旧格式数组
    updated = filters.get("updated")
    if isinstance(updated, dict):
        if updated.get("gte"):
            query += " AND updated >= ?"; params.append(updated["gte"])
        if updated.get("lte"):
            query += " AND updated <= ?"; params.append(updated["lte"])
    else:
        if filters.get("updated_from"):
            query += " AND updated >= ?"; params.append(filters["updated_from"][0])
        if filters.get("updated_to"):
            query += " AND updated <= ?"; params.append(filters["updated_to"][0])
    query += " ORDER BY id ASC"
    rows = conn.execute(query, params).fetchall()
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

# ─── Chat Sessions ─────────────────────────────────────────

@app.get("/api/chat/sessions")
def list_sessions():
    conn = db()
    rows = conn.execute(
        "SELECT id, title, created, updated FROM chat_sessions ORDER BY updated DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/chat/sessions")
def create_session():
    conn = db()
    cur = conn.execute(
        "INSERT INTO chat_sessions (title) VALUES (?)", ("新对话",)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM chat_sessions WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)

@app.patch("/api/chat/sessions/{sid}")
def rename_session(sid: int, body: dict):
    title = body.get("title", "").strip()
    if not title:
        raise HTTPException(400, "标题不能为空")
    conn = db()
    conn.execute(
        "UPDATE chat_sessions SET title=?, updated=datetime('now','localtime') WHERE id=?",
        (title, sid)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "会话不存在")
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

    # HITL 响应：从历史中取上一条 AI 消息所用的 skill，跳过重新路由
    forced_skill = None
    if is_hitl_response:
        last_skill_row = conn.execute(
            """SELECT text FROM chat_messages WHERE session_id=? AND role='ai'
               ORDER BY id DESC LIMIT 1""",
            (session_id,)
        ).fetchone()
        if last_skill_row:
            forced_skill = await skill_framework.detect_skill_from_reply(last_skill_row["text"])

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

    if reply and "```apicall" in reply:
        try:
            apicall_part = reply.split("```apicall")[1].split("```")[0]
            apicall_json = json.loads(apicall_part)
        except Exception:
            pass

    conn.execute(
        "INSERT INTO chat_messages (session_id, role, text, hitl, apicall) VALUES (?, ?, ?, ?, ?)",
        (session_id, "ai", reply,
         json.dumps(hitl_json, ensure_ascii=False) if hitl_json else None,
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
def save_apicall_result(msg_id: int, body: dict):
    conn = db()
    conn.execute(
        "UPDATE chat_messages SET apicall_result=? WHERE id=?",
        (json.dumps(body, ensure_ascii=False), msg_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
