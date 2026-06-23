import React, { useState } from 'react';

function Sidebar({ sessions, activeId, tab, onSelect, onCreate, onDelete, onRename, onTabChange, open, onToggle }) {
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const startEdit = (e, s) => {
    e.stopPropagation();
    setEditingId(s.id);
    setEditTitle(s.title);
  };

  const commitEdit = (id) => {
    if (editTitle.trim()) onRename(id, editTitle.trim());
    setEditingId(null);
  };

  return (
    <aside className={`sidebar ${open ? 'sidebar--open' : 'sidebar--closed'}`}>
      {/* 顶部：品牌 + 折叠按钮 */}
      <div className="sidebar-header">
        {open && <span className="sidebar-brand">AI CRUD Demo</span>}
        <button className="sidebar-toggle-btn" onClick={onToggle} title={open ? '收起' : '展开'}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            {open
              ? <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              : <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            }
          </svg>
        </button>
      </div>

      {/* 导航 tabs */}
      <div className="sidebar-nav">
        <button
          className={`sidebar-nav-item ${tab === 'chat' ? 'active' : ''}`}
          onClick={() => onTabChange('chat')}
          title="AI 对话"
        >
          <span className="sidebar-nav-icon">💬</span>
          {open && <span>AI 对话</span>}
        </button>
        <button
          className={`sidebar-nav-item ${tab === 'products' ? 'active' : ''}`}
          onClick={() => onTabChange('products')}
          title="商品列表"
        >
          <span className="sidebar-nav-icon">📦</span>
          {open && <span>商品列表</span>}
        </button>
      </div>

      {/* 对话列表（仅 chat tab 展开时显示） */}
      {open && tab === 'chat' && (
        <>
          <div className="sidebar-section-header">
            <span className="sidebar-section-label">对话</span>
            <button className="sidebar-new-btn" onClick={onCreate} title="新对话">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <nav className="sidebar-list">
            {sessions.length === 0 && (
              <p className="sidebar-empty">还没有对话</p>
            )}
            {sessions.map(s => (
              <div
                key={s.id}
                className={`sidebar-item ${s.id === activeId ? 'active' : ''}`}
                onClick={() => onSelect(s.id)}
              >
                {editingId === s.id ? (
                  <input
                    className="sidebar-edit-input"
                    value={editTitle}
                    autoFocus
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={() => commitEdit(s.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitEdit(s.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : confirmDeleteId === s.id ? (
                  <div className="sidebar-confirm-delete" onClick={e => e.stopPropagation()}>
                    <span className="sidebar-confirm-label">确认删除？</span>
                    <button className="sidebar-icon-btn danger" title="确认" onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); onDelete(s.id); }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    <button className="sidebar-icon-btn" title="取消" onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="sidebar-title">{s.title}</span>
                    <div className="sidebar-actions">
                      <button className="sidebar-icon-btn" title="重命名" onClick={e => startEdit(e, s)}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button className="sidebar-icon-btn danger" title="删除" onClick={e => { e.stopPropagation(); setConfirmDeleteId(s.id); }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 3h8M5 3V2h2v1M4 3v6h4V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </nav>
        </>
      )}
    </aside>
  );
}

export default Sidebar;
