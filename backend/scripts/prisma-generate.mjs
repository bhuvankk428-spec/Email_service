import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));

const targets = [
  {
    schema: 'prisma/schema.prisma',
    databaseUrl: 'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder',
  },
  {
    schema: 'prisma/schema.sqlite.prisma',
    databaseUrl: 'file:./dev.db',
  },
];

for (const target of targets) {
  console.log(`[prisma] generating ${target.schema}`);
  const result = spawnSync(process.execPath, [cli, 'generate', '--schema', target.schema], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: target.databaseUrl },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
