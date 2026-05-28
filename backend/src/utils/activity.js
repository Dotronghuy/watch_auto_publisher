export const recentActivities = [
  { id: 1, message: 'Hệ thống khởi tạo thành công.', timestamp: Date.now() - 120000, type: 'success' },
  { id: 2, type: 'info', message: 'Cơ sở dữ liệu sẵn sàng.', timestamp: Date.now() - 60000 },
];

export const addActivity = (message, type = 'info') => {
  recentActivities.push({
    id: Date.now(),
    message,
    timestamp: Date.now(),
    type
  });
  // Keep only last 20
  if (recentActivities.length > 20) {
    recentActivities.shift();
  }
};
