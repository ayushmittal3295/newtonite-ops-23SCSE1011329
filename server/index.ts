import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from './lib/prisma.js';
import { comparePassword, hashPassword, signToken } from './lib/auth.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(6),
});

const setupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  teamName: z.string().trim().min(2).max(120),
  teamDescription: z.string().trim().max(500).optional(),
});

const teamSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});

const teamMemberSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  role: z.enum(['VIEWER', 'MEMBER', 'LEAD', 'ADMIN']).default('MEMBER'),
});

const workItemInputSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(4000),
  type: z.enum(['INCIDENT', 'CUSTOMER_ISSUE', 'PAYMENT', 'COMPLIANCE', 'TASK']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  teamId: z.string().min(1),
  assigneeId: z.string().optional().nullable(),
  dueDate: z.string().datetime({ offset: true }).optional().nullable(),
});

const updateWorkItemSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().trim().min(10).max(4000).optional(),
  type: z.enum(['INCIDENT', 'CUSTOMER_ISSUE', 'PAYMENT', 'COMPLIANCE', 'TASK']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeId: z.string().optional().nullable(),
  dueDate: z.string().datetime({ offset: true }).optional().nullable(),
  version: z.number().int().positive(),
}).superRefine((data, context) => {
  if (!['title', 'description', 'type', 'priority', 'assigneeId', 'dueDate'].some((field) => field in data)) {
    context.addIssue({ code: 'custom', message: 'At least one work-item field must be updated' });
  }
});

const commentSchema = z.object({
  content: z.string().min(1).max(2000),
});

const transitionSchema = z.object({
  toStatus: z.enum(['OPEN', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'RESOLVED', 'CLOSED']),
  expectedVersion: z.number().int().positive(),
  comment: z.string().min(1).max(2000).optional(),
});
const claimSchema = z.object({ expectedVersion: z.number().int().positive() });

const workflowTransitions: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'AWAITING_APPROVAL'],
  IN_PROGRESS: ['AWAITING_APPROVAL', 'RESOLVED'],
  AWAITING_APPROVAL: ['RESOLVED', 'OPEN'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};
const workItemStatuses = ['OPEN', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'RESOLVED', 'CLOSED'] as const;
const workItemPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

const parseSort = (value?: string) => {
  const allowed = new Set(['updatedAt_desc', 'createdAt_desc', 'priority_desc', 'status_asc']);
  return allowed.has(String(value ?? 'updatedAt_desc')) ? String(value ?? 'updatedAt_desc') : 'updatedAt_desc';
};

const getParamId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? '' : value ?? '';

const summarizeUser = (user: any) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  memberships: user.memberships.map((membership: any) => ({
    teamId: membership.teamId,
    role: membership.role,
  })),
});

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'newtonite-ops' }));

app.get('/api/setup/status', async (_req, res) => {
  const userCount = await prisma.user.count();
  return res.json({ setupRequired: userCount === 0 });
});

app.post('/api/setup', async (req, res) => {
  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid setup payload. Password must be at least 12 characters.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (await tx.user.count() !== 0) {
        return null;
      }

      const user = await tx.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email.toLowerCase(),
          password: await hashPassword(parsed.data.password),
        },
      });
      const team = await tx.team.create({
        data: {
          name: parsed.data.teamName,
          description: parsed.data.teamDescription || null,
        },
      });
      await tx.teamMember.create({
        data: { userId: user.id, teamId: team.id, role: 'ADMIN' },
      });
      return { user, team };
    });

    if (!result) {
      return res.status(409).json({ error: 'Initial setup has already been completed' });
    }

    const token = signToken({
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
    });
    return res.status(201).json({
      token,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      team: { id: result.team.id, name: result.team.name },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'An account or team with that email or name already exists' });
    }
    throw error;
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid login payload' });
    }

    const { password } = parsed.data;
    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { team: true } } },
    });

    if (!user || !(await comparePassword(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({ userId: user.id, email: user.email, name: user.name });
    return res.json({ token, user: summarizeUser(user) });
  } catch (error) {
    console.error('Login request failed:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  return res.json({ user: { id: user.id, email: user.email, name: user.name, memberships: user.memberships } });
});

app.get('/api/teams', authMiddleware, async (req, res) => {
  const teams = await prisma.team.findMany({
    where: {
      members: {
        some: { userId: req.user!.id },
      },
    },
    include: {
      members: {
        include: { user: true },
      },
    },
  });

  return res.json({ teams: teams.map((team: any) => ({
    id: team.id,
    name: team.name,
    description: team.description,
    members: team.members.map((member: any) => ({
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
    })),
  })) });
});

app.post('/api/teams', authMiddleware, async (req, res) => {
  const parsed = teamSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid team payload' });
  }
  if (!req.user!.memberships.some((membership) => membership.role === 'ADMIN')) {
    return res.status(403).json({ error: 'Only an administrator may create teams' });
  }

  try {
    const team = await prisma.team.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        members: { create: { userId: req.user!.id, role: 'ADMIN' } },
      },
    });
    return res.status(201).json({ team: { id: team.id, name: team.name, description: team.description } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'A team with that name already exists' });
    }
    throw error;
  }
});

app.post('/api/teams/:teamId/members', authMiddleware, async (req, res) => {
  const teamId = getParamId(req.params.teamId);
  const membership = req.user!.memberships.find((entry) => entry.teamId === teamId);
  if (!membership) {
    return res.status(403).json({ error: 'You do not have access to this team' });
  }
  if (membership.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only a team administrator may add members' });
  }

  const parsed = teamMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid team member payload. Password must be at least 12 characters.' });
  }
  const email = parsed.data.email.toLowerCase();
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: parsed.data.name,
          email,
          password: await hashPassword(parsed.data.password),
        },
      });
      await tx.teamMember.create({
        data: { userId: created.id, teamId, role: parsed.data.role },
      });
      return created;
    });
    return res.status(201).json({
      member: { id: user.id, name: user.name, email: user.email, role: parsed.data.role },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    throw error;
  }
});

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  const userId = req.user!.id;
  const allowedTeams = req.user!.memberships.map((membership) => membership.teamId);
  const teamScope = { teamId: { in: allowedTeams } };
  const [assignedToMe, unassignedUrgent, awaitingMyApproval, statusGroups, totalWorkItems] = await Promise.all([
    prisma.workItem.count({ where: { ...teamScope, assigneeId: userId } }),
    prisma.workItem.count({ where: { ...teamScope, assigneeId: null, priority: 'URGENT' } }),
    prisma.workItem.count({
      where: {
        ...teamScope,
        status: 'AWAITING_APPROVAL',
        team: { members: { some: { userId, role: { in: ['LEAD', 'ADMIN'] } } } },
      },
    }),
    prisma.workItem.groupBy({
      by: ['status'],
      where: teamScope,
      _count: { _all: true },
    }),
    prisma.workItem.count({ where: teamScope }),
  ]);

  return res.json({
    stats: {
      assignedToMe,
      unassignedUrgent,
      awaitingMyApproval,
      totalWorkItems,
      statusCounts: statusGroups.map((group) => ({ status: group.status, count: group._count._all })),
    },
  });
});

app.get('/api/work-items', authMiddleware, async (req, res) => {
  const teamId = typeof req.query.teamId === 'string' ? req.query.teamId : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const priority = typeof req.query.priority === 'string' ? req.query.priority : undefined;
  const assigneeId = typeof req.query.assigneeId === 'string' && req.query.assigneeId !== 'all' ? req.query.assigneeId : undefined;
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const sort = parseSort(req.query.sort as string | undefined);

  const allowedTeams = req.user!.memberships.map((membership) => membership.teamId);
  if (teamId && !allowedTeams.includes(teamId)) {
    return res.status(403).json({ error: 'You do not have access to this team' });
  }
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'Page must be positive and limit must be between 1 and 100' });
  }
  if (search.length > 200) {
    return res.status(400).json({ error: 'Search must not exceed 200 characters' });
  }
  if (status && !workItemStatuses.includes(status as (typeof workItemStatuses)[number])) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }
  if (priority && !workItemPriorities.includes(priority as (typeof workItemPriorities)[number])) {
    return res.status(400).json({ error: 'Invalid priority filter' });
  }

  const where: any = {
    teamId: teamId ?? { in: allowedTeams },
    ...(search ? {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(assigneeId ? { assigneeId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.workItem.findMany({
      where,
      include: { creator: true, assignee: true, team: true },
      orderBy: sort === 'priority_desc' ? [{ priority: 'desc' }, { updatedAt: 'desc' }] : sort === 'status_asc' ? [{ status: 'asc' }, { updatedAt: 'desc' }] : [{ updatedAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.workItem.count({ where }),
  ]);

  return res.json({
    items: items.map((item: any) => ({
      ...item,
      dueDate: item.dueDate ? item.dueDate.toISOString() : null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      teamName: item.team.name,
      creatorName: item.creator.name,
      assigneeName: item.assignee?.name ?? null,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  });
});

app.post('/api/work-items', authMiddleware, async (req, res) => {
  const user = req.user!;
  const parsed = workItemInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid work item payload' });
  }

  const input = parsed.data;
  const membership = user.memberships.find((member) => member.teamId === input.teamId);
  if (!membership || !['MEMBER', 'LEAD', 'ADMIN'].includes(membership.role)) {
    return res.status(403).json({ error: 'You do not have permission to create work items for this team' });
  }
  if (input.assigneeId) {
    const assigneeMembership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId: input.assigneeId, teamId: input.teamId } },
    });
    if (!assigneeMembership) {
      return res.status(400).json({ error: 'Assignee must be a member of the selected team' });
    }
  }

  const idempotencyHeader = req.headers['idempotency-key'];
  const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader.trim() : undefined;
  if (idempotencyHeader && (!idempotencyKey || idempotencyKey.length > 200)) {
    return res.status(400).json({ error: 'Idempotency-Key must contain 1 to 200 characters' });
  }
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({
    userId: user.id,
    operation: 'CREATE_WORK_ITEM',
    body: input,
  })).digest('hex');
  if (idempotencyKey) {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { userId_operation_key: { userId: user.id, operation: 'CREATE_WORK_ITEM', key: idempotencyKey } },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return res.status(409).json({ error: 'Idempotency key reused with different payload' });
      }
      return res.status(200).json(JSON.parse(existing.responseJson));
    }
  }

  try {
    const response = await prisma.$transaction(async (tx: any) => {
      const item = await tx.workItem.create({
        data: {
          title: input.title,
          description: input.description,
          type: input.type,
          priority: input.priority,
          status: 'OPEN',
          teamId: input.teamId,
          assigneeId: input.assigneeId ?? null,
          creatorId: user.id,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        },
        include: { team: true, creator: true, assignee: true },
      });

      await tx.activity.create({
        data: {
          workItemId: item.id,
          actorId: user.id,
          action: 'CREATED',
          details: { by: user.name, team: item.team.name },
        },
      });

      const payload = {
        message: 'Work item created',
        item: {
          ...item,
          dueDate: item.dueDate ? item.dueDate.toISOString() : null,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          teamName: item.team.name,
          creatorName: item.creator.name,
          assigneeName: item.assignee?.name ?? null,
        },
      };
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            userId: user.id,
            operation: 'CREATE_WORK_ITEM',
            key: idempotencyKey,
            requestHash,
            responseJson: JSON.stringify(payload),
            workItemId: item.id,
          },
        });
      }
      return payload;
    });

    return res.status(201).json(response);
  } catch (error) {
    if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.idempotencyKey.findUnique({
        where: { userId_operation_key: { userId: user.id, operation: 'CREATE_WORK_ITEM', key: idempotencyKey } },
      });
      if (existing?.requestHash === requestHash) {
        return res.status(200).json(JSON.parse(existing.responseJson));
      }
      if (existing) {
        return res.status(409).json({ error: 'Idempotency key reused with different payload' });
      }
    }
    throw error;
  }
});

app.get('/api/work-items/:id', authMiddleware, async (req, res) => {
  const itemId = getParamId(req.params.id);
  const item = await prisma.workItem.findUnique({
    where: { id: itemId },
    include: {
      team: true,
      creator: true,
      assignee: true,
      comments: { include: { author: true }, orderBy: { createdAt: 'asc' } },
      activities: { include: { actor: true }, orderBy: { createdAt: 'asc' } },
      approvals: { include: { approver: true }, orderBy: { createdAt: 'asc' } },
    },
  });

  if (!item) {
    return res.status(404).json({ error: 'Work item not found' });
  }

  const membership = req.user!.memberships.find((team) => team.teamId === item.teamId);
  if (!membership) {
    return res.status(403).json({ error: 'You do not have access to this work item' });
  }

  const payloadItem = item as any;
  return res.json({
    item: {
      ...payloadItem,
      dueDate: payloadItem.dueDate ? payloadItem.dueDate.toISOString() : null,
      createdAt: payloadItem.createdAt.toISOString(),
      updatedAt: payloadItem.updatedAt.toISOString(),
      teamName: payloadItem.team.name,
      creatorName: payloadItem.creator.name,
      assigneeName: payloadItem.assignee?.name ?? null,
      comments: payloadItem.comments.map((comment: any) => ({
        id: comment.id,
        content: comment.content,
        authorName: comment.author.name,
        createdAt: comment.createdAt.toISOString(),
      })),
      activities: payloadItem.activities.map((activity: any) => ({
        id: activity.id,
        action: activity.action,
        details: activity.details,
        actorName: activity.actor?.name ?? 'System',
        createdAt: activity.createdAt.toISOString(),
      })),
      approvals: payloadItem.approvals.map((approval: any) => ({
        id: approval.id,
        status: approval.status,
        approverName: approval.approver.name,
        createdAt: approval.createdAt.toISOString(),
        updatedAt: approval.updatedAt.toISOString(),
      })),
    },
  });
});

app.patch('/api/work-items/:id', authMiddleware, async (req, res) => {
  const itemId = getParamId(req.params.id);
  const item = await prisma.workItem.findUnique({ where: { id: itemId }, include: { team: true } });
  if (!item) {
    return res.status(404).json({ error: 'Work item not found' });
  }

  const membership = req.user!.memberships.find((team) => team.teamId === item.teamId);
  if (!membership || !['MEMBER', 'LEAD', 'ADMIN'].includes(membership.role)) {
    return res.status(403).json({ error: 'You do not have permission to edit this work item' });
  }

  if (req.body?.version !== item.version) {
    return res.status(409).json({ error: 'This item changed since you last viewed it. Refresh and try again.' });
  }

  const parsed = updateWorkItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid update payload' });
  }

  const { version, ...data } = parsed.data;
  if (data.assigneeId) {
    const assigneeMembership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId: data.assigneeId, teamId: item.teamId } },
    });
    if (!assigneeMembership) {
      return res.status(400).json({ error: 'Assignee must be a member of the selected team' });
    }
  }

  const updatePayload: any = {
    ...(data.title ? { title: data.title } : {}),
    ...(data.description ? { description: data.description } : {}),
    ...(data.type ? { type: data.type } : {}),
    ...(data.priority ? { priority: data.priority } : {}),
    ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId ?? null } : {}),
    ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
    version: { increment: 1 },
  };

  const updated = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.workItem.updateMany({
      where: { id: item.id, version },
      data: updatePayload,
    });
    if (updateResult.count !== 1) {
      return null;
    }
    await tx.activity.create({
      data: {
        workItemId: item.id,
        actorId: req.user!.id,
        action: 'UPDATED',
        details: { fields: Object.keys(data) },
      },
    });
    return tx.workItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { team: true, creator: true, assignee: true },
    });
  });

  if (!updated) {
    return res.status(409).json({ error: 'This item changed since you last viewed it. Refresh and try again.' });
  }

  return res.json({
    message: 'Work item updated',
    item: {
      ...updated,
      dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      teamName: updated.team.name,
      creatorName: updated.creator.name,
      assigneeName: updated.assignee?.name ?? null,
    },
  });
});

app.post('/api/work-items/:id/claim', authMiddleware, async (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Expected work-item version is required' });
  }
  const expectedVersion = parsed.data.expectedVersion;
  const itemId = getParamId(req.params.id);
  const item = await prisma.workItem.findUnique({ where: { id: itemId }, include: { team: true } });
  if (!item) {
    return res.status(404).json({ error: 'Work item not found' });
  }

  const membership = req.user!.memberships.find((team) => team.teamId === item.teamId);
  if (!membership || !['MEMBER', 'LEAD', 'ADMIN'].includes(membership.role)) {
    return res.status(403).json({ error: 'You do not have permission to claim work for this team' });
  }

  if (item.version !== expectedVersion || item.assigneeId) {
    return res.status(409).json({ error: 'This item changed since you last viewed it. Refresh and try again.' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.workItem.updateMany({
      where: { id: item.id, assigneeId: null, version: expectedVersion },
      data: { assigneeId: req.user!.id, version: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      return null;
    }
    await tx.activity.create({
      data: {
        workItemId: item.id,
        actorId: req.user!.id,
        action: 'CLAIMED',
        details: { assignee: req.user!.name },
      },
    });
    return tx.workItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { assignee: true, team: true, creator: true },
    });
  });

  if (!updated) {
    return res.status(409).json({ error: 'This work item was claimed or changed by another user' });
  }

  return res.json({ message: 'Work item claimed', item: updated });
});

app.post('/api/work-items/:id/transition', authMiddleware, async (req, res) => {
  const parsed = transitionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid transition payload' });
  }

  const itemId = getParamId(req.params.id);
  const item = await prisma.workItem.findUnique({ where: { id: itemId }, include: { team: true } });
  if (!item) {
    return res.status(404).json({ error: 'Work item not found' });
  }

  const membership = req.user!.memberships.find((team) => team.teamId === item.teamId);
  if (!membership) {
    return res.status(403).json({ error: 'You do not have access to this work item' });
  }
  if (!['MEMBER', 'LEAD', 'ADMIN'].includes(membership.role)) {
    return res.status(403).json({ error: 'Your team role does not allow workflow changes' });
  }

  if (!workflowTransitions[item.status]?.includes(parsed.data.toStatus)) {
    return res.status(409).json({ error: `Invalid transition from ${item.status} to ${parsed.data.toStatus}` });
  }

  if (parsed.data.toStatus === 'RESOLVED' && item.status === 'AWAITING_APPROVAL') {
    const role = membership.role;
    if (!['LEAD', 'ADMIN'].includes(role)) {
      return res.status(403).json({ error: 'Only team leads or admins may approve this work item' });
    }
  }

  const expectedVersion = parsed.data.expectedVersion;
  if (item.version !== expectedVersion) {
    return res.status(409).json({ error: 'This item changed since you last viewed it. Refresh and try again.' });
  }

  const update = await prisma.$transaction(async (tx) => {
    const updated = await tx.workItem.updateMany({
      where: { id: item.id, version: expectedVersion, status: item.status },
      data: {
        status: parsed.data.toStatus,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return null;
    }

    await tx.activity.create({
      data: {
        workItemId: item.id,
        actorId: req.user!.id,
        action: 'STATUS_CHANGED',
        details: { from: item.status, to: parsed.data.toStatus, approvedBy: req.user!.name },
      },
    });

    if (parsed.data.toStatus === 'AWAITING_APPROVAL') {
      await tx.approval.updateMany({
        where: { workItemId: item.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      const approvers = await tx.teamMember.findMany({
        where: { teamId: item.teamId, role: { in: ['LEAD', 'ADMIN'] } },
        select: { userId: true },
      });
      await tx.approval.createMany({
        data: approvers.map((approver) => ({
          workItemId: item.id,
          approverId: approver.userId,
          status: 'PENDING',
        })),
      });
    }

    if (item.status === 'AWAITING_APPROVAL' && parsed.data.toStatus === 'OPEN') {
      await tx.approval.updateMany({
        where: { workItemId: item.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    }

    if (item.status === 'AWAITING_APPROVAL' && parsed.data.toStatus === 'RESOLVED') {
      await tx.approval.updateMany({
        where: { workItemId: item.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      const existingApproval = await tx.approval.findFirst({
        where: { workItemId: item.id, approverId: req.user!.id },
      });
      if (existingApproval) {
        await tx.approval.update({
          where: { id: existingApproval.id },
          data: { status: 'APPROVED' },
        });
      } else {
        await tx.approval.create({
          data: { workItemId: item.id, approverId: req.user!.id, status: 'APPROVED' },
        });
      }
    }

    if (parsed.data.comment) {
      await tx.comment.create({
        data: {
          workItemId: item.id,
          authorId: req.user!.id,
          content: parsed.data.comment,
        },
      });
    }

    return tx.workItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { team: true, creator: true, assignee: true },
    });
  });

  if (!update) {
    return res.status(409).json({ error: 'This item changed since you last viewed it. Refresh and try again.' });
  }

  return res.json({
    message: 'Status updated',
    item: {
      ...update,
      dueDate: update.dueDate ? update.dueDate.toISOString() : null,
      createdAt: update.createdAt.toISOString(),
      updatedAt: update.updatedAt.toISOString(),
      teamName: update.team.name,
      creatorName: update.creator.name,
      assigneeName: update.assignee?.name ?? null,
    },
  });
});

app.post('/api/work-items/:id/comments', authMiddleware, async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid comment payload' });
  }

  const itemId = getParamId(req.params.id);
  const item = await prisma.workItem.findUnique({ where: { id: itemId } });
  if (!item) {
    return res.status(404).json({ error: 'Work item not found' });
  }

  const membership = req.user!.memberships.find((team) => team.teamId === item.teamId);
  if (!membership) {
    return res.status(403).json({ error: 'You do not have access to this work item' });
  }
  if (!['MEMBER', 'LEAD', 'ADMIN'].includes(membership.role)) {
    return res.status(403).json({ error: 'Your team role does not allow comments' });
  }

  const comment = await prisma.$transaction(async (tx: any) => {
    const created = await tx.comment.create({
      data: { workItemId: item.id, authorId: req.user!.id, content: parsed.data.content },
      include: { author: true },
    });

    await tx.activity.create({
      data: {
        workItemId: item.id,
        actorId: req.user!.id,
        action: 'COMMENTED',
        details: { commentId: created.id },
      },
    });

    return created;
  });

  return res.status(201).json({ comment: { id: comment.id, content: comment.content, authorName: comment.author.name, createdAt: comment.createdAt.toISOString() } });
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled API error:', error.message);
  res.status(500).json({ error: 'Internal server error' });
});

export { app };
