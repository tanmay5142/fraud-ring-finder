import { connect } from './db.js';
import { getFlaggedTransactions } from './queries.js';
import { investigate, explain } from './agent.js';

const { db, graph } = await connect();
const txnArg = process.argv[2];

if (txnArg) {
  // One transaction: show everything
  const ev = await investigate(graph, txnArg);

  console.log(`\n=== Investigating ${txnArg} ===\n`);
  console.log('Steps the agent took:');
  for (const t of ev.trace) console.log(`  ${t.step}. ${t.action}\n     → ${t.result}`);

  console.log('\nWhy this score:');
  for (const r of ev.reasons) console.log(`  +${r.points}  ${r.text}`);

  console.log(`\nSCORE: ${ev.score}/100  ${ev.verdict}\n`);
  console.log('Explanation:\n');
  console.log(await explain(ev));
} else {
  // No argument: check every flagged transaction
  const flagged = await getFlaggedTransactions(graph);
  for (const f of flagged) {
    const ev = await investigate(graph, f.txn);
    console.log(`${f.txn}  group=${String(ev.group.length).padEnd(2)}  score=${String(ev.score).padEnd(3)}  ${ev.verdict}`);
  }
}

await db.close();