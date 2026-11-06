/**
 * A tiny in-memory stand-in for PrismaService, for tests ONLY. It understands exactly the query shapes central storage
 * uses (equality, in/notIn/not, contains (insensitive), lt/gt, AND/OR, orderBy, skip/take, aggregate, groupBy, increment)
 * and behaves like the database where it matters: ids auto-increment, `updated_at` is set on every update (the
 * set_updated_at trigger), and a model nobody registered throws, so code that reads a table it should not is caught.
 */
type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return (a as never) < (b as never) ? -1 : 1;
}

function matchesValue(actual: unknown, condition: unknown): boolean {
  if (!isPlainObject(condition)) return actual === condition || (actual == null && condition == null);
  return Object.entries(condition).every(([op, expected]) => {
    switch (op) {
      case 'equals':
        return actual === expected;
      case 'in':
        return (expected as unknown[]).includes(actual);
      case 'notIn':
        return actual != null && !(expected as unknown[]).includes(actual);
      case 'not':
        return !matchesValue(actual, expected);
      case 'contains': {
        const insensitive = (condition as { mode?: string }).mode === 'insensitive';
        const hay = typeof actual === 'string' ? actual : '';
        const needle = String(expected);
        return insensitive ? hay.toLowerCase().includes(needle.toLowerCase()) : hay.includes(needle);
      }
      case 'mode':
        return true;
      case 'lt':
        return actual != null && compare(actual, expected) < 0;
      case 'lte':
        return actual != null && compare(actual, expected) <= 0;
      case 'gt':
        return actual != null && compare(actual, expected) > 0;
      case 'gte':
        return actual != null && compare(actual, expected) >= 0;
      default:
        throw new Error(`fake-prisma: unsupported operator "${op}"`);
    }
  });
}

export function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === 'AND') return (condition as Where[]).every((part) => matches(row, part));
    if (key === 'OR') return (condition as Where[]).some((part) => matches(row, part));
    if (key === 'NOT') return !matches(row, condition as Where);
    return matchesValue(row[key], condition);
  });
}

export interface TableOptions {
  /** Applied to a new row before the caller's data is merged in. */
  defaults?: () => Row;
  /** Column names the table has; anything else in `data` throws (catches typos that Prisma would reject). */
  columns?: string[];
}

export class FakeTable {
  rows: Row[] = [];
  private nextId = 1n;
  readonly calls: string[] = [];

  constructor(
    readonly name: string,
    private readonly options: TableOptions = {},
  ) {}

  /** Test helper: insert a row exactly as given (plus defaults and an id). */
  seed(row: Row): Row {
    const created = { ...(this.options.defaults?.() ?? {}), ...row };
    if (created['id'] === undefined) created['id'] = this.nextId++;
    else if ((created['id'] as bigint) >= this.nextId) this.nextId = (created['id'] as bigint) + 1n;
    this.rows.push(created);
    return created;
  }

  findFirst = (args: { where?: Where; orderBy?: unknown } = {}) => {
    this.calls.push('findFirst');
    const found = this.sorted(args.orderBy).find((row) => matches(row, args.where));
    return Promise.resolve(found ? { ...found } : null); // a copy, like a real query result
  };

  findMany = (args: { where?: Where; orderBy?: unknown; skip?: number; take?: number } = {}) => {
    this.calls.push('findMany');
    const found = this.sorted(args.orderBy).filter((row) => matches(row, args.where));
    const start = args.skip ?? 0;
    return Promise.resolve(
      found.slice(start, args.take === undefined ? undefined : start + args.take).map((row) => ({ ...row })),
    );
  };

  count = (args: { where?: Where } = {}) => {
    this.calls.push('count');
    return Promise.resolve(this.rows.filter((row) => matches(row, args.where)).length);
  };

  create = (args: { data: Row }) => {
    this.calls.push('create');
    return Promise.resolve({ ...this.seed(this.assertColumns(args.data)) });
  };

  update = (args: { where: Where; data: Row }) => {
    this.calls.push('update');
    const row = this.rows.find((candidate) => matches(candidate, args.where));
    if (!row) return Promise.reject(Object.assign(new Error('Record to update not found.'), { code: 'P2025' }));
    this.apply(row, args.data);
    return Promise.resolve({ ...row });
  };

  updateMany = (args: { where?: Where; data: Row }) => {
    this.calls.push('updateMany');
    const targets = this.rows.filter((row) => matches(row, args.where));
    targets.forEach((row) => this.apply(row, args.data));
    return Promise.resolve({ count: targets.length });
  };

  deleteMany = (args: { where?: Where } = {}) => {
    this.calls.push('deleteMany');
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !matches(row, args.where));
    return Promise.resolve({ count: before - this.rows.length });
  };

  aggregate = (args: { where?: Where; _sum?: Record<string, boolean>; _count?: { _all: boolean } }) => {
    this.calls.push('aggregate');
    const found = this.rows.filter((row) => matches(row, args.where));
    const sums: Row = {};
    for (const field of Object.keys(args._sum ?? {})) {
      sums[field] = found.length === 0 ? null : found.reduce((total, row) => total + (row[field] as bigint), 0n);
    }
    return Promise.resolve({ _sum: sums, _count: { _all: found.length } });
  };

  groupBy = (args: { by: string[]; where?: Where; _sum?: Record<string, boolean> }) => {
    this.calls.push('groupBy');
    const groups = new Map<string, Row[]>();
    for (const row of this.rows.filter((candidate) => matches(candidate, args.where))) {
      const key = args.by.map((field) => String(row[field])).join('|');
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return Promise.resolve(
      [...groups.values()].map((members) => {
        const first = members[0];
        const result: Row = Object.fromEntries(args.by.map((field) => [field, first[field]]));
        result['_count'] = { _all: members.length };
        result['_sum'] = Object.fromEntries(
          Object.keys(args._sum ?? {}).map((field) => [field, members.reduce((t, r) => t + (r[field] as bigint), 0n)]),
        );
        return result;
      }),
    );
  };

  private assertColumns(data: Row): Row {
    const columns = this.options.columns;
    if (columns) {
      for (const key of Object.keys(data)) {
        if (!columns.includes(key)) throw new Error(`fake-prisma: ${this.name} has no column "${key}"`);
      }
    }
    return data;
  }

  private apply(row: Row, data: Row): void {
    this.assertColumns(data);
    for (const [key, value] of Object.entries(data)) {
      if (isPlainObject(value) && 'increment' in value) {
        const current = row[key] as bigint | number;
        // Prisma accepts a plain number for a BigInt column; do the same.
        row[key] =
          typeof current === 'bigint'
            ? current + BigInt(value['increment'] as number)
            : current + (value['increment'] as number);
      } else if (value !== undefined) row[key] = value;
    }
    row['updated_at'] = new Date(); // the set_updated_at trigger
  }

  private sorted(orderBy: unknown): Row[] {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, 'asc' | 'desc'>[];
    if (keys.length === 0) return [...this.rows];
    return [...this.rows].sort((a, b) => {
      for (const entry of keys) {
        const [field, direction] = Object.entries(entry)[0];
        const result = compare(a[field], b[field]);
        if (result !== 0) return direction === 'desc' ? -result : result;
      }
      return 0;
    });
  }
}

/**
 * Advisory-lock registry, shared by every fake "backend instance" that should see the same database. Like Postgres:
 * a transaction only waits when IT asks for a lock; two transactions that never take the same lock run at the same time.
 * (A missing lock in the code under test therefore shows up in a parallel-request test, instead of being hidden.)
 */
class Mutex {
  private readonly queues = new Map<number, Promise<void>>();
  private readonly held = new Set<number>();

  /** Waits for the lock; resolves with its release function. Released at the end of the owning transaction. */
  async acquire(key: number): Promise<() => void> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(
      key,
      previous.then(() => mine),
    );
    await previous;
    this.held.add(key);
    return () => {
      this.held.delete(key);
      release();
    };
  }

  /** pg_try_advisory_xact_lock: takes it only if it is free right now (nobody holds it or waits for it). */
  tryAcquire(key: number): (() => void) | null {
    if (this.held.has(key)) return null;
    this.held.add(key);
    return () => this.held.delete(key);
  }
}

export type FakeTables = Record<string, FakeTable>;

export interface FakePrisma {
  [model: string]: unknown;
  $transaction: (work: (tx: FakePrisma) => Promise<unknown>) => Promise<unknown>;
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
  /** Next value `nextval()` returns (central_connection ids are reserved this way). */
  nextval: bigint;
  /** The DATABASE clock (SELECT clock_timestamp()). Tests replace it to move time. */
  clock: () => Date;
  /** Every raw statement run, in order: lets a test prove a lock was taken first. */
  rawLog: string[];
}

/**
 * `shared` lets several fakes (several "backend instances") use the SAME tables and the SAME locks, to test concurrency.
 * Accessing a model that was not registered throws.
 */
export function createFakePrisma(tables: FakeTables, shared?: { mutex: Mutex }): FakePrisma {
  const locks = shared?.mutex ?? new Mutex();
  const state = { nextval: 1n, clock: () => new Date(), rawLog: [] as string[] };

  const build = (releases: (() => void)[] | null): FakePrisma => {
    const textOf = (strings: TemplateStringsArray) => strings.join('?');
    const keyOf = (values: unknown[]) => Number(values[0]);

    return new Proxy({} as FakePrisma, {
      get(_object, property: string | symbol) {
        // Nest probes providers for lifecycle hooks (onModuleDestroy, ...) and symbols: "none", not "unknown model".
        if (typeof property === 'symbol' || /^(on|before)[A-Z]/.test(property)) return undefined;
        if (property === '$transaction') {
          return async (work: (tx: FakePrisma) => Promise<unknown>) => {
            const mine: (() => void)[] = [];
            try {
              return await work(build(mine));
            } finally {
              mine.forEach((release) => release()); // advisory xact locks end with the transaction
            }
          };
        }
        if (property === '$executeRaw') {
          return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const text = textOf(strings);
            state.rawLog.push(text);
            if (text.includes('pg_advisory_xact_lock(')) {
              const release = await locks.acquire(keyOf(values));
              // Outside a transaction a real database would release an xact lock at once.
              if (releases) releases.push(release);
              else release();
            }
            return 1;
          };
        }
        if (property === '$queryRaw') {
          return (strings: TemplateStringsArray, ...values: unknown[]) => {
            const text = textOf(strings);
            state.rawLog.push(text);
            if (text.includes('clock_timestamp')) return Promise.resolve([{ now: state.clock() }]);
            if (text.includes('nextval')) return Promise.resolve([{ id: state.nextval++ }]);
            if (text.includes('pg_try_advisory_xact_lock')) {
              const release = locks.tryAcquire(keyOf(values));
              if (release) releases?.push(release);
              return Promise.resolve([{ locked: release !== null }]);
            }
            return Promise.resolve([]);
          };
        }
        if (property === 'nextval') return state.nextval;
        if (property === 'clock') return state.clock;
        if (property === 'rawLog') return state.rawLog;
        if (property === 'then') return undefined; // not a thenable
        const table = tables[property];
        if (!table) throw new Error(`fake-prisma: the code read the unregistered model "${property}"`);
        return table;
      },
      set(_object, property: string, value) {
        if (property === 'nextval') state.nextval = value as bigint;
        if (property === 'clock') state.clock = value as () => Date;
        return true;
      },
    });
  };

  return build(null);
}

export { Mutex };
