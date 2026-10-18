import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: object) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '8h' });
}

export function verifyToken(token: string) {
  return jwt.verify(token, config.jwtSecret) as { userId: string; email: string; name: string };
}
