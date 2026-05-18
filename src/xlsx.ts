import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface Worksheet {
  readonly name: string;
  readonly data: string[][];
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  // Decode numeric character references like `&#xd;` and `&#xa;` that appear
  // in formsite-style XLSX exports. Raise the default 1000-expansion guard:
  // the rainout sheet legitimately has tens of thousands of these.
  htmlEntities: true,
  processEntities: {
    enabled: true,
    maxTotalExpansions: 1_000_000,
  },
  // Force these elements to always come back as arrays so callers don't have
  // to special-case the single-element shape that fast-xml-parser produces by
  // default.
  isArray: (name) =>
    name === "row" ||
    name === "c" ||
    name === "si" ||
    name === "r" ||
    name === "t" ||
    name === "numFmt" ||
    name === "xf" ||
    name === "sheet" ||
    name === "Relationship",
});

type AnyObj = Record<string, unknown>;

function asObj(v: unknown): AnyObj | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as AnyObj)
    : undefined;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// Pulls text from an element value that may be a bare string, a number, or an
// object with a "#text" key (fast-xml-parser wraps the text in #text when the
// element also has attributes).
function getText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  const o = asObj(v);
  if (o && "#text" in o) return String(o["#text"]);
  return "";
}

function siText(si: unknown): string {
  if (typeof si === "string") return si;
  const o = asObj(si);
  if (!o) return "";
  // <t>...</t> children (one or more)
  if (o.t !== undefined) {
    return asArray(o.t).map(getText).join("");
  }
  // Rich text: <r>...</r> children each containing <t>
  if (o.r !== undefined) {
    return asArray(o.r).map(siText).join("");
  }
  return "";
}

// Excel column reference ("A", "AB", "C3") → zero-based column index.
function colFromRef(ref: string): number {
  let col = 0;
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break; // first digit ends the letter prefix
    col = col * 26 + (code - 64);
  }
  return col - 1;
}

// Excel serial → JS Date (UTC). Uses 1899-12-30 as the epoch to account for
// Excel's 1900 leap-year bug (so serial 1 maps to 1900-01-01).
function excelSerialToDate(serial: number): Date {
  const ms = Math.round(serial * 86400000);
  return new Date(Date.UTC(1899, 11, 30) + ms);
}

// Subset of Excel built-in number format ids that represent dates. See OOXML
// 18.8.30 "numFmt" for the full list; we only need the date-shaped ones.
const BUILTIN_DATE_FORMATS: Record<number, string> = {
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  22: "m/d/yyyy h:mm",
};

function isDateFormat(fmt: string): boolean {
  // Strip quoted literals and escaped chars before sniffing.
  const cleaned = fmt.replace(/"[^"]*"/g, "").replace(/\\./g, "");
  return /[dy]/i.test(cleaned);
}

// Minimal format applier — supports the date/time tokens that appear in real
// XLSX exports we care about. Unknown tokens are passed through.
function formatExcelDate(serial: number, fmt: string): string {
  const d = excelSerialToDate(serial);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const da = d.getUTCDate();
  return fmt
    .replace(/yyyy/gi, String(y))
    .replace(/yy/gi, String(y % 100).padStart(2, "0"))
    .replace(/mm/g, String(mo).padStart(2, "0"))
    .replace(/m/g, String(mo))
    .replace(/dd/gi, String(da).padStart(2, "0"))
    .replace(/d/gi, String(da));
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const f = zip.file("xl/sharedStrings.xml");
  if (!f) return [];
  const doc = xml.parse(await f.async("string"));
  const sst = asObj(asObj(doc)?.sst);
  return asArray(sst?.si as unknown).map(siText);
}

async function readDateStyleFormats(
  zip: JSZip,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const f = zip.file("xl/styles.xml");
  if (!f) return out;
  const doc = xml.parse(await f.async("string"));
  const styleSheet = asObj(asObj(doc)?.styleSheet);
  const customFmts = new Map<number, string>();
  for (const nf of asArray(asObj(styleSheet?.numFmts)?.numFmt as unknown)) {
    const o = asObj(nf);
    if (!o) continue;
    customFmts.set(parseInt(String(o["@numFmtId"]), 10), String(o["@formatCode"]));
  }
  const xfs = asArray(asObj(styleSheet?.cellXfs)?.xf as unknown);
  xfs.forEach((xf, i) => {
    const o = asObj(xf);
    if (!o) return;
    const id = parseInt(String(o["@numFmtId"]), 10);
    const code = customFmts.get(id) ?? BUILTIN_DATE_FORMATS[id];
    if (code && isDateFormat(code)) out.set(i, code);
  });
  return out;
}

function parseSheet(
  sheetXml: string,
  sharedStrings: string[],
  dateFormats: Map<number, string>,
): string[][] {
  const doc = xml.parse(sheetXml);
  const worksheet = asObj(asObj(doc)?.worksheet);
  const sheetData = asObj(worksheet?.sheetData);
  const rows = asArray(sheetData?.row as unknown);
  const out: string[][] = [];
  for (const row of rows) {
    const cells = asArray(asObj(row)?.c as unknown);
    const line: string[] = [];
    for (const cell of cells) {
      const c = asObj(cell);
      if (!c) continue;
      const ref = c["@r"];
      if (typeof ref === "string") {
        const col = colFromRef(ref);
        while (line.length < col) line.push("");
      }
      const type = c["@t"];
      let text = "";
      if (type === "s") {
        const idx = parseInt(getText(c.v), 10);
        text = sharedStrings[idx] ?? "";
      } else if (type === "inlineStr") {
        text = siText(c.is);
      } else if (type === "str") {
        text = getText(c.v);
      } else if (type === "b") {
        text = getText(c.v) === "1" ? "TRUE" : "FALSE";
      } else if (type === "e") {
        text = getText(c.v);
      } else {
        // number or untyped: apply date formatting if the style points to one
        const raw = getText(c.v);
        if (raw !== "") {
          const styleAttr = c["@s"];
          const styleIdx =
            typeof styleAttr === "string" ? parseInt(styleAttr, 10) : undefined;
          const fmt = styleIdx !== undefined ? dateFormats.get(styleIdx) : undefined;
          text = fmt ? formatExcelDate(parseFloat(raw), fmt) : raw;
        }
      }
      // Normalize line endings to LF — XLSX exports commonly carry CRLF via
      // numeric character references (&#xd;&#xa;), but our consumers and
      // existing test fixtures use plain LF.
      line.push(text.replace(/\r\n?/g, "\n"));
    }
    // Drop trailing empty cells so the row shape matches what node-xlsx /
    // SheetJS produced (rows without an Additional Information column come
    // back as 4-element arrays, not 5-element arrays with a trailing "").
    while (line.length > 0 && line[line.length - 1] === "") line.pop();
    out.push(line);
  }
  return out;
}

export async function parseXlsx(buf: ArrayBuffer): Promise<Worksheet[]> {
  const zip = await JSZip.loadAsync(buf);
  const sharedStrings = await readSharedStrings(zip);
  const dateFormats = await readDateStyleFormats(zip);

  // Map relationship ids to sheet file targets via xl/_rels/workbook.xml.rels
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  const relTarget = new Map<string, string>();
  if (relsFile) {
    const relsDoc = xml.parse(await relsFile.async("string"));
    const rels = asObj(asObj(relsDoc)?.Relationships);
    for (const r of asArray(rels?.Relationship as unknown)) {
      const o = asObj(r);
      if (!o) continue;
      relTarget.set(String(o["@Id"]), String(o["@Target"]));
    }
  }

  const wbFile = zip.file("xl/workbook.xml");
  const worksheets: Worksheet[] = [];
  if (wbFile) {
    const wbDoc = xml.parse(await wbFile.async("string"));
    const sheets = asObj(asObj(asObj(wbDoc)?.workbook)?.sheets);
    for (const sheet of asArray(sheets?.sheet as unknown)) {
      const o = asObj(sheet);
      if (!o) continue;
      const name = typeof o["@name"] === "string" ? o["@name"] : "";
      const rid = o["@r:id"] ?? o["@id"];
      const target = typeof rid === "string" ? relTarget.get(rid) : undefined;
      if (!target) continue;
      const path = target.startsWith("/")
        ? target.slice(1)
        : `xl/${target.replace(/^\.?\//, "")}`;
      const sheetFile = zip.file(path);
      if (!sheetFile) continue;
      const data = parseSheet(
        await sheetFile.async("string"),
        sharedStrings,
        dateFormats,
      );
      worksheets.push({ name, data });
    }
  }
  return worksheets;
}
