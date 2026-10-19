// MongoDB serving store for the analytics API (read-only use).
// MONGO_URI is a server-only secret; give it a user with the `read` role on MONGO_DATABASE.
import { MongoClient, type Db } from "mongodb";

let client: Promise<MongoClient> | undefined;

export async function analyticsDatabase(): Promise<Db> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not configured");
  // One pooled client per server process; a failed connect is retried on the next request.
  client ??= new MongoClient(uri, {
    appName: "finsight-analytics-api",
    serverSelectionTimeoutMS: 3000,
    maxPoolSize: 10,
  })
    .connect()
    .catch((error) => {
      client = undefined;
      throw error;
    });
  return (await client).db(process.env.MONGO_DATABASE || "finsight");
}
