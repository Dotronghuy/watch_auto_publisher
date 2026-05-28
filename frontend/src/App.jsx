import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';

import Dashboard from './pages/Dashboard';
import DrivePage from './pages/DrivePage';
import DriveManager from './pages/DriveManager';
import Workflow from './pages/Workflow';
import CalendarPage from './pages/Calendar';
import SocialConnections from './pages/SocialConnections';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="drive" element={<DrivePage />} />
          <Route path="workflow" element={<Workflow />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="database" element={<DriveManager />} />
          <Route path="settings" element={<SocialConnections />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
