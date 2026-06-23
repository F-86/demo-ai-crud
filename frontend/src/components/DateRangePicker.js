import React, { useState, useRef, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

function fmt(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parse(str) {
  if (!str) return undefined;
  const d = new Date(str + 'T00:00:00');
  return isNaN(d) ? undefined : d;
}

function DateRangePicker({ valueGte, valueLte, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const range = {
    from: parse(valueGte),
    to: parse(valueLte),
  };

  const handleSelect = (r) => {
    onChange(fmt(r?.from), fmt(r?.to));
    // 只有 from 和 to 都选完且不同才关闭
    if (r?.from && r?.to && r.from.getTime() !== r.to.getTime()) setOpen(false);
  };

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const label = valueGte || valueLte
    ? `${valueGte || '…'} — ${valueLte || '…'}`
    : '选择日期范围';

  return (
    <div className="drp-wrap" ref={ref}>
      <button
        className={`drp-trigger ${open ? 'drp-trigger--open' : ''}`}
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        type="button"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{flexShrink:0}}>
          <rect x="1" y="2" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M4 1v2M10 1v2M1 6h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <span className="drp-label">{label}</span>
        {(valueGte || valueLte) && !disabled && (
          <span className="drp-clear" onClick={e => { e.stopPropagation(); onChange('', ''); }}>×</span>
        )}
      </button>

      {open && (
        <div className="drp-popover">
          <DayPicker
            mode="range"
            selected={range}
            onSelect={handleSelect}
            numberOfMonths={1}
            captionLayout="dropdown"
            startMonth={new Date(2020, 0)}
            endMonth={new Date(2030, 11)}
          />
        </div>
      )}
    </div>
  );
}

export default DateRangePicker;
