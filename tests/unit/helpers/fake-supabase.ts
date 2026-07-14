import { vi } from 'vitest';
import type { getSupabaseServerClient } from '@/lib/supabase-server';
import type { getSupabaseAdminClient } from '@/lib/supabase-admin';
import type { getSupabaseClient } from '@/lib/supabase';

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
type SupabaseAdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
type SupabaseClient = ReturnType<typeof getSupabaseClient>;

export interface FakeResult<T = unknown> {
  data?: T | null;
  error?: { message: string; code?: string } | null;
}

// Mimics the chainable + thenable shape of a Supabase PostgrestFilterBuilder:
// every filter/modifier method returns the same object so calls can chain in
// any order, and the object itself resolves to `result` when awaited
// directly (routes that never call .single()/.maybeSingle() rely on this).
export interface FakeQueryBuilder<T = unknown> extends PromiseLike<FakeResult<T>> {
  select: (...args: unknown[]) => FakeQueryBuilder<T>;
  eq: (...args: unknown[]) => FakeQueryBuilder<T>;
  is: (...args: unknown[]) => FakeQueryBuilder<T>;
  update: (...args: unknown[]) => FakeQueryBuilder<T>;
  insert: (...args: unknown[]) => FakeQueryBuilder<T>;
  upsert: (...args: unknown[]) => FakeQueryBuilder<T>;
  delete: (...args: unknown[]) => FakeQueryBuilder<T>;
  order: (...args: unknown[]) => FakeQueryBuilder<T>;
  limit: (...args: unknown[]) => FakeQueryBuilder<T>;
  range: (...args: unknown[]) => FakeQueryBuilder<T>;
  returns: (...args: unknown[]) => FakeQueryBuilder<T>;
  single: () => Promise<FakeResult<T>>;
  maybeSingle: () => Promise<FakeResult<T>>;
}

export function makeQueryBuilder<T = unknown>(result: FakeResult<T>): FakeQueryBuilder<T> {
  const builder = {} as FakeQueryBuilder<T>;
  const chainMethods: (keyof FakeQueryBuilder<T>)[] = [
    'select', 'eq', 'is', 'update', 'insert', 'upsert', 'delete', 'order', 'limit', 'range', 'returns',
  ];
  for (const method of chainMethods) {
    (builder[method] as ReturnType<typeof vi.fn>) = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = ((onFulfilled, onRejected) =>
    Promise.resolve(result).then(onFulfilled, onRejected)) as FakeQueryBuilder<T>['then'];
  return builder;
}

export interface FakeStorageBucket {
  upload: (...args: unknown[]) => Promise<{ error: { message: string } | null }>;
  createSignedUrl: (
    ...args: unknown[]
  ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
  remove: (...args: unknown[]) => Promise<{ error: { message: string } | null }>;
}

export function makeStorageBucket(overrides: Partial<FakeStorageBucket> = {}): FakeStorageBucket {
  return {
    upload: vi.fn(async () => ({ error: null })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed.example.com/x' }, error: null })),
    remove: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

interface FakeSupabaseOptions {
  user?: { id: string } | null;
  from?: (table: string) => FakeQueryBuilder;
  storageFrom?: (bucket: string) => FakeStorageBucket;
}

function buildFakeClient(opts: FakeSupabaseOptions) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.user ?? null } })),
    },
    from: vi.fn((table: string) =>
      opts.from ? opts.from(table) : makeQueryBuilder({ data: null, error: null })
    ),
    storage: {
      from: vi.fn((bucket: string) =>
        opts.storageFrom ? opts.storageFrom(bucket) : makeStorageBucket()
      ),
    },
  };
}

export function makeFakeServerClient(opts: FakeSupabaseOptions = {}): SupabaseServerClient {
  return buildFakeClient(opts) as unknown as SupabaseServerClient;
}

export function makeFakeAdminClient(opts: FakeSupabaseOptions = {}): SupabaseAdminClient {
  return buildFakeClient(opts) as unknown as SupabaseAdminClient;
}

export function makeFakeClient(opts: FakeSupabaseOptions = {}): SupabaseClient {
  return buildFakeClient(opts) as unknown as SupabaseClient;
}
