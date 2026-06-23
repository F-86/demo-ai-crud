import React from 'react';

function ProductTable({ products }) {
  if (!products.length) return <p className="apicall-empty">没有找到符合条件的商品。</p>;
  return (
    <table className="apicall-table">
      <thead>
        <tr><th>ID</th><th>名称</th><th>价格</th><th>分类</th><th>上架时间</th><th>更新时间</th></tr>
      </thead>
      <tbody>
        {products.map(p => (
          <tr key={p.id}>
            <td>{p.id}</td>
            <td>{p.name}</td>
            <td>¥{Number(p.price).toFixed(2)}</td>
            <td>{p.category}</td>
            <td>{p.created}</td>
            <td>{p.updated}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProductCard({ product, verb }) {
  return (
    <div className="apicall-card">
      <span className="apicall-badge apicall-badge--success">✓ {verb}成功</span>
      <div className="apicall-card-row"><span>ID</span><span>{product.id}</span></div>
      <div className="apicall-card-row"><span>名称</span><span>{product.name}</span></div>
      <div className="apicall-card-row"><span>价格</span><span>¥{Number(product.price).toFixed(2)}</span></div>
      <div className="apicall-card-row"><span>分类</span><span>{product.category}</span></div>
    </div>
  );
}

function ApiCallResult({ apicall, result }) {
  if (!result) return <div className="apicall-loading">请求中...</div>;
  if (result.error) return <div className="apicall-error">❌ {result.error}</div>;

  const { method, endpoint } = apicall;

  if (method === 'POST' && endpoint.endsWith('/query')) {
    const products = Array.isArray(result) ? result : [];
    return <ProductTable products={products} />;
  }

  if (method === 'GET') {
    const products = Array.isArray(result) ? result : [result];
    return <ProductTable products={products} />;
  }

  if (method === 'POST') return <ProductCard product={result} verb="创建" />;
  if (method === 'PUT') return <ProductCard product={result} verb="更新" />;

  if (method === 'DELETE') {
    return (
      <div className="apicall-card">
        <span className="apicall-badge apicall-badge--danger">✓ 已删除</span>
        <div className="apicall-card-row"><span>商品 ID</span><span>{result.deleted_id}</span></div>
      </div>
    );
  }

  return null;
}

export default ApiCallResult;
