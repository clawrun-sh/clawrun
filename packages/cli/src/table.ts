import chalk from "chalk";

export interface Column {
  /** Column header label (also used as row key). */
  label: string;
  /** Fixed character width for this column. */
  width: number;
  /** Optional color function applied to cell values. */
  color?: (s: string) => string;
}

export interface TableOptions {
  /** Left indent in spaces (default: 2). */
  indent?: number;
}

export interface CellValue {
  /** Raw text (used for width calculation). */
  raw: string;
  /** Display text (may include ANSI color codes). */
  display: string;
}

/** A cell can be a plain string or a {raw, display} pair for pre-colored values. */
export type Cell = string | CellValue;

/**
 * Simple CLI table with column-aligned output.
 *
 * Usage:
 *   const table = createTable([
 *     { label: "NAME", width: 28, color: chalk.cyan },
 *     { label: "STATUS", width: 14 },
 *   ]);
 *   table.row({ NAME: "my-instance", STATUS: { raw: "running", display: chalk.green("running") } });
 *   table.print();
 */
export function createTable(columns: Column[], options?: TableOptions) {
  const indent = " ".repeat(options?.indent ?? 2);
  const rows: Record<string, Cell>[] = [];

  return {
    row(values: Record<string, Cell>) {
      rows.push(values);
    },

    print() {
      // Header
      const header = columns.map((c) => c.label.padEnd(c.width)).join("");
      console.log(indent + chalk.dim(header));

      // Separator
      const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
      console.log(indent + chalk.dim("─".repeat(totalWidth)));

      // Rows
      for (const values of rows) {
        const cells = columns.map((col, i) => {
          const cell = values[col.label] ?? "";
          const raw = typeof cell === "string" ? cell : cell.raw;
          let display = typeof cell === "string" ? cell : cell.display;

          // Apply column-level color to plain string cells
          if (typeof cell === "string" && col.color) {
            display = col.color(raw);
          }

          // Last column: no padding
          if (i === columns.length - 1) return display;

          const pad = Math.max(0, col.width - raw.length);
          return display + " ".repeat(pad);
        });
        console.log(indent + cells.join(""));
      }
    },
  };
}
