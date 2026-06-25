import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Users, UserPlus, X, Check, Shield, User, Lock, LayoutGrid, ChevronDown, ChevronRight } from 'lucide-react';
import './UserManagement.css';

// ═══ Cấu trúc cây quyền chi tiết ═══
const PERMISSION_TREE = [
  {
    id: 'dashboard', label: '📊 Tổng quan', children: [
      { id: 'dashboard.view', label: 'Xem trang tổng quan' }
    ]
  },
  {
    id: 'drive', label: '☁️ Lưu trữ', children: [
      { id: 'drive.view', label: 'Xem trang Google Drive' },
      { id: 'drive.upload', label: 'Upload ảnh / video' }
    ]
  },
  {
    id: 'workflow', label: '🔄 Luồng công việc', children: [
      { id: 'workflow.view', label: 'Xem trang Luồng công việc' },
      { id: 'workflow.start', label: 'Bắt đầu đăng bài tự động' },
      { id: 'workflow.stop', label: 'Dừng đăng bài' }
    ]
  },
  {
    id: 'calendar', label: '📅 Lịch đăng', children: [
      { id: 'calendar.view', label: 'Xem lịch đăng bài' }
    ]
  },
  {
    id: 'inbox', label: '💬 Hộp thư (CRM)', children: [
      { id: 'inbox.view', label: 'Xem danh sách tin nhắn' },
      { id: 'inbox.reply', label: 'Trả lời tin nhắn khách hàng' }
    ]
  },
  {
    id: 'shopee', label: '🛍️ Shopee Manager', children: [
      { id: 'shopee.view', label: 'Xem trang Shopee Manager' },
      { id: 'shopee.sync_start', label: 'Bắt đầu đồng bộ (Auto Sync)' },
      { id: 'shopee.sync_stop', label: 'Dừng đồng bộ' },
      { id: 'shopee.edit_product', label: 'Sửa thông tin sản phẩm' }
    ]
  },
  {
    id: 'database', label: '🗃️ Dữ liệu SP', children: [
      { id: 'database.view', label: 'Xem trang Dữ liệu sản phẩm' },
      { id: 'database.import', label: 'Import dữ liệu (Sapo / Sheets)' },
      { id: 'database.delete', label: 'Xóa model / variant' }
    ]
  },
  {
    id: 'autofill', label: '📋 Auto Fill Sheet', children: [
      { id: 'autofill.view', label: 'Xem trang Auto Fill' },
      { id: 'autofill.start', label: 'Bắt đầu cào dữ liệu' },
      { id: 'autofill.stop', label: 'Dừng cào' }
    ]
  },
  {
    id: 'zalo', label: '📱 Zalo Auto Post', children: [
      { id: 'zalo.view', label: 'Xem trang Zalo Auto Post' },
      { id: 'zalo.start', label: 'Bắt đầu đăng Zalo' },
      { id: 'zalo.stop', label: 'Dừng đăng Zalo' }
    ]
  },
  {
    id: 'settings', label: '⚙️ Cài đặt', children: [
      { id: 'settings.view', label: 'Xem trang Cài đặt' },
      { id: 'settings.schedule', label: 'Khung giờ đăng & Tần suất' },
      { id: 'settings.chatbot', label: 'Cài đặt Chatbot Tư Vấn' },
      { id: 'settings.api_keys', label: 'Khóa API Gemini & Phân bổ nguồn' },
      { id: 'settings.accounts', label: 'Danh sách tài khoản đăng bài' },
      { id: 'settings.ai_login', label: 'Login Helper AI (ChatGPT/Gemini)' },
      { id: 'settings.users', label: 'Quản lý Nhân sự (Chỉ Admin)' }
    ]
  }
];

// Helper: lấy tất cả permission IDs dạng phẳng
const ALL_PERMISSION_IDS = PERMISSION_TREE.flatMap(g => g.children.map(c => c.id));

// Helper: lấy label hiển thị từ permission ID
const getPermLabel = (permId) => {
  for (const group of PERMISSION_TREE) {
    if (group.id === permId) return group.label;
    const child = group.children.find(c => c.id === permId);
    if (child) return child.label;
  }
  return permId;
};

const UserManagement = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState({});
  
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'staff',
    permissions: []
  });

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('zenwatch_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      } else {
        setError('Không thể lấy danh sách người dùng');
      }
    } catch (err) {
      setError('Lỗi kết nối máy chủ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && user.role === 'admin') {
      fetchUsers();
    }
  }, [user]);

  const handleOpenModal = (user = null) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        username: user.username,
        password: '',
        role: user.role,
        permissions: user.permissions || []
      });
    } else {
      setEditingUser(null);
      setFormData({
        username: '',
        password: '',
        role: 'staff',
        permissions: []
      });
    }
    setExpandedGroups({});
    setShowModal(true);
  };

  const handlePermissionToggle = (permId) => {
    setFormData(prev => {
      const perms = prev.permissions.includes(permId)
        ? prev.permissions.filter(p => p !== permId)
        : [...prev.permissions, permId];
      return { ...prev, permissions: perms };
    });
  };

  const handleGroupToggleAll = (group) => {
    const childIds = group.children.map(c => c.id);
    const allChecked = childIds.every(id => formData.permissions.includes(id));
    
    setFormData(prev => {
      let perms;
      if (allChecked) {
        // Bỏ chọn tất cả
        perms = prev.permissions.filter(p => !childIds.includes(p));
      } else {
        // Chọn tất cả
        perms = [...new Set([...prev.permissions, ...childIds])];
      }
      return { ...prev, permissions: perms };
    });
  };

  const toggleGroupExpand = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingUser 
        ? `/api/users/${editingUser.id}` 
        : '/api/users';
      
      const method = editingUser ? 'PUT' : 'POST';
      const bodyParams = { ...formData };
      if (editingUser && !bodyParams.password) delete bodyParams.password;

      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('zenwatch_token')}` 
        },
        body: JSON.stringify(bodyParams)
      });

      if (res.ok) {
        setShowModal(false);
        fetchUsers();
      } else {
        const err = await res.json();
        alert(err.message || 'Có lỗi xảy ra');
      }
    } catch (err) {
      alert('Lỗi kết nối máy chủ');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa nhân viên này?')) return;
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('zenwatch_token')}` }
      });
      if (res.ok) {
        fetchUsers();
      } else {
        const err = await res.json();
        alert(err.message);
      }
    } catch (err) {
      alert('Lỗi kết nối máy chủ');
    }
  };

  if (!user || user.role !== 'admin') {
    return <div className="um-container"><h3>Bạn không có quyền truy cập trang này.</h3></div>;
  }

  return (
    <div className="um-container">
      <div className="um-header">
        <div className="um-header-left">
          <h2><Users size={28} style={{ color: 'var(--color-primary)' }} /> Quản lý Nhân sự</h2>
          <p>Thiết lập tài khoản và phân quyền chi tiết cho nhân viên truy cập hệ thống</p>
        </div>
        <button className="um-add-btn glow-primary" onClick={() => handleOpenModal()}>
          <UserPlus size={18} /> Thêm Nhân viên
        </button>
      </div>

      {error && <div className="um-error">{error}</div>}

      <div className="um-table-container">
        {loading ? (
          <p style={{ padding: '24px' }}>Đang tải danh sách...</p>
        ) : (
          <table className="um-table">
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Vai trò</th>
                <th>Quyền truy cập</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="avatar-mini"><User size={14} /></div>
                      {u.username}
                    </div>
                  </td>
                  <td>
                    <span className={`um-role badge-${u.role}`}>
                      {u.role === 'admin' ? <Shield size={14}/> : <User size={14}/>}
                      {u.role === 'admin' ? 'Quản trị viên' : 'Nhân viên'}
                    </span>
                  </td>
                  <td>
                    <div className="um-perms-badges">
                      {u.role === 'admin' 
                        ? <span className="perm-badge all">Toàn quyền hệ thống</span>
                        : (() => {
                            // Group permissions by module for display
                            const grouped = {};
                            (u.permissions || []).forEach(p => {
                              const mod = p.split('.')[0] || p;
                              if (!grouped[mod]) grouped[mod] = [];
                              grouped[mod].push(p);
                            });
                            const moduleLabels = Object.keys(grouped).map(mod => {
                              const group = PERMISSION_TREE.find(g => g.id === mod);
                              return group ? group.label : mod;
                            });
                            return moduleLabels.length > 0 
                              ? moduleLabels.map(lbl => <span key={lbl} className="perm-badge">{lbl}</span>)
                              : <span className="perm-badge" style={{ opacity: 0.5 }}>Chưa có quyền</span>;
                          })()
                      }
                    </div>
                  </td>
                  <td>
                    <button className="um-action-btn edit" onClick={() => handleOpenModal(u)}>Sửa</button>
                    {u.role !== 'admin' && (
                      <button className="um-action-btn delete" onClick={() => handleDelete(u.id)}>Xóa</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="um-modal-overlay">
          <div className="um-modal" style={{ maxWidth: '850px' }}>
            <div className="um-modal-header">
              <div>
                <h3>{editingUser ? 'Chỉnh sửa tài khoản' : 'Add New Employee'}</h3>
                <p className="um-modal-subtitle">Initialize employee credentials and define systemic permissions.</p>
              </div>
              <button className="close-btn" onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSubmit} className="um-modal-form">
              <div className="um-modal-grid">
                <div className="um-modal-left">
              <div className="um-form-group">
                <label>Tên đăng nhập</label>
                <div className="input-with-icon">
                  <User size={18} className="input-icon" />
                  <input 
                    type="text" 
                    value={formData.username} 
                    onChange={e => setFormData({...formData, username: e.target.value})}
                    disabled={!!editingUser}
                    required 
                    placeholder="Nhập tên đăng nhập..."
                  />
                </div>
              </div>
              <div className="um-form-group">
                <label>Email Address / Mật khẩu</label>
                <div className="input-with-icon">
                  <Lock size={18} className="input-icon" />
                  <input 
                    type="password" 
                    value={formData.password} 
                    onChange={e => setFormData({...formData, password: e.target.value})}
                    required={!editingUser}
                    placeholder="Nhập mật khẩu..."
                  />
                </div>
              </div>
              <div className="um-form-group">
                <label>Primary Role</label>
                <div className="input-with-icon">
                  <Shield size={18} className="input-icon" />
                  <select 
                    value={formData.role} 
                    onChange={e => setFormData({...formData, role: e.target.value})}
                  >
                    <option value="staff">Nhân viên</option>
                    <option value="admin">Quản trị viên</option>
                  </select>
                </div>
              </div>

                </div>

              {formData.role !== 'admin' && (
                <div className="um-modal-right">
                  <div className="um-modal-right-header">ACCESS NODES</div>
                  <div className="um-permission-grid">
                    {PERMISSION_TREE.map(group => {
                      const isExpanded = expandedGroups[group.id];
                      const childIds = group.children.map(c => c.id);
                      const checkedCount = childIds.filter(id => formData.permissions.includes(id)).length;
                      const allChecked = checkedCount === childIds.length;
                      const someChecked = checkedCount > 0 && !allChecked;

                      return (
                        <div key={group.id} className={`perm-node-card ${checkedCount > 0 ? 'active' : ''}`}>
                          <div 
                            className="perm-node-header"
                            onClick={() => toggleGroupExpand(group.id)}
                          >
                            <span className="perm-node-label">{group.label}</span>
                            <div 
                              className={`ios-switch ${allChecked ? 'on' : someChecked ? 'partial' : ''}`}
                              onClick={(e) => { e.stopPropagation(); handleGroupToggleAll(group); }}
                            >
                              <div className="ios-switch-knob"></div>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="perm-node-children">
                              {group.children.map(child => {
                                const isChecked = formData.permissions.includes(child.id);
                                return (
                                  <div 
                                    key={child.id}
                                    className={`perm-child-item ${isChecked ? 'checked' : ''}`}
                                    onClick={() => handlePermissionToggle(child.id)}
                                  >
                                    <span className="perm-child-label">{child.label}</span>
                                    <div className={`ios-switch-small ${isChecked ? 'on' : ''}`}>
                                      <div className="ios-switch-small-knob"></div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>

              <div className="um-modal-footer">
                <div className="um-modal-actions">
                  <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn-save glow-primary">{editingUser ? 'Lưu thay đổi' : 'Create Account'}</button>
                </div>
                <div className="um-modal-security">
                  Security Verification: <span>LEVEL 3 (ENCRYPTED)</span>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
