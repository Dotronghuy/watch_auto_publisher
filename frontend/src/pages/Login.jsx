import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Login.css';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleMove = (e) => {
    setTilt({
      x: (e.clientX / window.innerWidth - 0.5) * 2,
      y: (e.clientY / window.innerHeight - 0.5) * 2
    });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok) {
        login({
          id: data.id,
          username: data.username,
          role: data.role,
          permissions: data.permissions
        }, data.accessToken);
        navigate('/');
      } else {
        setError(data.message || 'Đăng nhập thất bại');
      }
    } catch (err) {
      setError('Lỗi kết nối máy chủ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container" onMouseMove={handleMove}>
      <div className="login-visual">
        <div className="login-visual-glow"></div>
        <div className="login-watch-float">
          <img
            src="/watch-3d.png"
            alt="ZenWatch Flow 3D"
            className="login-watch"
            style={{ transform: `perspective(1400px) rotateY(${(tilt.x * 10).toFixed(2)}deg) rotateX(${(-tilt.y * 10).toFixed(2)}deg)` }}
          />
        </div>
        <h1 className="login-visual-title">ZenWatch <span className="text-gradient">Flow</span></h1>
        <p className="login-visual-sub">Hệ thống tự động đăng bài & chăm sóc khách hàng cho cửa hàng đồng hồ</p>
      </div>
      <div className="login-box">
        <div className="login-logo">
          <img src="/logo-z.png" alt="ZenWatch Flow" />
          <h2>ZenWatch Flow</h2>
        </div>
        <p className="login-subtitle">Đăng nhập để vào hệ thống</p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label>Tên đăng nhập</label>
            <input 
              type="text" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nhập tài khoản..."
              required 
            />
          </div>
          <div className="form-group">
            <label>Mật khẩu</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu..."
              required 
            />
          </div>
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Đang xử lý...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
