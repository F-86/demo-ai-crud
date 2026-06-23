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
import skills.product_skill  # register skills via import side effect

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
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

# ─── Chat History ──────────────────────────────────────────

@app.get("/api/chat/history")
def get_chat_history(limit: int = 100):
    conn = db()
    rows = conn.execute(
        "SELECT id, role, text, hitl, created FROM chat_messages ORDER BY id ASC LIMIT ?",
        (limit,)
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        msg = {"id": r["id"], "role": r["role"], "text": r["text"], "created": r["created"]}
        if r["hitl"]:
            msg["hitl"] = json.loads(r["hitl"])
        result.append(msg)
    return result

@app.delete("/api/chat/history")
def clear_chat_history():
    conn = db()
    conn.execute("DELETE FROM chat_messages")
    conn.commit()
    conn.close()
    return {"ok": True}

# ─── Skills ────────────────────────────────────────────────

@app.get("/api/skills")
def list_skills():
    return skill_framework.list_skills()

@app.post("/api/skill/execute")
async def execute_skill(body: dict):
    message = body.get("message", "")
    conn = db()

    conn.execute(
        "INSERT INTO chat_messages (role, text) VALUES (?, ?)",
        ("user", message)
    )
    conn.commit()

    result = await skill_framework.execute_skill(message, conn)
    reply = result.get("reply", "")

    hitl_json = None
    if reply and "```hitl" in reply:
        try:
            hitl_part = reply.split("```hitl")[1].split("```")[0]
            hitl_json = json.loads(hitl_part)
        except Exception:
            pass

    conn.execute(
        "INSERT INTO chat_messages (role, text, hitl) VALUES (?, ?, ?)",
        ("ai", reply, json.dumps(hitl_json, ensure_ascii=False) if hitl_json else None)
    )
    conn.commit()
    conn.close()
    return result

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
