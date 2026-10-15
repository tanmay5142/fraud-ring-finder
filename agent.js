import {
  getTransactionOwner,
  findLinkedAccounts,
  getSharedEvidence,
  getGroupMoney,
  getCreationSpanMinutes,
  getConnectionPath,
} from './queries.js';

// ---------- The scoring rules (simple and easy to explain) ----------
function scoreCase(group, shared, money, span) {
  const reasons = [];
  const add = (points, text) => reasons.push({ points, text });

  if (group.length >= 3) add(25, `${group.length} accounts are linked through shared devices, cards or addresses`);
  else if (group.length === 2) add(10, 'Only 2 accounts are linked');

  const devices = shared.filter((s) => s.kind === 'Device');
  if (devices.length) add(Math.min(30, devices.length * 15), `${devices.length} device(s) used by more than one account`);

  const cards = shared.filter((s) => s.kind === 'Card');
  if (cards.length) add(20, `${cards.length} card(s) shared between accounts`);

  const addrs = shared.filter((s) => s.kind === 'Address');
  if (addrs.length) add(10, `${addrs.length} address(es) shared between accounts`);

  const ips = shared.filter((s) => s.kind === 'IP');
  if (ips.length) add(Math.min(10, ips.length * 5), `${ips.length} shared IP(s) (weak clue, many innocent people share IPs)`);

  if (group.length >= 2) {
    if (span <= 60) add(20, `All accounts were created within ${span} minutes of each other`);
    else if (span <= 1440) add(5, `All accounts were created within one day`);
  }

  const ratio = money.avg_amount / money.normal_avg;
  if (ratio >= 3) add(20, `Average payment is ${ratio.toFixed(1)}x higher than normal accounts`);
  else if (ratio >= 2) add(10, `Average payment is ${ratio.toFixed(1)}x higher than normal accounts`);

  const total = Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0));
  let verdict;
  if (total >= 70) verdict = 'HIGH RISK - likely fraud ring';
  else if (total >= 40) verdict = 'MEDIUM - needs a human to review';
  else verdict = 'LOW - likely innocent';

  return { score: total, verdict, reasons };
}

// ---------- The investigation ----------
export async function investigate(graph, txnId) {
  const trace = []; // every step the agent took, so we can show it later
  const log = (action, result) => trace.push({ step: trace.length + 1, action, result });

  const txn = await getTransactionOwner(graph, txnId);
  if (!txn) throw new Error(`Transaction ${txnId} not found`);
  log('Looked up the transaction owner', `${txnId} belongs to account ${txn.account}, amount ₹${txn.amount}`);

  const linked = await findLinkedAccounts(graph, txn.account);
  const group = [txn.account, ...linked];
  log('Followed device, card and address links in the graph', `Found ${linked.length} linked account(s): ${group.length} in total`);

  const shared = await getSharedEvidence(graph, group);
  log('Checked what these accounts share', `${shared.length} shared item(s)`);

  const money = await getGroupMoney(graph, group);
  log('Compared their money with normal accounts', `average ₹${Math.round(money.avg_amount)} vs normal ₹${Math.round(money.normal_avg)}`);

  const span = group.length >= 2 ? await getCreationSpanMinutes(graph, group) : null;
  if (span !== null) log('Checked when the accounts were created', `all within ${span} minutes`);

  const paths = [];
  for (const other of linked.slice(0, 3)) {
    const path = await getConnectionPath(graph, txn.account, other);
    if (path) paths.push({ to: other, path });
  }
  if (paths.length) log('Found the exact path between accounts', `${paths.length} path(s) found`);

  const result = scoreCase(group, shared, money, span);
  log('Scored the case with the rules', `${result.score}/100 → ${result.verdict}`);

  return {
    transaction: { id: txnId, amount: txn.amount, account: txn.account },
    group,
    shared,
    money,
    created_span_minutes: span,
    paths,
    ...result,
    trace,
  };
}

// ---------- Explaining in plain English ----------
function templateExplanation(ev) {
  const lines = [`Verdict: ${ev.verdict} (score ${ev.score}/100).`];
  if (ev.group.length === 1) {
    lines.push('This account is not linked to any other account by a shared device, card or address.');
  } else {
    lines.push(`Account ${ev.transaction.account} is connected to ${ev.group.length - 1} other account(s).`);
  }
  for (const r of ev.reasons) lines.push(`- ${r.text} (+${r.points})`);
  for (const p of ev.paths) lines.push(`Path: ${p.path.join(' → ')}`);
  return lines.join('\n');
}

export async function explain(ev) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return templateExplanation(ev);

  const system =
    'You are a fraud analyst assistant. You get evidence found by a graph database. ' +
    'Explain the case in simple plain English in under 150 words. ' +
    'Use ONLY the evidence given. Never invent facts. ' +
    'Mention the verdict, the strongest reasons, and describe one connection path in words. ' +
    'If the case looks innocent, say why.';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: JSON.stringify(ev, null, 2) }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  } catch (e) {
    console.log('(AI explanation failed, using the template instead:', e.message, ')');
    return templateExplanation(ev);
  }
}