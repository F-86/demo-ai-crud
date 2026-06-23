import React, { useState, useRef, useEffect, useCallback } from 'react';

const SUGGESTIONS = ['查一下所有商品', '帮我添加一个商品', '修改商品信息', '删除一个商品'];

function AIChat({ api }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pendingHITL, setPendingHITL] = useState(null);
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${api}/api/chat/history`);
      const data = await res.json();
      setMessages(data.map(m => ({ role: m.role, text: m.text, hitl: m.hitl || null })));
    } catch {
      // 静默失败
    }
    setHistoryLoaded(true);
  }, [api]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const autoResize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');
    setTimeout(autoResize, 0);
    setLoading(true);
    setPendingHITL(null);

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
      setMessages(prev => [...prev, { role: 'ai', text: `请求失败: ${err.message}` }]);
    }
    setLoading(false);
  };

  const clearHistory = async () => {
    await fetch(`${api}/api/chat/history`, { method: 'DELETE' });
    setMessages([]);
    setPendingHITL(null);
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

  const renderHITLActions = (hitl) => {
    const decision = hitl?.checkpoint?.decisions?.[0];
    if (!decision) return null;

    if (decision.type === 'input') {
      return (
        <div className="hitl-input-row">
          <input
            className="hitl-text-input"
            placeholder="输入信息..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target.value) {
                handleHITLAction(e.target.value);
                e.target.value = '';
              }
            }}
          />
          <button className="hitl-btn primary" onClick={(e) => {
            const inp = e.target.closest('.hitl-input-row').querySelector('input');
            if (inp?.value) { handleHITLAction(inp.value); inp.value = ''; }
          }}>提交</button>
        </div>
      );
    }

    if (decision.type === 'confirm') {
      return (
        <div className="hitl-actions">
          <button className="hitl-btn danger" onClick={() => handleHITLAction('confirm')}>确认</button>
          <button className="hitl-btn default" onClick={() => handleHITLAction('cancel')}>取消</button>
        </div>
      );
    }

    return (
      <div className="hitl-actions">
        {decision.options?.map((opt, i) => (
          <button key={i}
            className={`hitl-btn ${opt.value.includes('confirm') || opt.value === 'approve' ? 'danger' : opt.value === 'cancel' ? 'default' : 'primary'}`}
            onClick={() => handleHITLAction(opt.value)}>
            {opt.label}
          </button>
        ))}
      </div>
    );
  };

  if (!historyLoaded) return null;

  return (
    <div className="gpt-chat">
      {messages.length === 0 ? (
        <div className="gpt-welcome">
          <div className="gpt-logo">✦</div>
          <h2 className="gpt-welcome-title">有什么可以帮你的？</h2>
          <div className="gpt-suggestions">
            {SUGGESTIONS.map(s => (
              <button key={s} className="gpt-suggestion" onClick={() => sendMessage(s)}>{s}</button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="gpt-toolbar">
            <button className="gpt-clear-btn" onClick={clearHistory}>清空对话</button>
          </div>
          <div className="gpt-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`gpt-row gpt-row--${msg.role}`}>
                {msg.role === 'ai' && <div className="gpt-avatar">✦</div>}
                <div className="gpt-bubble">
                  {msg.text && <div className="gpt-text">{msg.text}</div>}
                  {msg.hitl && (
                    <div className="hitl-block">
                      {JSON.stringify(msg.hitl, null, 2)}
                    </div>
                  )}
                  {msg.hitl && pendingHITL && i === messages.length - 1 &&
                    renderHITLActions(pendingHITL)
                  }
                </div>
              </div>
            ))}
            {loading && (
              <div className="gpt-row gpt-row--ai">
                <div className="gpt-avatar">✦</div>
                <div className="gpt-bubble">
                  <div className="gpt-typing"><span /><span /><span /></div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </>
      )}

      <div className="gpt-input-wrap">
        <div className="gpt-input-box">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoResize(); }}
            onKeyDown={handleKeyDown}
            placeholder="给 AI 发消息…"
            disabled={loading}
            rows={1}
          />
          <button
            className={`gpt-send ${input.trim() && !loading ? 'gpt-send--active' : ''}`}
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 13V3M3 8l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="gpt-hint">AI 可能会犯错，请注意核查重要信息。</p>
      </div>
    </div>
  );
}

export default AIChat;
