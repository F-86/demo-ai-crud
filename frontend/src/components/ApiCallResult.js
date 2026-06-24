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

function diffCell(beforeVal, afterVal, formatter = (v) => v) {
  if (afterVal === undefined || afterVal === null) return <span>{formatter(beforeVal)}</span>;
  if (beforeVal === afterVal) return <span>{formatter(beforeVal)}</span>;
  return (
    <span>
      <span style={{ textDecoration: 'line-through', color: '#999' }}>{formatter(beforeVal)}</span>
      {' → '}
      <strong style={{ color: '#1976d2' }}>{formatter(afterVal)}</strong>
    </span>
  );
}

function BulkPreviewTable({ matched, preview }) {
  return (
    <div>
      <div className="apicall-card-row" style={{ marginBottom: 8 }}>
        <span className="apicall-badge">🔍 预览（未执行）</span>
        <span>共匹配 <strong>{matched}</strong> 条</span>
      </div>
      <table className="apicall-table">
        <thead>
          <tr><th>ID</th><th>名称</th><th>价格</th><th>分类</th></tr>
        </thead>
        <tbody>
          {preview.map(p => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{diffCell(p.before.name, p.after.name)}</td>
              <td>{diffCell(p.before.price, p.after.price, v => `¥${Number(v).toFixed(2)}`)}</td>
              <td>{diffCell(p.before.category, p.after.category)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulkResultTable({ updated, items }) {
  return (
    <div>
      <div className="apicall-card-row" style={{ marginBottom: 8 }}>
        <span className="apicall-badge apicall-badge--success">✓ 批量修改成功</span>
        <span>共更新 <strong>{updated}</strong> 条</span>
      </div>
      <ProductTable products={items} />
    </div>
  );
}

function BulkDeletePreviewTable({ matched, items }) {
  return (
    <div>
      <div className="apicall-card-row" style={{ marginBottom: 8 }}>
        <span className="apicall-badge apicall-badge--danger">⚠️ 删除预览（未执行）</span>
        <span>共匹配 <strong>{matched}</strong> 条</span>
      </div>
      <ProductTable products={items} />
    </div>
  );
}

function BulkDeleteResultTable({ deleted, items }) {
  return (
    <div>
      <div className="apicall-card-row" style={{ marginBottom: 8 }}>
        <span className="apicall-badge apicall-badge--danger">✓ 批量删除成功</span>
        <span>共删除 <strong>{deleted}</strong> 条</span>
      </div>
      <ProductTable products={items} />
    </div>
  );
}

function ErrorBlock({ error }) {
  // 字符串错误：直接显示
  if (typeof error === 'string') {
    return <div className="apicall-error">❌ {error}</div>;
  }
  // 结构化错误：{error, message, duplicates?, conflicts?, matched?, expected?}
  if (error && typeof error === 'object') {
    const { error: code, message, duplicates, conflicts, matched, expected } = error;
    return (
      <div className="apicall-error">
        <div>❌ {message || code || '请求失败'}</div>
        {code && <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>code: {code}</div>}
        {Array.isArray(duplicates) && duplicates.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            批内重复名称（{duplicates.length}）：{duplicates.join('、')}
          </div>
        )}
        {Array.isArray(conflicts) && conflicts.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            与库内已存在冲突（{conflicts.length}）：
            {conflicts.map(c => `#${c.id} ${c.name}`).join('、')}
          </div>
        )}
        {(matched != null || expected != null) && (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            匹配 {matched} 条，预期 {expected} 条
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          ⚠️ 操作已中止，数据未变更。请调整参数后重试。
        </div>
      </div>
    );
  }
  return <div className="apicall-error">❌ 请求失败</div>;
}

function ApiCallResult({ apicall, result }) {
  if (!result) return <div className="apicall-loading">请求中...</div>;
  if (result.error !== undefined) return <ErrorBlock error={result.error} />;

  const { method, endpoint } = apicall;

  // 批量修改：根据 dry_run 区分预览/执行
  if (method === 'POST' && endpoint.includes('/bulk_update')) {
    if (result.dry_run) {
      return <BulkPreviewTable matched={result.matched} preview={result.preview || []} />;
    }
    return <BulkResultTable updated={result.updated} items={result.items || []} />;
  }

  // 批量删除：根据 dry_run 区分预览/执行
  if (method === 'POST' && endpoint.includes('/bulk_delete')) {
    if (result.dry_run) {
      return <BulkDeletePreviewTable matched={result.matched} items={result.items || []} />;
    }
    return <BulkDeleteResultTable deleted={result.deleted} items={result.items || []} />;
  }

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
