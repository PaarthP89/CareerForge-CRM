import type { PostgrestError } from '@supabase/supabase-js';

// PostgREST caps a single .select() at 1000 rows regardless of .limit() —
// loop with .range() until a page comes back short so tables past that cap
// aren't silently truncated.
const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  makeQuery: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error };
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: all, error: null };
}
