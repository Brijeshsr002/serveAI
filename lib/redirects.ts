type Query = Record<string, string | string[] | undefined>;

/**
 * Where a moved page's old address goes: its query carried over, repeats included, with `fixed` values winning.
 * The path is always one of ours, so nothing in the query can send anyone off the site.
 */
export function movedTo(path: string, query: Query = {}, fixed: Record<string, string> = {}) {
  const params = new URLSearchParams(fixed);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || Object.hasOwn(fixed, key)) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
