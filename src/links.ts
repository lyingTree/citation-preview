function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').replace(/\.md$/i, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join('/');
}

/** Normalize a link only when it targets the current note; never accept external URLs. */
export function localLinkAnchor(target: string, sourcePath?: string): string | undefined {
  let destination: string;
  try { destination = decodeURIComponent(target); } catch { return undefined; }
  if (/^[a-z][a-z\d+.-]*:/i.test(destination) || destination.startsWith('//')) return undefined;
  const hash = destination.indexOf('#');
  if (hash < 0 || hash === destination.length - 1) return undefined;
  const path = destination.slice(0, hash);
  const anchor = destination.slice(hash + 1);
  if (!path) return anchor;
  if (!sourcePath) return undefined;
  const source = normalizePath(sourcePath);
  const normalized = normalizePath(path);
  const directory = source.slice(0, Math.max(0, source.lastIndexOf('/')));
  const relative = normalizePath(`${directory}/${path}`);
  const basename = source.slice(source.lastIndexOf('/') + 1);
  if (normalized !== source && relative !== source && !(normalized === basename && !path.includes('/'))) return undefined;
  return anchor;
}
