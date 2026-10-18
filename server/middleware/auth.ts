import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../lib/auth.js';
import prisma from '../lib/prisma.js';

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const token = header.slice('Bearer '.length).trim();
    const decoded = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { memberships: { include: { team: true } } },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      memberships: user.memberships.map((membership: { teamId: string; role: string }) => ({
        teamId: membership.teamId,
        role: membership.role,
      })),
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
