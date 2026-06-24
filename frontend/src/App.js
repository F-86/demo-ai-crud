import React, { useState, useEffect, useCallback } from 'react';
import AIChat from './components/AIChat';
import ProductList from './components/ProductList';
import Sidebar from './components/Sidebar';

const API = '';

const UNGROUPED_KEY = '__none__';

function groupSessions(sessions, groups) {
  const sections = groups.map(g => ({
    key: g.id,
    group: g,
    sessions: sessions.filter(s => s.group_id === g.id),
  }));
  const ungrouped = sessions.filter(s => !s.group_id);
  if (ungrouped.length > 0) {
    sections.push({ key: UNGROUPED_KEY, group: null, sessions: ungrouped });
  }
  return sections;
}

function App() {
  const [tab, setTab] = useState('chat');
  const [sessions, setSessions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showMobilePicker, setShowMobilePicker] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 700);
  const [mobileEditId, setMobileEditId] = useState(null);
  const [mobileEditTitle, setMobileEditTitle] = useState('');
  const [mobileConfirmDel, setMobileConfirmDel] = useState(null);
  const [mobileMoveId, setMobileMoveId] = useState(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 700);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleTabChange = (t) => {
    if (t === 'chat' && isMobile) {
      if (!activeSessionId) {
        handleCreate();
      } else {
        setShowMobilePicker(true);
      }
    } else {
      setTab(t);
    }
  };

  const handleSelectSession = (id) => {
    setActiveSessionId(id);
    setTab('chat');
    setShowMobilePicker(false);
  };

  const loadSessions = useCallback(async () => {
    const res = await fetch(`${API}/api/chat/sessions`);
    const data = await res.json();
    setSessions(data);
    return data;
  }, []);

  const loadGroups = useCallback(async () => {
    const res = await fetch(`${API}/api/chat/groups`);
    const data = await res.json();
    setGroups(data);
    return data;
  }, []);

  useEffect(() => {
    Promise.all([loadSessions(), loadGroups()]).then(([data]) => {
      if (data.length > 0) setActiveSessionId(data[0].id);
    });
  }, [loadSessions, loadGroups]);

  const handleCreate = async (groupId = null) => {
    const opts = { method: 'POST' };
    if (groupId !== null) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify({ group_id: groupId });
    }
    const res = await fetch(`${API}/api/chat/sessions`, opts);
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

  const handleMoveSession = async (id, groupId) => {
    const res = await fetch(`${API}/api/chat/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId })
    });
    const updated = await res.json();
    setSessions(prev => prev.map(s => s.id === id ? updated : s));
  };

  const handleCreateGroup = async (name) => {
    const opts = { method: 'POST' };
    if (name) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify({ name });
    }
    const res = await fetch(`${API}/api/chat/groups`, opts);
    const g = await res.json();
    setGroups(prev => [...prev, g]);
    return g;
  };

  const handleRenameGroup = async (id, name) => {
    const res = await fetch(`${API}/api/chat/groups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const updated = await res.json();
    setGroups(prev => prev.map(g => g.id === id ? updated : g));
  };

  const handleDeleteGroup = async (id) => {
    await fetch(`${API}/api/chat/groups/${id}`, { method: 'DELETE' });
    setGroups(prev => prev.filter(g => g.id !== id));
    // 该分组下的会话 group_id 自动置空
    setSessions(prev => prev.map(s => s.group_id === id ? { ...s, group_id: null } : s));
  };

  const handleSessionTitleUpdate = (id, title) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s));
  };

  return (
    <div className="layout">
      <Sidebar
        sessions={sessions}
        groups={groups}
        activeId={activeSessionId}
        tab={tab}
        onSelect={id => { setActiveSessionId(id); setTab('chat'); }}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onRename={handleRename}
        onMoveSession={handleMoveSession}
        onCreateGroup={handleCreateGroup}
        onRenameGroup={handleRenameGroup}
        onDeleteGroup={handleDeleteGroup}
        onTabChange={handleTabChange}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(v => !v)}
      />

      <main className="layout-main">
        {showMobilePicker && isMobile ? (
          <div className="mobile-picker">
            <div className="mobile-picker-header">
              <span>历史对话</span>
              <button className="mobile-picker-close" onClick={() => setShowMobilePicker(false)}>✕</button>
            </div>
            <button className="mobile-picker-new" onClick={() => { handleCreate(); setShowMobilePicker(false); }}>
              ＋ 新对话
            </button>
            <button className="mobile-picker-new-group" onClick={() => handleCreateGroup()}>
              ＋ 新建分组
            </button>
            <div className="mobile-picker-list">
              {sessions.length === 0 && groups.length === 0 ? (
                <div className="mobile-picker-empty">暂无对话</div>
              ) : groupSessions(sessions, groups).map(section => (
                <div key={section.key} className="mobile-picker-group">
                  {section.group ? (
                    <div className="mobile-picker-group-header">
                      <span className="mobile-picker-group-name">{section.group.name}</span>
                      <span className="mobile-picker-group-count">{section.sessions.length}</span>
                    </div>
                  ) : (
                    section.sessions.length > 0 && (
                      <div className="mobile-picker-group-header">
                        <span className="mobile-picker-group-name mobile-picker-group-name--dim">未分组</span>
                      </div>
                    )
                  )}
                  {section.sessions.map(s => (
                    <div key={s.id} className={`mobile-picker-item ${s.id === activeSessionId ? 'active' : ''}`}>
                      {mobileEditId === s.id ? (
                        <div className="mobile-picker-edit-row">
                          <input className="mobile-picker-edit-input" value={mobileEditTitle}
                            onChange={e => setMobileEditTitle(e.target.value)}
                            onBlur={() => { handleRename(s.id, mobileEditTitle); setMobileEditId(null); }}
                            onKeyDown={e => { if (e.key === 'Enter') { handleRename(s.id, mobileEditTitle); setMobileEditId(null); } if (e.key === 'Escape') setMobileEditId(null); }}
                            autoFocus />
                          <button className="mobile-picker-icon-btn" onClick={() => setMobileEditId(null)}>✕</button>
                        </div>
                      ) : mobileConfirmDel === s.id ? (
                        <div className="mobile-picker-confirm-row">
                          <span className="mobile-picker-confirm-text">确认删除？</span>
                          <button className="mobile-picker-icon-btn danger" onClick={() => { handleDelete(s.id); setMobileConfirmDel(null); }}>确认</button>
                          <button className="mobile-picker-icon-btn" onClick={() => setMobileConfirmDel(null)}>取消</button>
                        </div>
                      ) : mobileMoveId === s.id ? (
                        <div className="mobile-picker-move-row">
                          <span className="mobile-picker-move-label">移动到</span>
                          <button className={`mobile-picker-move-opt ${!s.group_id ? 'active' : ''}`}
                            onClick={() => { handleMoveSession(s.id, null); setMobileMoveId(null); }}>未分组</button>
                          {groups.map(g => (
                            <button key={g.id} className={`mobile-picker-move-opt ${s.group_id === g.id ? 'active' : ''}`}
                              onClick={() => { handleMoveSession(s.id, g.id); setMobileMoveId(null); }}>{g.name}</button>
                          ))}
                          <button className="mobile-picker-move-cancel" onClick={() => setMobileMoveId(null)}>取消</button>
                        </div>
                      ) : (
                        <>
                          <div className="mobile-picker-item-title" onClick={() => handleSelectSession(s.id)}>
                            {s.title || '新对话'}
                          </div>
                          <div className="mobile-picker-item-actions">
                            <button className="mobile-picker-icon-btn" onClick={() => { setMobileMoveId(s.id); }} title="移动分组">
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M1.5 3.5h3l1 1.5h5v4.5h-9V3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            <button className="mobile-picker-icon-btn" onClick={() => { setMobileEditId(s.id); setMobileEditTitle(s.title || ''); }} title="重命名">
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            <button className="mobile-picker-icon-btn danger" onClick={() => setMobileConfirmDel(s.id)} title="删除">
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2 3h8M5 3V2h2v1M4 3v6h4V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : tab === 'chat' ? (
          activeSessionId ? (
            <AIChat
              key={activeSessionId}
              api={API}
              sessionId={activeSessionId}
              onTitleUpdate={handleSessionTitleUpdate}
            />
          ) : (
            <div className="chat-empty">
              <button className="chat-empty-btn" onClick={() => handleCreate()}>开始新对话</button>
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
