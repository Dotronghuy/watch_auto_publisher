import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getUserByUsername, readUsers, writeUsers } from '../services/user.service.js';
import { verifyToken, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'zenwatch_secret_key_2026';

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = getUserByUsername(username);

  if (!user) {
    return res.status(401).json({ message: 'Sai tên đăng nhập hoặc mật khẩu!' });
  }

  const passwordIsValid = bcrypt.compareSync(password, user.password);
  if (!passwordIsValid) {
    return res.status(401).json({ message: 'Sai tên đăng nhập hoặc mật khẩu!' });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: 86400 // 24 hours
  });

  res.status(200).json({
    id: user.id,
    username: user.username,
    role: user.role,
    permissions: user.permissions,
    accessToken: token
  });
});

router.get('/me', verifyToken, (req, res) => {
  res.status(200).json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    permissions: req.user.permissions
  });
});

export default router;
