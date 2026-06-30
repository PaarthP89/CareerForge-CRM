export function extractUrl(cell: string): string | null {
  const match = cell.match(/\[([^\]]*)\]\(([^)]+)\)/);
  if (match) {
    const url = match[2].trim();
    return url || null;
  }
  const trimmed = cell.trim();
  if (/^https?:\/\/\S+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function isSeparatorRow(line: string): boolean {
  const inner = line.trim().replace(/^\||\|$/g, '');
  return inner.split('|').every(cell => /^[\s\-:]+$/.test(cell));
}

function parseRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim());
}

export function parseMarkdownTable(markdown: string): Record<string, string>[] {
  const lines = markdown.split('\n').filter(line => line.trim().startsWith('|'));

  if (lines.length < 2) return [];

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isSeparatorRow(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) return [];

  const headers = parseRow(lines[headerIdx]).map(h => h.toLowerCase());
  const results: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (isSeparatorRow(lines[i])) continue;
    const cells = parseRow(lines[i]);
    if (cells.length === 0) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? '';
    }
    results.push(row);
  }

  return results;
}
