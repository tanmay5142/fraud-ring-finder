// All the graph queries the project depends on.
// Each one is a plain Cypher query inside a small function.

// Q1. Which transactions are flagged, and whose are they?
export async function getFlaggedTransactions(graph) {
  const r = await graph.query(`
    MATCH (a:Account)-[:MADE]->(t:Transaction {flagged: true})
    RETURN t.id AS txn, t.amount AS amount, a.id AS account
    ORDER BY t.id
  `);
  return r.data;
}

// Q2. Which other accounts are connected to this account?
// Follows only STRONG links: device, card, address (up to 4 steps).
export async function findLinkedAccounts(graph, accountId) {
  const r = await graph.query(
    `
    MATCH (a:Account {id: $id})-[:USED_DEVICE|OWNS_CARD|LIVES_AT*1..4]-(b:Account)
    WHERE b.id <> $id
    RETURN DISTINCT b.id AS id
    `,
    { params: { id: accountId } }
  );
  return r.data.map((row) => row.id);
}

// Q3. What do these accounts have in common?
// This one also shows IPs, as extra evidence.
export async function getSharedEvidence(graph, accountIds) {
  const r = await graph.query(
    `
    MATCH (a:Account)-[:USED_DEVICE|OWNS_CARD|LIVES_AT|LOGGED_IN_FROM]->(x)
    WHERE a.id IN $ids
    WITH x, labels(x)[0] AS kind, collect(DISTINCT a.id) AS accounts
    WHERE size(accounts) >= 2
    RETURN kind, x.id AS id, accounts
    ORDER BY size(accounts) DESC
    `,
    { params: { ids: accountIds } }
  );
  return r.data;
}

// Q4. How much money did the group move, compared to normal accounts?
export async function getGroupMoney(graph, accountIds) {
  const group = await graph.query(
    `
    MATCH (a:Account)-[:MADE]->(t:Transaction)
    WHERE a.id IN $ids
    RETURN count(DISTINCT a) AS accounts, count(t) AS transactions,
           sum(t.amount) AS total, avg(t.amount) AS avg_amount
    `,
    { params: { ids: accountIds } }
  );
  const normal = await graph.query(
    `
    MATCH (a:Account)-[:MADE]->(t:Transaction)
    WHERE NOT a.id IN $ids
    RETURN avg(t.amount) AS normal_avg
    `,
    { params: { ids: accountIds } }
  );
  return { ...group.data[0], normal_avg: normal.data[0].normal_avg };
}

// Q5. When were these accounts created? (rings are often made within minutes)
export async function getCreationSpanMinutes(graph, accountIds) {
  const r = await graph.query(
    `MATCH (a:Account) WHERE a.id IN $ids RETURN a.created_at AS created`,
    { params: { ids: accountIds } }
  );
  const times = r.data.map((row) => new Date(row.created).getTime());
  return Math.round((Math.max(...times) - Math.min(...times)) / 60000);
}

// Q6. The path between two accounts. This is the "explain why" part.
export async function getConnectionPath(graph, fromId, toId) {
  const r = await graph.query(
    `
    MATCH (a:Account {id: $from}), (b:Account {id: $to})
    MATCH p = (a)-[:USED_DEVICE|OWNS_CARD|LIVES_AT*1..4]-(b)
    RETURN [n IN nodes(p) | labels(n)[0] + ':' + n.id] AS path, length(p) AS len
    ORDER BY len
    LIMIT 1
    `,
    { params: { from: fromId, to: toId } }
  );
  return r.data.length ? r.data[0].path : null;
}

// Q7. Who owns this transaction?
export async function getTransactionOwner(graph, txnId) {
  const r = await graph.query(
    `
    MATCH (a:Account)-[:MADE]->(t:Transaction {id: $id})
    RETURN a.id AS account, t.amount AS amount
    `,
    { params: { id: txnId } }
  );
  return r.data[0] || null;
}

// Q8. Data for drawing the ring: accounts plus the things they share.
export async function getRingGraph(graph, accountIds, flaggedAccount) {
  const r = await graph.query(
    `
    MATCH (a:Account)-[r:USED_DEVICE|OWNS_CARD|LIVES_AT|LOGGED_IN_FROM]->(x)
    WHERE a.id IN $ids
    RETURN a.id AS account, type(r) AS rel, labels(x)[0] AS kind, x.id AS id
    `,
    { params: { ids: accountIds } }
  );

  // count how many accounts use each thing
  const useCount = {};
  for (const row of r.data) useCount[row.id] = (useCount[row.id] || 0) + 1;

  const nodes = accountIds.map((id) => ({
    id,
    kind: 'Account',
    flagged: id === flaggedAccount,
  }));
  const edges = [];
  const seen = new Set();

  for (const row of r.data) {
    if (useCount[row.id] < 2) continue; // skip things only one account has
    if (!seen.has(row.id)) {
      seen.add(row.id);
      nodes.push({ id: row.id, kind: row.kind });
    }
    edges.push({ from: row.account, to: row.id, type: row.rel });
  }
  return { nodes, edges };
}