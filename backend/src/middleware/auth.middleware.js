import jwt from 'jsonwebtoken';
import { getUserById } from '../services/user.service.js';

const JWT_SECRET = process.env.JWT_SECRET || 'zenwatch_secret_key_2026';

export const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token.split(' ')[1], JWT_SECRET);
    const user = getUserById(decoded.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Require Admin Role' });
  }
};

export const requirePermission = (permission) => {
  return (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.permissions.includes(permission))) {
      next();
    } else {
      res.status(403).json({ message: `Require permission: ${permission}` });
    }
  };
};
