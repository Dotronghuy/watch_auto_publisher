import express from 'express';
import bcrypt from 'bcryptjs';
import { readUsers, writeUsers } from '../services/user.service.js';
import { verifyToken, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// Lấy danh sách users
router.get('/', [verifyToken, requireAdmin], (req, res) => {
  const users = readUsers();
  // Không trả về password
  const safeUsers = users.map(u => {
    const { password, ...userWithoutPassword } = u;
    return userWithoutPassword;
  });
  res.status(200).json(safeUsers);
});

// Tạo user mới
router.post('/', [verifyToken, requireAdmin], (req, res) => {
  const { username, password, role, permissions } = req.body;
  const users = readUsers();
  
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại!' });
  }

  const salt = bcrypt.genSaltSync(10);
  const newUser = {
    id: Date.now().toString(),
    username,
    password: bcrypt.hashSync(password, salt),
    role: role || 'staff',
    permissions: permissions || []
  };

  users.push(newUser);
  writeUsers(users);

  const { password: _, ...safeUser } = newUser;
  res.status(201).json(safeUser);
});

// Cập nhật user (quyền hoặc đổi pass)
router.put('/:id', [verifyToken, requireAdmin], (req, res) => {
  const { id } = req.params;
  const { password, permissions, role } = req.body;
  const users = readUsers();
  const index = users.findIndex(u => u.id === id);

  if (index === -1) {
    return res.status(404).json({ message: 'User không tồn tại' });
  }

  // Admin không thể tự đổi quyền của mình thành staff (tránh mất quyền admin duy nhất)
  if (users[index].role === 'admin' && role === 'staff') {
    const adminCount = users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) {
      return res.status(400).json({ message: 'Phải có ít nhất 1 Admin trong hệ thống!' });
    }
  }

  if (password) {
    const salt = bcrypt.genSaltSync(10);
    users[index].password = bcrypt.hashSync(password, salt);
  }
  
  if (permissions) users[index].permissions = permissions;
  if (role) users[index].role = role;

  writeUsers(users);
  
  const { password: _, ...safeUser } = users[index];
  res.status(200).json(safeUser);
});

// Xóa user
router.delete('/:id', [verifyToken, requireAdmin], (req, res) => {
  const { id } = req.params;
  const users = readUsers();
  const userToDelete = users.find(u => u.id === id);

  if (!userToDelete) {
    return res.status(404).json({ message: 'User không tồn tại' });
  }

  if (userToDelete.role === 'admin') {
    const adminCount = users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) {
      return res.status(400).json({ message: 'Không thể xóa Admin duy nhất!' });
    }
  }

  const filteredUsers = users.filter(u => u.id !== id);
  writeUsers(filteredUsers);

  res.status(200).json({ message: 'Xóa user thành công!' });
});

export default router;
