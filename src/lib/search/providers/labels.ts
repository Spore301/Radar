// Display names for search providers — browser-safe, no adapter code, so the
// receipt table and the progress popup can share one mapping with the server.

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  serpapi: 'SerpAPI',
  serper: 'Serper',
  'google-headless': 'Headless Google',
  'duckduckgo-headless': 'Headless DuckDuckGo',
  none: '—',
};

/** Product name for a provider id; unknown ids are shown as they are. */
export function providerLabel(id: string | null | undefined): string {
  if (!id) return '—';
  return PROVIDER_LABELS[id] ?? id;
}
