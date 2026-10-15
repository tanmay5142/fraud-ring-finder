import fs from 'fs';
import { connect } from './db.js';

const { db, graph } = await connect();
const data = JSON.parse(fs.readFileSync('data/graph-data.json', 'utf8'));

// Which properties each kind of node has
const PROPS = {
  Account: ['id', 'created_at', 'status'],
  Device: ['id'],
  Card: ['id'],
  IP: ['id'],
  Address: ['id', 'text'],
  Transaction: ['id', 'amount', 'time', 'flagged'],
};

// Send rows to FalkorDB in small groups, not all at once
async function inBatches(rows, size, fn) {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}

// 1. Start fresh, so you can run this file again any time
try {
  await graph.delete();
  console.log('Old graph deleted.');
} catch (e) {
  console.log('No old graph found, starting fresh.');
}

// 2. Indexes make lookups by id fast
for (const label of Object.keys(PROPS)) {
  await graph.query(`CREATE INDEX FOR (n:${label}) ON (n.id)`);
}
console.log('Indexes created.');

// 3. Create the nodes
for (const [label, rows] of Object.entries(data.nodes)) {
  const props = PROPS[label].map((p) => `${p}: row.${p}`).join(', ');
  await inBatches(rows, 500, (batch) =>
    graph.query(`UNWIND $rows AS row CREATE (:${label} {${props}})`, {
      params: { rows: batch },
    })
  );
  console.log(`Loaded ${rows.length} ${label} nodes`);
}

// 4. Create the edges (group them by type and by the two node kinds)
const groups = {};
for (const e of data.edges) {
  const key = `${e.type}|${e.fromLabel}|${e.toLabel}`;
  (groups[key] ||= []).push({ from: e.from, to: e.to });
}

for (const [key, rows] of Object.entries(groups)) {
  const [type, fromLabel, toLabel] = key.split('|');
  await inBatches(rows, 500, (batch) =>
    graph.query(
      `UNWIND $rows AS row
       MATCH (a:${fromLabel} {id: row.from}), (b:${toLabel} {id: row.to})
       CREATE (a)-[:${type}]->(b)`,
      { params: { rows: batch } }
    )
  );
  console.log(`Loaded ${rows.length} ${type} edges`);
}

// 5. Check what is really in the graph
console.log('\n--- Check: nodes in FalkorDB ---');
const nodeCounts = await graph.query(
  'MATCH (n) RETURN labels(n)[0] AS label, count(n) AS total'
);
console.table(nodeCounts.data);

console.log('--- Check: edges in FalkorDB ---');
const edgeCounts = await graph.query(
  'MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS total'
);
console.table(edgeCounts.data);

console.log('--- Check: flagged transactions ---');
const flagged = await graph.query(
  'MATCH (t:Transaction {flagged: true}) RETURN count(t) AS total'
);
console.log(flagged.data);

await db.close();