/**
 * Text as the assistant reads it (T-220, P-9; AI-EXECUTION-PLAN §4 "normalize"): one Unicode form,
 * no invisible characters, no runs of spaces. Done before anything reads the words — the credential
 * screen included, so a key split by an invisible character is still a key — and what is stored is
 * this text, which reads the same to the person who wrote it.
 *
 * Decides nothing: it neither shortens what was said nor guesses what was meant.
 */

/** Zero-width and directional marks, and control characters (`Cc`) other than a line break and a tab. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]|(?![\n\t])\p{Cc}/gu;

export function normalizeText(text: string): string {
  return (
    text
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      .replace(INVISIBLE, '')
      // Spaces of every width are one ordinary space; a line break stays a line break.
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
