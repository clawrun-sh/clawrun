---
name: skills-cli
description: Use when the user asks to find, search for, or install new skills, tools, capabilities, or workflows. Triggers include "find a skill for X", "install a tool for X", "search for skills", "I need a skill for X", "extend capabilities", or any request for new agent functionality not currently available.
allowed-tools: Bash(skills:*) Bash(npm:*)
---

# Skill Finder

You have the `skills` CLI installed. Use it to discover and install agent skills when a user asks for new capabilities, tools, or workflows that you don't currently have.

## Commands

| Action  | Command                              |
|---------|--------------------------------------|
| Search  | `skills find "QUERY"`                |
| Install | `skills add owner/repo@skill-name`   |
| Remove  | `skills remove <name>`               |

## When to Activate

- User asks "how do I do X" and you don't have a skill for it
- User says "find a skill for X" or "install a tool for X"
- User wants to extend your capabilities with a new workflow
- You encounter a task that would benefit from a specialized skill

## Skill Discovery Process

**Step 1:** Identify the domain and specific task the user needs.

**Step 2:** Search for matching skills:

```bash
skills find "github"
skills find "web scraping"
skills find "csv data"
skills find "docker"
```

This searches the skills.sh registry and returns matching skills with install counts in `owner/repo@skill-name` format. Higher install counts generally indicate more reliable/popular skills.

**Step 3:** Present results to the user with skill names and descriptions. Never install without confirmation.

**Step 4:** After user confirms, install:

```bash
skills add skillhq/telegram@telegram
skills add vercel-labs/agent-skills@vercel-react-best-practices
skills add coffeefuelbump/csv-data-summarizer-claude-skill@csv-data-summarizer
```

## After Installation

The skill's SKILL.md is placed in the workspace skills directory. You will have access to its instructions on the next message. Tell the user:
1. What was installed
2. What the skill does
3. That it's ready to use

## When a Skill Needs an npm Package

Some skills reference CLI tools or libraries. If a skill requires a tool that isn't installed:

1. Try `npm install -g <package-name>` for CLI tools
2. Try `npm install <package-name>` for libraries needed in the workspace
3. Tell the user what you're installing and why

Do NOT:
- Download binaries from arbitrary URLs
- Pipe remote scripts directly into a shell interpreter
- Install packages from untrusted sources outside npm

## No-Match Scenarios

When no skills are found: acknowledge the gap, offer to help directly with the task, and suggest the user can browse https://skills.sh/ for more options.

## Important Rules

1. **Always search first** — present options to the user before installing
2. **Prefer high-install-count skills** — they're more likely to be well-maintained
3. **One skill at a time** — install and verify before adding more
4. **Tell the user what you're doing** — be transparent about searches and installs
5. **npm only for binaries** — if a skill needs a binary, install it via npm, never download directly
