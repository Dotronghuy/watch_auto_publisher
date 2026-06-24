import { useState, useEffect } from 'react';
import { Database, Search, RefreshCw, FileSpreadsheet, ExternalLink, PackageSearch } from 'lucide-react';
import Swal from 'sweetalert2';
import './DriveManager.css';
import AutoFillSheet from './AutoFillSheet';

const DriveManager = () => {
  const [activeTab, setActiveTab] = useState('data');
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
      setPage(1);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    const formatRelative = (date) => {
      if (!date) return 'Chưa đồng bộ';
      const diffMs = Date.now() - new Date(date).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 5) return 'Vừa đồng bộ xong';
      if (diffSec < 60) return `${diffSec} giây trước`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin} phút trước`;
      const diffH = Math.floor(diffMin / 60);
      return `${diffH} giờ trước`;
    };
    setSyncLabel(formatRelative(syncedAt));
    const tick = setInterval(() => setSyncLabel(formatRelative(syncedAt)), 1000);
    return () => clearInterval(tick);
  }, [syncedAt]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/products?page=${page}&limit=${limit}&search=${encodeURIComponent(searchTerm)}`)
      .then(res => res.json())
      .then(data => {
        setProducts(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 0);
        if (data.syncedAt) setSyncedAt(data.syncedAt);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch products', err);
        setLoading(false);
      });
  }, [page, limit, searchTerm]);

  const handleSync = async () => {
    setIsSyncing(true);
    Swal.fire({
      title: 'Đang đồng bộ',
      text: 'Hệ thống đang kéo dữ liệu mới nhất từ Google Sheets...',
      icon: 'info', toast: true, position: 'top-end',
      showConfirmButton: false, timer: 3000,
      background: 'var(--color-surface)', color: 'var(--color-text)'
    });
    try {
      const res = await fetch('/api/trigger-sync', { method: 'POST' });
      const json = await res.json();
      if (json.syncedAt) setSyncedAt(json.syncedAt);
      setPage(1);
      setSearchTerm(prev => prev + '');
      Swal.fire({ title: 'Hoàn tất!', text: 'Dữ liệu đã được cập nhật.', icon: 'success', background: 'var(--color-surface)', color: 'var(--color-text)', confirmButtonColor: 'var(--color-primary)' });
    } catch (e) {
      Swal.fire('Lỗi', 'Không thể kết nối đến Backend', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const generatePagination = () => {
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (page <= 3) {
        pages.push(1, 2, 3, 4, '...', totalPages);
      } else if (page >= totalPages - 2) {
        pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
      }
    }
    return pages;
  };

  const SkeletonRows = () => (
    Array.from({ length: limit }).map((_, i) => (
      <tr key={`sk-${i}`} className="skeleton-row">
        <td className="col-stt"><div className="skeleton-bar" style={{width: '20px', margin: '0 auto'}}></div></td>
        <td><div className="skeleton-bar" style={{width: `${60 + Math.random() * 30}%`}}></div></td>
        <td><div className="skeleton-bar" style={{width: '80px'}}></div></td>
        <td><div className="skeleton-bar" style={{width: '60px'}}></div></td>
        <td><div className="skeleton-bar" style={{width: '70px'}}></div></td>
      </tr>
    ))
  );

  return (
    <div className="relative min-h-[calc(100vh-60px)] pb-32">
      {activeTab === 'data' ? (
        <div className="drive-manager">
          <div className="page-header">
            <h1>Dữ liệu Sản phẩm</h1>
            <p>Bảng đồng bộ tự động danh sách sản phẩm từ Google Sheets — nguồn dữ liệu gốc cho AI tạo Content.</p>
          </div>

          <div className="top-stats">
            <div className="stat-col">
              <div className="stat-title">
                <FileSpreadsheet size={14} style={{color: '#34d399'}} />
                <span>Nguồn dữ liệu</span>
              </div>
              <div className="stat-value-group">
                <a href="https://docs.google.com/spreadsheets/d/1y2U9cuBNTT6SoHNHsHycLqVlwVM9yjvsSp6Nq2DPwxo/" target="_blank" rel="noreferrer" className="sheet-link">
                  Mở Google Sheet <ExternalLink size={11} />
                </a>
              </div>
            </div>

            <div className="stat-col">
              <div className="stat-title">
                <RefreshCw size={14} style={{color: '#60a5fa'}} />
                <span>Trạng thái đồng bộ</span>
              </div>
              <div className="stat-value-group mt-1">
                <span className={`status-badge ${syncedAt ? 'connected' : 'disconnected'}`}>
                  <span className="dot"></span>
                  {isSyncing ? (
                    <><RefreshCw size={10} style={{ display: 'inline', marginRight: 4, animation: 'spin 1s linear infinite' }} /> Đang đồng bộ...</>
                  ) : syncLabel}
                </span>
              </div>
            </div>

            <div className="stat-col action-col">
              <button className="btn-primary sync-btn" disabled={isSyncing} onClick={handleSync}>
                <RefreshCw size={14} className={isSyncing ? 'spin' : ''} /> Đồng bộ Sheet
              </button>
            </div>
          </div>

          <div className="data-table-section">
            <div className="table-header-bar">
              <div className="header-title">
                <div className="icon-wrap"><Database size={15} /></div>
                <h3>Danh sách SKU</h3>
                {!loading && <span className="total-badge">{total} sản phẩm</span>}
              </div>

              <div className="table-actions">
                <div className="search-box">
                  <Search size={14} style={{color: 'var(--color-text-dim)', flexShrink: 0}} />
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
                    <th style={{width: '50px', textAlign: 'center'}}>#</th>
                    <th>Tên sản phẩm</th>
                    <th>Mã SKU</th>
                    <th>Thương hiệu</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows />
                  ) : !products || products.length === 0 ? (
                    <tr>
                      <td colSpan="5">
                        <div className="empty-state">
                          <PackageSearch size={40} />
                          <p>Không tìm thấy sản phẩm nào{searchTerm ? ` cho "${searchTerm}"` : ''}</p>
                        </div>
                      </td>
                    </tr>
                  ) : products.map((item, index) => (
                    <tr key={item.id}>
                      <td className="col-stt">{((page - 1) * limit) + index + 1}</td>
                      <td className="col-name">{item.name}</td>
                      <td className="col-sku"><span className="sku-chip">{item.sku}</span></td>
                      <td className="col-brand">{item.brand}</td>
                      <td>
                        {item.status.includes('Sẽ đăng') || item.status.includes('Đã đăng') ? (
                          <span className="status-badge posted"><span className="dot"></span> {item.status}</span>
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
              <div className="footer-info">
                <span>Hiển thị {products ? products.length : 0} / {total} sản phẩm</span>
                <select className="limit-selector" value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}>
                  <option value={12}>12 / trang</option>
                  <option value={24}>24 / trang</option>
                  <option value={48}>48 / trang</option>
                  <option value={100}>100 / trang</option>
                </select>
              </div>
              <div className="pagination">
                <span onClick={() => setPage(p => Math.max(1, p - 1))} style={{opacity: page === 1 ? .3 : 1, pointerEvents: page === 1 ? 'none' : 'auto'}}>&lt;</span>
                {generatePagination().map((p, i) => (
                  <span
                    key={i}
                    className={`${p === page ? 'active' : ''} ${typeof p !== 'number' ? 'dots' : ''}`}
                    onClick={() => typeof p === 'number' && setPage(p)}
                  >
                    {p}
                  </span>
                ))}
                <span onClick={() => setPage(p => Math.min(totalPages, p + 1))} style={{opacity: page === totalPages ? .3 : 1, pointerEvents: page === totalPages ? 'none' : 'auto'}}>&gt;</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <AutoFillSheet />
      )}

      {/* Floating Navigation Tabs */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 rounded-2xl p-1.5 flex gap-1 shadow-[0_0_40px_rgba(0,0,0,0.5)] border bg-[#0B0F19]/90 backdrop-blur-xl" style={{ borderColor: '#2D3349' }}>
        <button 
          onClick={() => setActiveTab('data')}
          className="flex items-center gap-2 py-2 px-6 rounded-xl transition-all duration-300 font-medium text-sm hover:text-white"
          style={{ 
            backgroundColor: activeTab === 'data' ? '#2D3349' : 'transparent',
            color: activeTab === 'data' ? '#fff' : '#94A3B8'
          }}
        >
          <Database size={16} /> Dữ liệu Sản phẩm
        </button>
        <button 
          onClick={() => setActiveTab('autofill')}
          className="flex items-center gap-2 py-2 px-6 rounded-xl transition-all duration-300 font-medium text-sm hover:text-white"
          style={{
            backgroundColor: activeTab === 'autofill' ? '#FF4D8D' : 'transparent',
            color: activeTab === 'autofill' ? '#fff' : '#94A3B8',
            boxShadow: activeTab === 'autofill' ? '0 0 15px rgba(255,77,141,0.4)' : 'none'
          }}
        >
          <FileSpreadsheet size={16} /> Tool Cào Dữ liệu
        </button>
      </div>
    </div>
  );
};

export default DriveManager;
