import { useState, useEffect } from 'react';
import { Database, Search, Download, RefreshCw, FileSpreadsheet, ExternalLink } from 'lucide-react';
import Swal from 'sweetalert2';
import './DriveManager.css';

const DriveManager = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(12);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [syncedAt, setSyncedAt] = useState(null);
  const [syncLabel, setSyncLabel] = useState('Chưa đồng bộ');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setSearchTerm(searchInput);
      setPage(1); // Reset về trang 1 khi search
    }, 500); // Đợi 500ms sau khi ngừng gõ mới search (Debounce)
    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  // Cập nhật nhãn "X giây/phút trước" mỗi giây
  useEffect(() => {
    const formatRelative = (date) => {
      if (!date) return 'Chưa đồng bộ';
      const diffMs = Date.now() - new Date(date).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 5) return 'Đang đồng bộ...';
      if (diffSec < 60) return `Đã đồng bộ ${diffSec} giây trước`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `Đã đồng bộ ${diffMin} phút trước`;
      const diffH = Math.floor(diffMin / 60);
      return `Đã đồng bộ ${diffH} giờ trước`;
    };
    setSyncLabel(formatRelative(syncedAt));
    const tick = setInterval(() => setSyncLabel(formatRelative(syncedAt)), 1000);
    return () => clearInterval(tick);
  }, [syncedAt]);

  useEffect(() => {
    setLoading(true);
    fetch(`http://localhost:3000/api/products?page=${page}&limit=${limit}&search=${encodeURIComponent(searchTerm)}`)
      .then(res => res.json())
      .then(data => {
        setProducts(data.data);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        if (data.syncedAt) setSyncedAt(data.syncedAt);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch products', err);
        setLoading(false);
      });
  }, [page, limit, searchTerm]);

  const generatePagination = () => {
    const pages = [];
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (page <= 3) {
        pages.push(1, 2, 3, '...', totalPages - 1, totalPages);
      } else if (page >= totalPages - 2) {
        pages.push(1, 2, '...', totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
      }
    }
    return pages;
  };
  return (
    <div className="drive-manager">
      <div className="page-header">
        <h1>Dữ liệu Sản phẩm (Google Sheets)</h1>
        <p>Bảng đồng bộ tự động danh sách sản phẩm và yêu cầu tạo Content từ file Google Sheet của bạn.</p>
      </div>

      <div className="top-stats glass">
        <div className="stat-col">
          <div className="stat-title">
            <FileSpreadsheet size={16} className="green" />
            <span>FILE DỮ LIỆU GỐC</span>
          </div>
          <div className="stat-value-group">
            <a href="https://docs.google.com/spreadsheets/d/1y2U9cuBNTT6SoHNHsHycLqVlwVM9yjvsSp6Nq2DPwxo/" target="_blank" rel="noreferrer" className="sheet-link">
              Mở Google Sheet <ExternalLink size={12} />
            </a>
          </div>
        </div>
        
        <div className="stat-col">
          <div className="stat-title">
            <RefreshCw size={16} className="blue" />
            <span>TRẠNG THÁI ĐỒNG BỘ</span>
          </div>
          <div className="stat-value-group mt-1">
            <span className={`status-badge ${syncedAt ? 'connected' : 'disconnected'}`}>
              <span className="dot"></span>
              {isSyncing ? (
                <><RefreshCw size={10} style={{ display: 'inline', marginRight: 4, animation: 'spin 1s linear infinite' }} /> Đang kết nối Google Sheet...</>
              ) : syncLabel}
            </span>
          </div>
        </div>

        <div className="stat-col action-col">
          <button className="btn-primary w-full justify-center" disabled={isSyncing} onClick={async () => {
            setIsSyncing(true);
            Swal.fire({
              title: 'Đang đồng bộ',
              text: 'Hệ thống đang kéo dữ liệu mới nhất từ Google Sheets...',
              icon: 'info', toast: true, position: 'top-end',
              showConfirmButton: false, timer: 2000,
              background: 'var(--color-surface)', color: 'var(--color-text)'
            });
            try {
              const res = await fetch('http://localhost:3000/api/trigger-sync', { method: 'POST' });
              const json = await res.json();
              if (json.syncedAt) setSyncedAt(json.syncedAt);
              // Reload data
              setPage(1);
              setSearchTerm(prev => prev + '');
              Swal.fire('Đã đồng bộ!', 'Dữ liệu mới nhất đã được tải về.', 'success');
            } catch (e) {
              Swal.fire('Lỗi', 'Không thể kết nối đến Backend', 'error');
            } finally {
              setIsSyncing(false);
            }
          }}>
            <RefreshCw size={16} className="mr-2" /> ĐỒNG BỘ NGAY TỪ SHEET
          </button>
        </div>
      </div>

      <div className="data-table-section glass">
        <div className="table-header-bar">
          <div className="header-title">
            <Database size={18} />
            <h3>Danh sách Sản phẩm & Nội dung (SKUs)</h3>
          </div>
          
          <div className="table-actions">
            <div className="search-box">
              <Search size={14} className="text-muted" />
              <input 
                type="text" 
                placeholder="Tìm theo SKU hoặc Tên..." 
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th width="40">STT</th>
                <th>TÊN SẢN PHẨM</th>
                <th>MÃ SKU</th>
                <th>THƯƠNG HIỆU</th>
                <th>TRẠNG THÁI</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="text-center">Đang tải dữ liệu từ Google Sheet...</td></tr>
              ) : products.map((item, index) => (
                <tr key={item.id}>
                  <td className="text-muted text-center">{((page - 1) * limit) + index + 1}</td>
                  <td className="font-semibold">{item.name}</td>
                  <td className="font-mono text-xs">{item.sku}</td>
                  <td>{item.brand}</td>
                  <td>
                    {item.status.includes('Sẽ đăng') ? (
                      <span className="status-badge connected"><span className="dot"></span> {item.status}</span>
                    ) : (
                      <span className="status-badge disconnected"><span className="dot"></span> {item.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="table-footer">
          <div className="footer-info" style={{ display: 'flex', alignItems: 'center' }}>
            <span>Đang hiển thị {products.length} trên tổng số {total} dòng từ Sheet</span>
            <select className="limit-selector" value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }} style={{
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              border: '1px solid var(--border-light)',
              padding: '4px 8px',
              borderRadius: '6px',
              outline: 'none',
              marginLeft: '12px'
            }}>
              <option value={12}>12 dòng / trang</option>
              <option value={48}>48 dòng / trang</option>
              <option value={100}>100 dòng / trang</option>
            </select>
          </div>
          <div className="pagination">
            <span onClick={() => setPage(p => Math.max(1, p - 1))} style={{cursor: 'pointer'}}>&lt;</span>
            {generatePagination().map((p, i) => (
              <span key={i} className={p === page ? 'active' : ''} onClick={() => typeof p === 'number' && setPage(p)} style={{cursor: typeof p === 'number' ? 'pointer' : 'default'}}>
                {p}
              </span>
            ))}
            <span onClick={() => setPage(p => Math.min(totalPages, p + 1))} style={{cursor: 'pointer'}}>&gt;</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriveManager;
