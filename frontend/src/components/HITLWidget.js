import React, { useState } from 'react';
import DateRangePicker from './DateRangePicker';

function HITLWidget({ hitl, onAction, readonly }) {
  const decision = hitl?.checkpoint?.decisions?.[0];
  const apicall = hitl?.checkpoint?.apicall;
  const summary = hitl?.checkpoint?.summary || '';
  const fields = decision?.fields || [];

  const [index, setIndex] = useState(0);
  const [values, setValues] = useState({});

  if (!decision) return null;

  const isInput = decision.type === 'input';
  const isConfirm = decision.type === 'confirm';
  const isOptions = decision.type === 'options' || decision.options?.length > 0;

  const handleSubmit = () => {
    const out = {};
    fields.forEach(f => {
      if (f.type === 'number_range' || f.type === 'datetime_range') {
        const gte = values[`${f.name}__gte`];
        const lte = values[`${f.name}__lte`];
        if (gte || lte) {
          const range = {};
          if (gte) range.gte = f.type === 'number_range' ? Number(gte) : gte;
          if (lte) range.lte = f.type === 'number_range' ? Number(lte) : lte;
          out[f.name] = range;
        }
      } else {
        if (values[f.name]) out[f.name] = values[f.name];
      }
    });
    onAction(JSON.stringify(out));
  };

  const isFieldFilled = (f) => {
    if (f.type === 'number_range' || f.type === 'datetime_range') {
      return !!(values[`${f.name}__gte`] || values[`${f.name}__lte`]);
    }
    return !!values[f.name];
  };

  const field = fields[index];

  return (
    <div className={`hitlw ${readonly ? 'hitlw--readonly' : ''}`}>
      {/* 头部 */}
      <div className="hitlw-header">
        <span className="hitlw-summary">{summary}</span>
        {readonly && <span className="hitlw-badge">已处理</span>}
      </div>

      {/* input 多字段轮播 */}
      {isInput && fields.length > 0 && (
        <>
          <div className="hitlw-field">
            <span className="hitlw-label">{field.label}</span>
            {field.type === 'choice' ? (
              <select
                className="hitlw-input"
                disabled={readonly}
                value={values[field.name] || ''}
                onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}
              >
                <option value="">— 不筛选 —</option>
                {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : field.type === 'datetime_range' ? (
              <DateRangePicker
                valueGte={values[`${field.name}__gte`] || ''}
                valueLte={values[`${field.name}__lte`] || ''}
                onChange={(gte, lte) => setValues(v => ({ ...v, [`${field.name}__gte`]: gte, [`${field.name}__lte`]: lte }))}
                disabled={readonly}
              />
            ) : field.type === 'number_range' ? (
              <div className="hitlw-range">
                <input
                  className="hitlw-input hitlw-input--half"
                  type="number"
                  placeholder="最小值"
                  disabled={readonly}
                  value={values[`${field.name}__gte`] || ''}
                  onChange={e => setValues(v => ({ ...v, [`${field.name}__gte`]: e.target.value }))}
                />
                <span className="hitlw-range-sep">—</span>
                <input
                  className="hitlw-input hitlw-input--half"
                  type="number"
                  placeholder="最大值"
                  disabled={readonly}
                  value={values[`${field.name}__lte`] || ''}
                  onChange={e => setValues(v => ({ ...v, [`${field.name}__lte`]: e.target.value }))}
                />
              </div>
            ) : (
              <input
                className="hitlw-input"
                type="text"
                placeholder={readonly ? '—' : (field.required ? '必填' : '留空则不筛选')}
                disabled={readonly}
                value={values[field.name] || ''}
                onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}
              />
            )}
          </div>

          {/* 导航 dots + 箭头 */}
          <div className="hitlw-nav">
            <div className="hitlw-dots">
              {fields.map((_, i) => (
                <button
                  key={i}
                  className={`hitlw-dot ${i === index ? 'hitlw-dot--active' : ''} ${isFieldFilled(fields[i]) ? 'hitlw-dot--filled' : ''}`}
                  onClick={() => setIndex(i)}
                />
              ))}
            </div>
          </div>

          {!readonly && (
            <div className="hitlw-actions">
              <button className="hitlw-btn default" onClick={() => onAction('cancel')}>取消</button>
              <button className="hitlw-btn primary" onClick={handleSubmit}>提交</button>
            </div>
          )}
        </>
      )}

      {/* confirm 类型 */}
      {isConfirm && !isOptions && (
        !readonly ? (
          <div className="hitlw-actions">
            <button className="hitlw-btn default" onClick={() => onAction('cancel')}>取消</button>
            <button className="hitlw-btn danger" onClick={() => onAction('confirm', apicall)}>确认</button>
          </div>
        ) : null
      )}

      {/* options 类型 */}
      {isOptions && (
        !readonly ? (
          <div className="hitlw-actions">
            {decision.options?.map((opt, i) => (
              <button key={i}
                className={`hitlw-btn ${opt.value === 'confirm' ? 'danger' : opt.value === 'cancel' ? 'default' : 'primary'}`}
                onClick={() => onAction(opt.value, opt.value === 'confirm' ? apicall : null)}
              >{opt.label}</button>
            ))}
          </div>
        ) : null
      )}
    </div>
  );
}

export default HITLWidget;
