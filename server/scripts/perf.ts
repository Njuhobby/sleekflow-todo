/**
 * Perf check against the seeded database (R-6.3, T-4.5).
 * Not part of the default CI run — needs the 10k seed:
 *   npm run db:seed && npm run test:perf
 *
 * Asserts p95 latency of the hot list queries at 10k+ rows.
 */
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const RUNS = 50;
const THRESHOLDS_MS = {
  defaultList: 100,
  blockedFilter: 300,
  filteredSorted: 150,
};

const CASES: Array<{ name: keyof typeof THRESHOLDS_MS; url: string }> = [
  { name: "defaultList", url: "/api/todos" },
  { name: "blockedFilter", url: "/api/todos?blocked=true&pageSize=50" },
  {
    name: "filteredSorted",
    url: "/api/todos?status=not_started,in_progress&priority=high&sortBy=dueDate&order=asc&pageSize=50",
  },
];

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

async function main() {
  const count = await prisma.todo.count();
  if (count < 10_000) {
    console.error(`Only ${count} todos in the database — run \`npm run db:seed\` first.`);
    process.exit(1);
  }

  const app = buildApp();
  await app.ready();

  let failed = false;
  for (const c of CASES) {
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      const res = await app.inject({ method: "GET", url: c.url });
      samples.push(performance.now() - start);
      if (res.statusCode !== 200) {
        console.error(`${c.name}: unexpected ${res.statusCode}`);
        process.exit(1);
      }
    }
    const value = p95(samples);
    const limit = THRESHOLDS_MS[c.name];
    const ok = value <= limit;
    if (!ok) failed = true;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(16)} p95 ${value.toFixed(1)}ms (limit ${limit}ms, n=${RUNS}, rows=${count})`
    );
  }

  await app.close();
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main();
