import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Edit2, CheckCircle } from 'lucide-react';
import Swal from 'sweetalert2';
import { Twitter } from '../components/SocialIcons';
import './Calendar.css';

const CalendarPage = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [settings, setSettings] = useState({ timeSlots: [] });
  const [history, setHistory] = useState([]);
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  
  useEffect(() => {
    fetch('http://localhost:3000/api/settings').then(r => r.json()).then(data => setSettings(data));
    fetch('http://localhost:3000/api/history').then(r => r.json()).then(data => setHistory(data));
  }, []);

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  // Generate calendar grid
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const dates = [];
  
  // Previous month padding
  for (let i = 0; i < firstDayOfMonth; i++) {
    dates.push({ date: new Date(year, month - 1, daysInPrevMonth - firstDayOfMonth + i + 1), isCurrentMonth: false });
  }
  // Current month
  for (let i = 1; i <= daysInMonth; i++) {
    dates.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }
  // Next month padding
  const remaining = 7 - (dates.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      dates.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const colors = ['facebook', 'instagram', 'linkedin', 'twitter'];

  // Map events to dates
  const calendarCells = dates.map(d => {
    const dTime = d.date.getTime();
    const isToday = dTime === today.getTime();
    
    let events = [];

    // For past days, show history
    if (dTime < today.getTime()) {
      history.forEach(item => {
        const itemDate = new Date(item.timestamp);
        itemDate.setHours(0, 0, 0, 0);
        if (itemDate.getTime() === dTime) {
          // item có thể có sku, name, hoặc chỉ có id
          const label = item.sku || item.name || item.productName || `#${item.id?.slice(-6) || '?'}`;
          events.push({
            type: 'linkedin',
            text: `Đã đăng: ${label}`,
            platform: 'History',
            isPast: true
          });
        }
      });
    } else {
      // For today and future, show timeSlots from settings
      if (settings.timeSlots && settings.timeSlots.length > 0) {
        settings.timeSlots.forEach((slot, idx) => {
          events.push({
            type: colors[idx % colors.length],
            text: `${slot} • Auto Post`,
            platform: 'Auto'
          });
        });
      }
    }

    return { text: d.date.getDate(), isCurrentMonth: d.isCurrentMonth, isToday, events };
  });

  const monthNames = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
  const currentMonthStr = `${monthNames[month]} ${year}`;

  return (
    <div className="calendar-page">
      <div className="calendar-main">
        <div className="calendar-header">
          <div className="month-selector">
            <button className="btn-icon" onClick={prevMonth}><ChevronLeft size={20} /></button>
            <h2>{currentMonthStr}</h2>
            <button className="btn-icon" onClick={nextMonth}><ChevronRight size={20} /></button>
          </div>
          
          <div className="calendar-actions">
            <button className="btn-ghost" onClick={() => {
              Swal.fire({
                title: 'Lịch tự động',
                text: 'Lịch này được phần mềm tự động tạo ra dựa trên Khung Giờ Vàng bạn đã cài ở phần Cài Đặt. Không cần phải lên lịch bằng tay ở đây nữa!',
                icon: 'info',
                background: 'var(--color-surface)',
                color: 'white',
                confirmButtonColor: 'var(--color-primary)'
              });
            }}>Lịch đăng bài Tự động</button>
            <button className="btn-primary" onClick={() => {
              Swal.fire({
                title: 'Bảng thống kê Chi Tiết',
                text: 'Bảng thống kê đang được xử lý và sẽ ra mắt trong phiên bản sắp tới.',
                icon: 'info',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                background: 'var(--color-surface)',
                color: 'var(--color-text)'
              });
            }}>
              <Edit2 size={14} className="mr-2" /> XEM CHI TIẾT
            </button>
          </div>
        </div>

        <div className="calendar-grid">
          {days.map(d => (
            <div key={d} className="day-header">{d}</div>
          ))}
          
          {calendarCells.map((d, i) => (
            <div key={i} className={`calendar-cell ${!d.isCurrentMonth ? 'dim' : ''} ${d.isToday ? 'today' : ''}`}>
              <span className="date-number">{d.text}</span>
              
              {d.events.length > 0 && (
                <div className="events-container">
                  {d.events.map((ev, idx) => (
                    <div key={idx} className={`event-badge ${ev.type}`}>
                      {ev.isPast ? <CheckCircle size={10} /> : (ev.type === 'twitter' ? <Twitter size={10} /> : null)}
                      <span>{ev.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CalendarPage;
