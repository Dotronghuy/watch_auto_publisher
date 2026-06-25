import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'zenwatch_secret_key_2026';

export const verifyToken = async (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token.split(' ')[1], JWT_SECRET, { ignoreExpiration: true });
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // Parse permissions for convenience in next middlewares
    let perms = [];
    try { if (user.permissions) perms = JSON.parse(user.permissions); } catch(e){}
    user.permissions = perms;

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      console.warn('JWT Verification: Token Expired');
    } else {
      console.error('JWT Verification Error:', err.message, err.stack);
    }
    return res.status(401).json({ message: 'Unauthorized', error: err.message });
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
    if (!req.user) return res.status(403).json({ message: `Require permission: ${permission}` });
    if (req.user.role === 'admin') return next();
    
    const perms = req.user.permissions || [];
    
    // Exact match
    if (perms.includes(permission)) return next();
    
    // Parent module match: checking 'shopee' passes if user has any 'shopee.*'
    if (!permission.includes('.')) {
      if (perms.some(p => p === permission || p.startsWith(permission + '.'))) return next();
    }
    
    // Legacy: checking 'settings.schedule' passes if user has old 'settings' permission
    const parentModule = permission.split('.')[0];
    if (perms.includes(parentModule)) return next();
    
    res.status(403).json({ message: `Require permission: ${permission}` });
  };
};
