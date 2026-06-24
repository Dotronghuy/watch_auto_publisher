import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '../middleware/auth.middleware.js';

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'zenwatch_secret_key_2026';

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user) {
      return res.status(401).json({ message: 'Sai tên đăng nhập hoặc mật khẩu!' });
    }

    const passwordIsValid = bcrypt.compareSync(password, user.password);
    if (!passwordIsValid) {
      return res.status(401).json({ message: 'Sai tên đăng nhập hoặc mật khẩu!' });
    }

    let permissions = [];
    try {
      if (user.permissions) permissions = JSON.parse(user.permissions);
    } catch (e) {}

    const token = jwt.sign({ id: user.id, role: user.role, shopId: user.shopId }, JWT_SECRET, {
      expiresIn: 86400 // 24 hours
    });

    res.status(200).json({
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: permissions,
      shopId: user.shopId,
      accessToken: token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    let permissions = [];
    try { if (user.permissions) permissions = JSON.parse(user.permissions); } catch (e) {}

    res.status(200).json({
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: permissions,
      shopId: user.shopId
    });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

export default router;
