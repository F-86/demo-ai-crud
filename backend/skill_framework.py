"""
Skill framework — 基于 agentskills-core + agentskills-fs。
启动时扫描 skills/ 目录，按 Progressive Disclosure 加载：
  - catalog（名称+描述）用于路由
  - 匹配到 skill 后加载完整 SKILL.md 正文注入 LLM，由 LLM 直接生成 apicall/hitl 块
"""

import os
from pathlib import Path
from typing import Optional
from openai import OpenAI

from agentskills_core import SkillRegistry
from agentskills_fs import LocalFileSystemSkillProvider

API_KEY = os.environ.get("DEEPSEEK_API_KEY")
if not API_KEY:
    raise ValueError("DEEPSEEK_API_KEY 未设置。请复制 .env.example 为 .env 并填入你的 API Key。")
MODEL = "deepseek-chat"

client = OpenAI(api_key=API_KEY, base_url="https://api.deepseek.com/v1")
registry = SkillRegistry()

SKILLS_ROOT = Path(__file__).parent.parent / "skills"


async def init_registry():
    """启动时扫描 SKILLS_ROOT，注册所有包含 SKILL.md 的子目录。"""
    if not SKILLS_ROOT.exists():
        return
    for skill_dir in SKILLS_ROOT.iterdir():
        if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
            provider = LocalFileSystemSkillProvider(skill_dir.parent)
            await registry.register(skill_dir.name, provider)


def list_skills():
    return [{"name": s.get_id()} for s in registry.list_skills()]


async def _build_catalog_prompt() -> str:
    """仅包含 catalog（名称+描述），用于无匹配时的兜底回复。"""
    catalog = await registry.get_skills_catalog(format="xml")
    return f"""你是一个 AI 助手，专门帮助用户管理商品数据。

## 可用能力
{catalog}

## 规则
- 打招呼或询问能力 → 友好介绍自己和可用功能
- 超出能力范围 → 礼貌说明，并简介能力范围
- 不要编造数据或自行执行操作
"""


async def _route_skill(message: str, history: list) -> Optional[str]:
    """用 LLM 路由到匹配的 skill name，返回 None 表示无匹配。"""
    skills = registry.list_skills()
    if not skills:
        return None

    skill_descs = []
    for s in skills:
        meta = await s.get_metadata()
        skill_descs.append(f"- {s.get_id()}: {meta.get('description', '')}")

    # 构造带历史的消息列表
    messages = [
        {"role": "system", "content": "你是一个 skill 路由选择器。根据对话上下文判断当前消息属于哪个 skill，只返回 skill 名称或 NONE。"},
    ]
    for h in history[-6:]:  # 最近 6 条提供上下文
        role = "user" if h["role"] == "user" else "assistant"
        messages.append({"role": role, "content": h["text"]})
    messages.append({"role": "user", "content": f"当前消息: \"{message}\"\n\n可用 skill:\n" + "\n".join(skill_descs)})

    resp = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.1,
        max_tokens=50,
    )
    name = resp.choices[0].message.content.strip()
    if name == "NONE":
        return None
    for s in skills:
        sid = s.get_id()
        if sid in name or name in sid:
            return sid
    return None


async def detect_skill_from_reply(reply_text: str) -> Optional[str]:
    """从 AI 上一条回复中识别使用了哪个 skill（通过匹配已注册 skill 的关键词）。"""
    for s in registry.list_skills():
        meta = await s.get_metadata()
        desc = meta.get("description", "")
        sid = s.get_id()
        # 回复中包含 skill name 或 skill 描述中的核心关键词
        if sid in reply_text:
            return sid
        # 检查 skill 描述里提到的触发关键词是否出现在历史回复中
        triggers = [kw for kw in desc.replace("，", ",").split(",") if len(kw.strip()) > 2]
        if any(kw.strip() in reply_text for kw in triggers[:5]):
            return sid
    return None


async def execute_skill(message: str, db, history: list = [], forced_skill: Optional[str] = None) -> dict:
    """路由并执行 skill，返回 {matched, skill, reply}。"""
    if not registry.list_skills():
        return {"matched": False, "reply": "抱歉，当前没有这个能力。", "skill": None}

    # forced_skill：HITL 响应复用上一轮 skill，跳过路由
    if forced_skill:
        skill_name = forced_skill
    else:
        try:
            skill_name = await _route_skill(message, history)
        except Exception as e:
            return {"matched": False, "reply": f"❌ LLM 调用失败: {e}", "skill": None}

    if not skill_name:
        try:
            prompt = await _build_catalog_prompt()
            resp = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": message},
                ],
                temperature=0.7,
                max_tokens=512,
            )
            reply = resp.choices[0].message.content.strip()
        except Exception as e:
            reply = f"抱歉，当前没有这个能力。（LLM 调用失败: {e}）"
        return {"matched": False, "reply": reply, "skill": None}

    try:
        skill = registry.get_skill(skill_name)
        skill_body = await skill.get_body()
        messages = [{"role": "system", "content": skill_body}]
        for h in history[-10:]:  # 最近 10 条对话历史
            role = "user" if h["role"] == "user" else "assistant"
            messages.append({"role": role, "content": h["text"]})
        messages.append({"role": "user", "content": message})
        resp = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.2,
            max_tokens=512,
        )
        reply = resp.choices[0].message.content.strip()
        return {"matched": True, "skill": skill_name, "reply": reply}
    except Exception as e:
        return {"matched": True, "skill": skill_name, "reply": f"❌ Skill 执行出错: {e}"}
