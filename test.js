import { FalkorDB } from 'falkordb';

const db = await FalkorDB.connect({
  socket: { host: 'localhost', port: 6379 }
});

const graph = db.selectGraph('test');

// Make two accounts that share one device
await graph.query(`
  CREATE (a1:Account {id: 'A1'}),
         (a2:Account {id: 'A2'}),
         (d:Device {id: 'D1'}),
         (a1)-[:USED_DEVICE]->(d),
         (a2)-[:USED_DEVICE]->(d)
`);

// Ask: which accounts share a device?
const result = await graph.query(`
  MATCH (a:Account)-[:USED_DEVICE]->(d:Device)<-[:USED_DEVICE]-(b:Account)
  WHERE a.id < b.id
  RETURN a.id, b.id, d.id
`);

console.log(result.data);
await db.close();