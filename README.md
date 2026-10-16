# Fraud Ring Finder

**Track: Agents That Act on Connected Data** (Graph Hacks, powered by FalkorDB)

An agent that investigates flagged transactions by following links in a graph.
It finds the other accounts connected to a suspicious one, scores the risk with
clear rules, and explains its answer using the exact path through the graph.

**Live demo:** https://fraud-ring-finder.onrender.com/
**Demo video:** [paste link]

> The free server sleeps when idle. The first load can take up to a minute.

[Fraud ring found for transaction T1017](screenshots/t1017.png)

## Why a graph?
A fraud ring is a group of accounts that secretly share devices, cards and
addresses. Finding them means following links several steps deep. In FalkorDB
this is one query. Without the graph there are no linked accounts, no scores and
no paths, so the product stops working.

## How it works
1. A transaction is flagged.
2. The agent finds all accounts linked to it through shared **devices, cards and
   addresses** (strong clues).
3. It gathers evidence: what they share, how much money they moved compared with
   normal accounts, and how close together the accounts were created.
4. Simple, visible rules give a score from 0 to 100.
5. An AI model writes a plain-English explanation. It only sees the evidence the
   graph found, so it cannot invent facts. If no AI key is set, a template
   explanation is used.

Shared **IP addresses** are treated as a weak clue only. Many innocent people
share an IP (a cafe, an office), so following IP links would glue unrelated
accounts into one fake "ring".

## Graph data model
**Nodes:** `Account`, `Device`, `Card`, `IP`, `Address`, `Transaction`

**Relationships:**
- `(Account)-[:USED_DEVICE]->(Device)`
- `(Account)-[:OWNS_CARD]->(Card)`
- `(Account)-[:LOGGED_IN_FROM]->(IP)`
- `(Account)-[:LIVES_AT]->(Address)`
- `(Account)-[:MADE]->(Transaction)`
- `(Transaction)-[:PAID_WITH]->(Card)`

[Add a picture of the model here if you have time. A simple drawing is fine.]

## Cypher queries the product depends on
All are in [`queries.js`](queries.js).

| # | Query | What it does |
|---|-------|--------------|
| 1 | `getFlaggedTransactions` | Lists flagged transactions and their accounts |
| 2 | `findLinkedAccounts` | Follows device, card and address links up to 4 steps to find the ring |
| 3 | `getSharedEvidence` | Finds what the ring members share (devices, cards, addresses, IPs) |
| 4 | `getGroupMoney` | Compares the group's payments with normal accounts |
| 5 | `getCreationSpanMinutes` | Checks how close together the accounts were created |
| 6 | `getConnectionPath` | Finds the shortest path between two accounts (the "why") |
| 7 | `getTransactionOwner` | Finds who made a transaction |
| 8 | `getRingGraph` | Gets the data to draw the ring |

The key one:
```cypher
MATCH (a:Account {id: $id})-[:USED_DEVICE|OWNS_CARD|LIVES_AT*1..4]-(b:Account)
WHERE b.id <> $id
RETURN DISTINCT b.id AS id
```

## The data
All data is **synthetic**, made by `generate.js`. It has 300 normal accounts
(including innocent traps like family members sharing a device, and shared cafe
IPs), 5 hidden fraud rings of 4 to 8 accounts, and 8 flagged transactions
(5 real fraud, 3 false alarms). `data/truth.json` is the answer key used only to
test the agent. It is never loaded into the graph.

## Test results
The agent finds all 5 rings with the exact right accounts, scores them 100, and
scores the 3 false alarms low. Run `node run-agent.js` to see it.

## Run it locally
You need Node.js 20+ and Docker.

```bash
# 1. Start FalkorDB
docker run -d --name falkordb -p 6379:6379 -p 3000:3000 \
  -v falkordb_data:/var/lib/falkordb/data falkordb/falkordb:latest

# 2. Install
npm install

# 3. Make the fake data and load it
node generate.js
node load.js

# 4. Check the queries and the agent
node test-queries.js
node run-agent.js

# 5. Start the app
npm start
# open http://localhost:4000
```

Optional: for AI-written explanations, create a `.env` file with
`ANTHROPIC_API_KEY=your-key`. Without it, a template explanation is used.

To use FalkorDB Cloud, set `FALKORDB_HOST`, `FALKORDB_PORT`,
`FALKORDB_USERNAME` and `FALKORDB_PASSWORD` (or `FALKORDB_URL`).

## Tech
Node.js, Express, FalkorDB (Cypher), plain HTML/JS front end. Hosted on Render
with FalkorDB Cloud.

## AI tools disclosure
I used an AI assistant (Claude) to help plan the project. I ran and tested everything
myself, fixed bugs. I understand and can explain the code.