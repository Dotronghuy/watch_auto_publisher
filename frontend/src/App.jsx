import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DrivePage from './pages/DrivePage';
import DriveManager from './pages/DriveManager';
import Workflow from './pages/Workflow';
import CalendarPage from './pages/Calendar';
import SocialConnections from './pages/SocialConnections';
import UserManagement from './pages/UserManagement';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route path="/" element={<Layout />}>
            <Route element={<ProtectedRoute permission="dashboard" />}>
              <Route index element={<Dashboard />} />
            </Route>

            <Route element={<ProtectedRoute permission="drive" />}>
              <Route path="drive" element={<DrivePage />} />
            </Route>

            <Route element={<ProtectedRoute permission="workflow" />}>
              <Route path="workflow" element={<Workflow />} />
            </Route>

            <Route element={<ProtectedRoute permission="calendar" />}>
              <Route path="calendar" element={<CalendarPage />} />
            </Route>

            <Route element={<ProtectedRoute permission="database" />}>
              <Route path="database" element={<DriveManager />} />
            </Route>

            <Route element={<ProtectedRoute permission="settings" />}>
              <Route path="settings" element={<SocialConnections />} />
              <Route path="settings/users" element={<UserManagement />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
