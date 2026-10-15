import fs from 'fs';

// ---------- random helpers (seeded, so you get the same data every run) ----------
function makeRng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = makeRng(42);
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ---------- where we store everything ----------
const nodes = { Account: [], Device: [], Card: [], IP: [], Address: [], Transaction: [] };
const edges = [];
const counters = { Account: 0, Device: 0, Card: 0, Address: 0, Transaction: 0 };
const ipSet = new Set();

const nextId = (prefix, key) => prefix + String(++counters[key]).padStart(4, '0');

function addEdge(type, fromLabel, from, toLabel, to) {
  edges.push({ type, fromLabel, from, toLabel, to });
}

// ---------- small builders ----------
function newAccount(createdAt) {
  const id = nextId('A', 'Account');
  nodes.Account.push({ id, created_at: createdAt.toISOString(), status: 'active' });
  return id;
}
function newDevice() {
  const id = nextId('D', 'Device');
  nodes.Device.push({ id });
  return id;
}
function newCard() {
  const id = nextId('C', 'Card');
  nodes.Card.push({ id });
  return id;
}
function newAddress() {
  const id = nextId('ADDR', 'Address');
  nodes.Address.push({
    id,
    text: `House ${randInt(1, 300)}, Fake Layout ${randInt(1, 40)}, Testville`,
  });
  return id;
}
function newIp() {
  let id;
  do {
    id = `10.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;
  } while (ipSet.has(id));
  ipSet.add(id);
  nodes.IP.push({ id });
  return id;
}
function newTxn(accountId, cardId, amount, time) {
  const id = nextId('T', 'Transaction');
  nodes.Transaction.push({ id, amount, time: time.toISOString(), flagged: false });
  addEdge('MADE', 'Account', accountId, 'Transaction', id);
  addEdge('PAID_WITH', 'Transaction', id, 'Card', cardId);
  return id;
}

// ---------- 1. NORMAL ACCOUNTS ----------
const sharedIps = Array.from({ length: 10 }, () => newIp()); // cafes / offices
const normalAccounts = [];
const normalTxnIds = [];
const start = new Date('2026-01-01T00:00:00Z').getTime();
const end = new Date('2026-09-30T00:00:00Z').getTime();

for (let i = 0; i < 300; i++) {
  const created = new Date(start + rand() * (end - start));
  const acc = newAccount(created);

  let device, address;
  const isFamily = normalAccounts.length > 0 && rand() < 0.08;
  if (isFamily) {
    const relative = pick(normalAccounts);
    device = relative.device;
    address = relative.address;
  } else {
    device = newDevice();
    address = newAddress();
  }
  const card = newCard();
  const ip = rand() < 0.15 ? pick(sharedIps) : newIp();

  addEdge('USED_DEVICE', 'Account', acc, 'Device', device);
  addEdge('OWNS_CARD', 'Account', acc, 'Card', card);
  addEdge('LOGGED_IN_FROM', 'Account', acc, 'IP', ip);
  addEdge('LIVES_AT', 'Account', acc, 'Address', address);
  normalAccounts.push({ acc, device, address });

  const howMany = randInt(2, 5);
  for (let j = 0; j < howMany; j++) {
    const when = new Date(created.getTime() + randInt(1, 60) * 86400000);
    normalTxnIds.push(newTxn(acc, card, randInt(200, 6000), when));
  }
}

// ---------- 2. FRAUD RINGS ----------
const truth = { rings: [], falseAlarms: [] };
const ringSizes = [4, 5, 6, 7, 8];

ringSizes.forEach((size, r) => {
  const base = new Date('2026-10-02T10:00:00Z').getTime() + r * 86400000;
  const devices = [newDevice(), newDevice()];
  const muleCard = newCard();
  const dropAddress = newAddress();
  const ringIps = [newIp(), newIp()];
  const accounts = [];
  let flaggedTxn = null;

  for (let i = 0; i < size; i++) {
    const created = new Date(base + i * randInt(2, 6) * 60000);
    const acc = newAccount(created);
    accounts.push(acc);

    // devices: alternate between the 2, and account 0 uses both (this joins the ring)
    addEdge('USED_DEVICE', 'Account', acc, 'Device', devices[i % 2]);
    if (i === 0) addEdge('USED_DEVICE', 'Account', acc, 'Device', devices[1]);

    // cards: everyone has their own, every 3rd account also owns the shared mule card
    const ownCard = newCard();
    addEdge('OWNS_CARD', 'Account', acc, 'Card', ownCard);
    if (i % 3 === 0) addEdge('OWNS_CARD', 'Account', acc, 'Card', muleCard);

    // address: most share the drop address, a few have their own
    const address = rand() < 0.7 ? dropAddress : newAddress();
    addEdge('LIVES_AT', 'Account', acc, 'Address', address);

    addEdge('LOGGED_IN_FROM', 'Account', acc, 'IP', ringIps[i % 2]);

    // big transactions
    const howMany = randInt(2, 4);
    for (let j = 0; j < howMany; j++) {
      const card = i % 3 === 0 && j === 0 ? muleCard : ownCard;
      const when = new Date(created.getTime() + randInt(10, 600) * 60000);
      const txn = newTxn(acc, card, randInt(15000, 80000), when);
      if (i === 0 && j === 0) flaggedTxn = txn;
    }
  }

  nodes.Transaction.find((t) => t.id === flaggedTxn).flagged = true;
  truth.rings.push({ ring: r + 1, accounts, flaggedTxn });
});

// ---------- 3. FALSE ALARMS (flagged, but innocent) ----------
const falseSet = new Set();
while (falseSet.size < 3) falseSet.add(pick(normalTxnIds));
for (const id of falseSet) {
  nodes.Transaction.find((t) => t.id === id).flagged = true;
  truth.falseAlarms.push(id);
}

// ---------- 4. SAVE FILES ----------
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/graph-data.json', JSON.stringify({ nodes, edges }, null, 2));
fs.writeFileSync('data/truth.json', JSON.stringify(truth, null, 2));

console.log('Accounts:    ', nodes.Account.length);
console.log('Devices:     ', nodes.Device.length);
console.log('Cards:       ', nodes.Card.length);
console.log('IPs:         ', nodes.IP.length);
console.log('Addresses:   ', nodes.Address.length);
console.log('Transactions:', nodes.Transaction.length);
console.log('Edges:       ', edges.length);
console.log('Flagged txns:', nodes.Transaction.filter((t) => t.flagged).length);