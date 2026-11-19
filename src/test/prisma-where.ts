/**
 * A small Prisma-style `where` matcher for in-memory test fakes. Supports field
 * equality (null matches a missing field, Dates compare by time), `in`, `not`,
 * `gte`, `lte`, `AND`, `OR` and `NOT`, plus compound unique keys such as
 * `externalSource_externalSlug: { externalSource, externalSlug }`. Anything else
 * throws, so a fake never silently matches a query it doesn't understand.
 */
type Row = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function isPlainObject(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !(v instanceof Date) && !Array.isArray(v);
}

function compare(value: unknown, arg: unknown): number {
  const a = value instanceof Date ? value.getTime() : Number(value);
  const b = arg instanceof Date ? arg.getTime() : Number(arg);
  return a - b;
}

function matchOperator(value: unknown, op: string, arg: unknown): boolean {
  switch (op) {
    case "in":
      return (arg as unknown[]).some((x) => same(value, x));
    case "not":
      return !matchField(value, arg);
    case "gte":
      return value != null && compare(value, arg) >= 0;
    case "lte":
      return value != null && compare(value, arg) <= 0;
    default:
      throw new Error(`matchesWhere: unsupported operator "${op}"`);
  }
}

function matchField(value: unknown, cond: unknown): boolean {
  if (!isPlainObject(cond)) return same(value, cond);
  return Object.entries(cond).every(([op, arg]) => matchOperator(value, op, arg));
}

function isCompoundKey(key: string, cond: unknown): cond is Row {
  return key.includes("_") && isPlainObject(cond) && Object.keys(cond).join("_") === key;
}

export function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "AND") return (cond as Row[]).every((w) => matchesWhere(row, w));
    if (key === "OR") return (cond as Row[]).some((w) => matchesWhere(row, w));
    if (key === "NOT") return !matchesWhere(row, cond as Row);
    if (isCompoundKey(key, cond)) return matchesWhere(row, cond);
    return matchField(row[key], cond);
  });
}
