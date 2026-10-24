import '../src/config/ethereal.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { ensureSendersForUser } from '../src/services/senders.js';

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });

  if (users.length === 0) {
    console.log('[seed] No users yet. Senders are created per user on first sign-in.');
    return;
  }

  for (const user of users) {
    await ensureSendersForUser(user.id);
    const count = await prisma.sender.count({ where: { userId: user.id } });
    console.log(`[seed] ${user.email}: ${count}/${env.SENDER_COUNT} sender(s)`);
  }

  console.log('[seed] Done.');
}

main()
  .catch((error) => {
    console.error('[seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
