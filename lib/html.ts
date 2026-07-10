const MAX_EXTRACTED_CHARS = 20_000;
const MIN_VIABLE_CHARS = 200;

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
}

export function extractReadableText(html: string): string {
  const withoutNonContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const withoutTags = withoutNonContent.replace(/<[^>]+>/g, ' ');
  const decoded = decodeEntities(withoutTags);
  const collapsed = decoded.replace(/\s+/g, ' ').trim();

  return collapsed.slice(0, MAX_EXTRACTED_CHARS);
}

export function isViableJobDescription(text: string): boolean {
  return text.length >= MIN_VIABLE_CHARS;
}
