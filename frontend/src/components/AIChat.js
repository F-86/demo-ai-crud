import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import ApiCallResult from './ApiCallResult';
import HITLWidget from './HITLWidget';

const SUGGESTIONS = ['查一下所有商品', '帮我添加一个商品', '修改商品信息', '删除一个商品'];

async function executeApicall(api, apicall) {
  const { method, endpoint, body } = apicall;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${api}${endpoint}`, opts);
  const data = await res.json();
  if (!res.ok) return { error: data.detail || `请求失败 (${res.status})` };
  return data;
}

function AIChat({ api, sessionId, onTitleUpdate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pendingHITL, setPendingHITL] = useState(null);
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoaded(false);
    try {
      const res = await fetch(`${api}/api/chat/sessions/${sessionId}/messages`);
      const data = await res.json();
      const mapped = data.map(m => ({
        role: m.role,
        text: m.hitl ? m.text.split('```hitl')[0] : (m.apicall ? m.text.split('```apicall')[0] : m.text),
        hitl: m.hitl || null,
        apicall: m.apicall || null,
        apicallResult: m.apicall_result || null,
      }));
      setMessages(mapped);
      // 恢复未处理的 HITL：最后一条是 AI 且带 hitl
      const last = mapped[mapped.length - 1];
      if (last?.role === 'ai' && last?.hitl) setPendingHITL(last.hitl);
    } catch {
      setMessages([]);
    }
    setHistoryLoaded(true);
  }, [api, sessionId]);

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
    const isFirst = messages.length === 0;
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');
    setTimeout(autoResize, 0);
    setLoading(true);
    setPendingHITL(null);

    try {
      const res = await fetch(`${api}/api/skill/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: sessionId })
      });
      const data = await res.json();

      if (isFirst && onTitleUpdate) {
        onTitleUpdate(sessionId, text.slice(0, 20) + (text.length > 20 ? '…' : ''));
      }

      const msg = { role: 'ai', text: data.reply || '' };

      // 解析 hitl
      if (data.hitl) {
        msg.hitl = data.hitl;
        msg.text = msg.text.split('```hitl')[0];
        setPendingHITL(data.hitl);
      }

      // 解析 apicall：自动执行并挂载结果
      if (data.apicall) {
        msg.text = msg.text.split('```apicall')[0];
        msg.apicall = data.apicall;
        msg.apicallResult = null; // 占位，触发"请求中..."
        setMessages(prev => [...prev, msg]);
        setLoading(false);
        const result = await executeApicall(api, data.apicall);
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, apicallResult: result } : m
        ));
        return;
      }

      setMessages(prev => [...prev, msg]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: `请求失败: ${err.message}` }]);
    }
    setLoading(false);
  };

  const handleHITLAction = async (action, apicall) => {
    setPendingHITL(null);
    if (action === 'confirm' && apicall) {
      // 删除确认：直接执行 apicall，无需再发消息
      const pendingMsg = { role: 'ai', text: '', apicall, apicallResult: null };
      setMessages(prev => [...prev, pendingMsg]);
      const result = await executeApicall(api, apicall);
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, apicallResult: result } : m
      ));
    } else if (action !== 'cancel') {
      await sendMessage(action);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };


  if (!historyLoaded) return <div className="gpt-chat" />;

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
        <div className="gpt-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`gpt-row gpt-row--${msg.role}`}>
              {msg.role === 'ai' && <div className="gpt-avatar">✦</div>}
              <div className="gpt-bubble">
                {msg.text && (
                  <div className="gpt-text gpt-text--markdown">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                )}
                {msg.apicall && (
                  <ApiCallResult apicall={msg.apicall} result={msg.apicallResult} />
                )}
                {msg.hitl && (
                  <HITLWidget
                    hitl={msg.hitl}
                    readonly={!(pendingHITL && i === messages.length - 1)}
                    onAction={handleHITLAction}
                  />
                )}
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
