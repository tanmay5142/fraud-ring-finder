import { FalkorDB } from 'falkordb';

export const GRAPH_NAME = process.env.FALKORDB_GRAPH || 'fraud';

export async function connect() {
  let options;

  if (process.env.FALKORDB_URL) {
    // one single connection link (some dashboards give you this)
    options = { url: process.env.FALKORDB_URL };
  } else {
    options = {
      socket: {
        host: process.env.FALKORDB_HOST || 'localhost',
        port: Number(process.env.FALKORDB_PORT || 6379),
      },
    };
    if (process.env.FALKORDB_USERNAME) options.username = process.env.FALKORDB_USERNAME;
    if (process.env.FALKORDB_PASSWORD) options.password = process.env.FALKORDB_PASSWORD;
  }

  const db = await FalkorDB.connect(options);
  const graph = db.selectGraph(GRAPH_NAME);
  return { db, graph };
}