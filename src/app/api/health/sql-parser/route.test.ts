import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /api/health/sql-parser", () => {
  it("parses the fixed statement with libpg_query", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "healthy", statements: ["TransactionStmt", "VariableSetStmt", "SelectStmt", "TransactionStmt"] });
  });
});
