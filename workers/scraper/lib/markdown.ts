export function extractUrl(cell: string): string | null {
  const mdLink = cell.match(/\[([^\]]*)\]\(([^)]+)\)/);
  if (mdLink) {
    const url = mdLink[2].trim();
    return url || null;
  }
  const htmlAnchor = cell.match(/<a\s[^>]*href=["']([^"']+)["']/i);
  if (htmlAnchor) {
    const url = htmlAnchor[1].trim();
    return url || null;
  }
  const trimmed = cell.trim();
  if (/^https?:\/\/\S+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

// Strips markdown emphasis wrappers (bold/italic/strikethrough) around an
// already-extracted text value. Source READMEs (e.g. vanshb03) bold every
// company name in plain markdown rather than HTML, which the HTML-tag strip
// below never touches — left alone, the literal "**"/"__"/"~~" ends up
// stored verbatim in the jobs table and rendered as-is on the dashboard.
function stripMarkdownEmphasis(text: string): string {
  let result = text;
  let previous: string;
  do {
    previous = result;
    result = result
      .replace(/^\*\*\*(.+)\*\*\*$/, '$1')
      .replace(/^___(.+)___$/, '$1')
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .replace(/^__(.+)__$/, '$1')
      .replace(/^~~(.+)~~$/, '$1')
      .replace(/^\*(.+)\*$/, '$1')
      .replace(/^_(.+)_$/, '$1')
      .trim();
  } while (result !== previous);
  return result;
}

export function extractText(cell: string): string | null {
  const mdLink = cell.match(/\[([^\]]+)\]/);
  if (mdLink) return stripMarkdownEmphasis(mdLink[1].trim()) || null;
  const stripped = stripMarkdownEmphasis(cell.replace(/<[^>]+>/g, '').trim());
  return stripped || null;
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
