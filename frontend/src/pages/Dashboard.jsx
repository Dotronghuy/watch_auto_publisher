import React from 'react';

const Dashboard = () => {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Tổng Quan Chiến Dịch</h1>
      <p className="text-gray-600">Thống kê số lượng bài đăng lên Facebook, Instagram, Threads và TikTok.</p>
      <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Placeholder cards */}
        {['Facebook', 'Instagram', 'Threads', 'TikTok'].map((platform) => (
          <div key={platform} className="p-4 border rounded shadow-sm bg-white">
            <h3 className="font-semibold text-lg">{platform}</h3>
            <p className="text-2xl mt-2">0</p>
            <p className="text-sm text-gray-500">Bài đã đăng</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
