/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const DvhcvnConverterService = require('../DvhcvnConverterService');

async function main() {
  const failuresPath = process.argv[2] || path.join(process.cwd(), 'dvhcvn-convert-failures.json');
  const raw = fs.readFileSync(failuresPath, 'utf8');
  const items = JSON.parse(raw);

  const svc = new DvhcvnConverterService({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'vietnamese_administrative_units',
  });

  const stats = {
    total: 0,
    success: 0,
    invalid_input: 0,
    not_found: 0,
    ambiguous_candidate: 0,
  };

  const sample = { not_found: null, ambiguous_candidate: null };

  for (const it of items) {
    if (!it || !it.payload) continue;
    stats.total += 1;

    const res = await svc.convertWard(it.payload);
    if (res.success) {
      stats.success += 1;
      continue;
    }
    stats[res.reason] = (stats[res.reason] || 0) + 1;
    if (!sample[res.reason]) sample[res.reason] = { input: it.payload, debug: res.debug };
  }

  await svc.close();

  console.log(JSON.stringify({ stats, sample }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

