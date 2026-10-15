import { FalkorDB } from 'falkordb';

export const GRAPH_NAME = 'fraud';

export async function connect() {
  const db = await FalkorDB.connect({
    socket: { host: 'localhost', port: 6379 },
  });
  const graph = db.selectGraph(GRAPH_NAME);
  return { db, graph };
}