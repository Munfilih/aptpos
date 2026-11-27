export async function translateEnglishToArabic(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Enter an English name first to translate.');
  }
  const response = await fetch('/api/translate/ar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: trimmed }),
  });
  const result = (await response.json()) as { translation?: unknown; error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof result.error === 'string' ? result.error : 'Arabic translation failed.'
    );
  }
  if (typeof result.translation !== 'string' || !result.translation.trim()) {
    throw new Error('Arabic translation returned an empty result.');
  }
  return result.translation.trim();
}
