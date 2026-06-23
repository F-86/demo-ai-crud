import React, { useState } from 'react';
import AIChat from './components/AIChat';
import ProductList from './components/ProductList';

function App() {
  const [tab, setTab] = useState('chat');
  const API = '';  // 使用相对路径，CRA proxy 转发到后端

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI CRUD Demo</h1>
        <nav className="tabs">
          <button className={`tab ${tab === 'chat' ? 'active' : ''}`}
                  onClick={() => setTab('chat')}>💬 AI 对话</button>
          <button className={`tab ${tab === 'products' ? 'active' : ''}`}
                  onClick={() => setTab('products')}>📦 商品列表</button>
        </nav>
      </header>
      <main className="app-main">
        {tab === 'chat' ? <AIChat api={API} /> : <ProductList api={API} />}
      </main>
    </div>
  );
}

export default App;
