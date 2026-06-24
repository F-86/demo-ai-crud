import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "demo.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_groups (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    TEXT NOT NULL DEFAULT '新分组',
            created TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updated TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            title   TEXT NOT NULL DEFAULT '新对话',
            created TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updated TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
    """)
    # 迁移：为 chat_sessions 增加 group_id 列
    sess_cols = [r[1] for r in conn.execute("PRAGMA table_info(chat_sessions)").fetchall()]
    if "group_id" not in sess_cols:
        conn.execute(
            "ALTER TABLE chat_sessions ADD COLUMN group_id INTEGER "
            "REFERENCES chat_groups(id) ON DELETE SET NULL"
        )
        conn.commit()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
            role       TEXT NOT NULL CHECK(role IN ('user','ai')),
            text       TEXT NOT NULL,
            hitl       TEXT,
            created    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
    """)

    # 迁移：旧表没有 session_id 列时，重建表
    cols = [r[1] for r in conn.execute("PRAGMA table_info(chat_messages)").fetchall()]
    if "session_id" not in cols:
        conn.execute("DROP TABLE chat_messages")
        conn.execute("""
            CREATE TABLE chat_messages (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id     INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                role           TEXT NOT NULL CHECK(role IN ('user','ai')),
                text           TEXT NOT NULL,
                hitl           TEXT,
                apicall        TEXT,
                apicall_result TEXT,
                created        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )
        """)
        conn.commit()
    else:
        # 迁移：增加 apicall / apicall_result 列（旧版本没有）
        if "skill_name" not in cols:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN skill_name TEXT")
            conn.commit()
        if "apicall" not in cols:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN apicall TEXT")
            conn.commit()
        if "apicall_result" not in cols:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN apicall_result TEXT")
            conn.commit()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            category TEXT NOT NULL CHECK(category IN ('玩具','服装','饮料','食品','数码')),
            created TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updated TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
    """)
    # Seed data
    if conn.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
        seeds = [
            ("乐高积木", 299.00, "玩具", "2024-01-15 10:00:00", "2024-01-15 10:00:00"),
            ("芭比娃娃", 159.00, "玩具", "2024-02-20 14:30:00", "2024-02-20 14:30:00"),
            ("纯棉T恤", 89.00, "服装", "2024-03-10 09:00:00", "2024-03-10 09:00:00"),
            ("牛仔裤", 259.00, "服装", "2024-03-12 11:00:00", "2024-03-12 11:00:00"),
            ("农夫山泉", 2.00, "饮料", "2024-04-01 08:00:00", "2024-04-01 08:00:00"),
            ("可乐", 3.50, "饮料", "2024-04-05 16:00:00", "2024-04-05 16:00:00"),
            ("薯片", 8.00, "食品", "2024-05-01 12:00:00", "2024-05-01 12:00:00"),
            ("巧克力", 45.00, "食品", "2024-05-15 15:00:00", "2024-05-15 15:00:00"),
            ("iPhone 15", 6999.00, "数码", "2024-06-01 00:00:00", "2024-06-01 00:00:00"),
            ("MacBook Pro", 14999.00, "数码", "2024-06-10 00:00:00", "2024-06-10 00:00:00"),
        ]
        conn.executemany(
            "INSERT INTO products (name, price, category, created, updated) VALUES (?,?,?,?,?)",
            seeds
        )
        conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("DB initialized.")
