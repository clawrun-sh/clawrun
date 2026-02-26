import chalk from "chalk";
import { highlight, supportsLanguage } from "cli-highlight";
import type {
  DefaultTextStyle,
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
} from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Syntax highlighting (VSCode Dark+ palette, auto-downgrades via chalk)
// ---------------------------------------------------------------------------

const syntaxTheme: Record<string, (s: string) => string> = {
  keyword: (s) => chalk.hex("#569CD6")(s),
  built_in: (s) => chalk.hex("#4EC9B0")(s),
  literal: (s) => chalk.hex("#B5CEA8")(s),
  number: (s) => chalk.hex("#B5CEA8")(s),
  string: (s) => chalk.hex("#CE9178")(s),
  comment: (s) => chalk.hex("#6A9955")(s),
  function: (s) => chalk.hex("#DCDCAA")(s),
  title: (s) => chalk.hex("#DCDCAA")(s),
  class: (s) => chalk.hex("#4EC9B0")(s),
  type: (s) => chalk.hex("#4EC9B0")(s),
  variable: (s) => chalk.hex("#9CDCFE")(s),
  params: (s) => chalk.hex("#9CDCFE")(s),
  attr: (s) => chalk.hex("#9CDCFE")(s),
  operator: (s) => chalk.hex("#D4D4D4")(s),
  punctuation: (s) => chalk.hex("#D4D4D4")(s),
};

// ---------------------------------------------------------------------------
// Component themes
// ---------------------------------------------------------------------------

export const selectListTheme: SelectListTheme = {
  selectedPrefix: (s) => chalk.hex("#8abeb7")(s),
  selectedText: (s) => chalk.hex("#8abeb7")(s),
  description: (s) => chalk.dim(s),
  scrollInfo: (s) => chalk.dim(s),
  noMatch: (s) => chalk.dim(s),
};

export const editorTheme: EditorTheme = {
  borderColor: (s) => chalk.hex("#505050")(s),
  selectList: selectListTheme,
};

export const markdownTheme: MarkdownTheme = {
  heading: (s) => chalk.bold.hex("#f0c674")(s),
  link: (s) => chalk.hex("#81a2be")(s),
  linkUrl: (s) => chalk.dim(s),
  code: (s) => chalk.hex("#8abeb7")(s),
  codeBlock: (s) => chalk.hex("#b5bd68")(s),
  codeBlockBorder: (s) => chalk.dim(s),
  quote: (s) => chalk.italic(s),
  quoteBorder: (s) => chalk.dim(s),
  hr: (s) => chalk.dim(s),
  listBullet: (s) => chalk.hex("#8abeb7")(s),
  bold: (s) => chalk.bold(s),
  italic: (s) => chalk.italic(s),
  strikethrough: (s) => chalk.strikethrough(s),
  underline: (s) => chalk.underline(s),
  codeBlockIndent: "  ",
  highlightCode: (code: string, lang?: string): string[] => {
    const validLang = lang && supportsLanguage(lang) ? lang : undefined;
    try {
      return highlight(code, {
        language: validLang,
        ignoreIllegals: true,
        theme: syntaxTheme,
      }).split("\n");
    } catch {
      return code.split("\n");
    }
  },
};

// ---------------------------------------------------------------------------
// User message style (card with background)
// ---------------------------------------------------------------------------

export const userMessageStyle: DefaultTextStyle = {
  bgColor: (s) => chalk.bgHex("#343541")(s),
};

// ---------------------------------------------------------------------------
// UI colors
// ---------------------------------------------------------------------------

export const colors = {
  error: (s: string) => chalk.hex("#cc6666")(s),
  dim: (s: string) => chalk.dim(s),
  accent: (s: string) => chalk.hex("#8abeb7")(s),
  muted: (s: string) => chalk.hex("#808080")(s),
  spinnerFn: (s: string) => chalk.hex("#00d7ff")(s),
  spinnerMsgFn: (s: string) => chalk.dim(s),
  /** Active border while agent is thinking. */
  thinkingBorder: (s: string) => chalk.hex("#5f87af")(s),
};
