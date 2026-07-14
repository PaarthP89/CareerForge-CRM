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

// Parses a "posted date" table cell into a real Date. Source READMEs use two
// incompatible shapes for this: a relative age like "8d"/"0d" (speedyapply's
// "Age" column counts days since posting) and a yearless short date like
// "Jul 09" (vanshb03's "Date Posted" column) — `new Date('Jul 09')` parses
// "successfully" but silently defaults to the year 2001, which would sink
// every one of that source's postings to the bottom of a posted-date sort.
export function parseDateCell(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const ageMatch = trimmed.match(/^(\d+)\s*d$/i);
  if (ageMatch) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - Number(ageMatch[1]));
    return date;
  }

  // Only a "Mon D"/"Mon DD" shape (e.g. "Jul 9", "Jul 09") is treated as a
  // yearless date — anything looser risks JS's lenient Date parser
  // misreading unrelated text as a valid date (e.g. `new Date('foo 2026')`
  // silently resolves to Jan 1 2026).
  if (/^[A-Za-z]{3,9}\.?\s+\d{1,2}(st|nd|rd|th)?$/.test(trimmed)) {
    const now = new Date();
    const withYear = new Date(`${trimmed} ${now.getUTCFullYear()}`);
    if (!isNaN(withYear.getTime())) {
      // Guards the Dec/Jan rollover: a "Dec 31" cell parsed in early January
      // would otherwise land in the future.
      if (withYear.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
        withYear.setUTCFullYear(withYear.getUTCFullYear() - 1);
      }
      return withYear;
    }
  }

  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed;
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
