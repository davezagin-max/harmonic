/**
 * Reading delimited text the way DJ software writes it: UTF-8 with or without
 * a byte-order mark, UTF-16 (Rekordbox playlist exports), commas, semicolons or
 * tabs, quoted fields with commas, doubled quotes, and line breaks inside them.
 */

export type Delimiter = "," | ";" | "\t";

/** Bytes to text. Honours a byte-order mark and spots UTF-16 that has none. */
export function decodeText(bytes: Uint8Array): string {
  let encoding = "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  else {
    // No mark: plain-ASCII text stored as UTF-16 has a zero in every other byte.
    const sample = bytes.subarray(0, 400);
    let evenZeros = 0;
    let oddZeros = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) {
        if (i % 2 === 0) evenZeros++;
        else oddZeros++;
      }
    }
    if (oddZeros > sample.length * 0.3) encoding = "utf-16le";
    else if (evenZeros > sample.length * 0.3) encoding = "utf-16be";
  }
  return stripBom(new TextDecoder(encoding).decode(bytes));
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Picks the delimiter that splits the first non-empty line into the most fields. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine =
    stripBom(text)
      .split(/\r\n|\n|\r/)
      .find((line) => line.trim() !== "") ?? "";
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "," || char === ";" || char === "\t")) counts[char]++;
  }
  if (counts["\t"] > 0 && counts["\t"] >= counts[","] && counts["\t"] >= counts[";"]) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

/**
 * Splits delimited text into rows of fields. Blank lines are dropped.
 *
 * Quotes follow the usual CSV rules (a field that starts with a quote runs to
 * the matching quote; "" inside it is one quote). Tab-separated files are read
 * without quote handling, because DJ exports in that shape do not quote and
 * track titles often contain a bare inch mark (12" Mix).
 */
export function parseDelimited(input: string, delimiter?: Delimiter): string[][] {
  const text = stripBom(input);
  const split = delimiter ?? detectDelimiter(text);
  const quoting = split !== "\t";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStart = true;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (quoting && char === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
    } else if (char === split) {
      endField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += char;
      fieldStart = false;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
