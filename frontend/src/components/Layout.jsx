import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import './Layout.css';

const Layout = () => {
  const location = useLocation();
  const showTopbar = location.pathname === '/';

  return (
    <div className="app-container">
      <Sidebar />
      <div className="main-content">
        {showTopbar && <Topbar />}
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
