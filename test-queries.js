import fs from 'fs';
import { connect } from './db.js';
import {
  getFlaggedTransactions,
  findLinkedAccounts,
  getSharedEvidence,
  getGroupMoney,
  getCreationSpanMinutes,
  getConnectionPath,
} from './queries.js';

const { db, graph } = await connect();
const truth = JSON.parse(fs.readFileSync('data/truth.json', 'utf8'));

// answer key: flagged txn -> the real ring (if it is a real ring)
const ringByTxn = new Map(truth.rings.map((r) => [r.flaggedTxn, r]));

const flagged = await getFlaggedTransactions(graph);
console.log(`Found ${flagged.length} flagged transactions\n`);

let demo = null;

for (const f of flagged) {
  const linked = await findLinkedAccounts(graph, f.account);
  const group = [f.account, ...linked];
  const real = ringByTxn.get(f.txn);

  let verdict;
  if (real) {
    const same =
      real.accounts.length === group.length &&
      real.accounts.every((id) => group.includes(id));
    verdict = same
      ? `REAL RING (ring ${real.ring}) - found all ${group.length} accounts ✅`
      : `REAL RING (ring ${real.ring}) - WRONG, expected ${real.accounts.length} accounts but found ${group.length} ❌`;
    if (!demo) demo = { f, group, linked };
  } else {
    verdict = `false alarm - group size ${group.length}`;
  }
  console.log(`${f.txn} (account ${f.account}, ₹${f.amount}): ${verdict}`);
}

// Show all the evidence for the first real ring
if (demo) {
  const { f, group, linked } = demo;
  console.log(`\n===== Detail for ${f.txn} =====`);

  console.log('\nShared things:');
  console.table(await getSharedEvidence(graph, group));

  const money = await getGroupMoney(graph, group);
  console.log('Money:', money);

  const span = await getCreationSpanMinutes(graph, group);
  console.log(`All ${group.length} accounts were created within ${span} minutes`);

  const path = await getConnectionPath(graph, f.account, linked[linked.length - 1]);
  console.log('\nPath from', f.account, 'to', linked[linked.length - 1]);
  console.log(path ? path.join('  →  ') : 'no path');
}

await db.close();