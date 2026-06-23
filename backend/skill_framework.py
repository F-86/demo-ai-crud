"""
Skill framework — matches user messages to registered skills via LLM.
The LLM is instructed to ONLY use registered skills and never free-form answer.
Each skill provides a structured capability description.
"""

import json
import os
from typing import Optional
from openai import OpenAI

API_KEY = os.environ.get("DEEPSEEK_API_KEY")
if not API_KEY:
    raise ValueError("DEEPSEEK_API_KEY 未设置。请复制 .env.example 为 .env 并填入你的 API Key。")
MODEL = "deepseek-chat"  # deepseek-v4-flash 的模型名

client = OpenAI(api_key=API_KEY, base_url="https://api.deepseek.com/v1")

_skills = []

def register_skill(name: str, description: str, capabilities: list[dict], handler):
    """
    Register a skill.
    - name: unique skill name
    - description: what this skill does (for the LLM)
    - capabilities: list of {trigger, params, steps} describing what this skill can handle
    - handler: async function(message, db, params) -> str
    """
    _skills.append({
        "name": name,
        "description": description,
        "capabilities": capabilities,
        "handler": handler,
    })

def list_skills():
    return [{"name": s["name"], "description": s["description"]} for s in _skills]

def _build_system_prompt() -> str:
    """Build the system prompt that constrains the LLM to use skills only."""
    skills_desc = []
    for s in _skills:
        cap_lines = "\n".join(
            f"  - 触发词: {c['trigger']}\n    参数: {json.dumps(c['params'], ensure_ascii=False)}\n    流程: {c['steps']}"
            for c in s["capabilities"]
        )
        skills_desc.append(f"## {s['name']}\n{s['description']}\n{cap_lines}")
    
    skills_text = "\n\n".join(skills_desc) if skills_desc else "当前没有注册任何 skill。"
    
    return f"""你是一个 AI 助手，专门帮助用户管理商品数据。你必须遵守以下规则：

## 核心规则
1. **必须调用 skill 才能执行操作**。你不能自由发挥、不能猜测、不能编造数据。
2. 如果用户在**打招呼、问候、询问你的能力**，友好地介绍自己，说明你能做什么（列出可用 skill 的功能）。
3. 如果用户的需求**超出 skill 范围**，先礼貌地说明无法处理，再简短介绍你的能力范围。
4. 如果匹配到了 skill，按该 skill 定义的流程执行，用 ````hitl` JSON 块与用户交互。

## HITL 协议
当需要用户确认或补充信息时，输出 ````hitl` 块：

```hitl
{{"version": "1.0", "checkpoint": {{
  "id": "cp-xxx",
  "name": "名称",
  "phase": "阶段",
  "summary": "说明",
  "action": "wait",
  "decisions": [
    {{"id": "d-1", "type": "choice/confirm/input", "question": "问题", "options": [...]}}
  ]
}}}}
```

## 可用 Skill
{skills_text}

## 输出格式
- 打招呼 / 问能力 → 友好介绍自己和可用能力，不要输出 ````hitl` 块
- 匹配到 skill → 按 skill 流程执行，可能输出 ````hitl` 块
- 超出能力范围 → 礼貌说明，并简介能力范围
- 输出纯文本 + 可选的 ````hitl` 块，不要输出 JSON 以外的代码块
"""

async def execute_skill(message: str, db) -> dict:
    """Use LLM to determine intent, then execute the matching skill."""
    if not _skills:
        return {"matched": False, "reply": "抱歉，当前没有这个能力。", "skill": None}
    
    # Build skill routing prompt
    skill_list = "\n".join(f"- {s['name']}: {s['description']}" for s in _skills)
    routing_prompt = f"""用户消息: "{message}"

可用 skill:
{skill_list}

请判断用户需要哪个 skill。只返回 skill 名称，不要其他内容。如果都不匹配，返回 "NONE"。
"""
    
    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "你是一个 skill 路由选择器。只返回 skill 名称或 NONE。"},
                {"role": "user", "content": routing_prompt}
            ],
            temperature=0.1,
            max_tokens=50,
        )
        skill_name = resp.choices[0].message.content.strip()
    except Exception as e:
        return {"matched": False, "reply": f"❌ LLM 调用失败: {str(e)}", "skill": None}
    
    # Find matching skill
    matched = None
    for s in _skills:
        if s["name"] in skill_name or skill_name in s["name"]:
            matched = s
            break
    
    if not matched or skill_name == "NONE":
        # 让 LLM 用系统提示自由回复（打招呼/介绍能力/超范围说明）
        try:
            system_prompt = _build_system_prompt()
            resp2 = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": message}
                ],
                temperature=0.7,
                max_tokens=512,
            )
            reply = resp2.choices[0].message.content.strip()
        except Exception as e:
            reply = f"抱歉，当前没有这个能力。（LLM 调用失败: {e}）"
        return {"matched": False, "reply": reply, "skill": None}
    
    # Execute skill with full LLM prompt
    try:
        system_prompt = _build_system_prompt()
        result = await matched["handler"](message, db, system_prompt, client, MODEL)
        return {
            "matched": True,
            "skill": matched["name"],
            "reply": result
        }
    except Exception as e:
        return {"matched": True, "skill": matched["name"], "reply": f"❌ Skill 执行出错: {str(e)}"}
