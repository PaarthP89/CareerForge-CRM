export async function notifyDiscord(message: string, source = 'Scraper'): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.warn(`[${source}] DISCORD_WEBHOOK_URL not set — skipping notification`);
    return;
  }
  const truncated =
    message.length > 1800 ? message.slice(0, 1800) + '... (truncated)' : message;
  const timestamp = new Date().toISOString();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🚨 CareerForge ${source} Alert\n${timestamp}\n${truncated}`,
      }),
    });
    if (!res.ok) {
      console.error(`[${source}] Discord webhook returned HTTP ${res.status}`);
    }
  } catch (err) {
    // Never throw — notification failure must never crash the worker
    console.error(`[${source}] Failed to send Discord notification:`, err);
  }
}
