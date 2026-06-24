import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import ApiCallResult from './ApiCallResult';
import HITLWidget from './HITLWidget';

const SUGGESTIONS = ['查一下所有商品', '帮我添加一个商品', '修改商品信息', '删除一个商品'];

function cleanMessageText(m) {
  if (!m.text) return '';
  let text = m.text;
  // 去除代码块（filters / hitl / apicall）
  text = text.split('```filters')[0];
  text = text.split('```hitl')[0];
  text = text.split('```apicall')[0];
  return text.trim();
}

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
        text: cleanMessageText(m),
        hitl: m.hitl || null,
        apicall: m.apicall || null,
        apicallResult: m.apicall_result || null,
        msgId: m.id || null,
      }));
      setMessages(mapped);
      const last = mapped[mapped.length - 1];
      if (last?.role === 'ai' && last?.hitl) setPendingHITL(last.hitl);

      // 自动补跑缺少结果的 apicall
      const missing = mapped
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.apicall && !m.apicallResult);
      if (missing.length > 0) {
        missing.forEach(async ({ m, i }) => {
          const result = await executeApicall(api, m.apicall);
          setMessages(prev => prev.map((msg, idx) => idx === i ? { ...msg, apicallResult: result } : msg));
          if (m.msgId) {
            fetch(`${api}/api/chat/messages/${m.msgId}/apicall_result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result),
            }).catch(() => {});
          }
        });
      }
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

  const sendMessage = async (text, extraBody = {}) => {
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
        body: JSON.stringify({ message: text, session_id: sessionId, ...extraBody })
      });
      const data = await res.json();

      if (isFirst && onTitleUpdate) {
        onTitleUpdate(sessionId, text.slice(0, 20) + (text.length > 20 ? '…' : ''));
      }

      const msg = { role: 'ai', text: data.reply || '' };

      // 解析 hitl
      if (data.hitl) {
        msg.hitl = data.hitl;
        msg.text = cleanMessageText({ text: msg.text, hitl: data.hitl });
        setPendingHITL(data.hitl);
      }

      // 解析 apicall：自动执行并挂载结果
      if (data.apicall) {
        msg.text = msg.text.split('```apicall')[0];
        msg.apicall = data.apicall;
        msg.apicallResult = null;
        setMessages(prev => [...prev, msg]);
        setLoading(false);
        const result = await executeApicall(api, data.apicall);
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, apicallResult: result } : m
        ));
        // 持久化结果
        if (data.msg_id) {
          fetch(`${api}/api/chat/messages/${data.msg_id}/apicall_result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result),
          }).catch(() => {});
        }
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
    if (apicall && (action === 'confirm' || action === 'execute')) {
      // 直接执行 apicall（删除确认 / CP-1b 查询确认），无需再发消息
      const pendingMsg = { role: 'ai', text: '', apicall, apicallResult: null };
      setMessages(prev => [...prev, pendingMsg]);
      const result = await executeApicall(api, apicall);
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, apicallResult: result } : m
      ));
      // 持久化到数据库，刷新后不再重复显示 HITL 按钮
      fetch(`${api}/api/chat/sessions/${sessionId}/apicall_from_hitl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apicall, result }),
      }).catch(() => {});
    } else if (action !== 'cancel' && action !== '取消查询') {
      await sendMessage(action, { hitl_response: true });
    }
  };

  const [copiedIdx, setCopiedIdx] = useState(null);

  const copyMessage = (msg, i) => {
    const text = msg.text || '';
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
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
          {(() => {
            const skip = new Set();
            return messages.map((msg, i) => {
              if (skip.has(i)) return null;
              // AI 消息有已处理的 hitl，把下一条 user 消息内嵌
              let hitlReply = null;
              if (msg.role === 'ai' && msg.hitl) {
                const isReadonly = !(pendingHITL && i === messages.length - 1);
                const next = messages[i + 1];
                if (isReadonly && next?.role === 'user') {
                  hitlReply = next.text;
                  skip.add(i + 1);
                }
              }
              return (
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
                        api={api}
                        reply={hitlReply}
                      />
                    )}
                    {msg.text && (
                      <div className="msg-actions">
                        <button
                          className={`msg-copy-btn ${copiedIdx === i ? 'msg-copy-btn--copied' : ''}`}
                          onClick={() => copyMessage(msg, i)}
                          title="复制"
                        >
                          {copiedIdx === i ? (
                            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                              <path d="M2 7l4 4 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                              <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                              <path d="M2 10V2h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            });
          })()}
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
