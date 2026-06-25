import express from 'express';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { verifyToken, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();
const prisma = new PrismaClient();

// Lấy danh sách users
router.get('/', [verifyToken, requireAdmin], async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    const safeUsers = users.map(u => {
      const { password, ...userWithoutPassword } = u;
      let permissions = [];
      try { if (u.permissions) permissions = JSON.parse(u.permissions); } catch(e){}
      return { ...userWithoutPassword, permissions };
    });
    res.status(200).json(safeUsers);
  } catch(e) {
    res.status(500).json({message: 'Lỗi server'});
  }
});

// Tạo user mới
router.post('/', [verifyToken, requireAdmin], async (req, res) => {
  const { username, password, role, permissions } = req.body;
  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại!' });

    const salt = bcrypt.genSaltSync(10);
    const newUser = await prisma.user.create({
      data: {
        username,
        password: bcrypt.hashSync(password, salt),
        role: role || 'staff',
        permissions: JSON.stringify(permissions || [])
      }
    });

    const { password: _, ...safeUser } = newUser;
    safeUser.permissions = permissions || [];
    res.status(201).json(safeUser);
  } catch(e) {
    res.status(500).json({message: 'Lỗi server'});
  }
});

// Cập nhật user (quyền hoặc đổi pass)
router.put('/:id', [verifyToken, requireAdmin], async (req, res) => {
  const { id } = req.params;
  const { password, permissions, role } = req.body;
  
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ message: 'User không tồn tại' });

    // Admin không thể tự đổi quyền của mình thành staff (tránh mất quyền admin duy nhất)
    if (user.role === 'admin' && role === 'staff') {
      const adminCount = await prisma.user.count({ where: { role: 'admin' } });
      if (adminCount <= 1) return res.status(400).json({ message: 'Phải có ít nhất 1 Admin trong hệ thống!' });
    }

    const dataToUpdate = {};
    if (password) dataToUpdate.password = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
    if (permissions) dataToUpdate.permissions = JSON.stringify(permissions);
    if (role) dataToUpdate.role = role;

    const updatedUser = await prisma.user.update({
      where: { id },
      data: dataToUpdate
    });

    const { password: _, ...safeUser } = updatedUser;
    safeUser.permissions = permissions || (user.permissions ? JSON.parse(user.permissions) : []);
    res.status(200).json(safeUser);
  } catch(e) {
    res.status(500).json({message: 'Lỗi server'});
  }
});

// Xóa user
router.delete('/:id', [verifyToken, requireAdmin], async (req, res) => {
  const { id } = req.params;
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ message: 'User không tồn tại' });

    if (user.role === 'admin') {
      const adminCount = await prisma.user.count({ where: { role: 'admin' } });
      if (adminCount <= 1) return res.status(400).json({ message: 'Không thể xóa Admin duy nhất!' });
    }

    await prisma.user.delete({ where: { id } });
    res.status(200).json({ message: 'Xóa user thành công!' });
  } catch(e) {
    res.status(500).json({message: 'Lỗi server'});
  }
});

export default router;
