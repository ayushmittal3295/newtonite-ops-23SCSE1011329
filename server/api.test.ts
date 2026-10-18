import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './index.js';
import prisma from './lib/prisma.js';
import { hashPassword } from './lib/auth.js';

describe('operations API', () => {
  const createdUserIds: string[] = [];
  const createdTeamIds: string[] = [];
  const createdWorkItemIds: string[] = [];
  let token = '';
  let teamId = '';
  let secondUserId = '';
  let viewerToken = '';

  beforeAll(async () => {
    const setupStatus = await request(app).get('/api/setup/status');
    expect(setupStatus.status).toBe(200);

    if (setupStatus.body.setupRequired) {
      const setup = await request(app).post('/api/setup').send({
        name: 'Test Administrator',
        email: `api-admin-${Date.now()}@example.test`,
        password: 'TestPassword123!',
        teamName: `API Test Team ${Date.now()}`,
        teamDescription: 'Temporary integration-test records',
      });
      expect(setup.status).toBe(201);
      token = setup.body.token;
      createdUserIds.push(setup.body.user.id);
      teamId = setup.body.team.id;
      createdTeamIds.push(teamId);
    } else {
      const testId = crypto.randomUUID();
      const user = await prisma.user.create({
        data: {
          name: 'Test Administrator',
          email: `api-admin-${testId}@example.test`,
          password: await hashPassword('TestPassword123!'),
        },
      });
      const team = await prisma.team.create({
        data: {
          name: `API Test Team ${testId}`,
          description: 'Temporary integration-test records',
          members: { create: { userId: user.id, role: 'ADMIN' } },
        },
      });
      createdUserIds.push(user.id);
      createdTeamIds.push(team.id);
      teamId = team.id;
      const login = await request(app).post('/api/login').send({
        email: user.email,
        password: 'TestPassword123!',
      });
      expect(login.status).toBe(200);
      token = login.body.token;
    }

    const member = await request(app)
      .post(`/api/teams/${teamId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Member',
        email: `api-member-${Date.now()}@example.test`,
        password: 'MemberPassword123!',
        role: 'MEMBER',
      });
    expect(member.status).toBe(201);
    secondUserId = member.body.member.id;
    createdUserIds.push(secondUserId);

    const viewer = await request(app)
      .post(`/api/teams/${teamId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Viewer',
        email: `api-viewer-${Date.now()}@example.test`,
        password: 'ViewerPassword123!',
        role: 'VIEWER',
      });
    expect(viewer.status).toBe(201);
    createdUserIds.push(viewer.body.member.id);
    const viewerLogin = await request(app).post('/api/login').send({
      email: viewer.body.member.email,
      password: 'ViewerPassword123!',
    });
    expect(viewerLogin.status).toBe(200);
    viewerToken = viewerLogin.body.token;
  });

  afterAll(async () => {
    if (createdWorkItemIds.length) {
      await prisma.comment.deleteMany({ where: { workItemId: { in: createdWorkItemIds } } });
      await prisma.activity.deleteMany({ where: { workItemId: { in: createdWorkItemIds } } });
      await prisma.workItem.deleteMany({ where: { id: { in: createdWorkItemIds } } });
    }
    if (createdUserIds.length) {
      await prisma.idempotencyKey.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.teamMember.deleteMany({ where: { userId: { in: createdUserIds } } });
    }
    if (createdTeamIds.length) {
      await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  it('supports first-run onboarding, authenticated team access, and one-time setup', async () => {
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ teamId, role: 'ADMIN' }),
    ]));

    const setupAgain = await request(app).post('/api/setup').send({
      name: 'Unauthorized Second Setup',
      email: `second-${Date.now()}@example.test`,
      password: 'TestPassword123!',
      teamName: `Second Team ${Date.now()}`,
    });
    expect(setupAgain.status).toBe(409);
  });

  it('creates work items idempotently and prevents stale writes', async () => {
    const payload = {
      title: 'API test operational issue',
      description: 'Integration test issue description is sufficiently long.',
      type: 'INCIDENT',
      priority: 'HIGH',
      teamId,
    };
    const first = await request(app)
      .post('/api/work-items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'api-create-work-item-test')
      .send(payload);
    expect(first.status).toBe(201);
    const itemId = first.body.item.id as string;
    createdWorkItemIds.push(itemId);

    const replay = await request(app)
      .post('/api/work-items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'api-create-work-item-test')
      .send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.item.id).toBe(itemId);

    const keyReuse = await request(app)
      .post('/api/work-items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'api-create-work-item-test')
      .send({ ...payload, title: 'Different title with same key' });
    expect(keyReuse.status).toBe(409);

    const update = await request(app)
      .patch(`/api/work-items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated API test issue', version: 1 });
    expect(update.status).toBe(200);

    const staleUpdate = await request(app)
      .patch(`/api/work-items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Stale overwrite attempt', version: 1 });
    expect(staleUpdate.status).toBe(409);

    const transition = await request(app)
      .post(`/api/work-items/${itemId}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ toStatus: 'IN_PROGRESS', expectedVersion: 2, comment: 'Starting work' });
    expect(transition.status).toBe(200);

    const staleTransition = await request(app)
      .post(`/api/work-items/${itemId}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ toStatus: 'AWAITING_APPROVAL', expectedVersion: 2 });
    expect(staleTransition.status).toBe(409);

    const approvalRequest = await request(app)
      .post(`/api/work-items/${itemId}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ toStatus: 'AWAITING_APPROVAL', expectedVersion: 3 });
    expect(approvalRequest.status).toBe(200);
    expect(await prisma.approval.count({ where: { workItemId: itemId, status: 'PENDING' } })).toBe(1);

    const approval = await request(app)
      .post(`/api/work-items/${itemId}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ toStatus: 'RESOLVED', expectedVersion: 4 });
    expect(approval.status).toBe(200);
    expect(await prisma.approval.count({ where: { workItemId: itemId, status: 'APPROVED' } })).toBe(1);
  });

  it('allows only one user to claim an unassigned item and keeps access team-scoped', async () => {
    const create = await request(app)
      .post('/api/work-items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Concurrent claim test',
        description: 'Two team users attempt to claim this work item.',
        type: 'TASK',
        priority: 'MEDIUM',
        teamId,
      });
    expect(create.status).toBe(201);
    const itemId = create.body.item.id as string;
    createdWorkItemIds.push(itemId);

    const secondLogin = await request(app).post('/api/login').send({
      email: (await prisma.user.findUniqueOrThrow({ where: { id: secondUserId } })).email,
      password: 'MemberPassword123!',
    });
    expect(secondLogin.status).toBe(200);

    const claim = (authToken: string) => request(app)
      .post(`/api/work-items/${itemId}/claim`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: 1 });
    const results = await Promise.all([claim(token), claim(secondLogin.body.token)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await prisma.workItem.count({ where: { id: itemId, assigneeId: { not: null } } })).toBe(1);

    const viewerRead = await request(app)
      .get(`/api/work-items/${itemId}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(viewerRead.status).toBe(200);
    const viewerClaim = await request(app)
      .post(`/api/work-items/${itemId}/claim`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ expectedVersion: 2 });
    expect(viewerClaim.status).toBe(403);
    const viewerComment = await request(app)
      .post(`/api/work-items/${itemId}/comments`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ content: 'Viewer should not be able to write.' });
    expect(viewerComment.status).toBe(403);

    const inaccessible = await request(app)
      .get('/api/work-items')
      .query({ teamId: 'another-team-id' })
      .set('Authorization', `Bearer ${token}`);
    expect(inaccessible.status).toBe(403);
  });
});
