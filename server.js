import express from 'express';
import { connect } from './db.js';
import { getFlaggedTransactions, getRingGraph } from './queries.js';
import { investigate, explain } from './agent.js';

const app = express();
const cache = new Map();
const { graph } = await connect();

app.use(express.static('public'));

// 1. Is the server alive and talking to FalkorDB?
app.get('/api/health', async (req, res) => {
  try {
    const r = await graph.query('MATCH (n) RETURN count(n) AS nodes');
    res.json({ ok: true, nodes: r.data[0].nodes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 2. List of flagged transactions
app.get('/api/flagged', async (req, res) => {
  try {
    res.json(await getFlaggedTransactions(graph));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/investigate/:txnId', async (req, res) => {
  const txnId = req.params.txnId;

  if (!/^T\d{4}$/.test(txnId)) {
    return res.status(400).json({ error: 'Transaction id must look like T1017' });
  }
  if (cache.has(txnId)) return res.json(cache.get(txnId));

  try {
    const evidence = await investigate(graph, txnId);
    const explanation = await explain(evidence);
    const picture = await getRingGraph(graph, evidence.group, evidence.transaction.account);
    const answer = { ...evidence, explanation, graph: picture };
    cache.set(txnId, answer);
    res.json(answer);
  } catch (e) {
    const notFound = e.message.includes('not found');
    res.status(notFound ? 404 : 500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));