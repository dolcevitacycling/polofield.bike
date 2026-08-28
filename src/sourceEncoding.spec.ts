import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Characters that must never appear literally in source: they are either
// invisible or indistinguishable from ASCII at a glance, so a corrupted or
// mistyped one survives review. Write them as \uXXXX escapes instead.
//
// This exists because an en dash in ctxMinuteRangeParser was silently
// flattened to an ASCII hyphen, leaving a duplicated (to|-|-) alternative and
// breaking en-dash time ranges upstream, which aborted the whole scrape.
//
// Emoji are deliberately allowed: they are visible, unambiguous, and are the
// entire point of src/emoji.ts.
const FORBIDDEN = [
  // Look-alike dashes
  [0x2010, "HYPHEN"],
  [0x2011, "NON-BREAKING HYPHEN"],
  [0x2012, "FIGURE DASH"],
  [0x2013, "EN DASH"],
  [0x2015, "HORIZONTAL BAR"],
  [0x2212, "MINUS SIGN"],
  [0xfe63, "SMALL HYPHEN-MINUS"],
  [0xff0d, "FULLWIDTH HYPHEN-MINUS"],
  // Invisible / confusable spaces
  [0x00a0, "NO-BREAK SPACE"],
  [0x2000, "EN QUAD"],
  [0x2001, "EM QUAD"],
  [0x2002, "EN SPACE"],
  [0x2003, "EM SPACE"],
  [0x2004, "THREE-PER-EM SPACE"],
  [0x2005, "FOUR-PER-EM SPACE"],
  [0x2006, "SIX-PER-EM SPACE"],
  [0x2007, "FIGURE SPACE"],
  [0x2008, "PUNCTUATION SPACE"],
  [0x2009, "THIN SPACE"],
  [0x200a, "HAIR SPACE"],
  [0x202f, "NARROW NO-BREAK SPACE"],
  [0x205f, "MEDIUM MATHEMATICAL SPACE"],
  [0x3000, "IDEOGRAPHIC SPACE"],
  // Zero-width / directionality
  [0x200b, "ZERO WIDTH SPACE"],
  [0x200c, "ZERO WIDTH NON-JOINER"],
  [0x200d, "ZERO WIDTH JOINER"],
  [0x200e, "LEFT-TO-RIGHT MARK"],
  [0x200f, "RIGHT-TO-LEFT MARK"],
  [0x2028, "LINE SEPARATOR"],
  [0x2029, "PARAGRAPH SEPARATOR"],
  [0xfeff, "ZERO WIDTH NO-BREAK SPACE"],
] as const;

const byCodePoint = new Map<number, string>(
  FORBIDDEN.map(([cp, name]) => [cp as number, name as string]),
);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("source encoding", () => {
  it("has no invisible or look-alike characters outside escapes", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
      const lines = fs.readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        for (const ch of line) {
          const name = byCodePoint.get(ch.codePointAt(0) ?? 0);
          if (name) {
            offenders.push(
              `${file}:${i + 1}: ${name} (U+${(ch.codePointAt(0) ?? 0)
                .toString(16)
                .toUpperCase()
                .padStart(4, "0")}) — write it as an escape instead`,
            );
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
