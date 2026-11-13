/**
 * OCR can interchange these glyphs in a receipt. Keep the original first and bound the
 * alternatives so the authoritative SMS lookup cannot become an unbounded search.
 */
export const MAX_SCREENSHOT_REFERENCE_VARIANTS = 16;

const CONFUSABLE: Readonly<Record<string, string>> = {
  '0': 'O',
  O: '0',
  '5': 'S',
  S: '5',
};

export function screenshotReferenceVariants(reference: string): readonly string[] {
  if (!/^[A-Z0-9]{10,11}$/u.test(reference) || !/[0-9]/u.test(reference)) {
    return [reference];
  }
  const positions = [...reference].flatMap((character, index) =>
    CONFUSABLE[character] ? [index] : [],
  );
  if (positions.length > 4) return [reference];

  const variants = [reference];
  for (const position of positions) {
    for (const current of [...variants]) {
      const replacement = CONFUSABLE[current[position]!];
      variants.push(`${current.slice(0, position)}${replacement}${current.slice(position + 1)}`);
    }
  }
  return variants.filter((variant) => /[0-9]/u.test(variant));
}
