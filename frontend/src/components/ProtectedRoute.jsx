import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ permission }) => {
  const { user, loading, hasPermission } = useAuth();

  if (loading) {
    return <div style={{ padding: '40px', color: '#fff' }}>Đang kiểm tra quyền truy cập...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (permission && !hasPermission(permission)) {
    // Nếu có user nhưng không có quyền, đẩy về dashboard
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
