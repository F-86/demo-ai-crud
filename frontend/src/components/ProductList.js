import React, { useState, useEffect, useCallback } from 'react';

const CATEGORIES = ['玩具', '服装', '饮料', '食品', '数码'];

function ProductList({ api }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [newRow, setNewRow] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [formData, setFormData] = useState({});
  const [newFormData, setNewFormData] = useState({ name: '', price: '', category: '玩具' });
  const [search, setSearch] = useState({
    id: '', name: '', price_min: '', price_max: '',
    category: '', created_after: '', created_before: '', updated_after: '', updated_before: ''
  });

  const fetchProducts = useCallback(async (searchParams) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchParams) {
        Object.entries(searchParams).forEach(([k, v]) => { if (v) params.append(k, v); });
      }
      const res = await fetch(`${api}/api/products?${params.toString()}`);
      const data = await res.json();
      setProducts(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [api]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const handleSearch = (e) => {
    e.preventDefault();
    const clean = {};
    Object.entries(search).forEach(([k, v]) => { if (v.trim()) clean[k] = v.trim(); });
    fetchProducts(clean);
  };

  const handleReset = () => {
    setSearch({ id: '', name: '', price_min: '', price_max: '', category: '',
      created_after: '', created_before: '', updated_after: '', updated_before: '' });
    fetchProducts();
  };

  // ─── Add ───────────────────────────────────────
  const handleAddStart = () => {
    setNewRow(true);
    setNewFormData({ name: '', price: '', category: '玩具' });
    setEditingId(null);
  };

  const handleAddSave = async () => {
    if (!newFormData.name || !newFormData.price) return;
    try {
      await fetch(`${api}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newFormData, price: parseFloat(newFormData.price) })
      });
      setNewRow(false);
      fetchProducts();
    } catch (e) { console.error(e); }
  };

  // ─── Edit ──────────────────────────────────────
  const handleEditStart = (product) => {
    setEditingId(product.id);
    setFormData({ name: product.name, price: String(product.price), category: product.category });
    setNewRow(false);
  };

  const handleEditSave = async (id) => {
    const updates = {};
    if (formData.name) updates.name = formData.name;
    if (formData.price) updates.price = parseFloat(formData.price);
    if (formData.category) updates.category = formData.category;
    try {
      await fetch(`${api}/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      setEditingId(null);
      fetchProducts();
    } catch (e) { console.error(e); }
  };

  const handleEditCancel = () => { setEditingId(null); };

  // ─── Delete ────────────────────────────────────
  const handleDelete = async (id) => {
    try {
      await fetch(`${api}/api/products/${id}`, { method: 'DELETE' });
      setDeleteConfirm(null);
      fetchProducts();
    } catch (e) { console.error(e); }
  };

  // ─── Render ────────────────────────────────────
  const renderSearchField = (label, key, type = 'text', options = null) => (
    <label>
      {label}
      {options ? (
        <select value={search[key]} onChange={e => setSearch({ ...search, [key]: e.target.value })}>
          <option value="">全部</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={search[key]}
          onChange={e => setSearch({ ...search, [key]: e.target.value })}
          placeholder={label} />
      )}
    </label>
  );

  return (
    <div>
      <form className="search-bar" onSubmit={handleSearch}>
        {renderSearchField('ID', 'id', 'number')}
        {renderSearchField('名称', 'name')}
        {renderSearchField('最低价(¥)', 'price_min', 'number')}
        {renderSearchField('最高价(¥)', 'price_max', 'number')}
        {renderSearchField('分类', 'category', 'text', CATEGORIES)}
        {renderSearchField('上架起始', 'created_after', 'date')}
        {renderSearchField('上架截止', 'created_before', 'date')}
        {renderSearchField('修改起始', 'updated_after', 'date')}
        {renderSearchField('修改截止', 'updated_before', 'date')}
        <button type="submit" className="search-btn">搜索</button>
        <button type="button" className="reset-btn" onClick={handleReset}>重置</button>
      </form>

      <div className="add-row">
        <button className="add-btn" onClick={handleAddStart}>+ 添加商品</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>名称</th><th>价格</th><th>分类</th><th>上架时间</th><th>修改时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {newRow && (
              <tr>
                <td style={{ color: '#888' }}>新增</td>
                <td><input value={newFormData.name} onChange={e => setNewFormData({ ...newFormData, name: e.target.value })} placeholder="名称" /></td>
                <td><input type="number" step="0.01" value={newFormData.price} onChange={e => setNewFormData({ ...newFormData, price: e.target.value })} placeholder="价格(¥)" /></td>
                <td>
                  <select value={newFormData.category} onChange={e => setNewFormData({ ...newFormData, category: e.target.value })}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ color: '#888' }}>自动</td>
                <td style={{ color: '#888' }}>自动</td>
                <td>
                  <div className="actions">
                    <button className="btn-save" onClick={handleAddSave}>保存</button>
                    <button className="btn-cancel" onClick={() => setNewRow(false)}>取消</button>
                  </div>
                </td>
              </tr>
            )}

            {loading ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: 20, color: '#888' }}>加载中...</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: 20, color: '#888' }}>暂无商品</td></tr>
            ) : products.map(p => (
              <tr key={p.id}>
                <td>{p.id}</td>
                {editingId === p.id ? (
                  <>
                    <td><input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} /></td>
                    <td><input type="number" step="0.01" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} /></td>
                    <td>
                      <select value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{p.name}</td>
                    <td>¥{p.price.toFixed(2)}</td>
                    <td>{p.category}</td>
                  </>
                )}
                <td style={{ fontSize: 12, color: '#888' }}>{p.created}</td>
                <td style={{ fontSize: 12, color: '#888' }}>{p.updated}</td>
                <td>
                  {editingId === p.id ? (
                    <div className="actions">
                      <button className="btn-save" onClick={() => handleEditSave(p.id)}>保存</button>
                      <button className="btn-cancel" onClick={handleEditCancel}>取消</button>
                    </div>
                  ) : deleteConfirm === p.id ? (
                    <div className="actions">
                      <span style={{ fontSize: 12, color: '#e74c3c', marginRight: 4 }}>确认删除？</span>
                      <button className="btn-delete" onClick={() => handleDelete(p.id)}>确认</button>
                      <button className="btn-cancel" onClick={() => setDeleteConfirm(null)}>取消</button>
                    </div>
                  ) : (
                    <div className="actions">
                      <button className="btn-edit" onClick={() => handleEditStart(p)}>修改</button>
                      <button className="btn-delete" onClick={() => setDeleteConfirm(p.id)}>删除</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ProductList;
