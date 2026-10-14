/**
 * A mapping table as CSV (RFC 4180), the same text DirXMLDev's `mapping-table.export-csv` writes: a header of
 * column names, then one line per row, CRLF line ends, a field quoted when it holds a comma, a quote, a line
 * break or leading/trailing spaces (a quote doubled inside). `mapping-table.import-csv` reads it back.
 */
export function tableCsv(columns: string[], rows: string[][]): string {
  const field = (c: string) => (/[",\r\n]/.test(c) || /^\s|\s$/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  const line = (cells: string[]) => cells.map((c) => field(c ?? "")).join(",") + "\r\n";
  return line(columns) + rows.map((r) => line(columns.map((_, i) => r[i] ?? ""))).join("");
}
