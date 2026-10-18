import type { NextFunction, Request, Response } from 'express';
import prisma from '../lib/prisma.js';

export function requireTeamPermission(requiredRoles: string[] = []) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const teamId = req.params.teamId ?? req.body?.teamId ?? req.query?.teamId;
    if (!teamId) {
      return res.status(400).json({ error: 'Team identifier is required' });
    }

    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const membership = user.memberships.find((member) => member.teamId === teamId);
    if (!membership) {
      return res.status(403).json({ error: 'You do not have access to this team' });
    }

    const effectiveRoles = new Set(['VIEWER', 'MEMBER', 'LEAD', 'ADMIN']);
    const roleOrder = ['VIEWER', 'MEMBER', 'LEAD', 'ADMIN'];
    const membershipLevel = roleOrder.indexOf(membership.role);

    if (requiredRoles.length > 0) {
      const allowed = requiredRoles.every((role) => {
        const requiredLevel = roleOrder.indexOf(role);
        return membershipLevel >= requiredLevel;
      });

      if (!allowed) {
        return res.status(403).json({ error: 'Insufficient team permissions' });
      }
    }

    if (!effectiveRoles.has(membership.role)) {
      return res.status(403).json({ error: 'Invalid role' });
    }

    req.teamRole = membership.role;
    next();
  };
}
