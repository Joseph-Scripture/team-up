import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    // Prisma defaults to a 5s interactive-transaction timeout. Remote database
    // round-trips can exceed that during slow or congested connections, which
    // surfaces as a P2028 "transaction expired" error (HTTP 500).
    timeout: 30000, // 30 seconds for the transaction body to finish
    maxWait: 30000, // 30 seconds to wait for a pooled connection / transaction start
    isolationLevel: "ReadCommitted",
  },
});
export default prisma;
