import React from 'react';

const DriveManager = () => {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Quản Lý Nguồn Ảnh (Google Drive)</h1>
      <p className="text-gray-600 mb-6">Kết nối thư mục Drive và đồng bộ ảnh mới để chuẩn bị lên content.</p>
      
      <div className="bg-white p-6 border rounded shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Thư mục đã liên kết</h2>
        <div className="flex gap-4">
          <input 
            type="text" 
            placeholder="Nhập Google Drive Folder ID" 
            className="border p-2 rounded flex-1"
          />
          <button className="bg-blue-600 text-white px-4 py-2 rounded">
            Thêm Thư Mục
          </button>
        </div>
        
        <div className="mt-8">
          <h3 className="font-semibold mb-2">Ảnh mới đồng bộ</h3>
          <div className="text-gray-500 border-dashed border-2 border-gray-300 p-8 text-center rounded">
            Chưa có ảnh nào được đồng bộ.
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriveManager;
