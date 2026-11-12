import { useState } from 'react';
import { DEFAULT_WORKING_HOURS, todayStr, workingHoursFor } from './lib/workingHours';
import { useLanguage } from './LanguageContext';
import { dayLabels, monthsFull } from './lib/i18n';

function dateStr(y, m, d) {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Mirrors patient.html's renderCalendar()/changeMonth()/selectDay() -- same
// Monday-start grid, same today/has-termin/selected/past/closed day states.
export default function Calendar({ workingHours, termine, selectedDate, onSelectDate }) {
  useLanguage(); // subscribe to language changes so month/day names re-render
  const [viewDate, setViewDate] = useState(() => (selectedDate ? new Date(selectedDate + 'T00:00:00') : new Date()));

  const hours = workingHours || DEFAULT_WORKING_HOURS;
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = monthsFull()[month];
  const today = new Date();
  const todayFull = todayStr();
  const terminDays = new Set((termine || []).filter((t) => t.status !== 'cancelled').map((t) => t.date));

  const first = new Date(year, month, 1).getDay();
  const offset = first === 0 ? 6 : first - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function changeMonth(dir) {
    setViewDate(new Date(year, month + dir, 1));
  }

  return (
    <div className="calendar">
      <div className="cal-header">
        <button type="button" className="cal-nav" onClick={() => changeMonth(-1)}>‹</button>
        <div className="cal-month">{monthLabel} {year}</div>
        <button type="button" className="cal-nav" onClick={() => changeMonth(1)}>›</button>
      </div>
      <div className="cal-grid">
        {dayLabels().map((l, i) => <div className="cal-day-label" key={i}>{l}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div className="cal-day empty" key={'e' + i} />;
          const ds = dateStr(year, month, d);
          const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
          const isPast = ds < todayFull;
          const isClosed = !isPast && !workingHoursFor(ds, hours).open;
          const classes = ['cal-day'];
          if (isToday) classes.push('today');
          if (terminDays.has(ds)) classes.push('has-termin');
          if (selectedDate === ds) classes.push('selected');
          if (isPast) classes.push('past');
          else if (isClosed) classes.push('closed');
          return (
            <div
              className={classes.join(' ')}
              key={ds}
              onClick={isPast || isClosed ? undefined : () => onSelectDate(ds)}
            >
              {d}
            </div>
          );
        })}
      </div>
    </div>
  );
}
