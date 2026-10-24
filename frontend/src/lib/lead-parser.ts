export const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export interface ParseLeadsReport {
  validEmails: string[];
  invalidLines: string[];
  duplicateCount: number;
  totalDetected: number;
}

export function parseLeadsFile(rawText: string): ParseLeadsReport {
  const lines = rawText.split(/\r?\n/);
  const seen = new Set<string>();
  const validEmails: string[] = [];
  const invalidLines: string[] = [];
  let duplicateCount = 0;
  let totalDetected = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const tokens = line.split(/[,;\t]/).map((t) => t.trim().replace(/^["']|["']$/g, ''));
    let foundEmailInLine = false;

    for (const token of tokens) {
      if (!token) continue;

      if (isValidEmail(token)) {
        foundEmailInLine = true;
        totalDetected++;
        const normalized = token.toLowerCase();

        if (seen.has(normalized)) {
          duplicateCount++;
        } else {
          seen.add(normalized);
          validEmails.push(token);
        }
      }
    }

    if (!foundEmailInLine) {

      const lower = line.toLowerCase();
      if (!lower.includes('email') && !lower.includes('recipient') && !lower.includes('lead')) {
        invalidLines.push(line);
      }
    }
  }

  return {
    validEmails,
    invalidLines,
    duplicateCount,
    totalDetected,
  };
}
