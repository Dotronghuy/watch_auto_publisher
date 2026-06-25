import React, { createContext, useState, useEffect, useContext } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem('zenwatch_user');
    const token = localStorage.getItem('zenwatch_token');

    if (storedUser && token) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        localStorage.removeItem('zenwatch_user');
        localStorage.removeItem('zenwatch_token');
      }
    }
    setLoading(false);
  }, []);

  const login = (userData, token) => {
    localStorage.setItem('zenwatch_user', JSON.stringify(userData));
    localStorage.setItem('zenwatch_token', token);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('zenwatch_user');
    localStorage.removeItem('zenwatch_token');
    setUser(null);
  };

  const hasPermission = (permission) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (!user.permissions || !Array.isArray(user.permissions)) return false;
    
    // Exact match: 'settings.schedule'
    if (user.permissions.includes(permission)) return true;
    
    // Parent module match: checking 'settings' returns true if user has ANY 'settings.*' permission
    if (!permission.includes('.')) {
      return user.permissions.some(p => p === permission || p.startsWith(permission + '.'));
    }
    
    // Legacy compatibility: checking 'settings.view' also passes if user has old 'settings' permission
    const parentModule = permission.split('.')[0];
    return user.permissions.includes(parentModule);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
