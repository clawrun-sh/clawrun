import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Extract command names from a SKILL.md file's allowed-tools YAML frontmatter field.
 *
 * Supports:
 * - Space-delimited string: Bash(skills:*) Bash(npm:*)
 * - YAML array: ["Bash(firecrawl *)", "Bash(npx firecrawl *)"]
 * - YAML block array with - prefixed items
 *
 * Extracts the first word inside Bash(...) before ':', ' ', or ')'.
 * Non-Bash tools are ignored.
 */
export function parseSkillCommands(skillContent: string): string[] {
  const frontmatter = extractFrontmatter(skillContent);
  if (!frontmatter) return [];

  const allowedTools = extractAllowedTools(frontmatter);
  if (!allowedTools) return [];

  const commands: string[] = [];

  for (const tool of allowedTools) {
    const cmd = extractBashCommand(tool);
    if (cmd) commands.push(cmd);
  }

  return [...new Set(commands)];
}

/**
 * Scan a skills directory for SKILL.md files in subdirectories, parse each,
 * and return a deduplicated list of command names.
 */
export function scanSkillsDirectory(skillsDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }

  const allCommands: string[] = [];

  for (const entry of entries) {
    const skillMdPath = join(skillsDir, entry, "SKILL.md");
    try {
      if (!statSync(join(skillsDir, entry)).isDirectory()) continue;
      const content = readFileSync(skillMdPath, "utf-8");
      allCommands.push(...parseSkillCommands(content));
    } catch {
      // Skip entries without SKILL.md or unreadable files
    }
  }

  return [...new Set(allCommands)];
}

/** Extract YAML frontmatter content between --- markers. */
function extractFrontmatter(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

/**
 * Extract the allowed-tools value from YAML frontmatter.
 * Returns an array of individual tool strings.
 */
function extractAllowedTools(frontmatter: string): string[] | null {
  const lines = frontmatter.split(/\r?\n/);

  // Find the line with allowed-tools:
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^allowed-tools\s*:/.test(lines[i])) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;

  const valuePart = lines[idx].replace(/^allowed-tools\s*:\s*/, "").trim();

  // Case 1: Inline YAML array
  if (valuePart.startsWith("[")) {
    return parseInlineYamlArray(valuePart);
  }

  // Case 2: Inline space-delimited string
  if (valuePart.length > 0) {
    return splitToolString(valuePart);
  }

  // Case 3: Block array on subsequent lines
  const items: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    const blockMatch = line.match(/^\s+-\s+(.*)/);
    if (blockMatch) {
      items.push(blockMatch[1].trim().replace(/^["']|["']$/g, ""));
    } else if (/^\S/.test(line)) {
      // New top-level key, stop
      break;
    }
  }

  return items.length > 0 ? items : null;
}

/** Parse a YAML inline array like ["Bash(foo *)", "Bash(bar:*)"]. */
function parseInlineYamlArray(value: string): string[] {
  // Strip outer brackets
  const inner = value.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return [];

  // Split on commas, respecting quotes
  const items: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let ci = 0; ci < inner.length; ci++) {
    const ch = inner[ci];
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = ch;
    } else if (inQuote && ch === inQuote) {
      inQuote = null;
    } else if (!inQuote && ch === ",") {
      items.push(current.trim().replace(/^["']|["']$/g, ""));
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    items.push(current.trim().replace(/^["']|["']$/g, ""));
  }

  return items;
}

/** Split a space-delimited tool string like Bash(foo:*) Bash(bar:*). */
function splitToolString(value: string): string[] {
  const items: string[] = [];
  // Match Bash(...) or bare tool names
  const regex = /\S+\([^)]*\)|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    items.push(match[0]);
  }
  return items;
}

/**
 * Extract the command name from a Bash tool pattern.
 *
 * Examples:
 * - Bash(firecrawl *) -> firecrawl
 * - Bash(gh:*) -> gh
 * - Bash(agent-browser:*) -> agent-browser
 * - Bash(npx firecrawl:*) -> npx (first word)
 *
 * Returns null for non-Bash tools.
 */
function extractBashCommand(tool: string): string | null {
  const match = tool.match(/^Bash\(([^):* ]+)/);
  return match ? match[1] : null;
}
