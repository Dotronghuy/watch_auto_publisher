import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle, Clock, CalendarDays, BarChart3, Sparkles } from 'lucide-react';
import './Calendar.css';

const CalendarPage = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [settings, setSettings] = useState({ timeSlots: [] });
  const [history, setHistory] = useState([]);
  const [metrics, setMetrics] = useState([]);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(data => setSettings(data));
    fetch('/api/history').then(r => r.json()).then(data => setHistory(data));
    // Also fetch post metrics for richer calendar data
    fetch('/api/stats').then(r => r.json()).then(data => {
      if (data.recentPosts) setMetrics(data.recentPosts);
    }).catch(() => {});
  }, []);

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const dates = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    dates.push({ date: new Date(year, month - 1, daysInPrevMonth - firstDayOfMonth + i + 1), isCurrentMonth: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    dates.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }
  const remaining = (7 - (dates.length % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    dates.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build a map of history events by date key
  const historyMap = useMemo(() => {
    const map = {};
    // From posted_images
    history.forEach(item => {
      const d = new Date(item.timestamp);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map[key]) map[key] = [];
      const label = item.sku || item.name || item.productName || `Ảnh #${(item.id || '').toString().slice(-5)}`;
      map[key].push({ type: 'posted', text: label, platform: 'FB/IG' });
    });
    // From post_metrics
    metrics.forEach(item => {
      const d = new Date(item.timestamp);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map[key]) map[key] = [];
      const label = item.sku || `Post ${(item.post_id || '').slice(-6)}`;
      const existing = map[key].find(e => e.text === label);
      if (!existing) {
        map[key].push({
          type: item.platform === 'instagram' ? 'instagram' : 'facebook',
          text: label,
          platform: item.platform,
          likes: item.likes,
          comments: item.comments
        });
      }
    });
    return map;
  }, [history, metrics]);

  const calendarCells = dates.map(d => {
    const dTime = d.date.getTime();
    const isToday = dTime === today.getTime();
    const dayOfWeek = d.date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const key = `${d.date.getFullYear()}-${d.date.getMonth()}-${d.date.getDate()}`;

    let events = [];

    if (dTime < today.getTime()) {
      // Past — show history
      events = historyMap[key] || [];
    } else {
      // Today + Future — show scheduled time slots
      if (settings.timeSlots && settings.timeSlots.length > 0) {
        settings.timeSlots.forEach(slot => {
          events.push({ type: 'schedule', text: `${slot}`, platform: 'Auto' });
        });
      }
      // If today also has history (already posted today)
      if (isToday && historyMap[key]) {
        events = [...historyMap[key], ...events];
      }
    }

    return { text: d.date.getDate(), isCurrentMonth: d.isCurrentMonth, isToday, isWeekend, events };
  });

  const monthNames = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
  const dayHeaders = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  // Stats
  const totalPosted = history.length;
  const thisMonthPosts = history.filter(item => {
    const d = new Date(item.timestamp);
    return d.getFullYear() === year && d.getMonth() === month;
  }).length;
  const scheduledPerDay = settings.timeSlots ? settings.timeSlots.length : 0;

  return (
    <div className="calendar-page">
      <div className="calendar-main">
        {/* ─── Header ─── */}
        <div className="calendar-header">
          <div className="month-selector">
            <button className="month-nav" onClick={prevMonth}><ChevronLeft size={16} /></button>
            <h2>{monthNames[month]} {year}</h2>
            <button className="month-nav" onClick={nextMonth}><ChevronRight size={16} /></button>
          </div>
          <div className="calendar-actions">
            <button className="today-btn" onClick={goToday}>Hôm nay</button>
          </div>
        </div>

        {/* ─── Calendar Grid ─── */}
        <div className="calendar-grid">
          {dayHeaders.map((d, i) => (
            <div key={d} className={`day-header ${i === 0 || i === 6 ? 'weekend' : ''}`}>{d}</div>
          ))}

          {calendarCells.map((d, i) => (
            <div key={i} className={`calendar-cell ${!d.isCurrentMonth ? 'dim' : ''} ${d.isToday ? 'today' : ''} ${d.isWeekend ? 'weekend' : ''}`}>
              <span className="date-number">{d.text}</span>

              {d.events.length > 0 && (
                <div className="events-container">
                  {d.events.slice(0, 3).map((ev, idx) => (
                    <div key={idx} className={`event-badge ${ev.type}`}>
                      {ev.type === 'posted' || ev.type === 'facebook' || ev.type === 'instagram' ? (
                        <CheckCircle size={9} />
                      ) : (
                        <Clock size={9} />
                      )}
                      <span>{ev.text}</span>
                    </div>
                  ))}
                  {d.events.length > 3 && (
                    <span className="event-more">+{d.events.length - 3} khác</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Sidebar ═══ */}
      <div className="calendar-sidebar">
        {/* Stats */}
        <div className="sidebar-card">
          <h4><BarChart3 size={14} style={{color: '#60a5fa'}} /> Thống kê</h4>
          <div className="mini-stats">
            <div className="mini-stat">
              <div className="stat-num pink">{thisMonthPosts}</div>
              <div className="stat-label">Tháng này</div>
            </div>
            <div className="mini-stat">
              <div className="stat-num blue">{totalPosted}</div>
              <div className="stat-label">Tổng cộng</div>
            </div>
            <div className="mini-stat">
              <div className="stat-num purple">{scheduledPerDay}</div>
              <div className="stat-label">Slot / ngày</div>
            </div>
            <div className="mini-stat">
              <div className="stat-num green">{scheduledPerDay * daysInMonth}</div>
              <div className="stat-label">Dự kiến / tháng</div>
            </div>
          </div>
        </div>

        {/* Time Slots */}
        <div className="sidebar-card">
          <h4><Clock size={14} style={{color: '#a5b4fc'}} /> Khung giờ đăng</h4>
          {settings.timeSlots && settings.timeSlots.length > 0 ? (
            <div className="timeslot-list">
              {settings.timeSlots.map((slot, idx) => (
                <div key={idx} className="timeslot-item">
                  <span className="timeslot-time">{slot}</span>
                  <span className="timeslot-label">Tự động đăng</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="timeslot-empty">Chưa cài đặt khung giờ</div>
          )}
        </div>

        {/* Legend */}
        <div className="sidebar-card">
          <h4><CalendarDays size={14} style={{color: '#34d399'}} /> Chú thích</h4>
          <div className="legend-list">
            <div className="legend-item">
              <span className="legend-dot schedule"></span>
              Lịch đăng tự động
            </div>
            <div className="legend-item">
              <span className="legend-dot posted"></span>
              Đã đăng thành công
            </div>
            <div className="legend-item">
              <span className="legend-dot today"></span>
              Hôm nay
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalendarPage;
