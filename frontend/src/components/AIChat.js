import React, { useState, useRef, useEffect } from 'react';

function AIChat({ api }) {
  const [messages, setMessages] = useState([
    { role: 'system', text: '💬 这是一个 AI 对话演示。输入文字与商品 CRUD skill 交互。' +
      '\n\n可尝试的指令：\n- "查一下所有商品"\n- "帮我添加一个商品"\n- "修改商品"\n- "删除商品"' }
  ]);
  const [input, setInput] = useState('');
  const [pendingHITL, setPendingHITL] = useState(null);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async (text) => {
    if (!text.trim()) return;
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${api}/api/skill/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      
      if (data.reply && data.reply.includes('```hitl')) {
        const parts = data.reply.split('```hitl');
        const textBefore = parts[0];
        const hitlPart = parts[1].split('```')[0];
        try {
          const hitlJson = JSON.parse(hitlPart);
          setPendingHITL(hitlJson);
          setMessages(prev => [...prev, { role: 'ai', text: textBefore, hitl: hitlJson }]);
        } catch {
          setMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
        }
      } else {
        setMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: `❌ 请求失败: ${err.message}` }]);
    }
    setLoading(false);
  };

  const handleHITLAction = async (action) => {
    setPendingHITL(null);
    await sendMessage(action);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`msg ${msg.role}`}>
            {msg.text}
            {msg.hitl && (
              <div className="hitl-block">
                {JSON.stringify(msg.hitl, null, 2)}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {pendingHITL && (
        <div className="hitl-actions" style={{ padding: '8px 0' }}>
          {pendingHITL.checkpoint?.decisions?.[0]?.options?.map((opt, i) => (
            <button key={i}
              className={`hitl-btn ${opt.value.includes('confirm') || opt.value === 'approve' ? 'danger' : opt.value === 'cancel' ? 'default' : 'primary'}`}
              onClick={() => handleHITLAction(opt.value)}>
              {opt.label}
            </button>
          ))}
          {pendingHITL.checkpoint?.decisions?.[0]?.type === 'input' && (
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <input style={{ flex: 1, padding: '8px 12px', background: '#1a1b23', border: '1px solid #2a2b35', borderRadius: 8, color: '#e1e2e6' }}
                placeholder="输入信息..."
                onKeyDown={(e) => { if (e.key === 'Enter') handleHITLAction(e.target.value); }} />
              <button className="hitl-btn primary" onClick={() => {
                const val = document.querySelector('.hitl-actions input')?.value;
                if (val) handleHITLAction(val);
              }}>提交</button>
            </div>
          )}
          {pendingHITL.checkpoint?.decisions?.[0]?.type === 'confirm' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="hitl-btn danger" onClick={() => handleHITLAction('confirm')}>确认</button>
              <button className="hitl-btn default" onClick={() => handleHITLAction('cancel')}>取消</button>
            </div>
          )}
        </div>
      )}

      <div className="chat-input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入指令，如「查一下所有商品」..."
          disabled={loading}
        />
        <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>
          {loading ? '...' : '发送'}
        </button>
      </div>
    </div>
  );
}

export default AIChat;
