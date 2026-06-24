import React, { useState, useEffect } from 'react';
import DateRangePicker from './DateRangePicker';

const API_BASE = process.env.REACT_APP_API_BASE || '';

// 渲染单个 decision
function DecisionWidget({ decision, values, setValues, readonly, api }) {
  const [comboOptions, setComboOptions] = useState([]);
  const field = decision.field;

  useEffect(() => {
    if (decision.type !== 'combobox') return;
    const ep = decision.options_from?.endpoint;
    if (!ep) return;
    fetch(`${api || API_BASE}${ep}`)
      .then(r => r.json())
      .then(data => setComboOptions(Array.isArray(data) ? data : []))
      .catch(() => setComboOptions([]));
  }, [decision, api]);

  if (decision.type === 'combobox') {
    const labelField = decision.options_from?.label_field || 'label';
    const valueField = decision.options_from?.value_field || 'value';
    const selected = values[field] || [];
    const toggle = (val) => {
      if (readonly) return;
      setValues(v => {
        const cur = v[field] || [];
        return { ...v, [field]: cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val] };
      });
    };
    return (
      <div className="hitlw-decision">
        <span className="hitlw-label">{decision.label}</span>
        <div className="hitlw-tags">
          {comboOptions.map(o => {
            const val = o[valueField];
            const lbl = o[labelField];
            const active = selected.includes(val);
            return (
              <button
                key={val}
                className={`hitlw-tag ${active ? 'hitlw-tag--active' : ''}`}
                disabled={readonly}
                onClick={() => toggle(val)}
              >{lbl}</button>
            );
          })}
          {comboOptions.length === 0 && !readonly && (
            <span className="hitlw-dim">加载中...</span>
          )}
        </div>
      </div>
    );
  }

  if (decision.type === 'number_range') {
    return (
      <div className="hitlw-decision">
        <span className="hitlw-label">{decision.label}{decision.unit ? `（${decision.unit}）` : ''}</span>
        <div className="hitlw-range">
          <input
            className="hitlw-input hitlw-input--half"
            type="number"
            placeholder="最小值"
            disabled={readonly}
            value={values[`${field}__gte`] || ''}
            onChange={e => setValues(v => ({ ...v, [`${field}__gte`]: e.target.value }))}
          />
          <span className="hitlw-range-sep">—</span>
          <input
            className="hitlw-input hitlw-input--half"
            type="number"
            placeholder="最大值"
            disabled={readonly}
            value={values[`${field}__lte`] || ''}
            onChange={e => setValues(v => ({ ...v, [`${field}__lte`]: e.target.value }))}
          />
        </div>
      </div>
    );
  }

  if (decision.type === 'datetime_range') {
    return (
      <div className="hitlw-decision">
        <span className="hitlw-label">{decision.label}</span>
        <DateRangePicker
          valueGte={values[`${field}__gte`] || ''}
          valueLte={values[`${field}__lte`] || ''}
          onChange={(gte, lte) => setValues(v => ({ ...v, [`${field}__gte`]: gte, [`${field}__lte`]: lte }))}
          disabled={readonly}
        />
      </div>
    );
  }

  // input 字段（Create/Update 场景）
  if (decision.type === 'input') {
    const fields = decision.fields || [];
    return (
      <div className="hitlw-decision">
        {fields.map(f => (
          <div key={f.name} className="hitlw-input-row" style={{ marginBottom: 8 }}>
            <span className="hitlw-label">{f.label}</span>
            {f.type === 'choice' ? (
              <select
                className="hitlw-input"
                disabled={readonly}
                value={values[f.name] || ''}
                onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))}
              >
                <option value="">— 请选择 —</option>
                {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="hitlw-input"
                type={f.type === 'number' ? 'number' : 'text'}
                placeholder={f.required ? '必填' : '可选'}
                disabled={readonly}
                value={values[f.name] || ''}
                onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// 渲染只读字段（可视化展示已收集的值）
function ReadonlyField({ decision }) {
  const { field, label, unit, value } = decision;

  // number_range：只读的价格区间
  if (value && typeof value === 'object' && !Array.isArray(value) && ('gte' in value || 'lte' in value)) {
    return (
      <div className="hitlw-decision">
        <span className="hitlw-label">{label}{unit ? `（${unit}）` : ''}</span>
        <div className="hitlw-range">
          <div className="hitlw-readonly-box">{value.gte != null ? value.gte : '不限'}</div>
          <span className="hitlw-range-sep">—</span>
          <div className="hitlw-readonly-box">{value.lte != null ? value.lte : '不限'}</div>
        </div>
      </div>
    );
  }

  // 数组：只读标签（如 category、id）
  if (Array.isArray(value)) {
    return (
      <div className="hitlw-decision">
        <span className="hitlw-label">{label}</span>
        <div className="hitlw-tags">
          {value.map((v, i) => (
            <span key={i} className="hitlw-tag hitlw-tag--readonly">{v}</span>
          ))}
        </div>
      </div>
    );
  }

  // 字符串/数字：简单只读字段
  if (value != null) {
    return (
      <div className="hitlw-decision">
        <span className="hitlw-label">{label}</span>
        <div className="hitlw-readonly-text">{String(value)}</div>
      </div>
    );
  }

  return null;
}

function HITLWidget({ hitl, onAction, readonly, api, reply }) {
  const decisions = hitl?.checkpoint?.decisions || [];
  const apicall = hitl?.checkpoint?.apicall;
  const summary = hitl?.checkpoint?.summary || '';

  // 把用户提交的 reply JSON 转成 values 格式
  const initValues = () => {
    if (!readonly || !reply) return {};
    try {
      const parsed = JSON.parse(reply);
      const vals = {};
      Object.entries(parsed).forEach(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && ('gte' in v || 'lte' in v)) {
          if (v.gte !== undefined) vals[`${k}__gte`] = String(v.gte);
          if (v.lte !== undefined) vals[`${k}__lte`] = String(v.lte);
        } else {
          vals[k] = v;
        }
      });
      return vals;
    } catch { return {}; }
  };

  const [values, setValues] = useState(initValues);
  const [index, setIndex] = useState(0);

  if (!decisions.length) return null;

  // 区分 readonly 展示和可交互决策
  const readonlyDecisions = decisions.filter(d => d.type === 'readonly');
  const actionableDecisions = decisions.filter(d => d.type !== 'readonly');
  const hasReadonly = readonlyDecisions.length > 0;

  const firstDecision = actionableDecisions[0] || decisions[0];
  const isChoiceOnly = actionableDecisions.length === 1 && (firstDecision.type === 'choice' || firstDecision.type === 'confirm');
  const isMultiDecision = actionableDecisions.some(d => ['combobox', 'number_range', 'datetime_range', 'input'].includes(d.type));

  const isDecisionFilled = (d) => {
    const f = d.field || d.name;
    if (d.type === 'combobox') return (values[f] || []).length > 0;
    if (d.type === 'number_range' || d.type === 'datetime_range')
      return !!(values[`${f}__gte`] || values[`${f}__lte`]);
    if (d.type === 'input') return (d.fields || []).some(fi => !!values[fi.name]);
    return false;
  };

  const handleSubmit = () => {
    const out = {};
    decisions.forEach(d => {
      const f = d.field || d.name;
      if (d.type === 'combobox') {
        if ((values[f] || []).length > 0) out[f] = values[f];
      } else if (d.type === 'number_range') {
        const gte = values[`${f}__gte`];
        const lte = values[`${f}__lte`];
        if (gte || lte) {
          const range = {};
          if (gte) range.gte = Number(gte);
          if (lte) range.lte = Number(lte);
          out[f] = range;
        }
      } else if (d.type === 'datetime_range') {
        const gte = values[`${f}__gte`];
        const lte = values[`${f}__lte`];
        if (gte || lte) {
          const range = {};
          if (gte) range.gte = gte;
          if (lte) range.lte = lte;
          out[f] = range;
        }
      } else if (d.type === 'input') {
        (d.fields || []).forEach(fi => { if (values[fi.name]) out[fi.name] = values[fi.name]; });
      }
    });
    onAction(JSON.stringify(out));
  };

  const currentDecision = decisions[index];

  return (
    <div className={`hitlw ${readonly ? 'hitlw--readonly' : ''}`}>
      {/* 头部 */}
      <div className="hitlw-header">
        <span className="hitlw-summary">{summary}</span>
        {readonly && <span className="hitlw-badge">已处理</span>}
      </div>

      {/* readonly 字段：可视化展示已收集的值（如价格区间框、分类标签等） */}
      {hasReadonly && (
        <div className="hitlw-readonly-fields">
          {readonlyDecisions.map((d, i) => (
            <ReadonlyField key={i} decision={d} />
          ))}
        </div>
      )}

      {/* 多 decision 轮播（combobox / number_range / datetime_range） */}
      {isMultiDecision && (
        <>
          <DecisionWidget
            key={index}
            decision={currentDecision}
            values={values}
            setValues={setValues}
            readonly={readonly}
            api={api}
          />

          {/* dots 导航 */}
          {decisions.length > 1 && (
            <div className="hitlw-nav">
              <div className="hitlw-dots">
                {decisions.map((d, i) => (
                  <button
                    key={i}
                    className={`hitlw-dot ${i === index ? 'hitlw-dot--active' : ''} ${isDecisionFilled(d) ? 'hitlw-dot--filled' : ''}`}
                    onClick={() => setIndex(i)}
                  />
                ))}
              </div>
            </div>
          )}

          {!readonly && (
            <div className="hitlw-actions">
              <button className="hitlw-btn default" onClick={() => onAction('cancel')}>取消</button>
              <button className="hitlw-btn primary" onClick={handleSubmit}>提交</button>
            </div>
          )}
        </>
      )}

      {/* choice/confirm 单决策 */}
      {isChoiceOnly && !readonly && (
        firstDecision.type === 'confirm' ? (
          <div className="hitlw-actions">
            <button className="hitlw-btn default" onClick={() => onAction('cancel')}>取消</button>
            <button className="hitlw-btn danger" onClick={() => onAction('confirm', apicall)}>确认</button>
          </div>
        ) : (
          <div className="hitlw-actions">
            {firstDecision.options?.map((opt, i) => (
              <button key={i}
                className={`hitlw-btn ${opt.value === 'confirm' ? 'danger' : opt.value === '取消查询' || opt.value === 'cancel' ? 'default' : 'primary'}`}
                onClick={() => onAction(opt.value, (opt.value === 'execute' || opt.value === 'confirm') ? apicall : null)}
              >{opt.label}</button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

export default HITLWidget;
