import { Role, WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import prisma from '../server/lib/prisma.js';

async function main() {
  await prisma.activity.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.workItem.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  const admin = await prisma.user.create({
    data: { email: 'admin@newtonite.com', name: 'Ava Admin', password: passwordHash },
  });
  const opsLead = await prisma.user.create({
    data: { email: 'lead@newtonite.com', name: 'Liam Lead', password: passwordHash },
  });
  const memberOne = await prisma.user.create({
    data: { email: 'member1@newtonite.com', name: 'Maya Member', password: passwordHash },
  });
  const memberTwo = await prisma.user.create({
    data: { email: 'member2@newtonite.com', name: 'Noah Member', password: passwordHash },
  });
  const viewer = await prisma.user.create({
    data: { email: 'viewer@newtonite.com', name: 'Zoe Viewer', password: passwordHash },
  });

  const platformTeam = await prisma.team.create({
    data: { name: 'Platform Ops', description: 'Core platform reliability team' },
  });
  const financeTeam = await prisma.team.create({
    data: { name: 'Finance Ops', description: 'Payments and reconciliations' },
  });

  await prisma.teamMember.createMany({
    data: [
      { userId: admin.id, teamId: platformTeam.id, role: Role.ADMIN },
      { userId: opsLead.id, teamId: platformTeam.id, role: Role.LEAD },
      { userId: memberOne.id, teamId: platformTeam.id, role: Role.MEMBER },
      { userId: memberTwo.id, teamId: platformTeam.id, role: Role.MEMBER },
      { userId: viewer.id, teamId: platformTeam.id, role: Role.VIEWER },
      { userId: admin.id, teamId: financeTeam.id, role: Role.ADMIN },
      { userId: opsLead.id, teamId: financeTeam.id, role: Role.LEAD },
      { userId: memberTwo.id, teamId: financeTeam.id, role: Role.MEMBER },
      { userId: viewer.id, teamId: financeTeam.id, role: Role.VIEWER },
    ],
  });

  const workItemOne = await prisma.workItem.create({
    data: {
      title: 'API latency spike on checkout',
      description: 'Checkout API p95 latency increased above agreed threshold after 18:30 deploy.',
      type: WorkItemType.INCIDENT,
      priority: WorkItemPriority.URGENT,
      status: WorkItemStatus.OPEN,
      teamId: platformTeam.id,
      creatorId: admin.id,
      assigneeId: null,
      dueDate: new Date(Date.now() + 1000 * 60 * 60 * 2),
    },
  });

  const workItemTwo = await prisma.workItem.create({
    data: {
      title: 'Customer refund payment mismatch',
      description: 'E-commerce refunds not matching ledger totals for the last invoice batch.',
      type: WorkItemType.PAYMENT,
      priority: WorkItemPriority.HIGH,
      status: WorkItemStatus.AWAITING_APPROVAL,
      teamId: financeTeam.id,
      creatorId: opsLead.id,
      assigneeId: memberTwo.id,
      dueDate: new Date(Date.now() + 1000 * 60 * 60 * 14),
    },
  });

  const workItemThree = await prisma.workItem.create({
    data: {
      title: 'Quarterly compliance checklist',
      description: 'Finalize evidence pack for the quarterly IAM review.',
      type: WorkItemType.COMPLIANCE,
      priority: WorkItemPriority.MEDIUM,
      status: WorkItemStatus.IN_PROGRESS,
      teamId: platformTeam.id,
      creatorId: memberOne.id,
      assigneeId: memberOne.id,
      dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24),
    },
  });

  await prisma.activity.createMany({
    data: [
      { workItemId: workItemOne.id, actorId: admin.id, action: 'CREATED', details: { by: 'admin' } },
      { workItemId: workItemTwo.id, actorId: opsLead.id, action: 'CREATED', details: { by: 'lead' } },
      { workItemId: workItemThree.id, actorId: memberOne.id, action: 'ASSIGNED', details: { assignee: memberOne.name } },
    ],
  });
}

main().then(async () => {
  await prisma.$disconnect();
}).catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
