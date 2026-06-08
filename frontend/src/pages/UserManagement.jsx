import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Users, UserPlus, X, Check, Shield, User, Lock, LayoutGrid } from 'lucide-react';
import './UserManagement.css';

const UserManagement = () => {
  const { user, token } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'staff',
    permissions: []
  });

  const availablePermissions = [
    { id: 'dashboard', label: 'Tổng quan' },
    { id: 'drive', label: 'Lưu trữ' },
    { id: 'workflow', label: 'Luồng công việc' },
    { id: 'calendar', label: 'Lịch đăng' },
    { id: 'database', label: 'Dữ liệu SP' },
    { id: 'settings', label: 'Cài đặt' }
  ];

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
          <p>Thiết lập tài khoản và phân quyền cho nhân viên truy cập hệ thống</p>
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
                        : u.permissions.map(p => {
                            const lbl = availablePermissions.find(ap => ap.id === p)?.label || p;
                            return <span key={p} className="perm-badge">{lbl}</span>;
                          })
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
          <div className="um-modal">
            <div className="um-modal-header">
              <h3>{editingUser ? 'Chỉnh sửa tài khoản' : 'Thêm Nhân viên mới'}</h3>
              <button className="close-btn" onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSubmit}>
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
                <label>{editingUser ? 'Mật khẩu mới (bỏ trống nếu không đổi)' : 'Mật khẩu'}</label>
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
                <label>Vai trò</label>
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

              {formData.role !== 'admin' && (
                <div className="um-form-group" style={{ marginTop: '30px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <LayoutGrid size={16} color="var(--color-primary)" /> 
                    Cấp quyền truy cập hệ thống
                  </label>
                  <div className="um-checkbox-grid">
                    {availablePermissions.map(p => {
                      const isChecked = formData.permissions.includes(p.id);
                      return (
                        <div 
                          key={p.id} 
                          className={`um-custom-checkbox ${isChecked ? 'checked' : ''}`}
                          onClick={() => handlePermissionToggle(p.id)}
                        >
                          <div className="checkbox-box">
                            {isChecked && <Check size={14} strokeWidth={3} />}
                          </div>
                          <span>{p.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="um-modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowModal(false)}>Hủy bỏ</button>
                <button type="submit" className="btn-save glow-primary">{editingUser ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
