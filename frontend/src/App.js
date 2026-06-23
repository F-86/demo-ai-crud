import React, { useState, useEffect, useCallback } from 'react';
import AIChat from './components/AIChat';
import ProductList from './components/ProductList';
import Sidebar from './components/Sidebar';

const API = '';

function App() {
  const [tab, setTab] = useState('chat');
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const loadSessions = useCallback(async () => {
    const res = await fetch(`${API}/api/chat/sessions`);
    const data = await res.json();
    setSessions(data);
    return data;
  }, []);

  useEffect(() => {
    loadSessions().then(data => {
      if (data.length > 0) setActiveSessionId(data[0].id);
    });
  }, [loadSessions]);

  const handleCreate = async () => {
    const res = await fetch(`${API}/api/chat/sessions`, { method: 'POST' });
    const s = await res.json();
    setSessions(prev => [s, ...prev]);
    setActiveSessionId(s.id);
    setTab('chat');
  };

  const handleDelete = async (id) => {
    await fetch(`${API}/api/chat/sessions/${id}`, { method: 'DELETE' });
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        setActiveSessionId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  };

  const handleRename = async (id, title) => {
    const res = await fetch(`${API}/api/chat/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    const updated = await res.json();
    setSessions(prev => prev.map(s => s.id === id ? updated : s));
  };

  const handleSessionTitleUpdate = (id, title) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s));
  };

  return (
    <div className="layout">
      <Sidebar
        sessions={sessions}
        activeId={activeSessionId}
        tab={tab}
        onSelect={id => { setActiveSessionId(id); setTab('chat'); }}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onRename={handleRename}
        onTabChange={setTab}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(v => !v)}
      />

      <main className="layout-main">
        {tab === 'chat' ? (
          activeSessionId ? (
            <AIChat
              key={activeSessionId}
              api={API}
              sessionId={activeSessionId}
              onTitleUpdate={handleSessionTitleUpdate}
            />
          ) : (
            <div className="chat-empty">
              <button className="chat-empty-btn" onClick={handleCreate}>开始新对话</button>
            </div>
          )
        ) : (
          <div className="products-wrap">
            <ProductList api={API} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
