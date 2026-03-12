---
name: find-skills
description: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.
---

# Find Skills

This skill helps you discover and install skills from the open agent skills ecosystem.

## When to Use This Skill

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Expresses interest in extending agent capabilities
- Wants to search for tools, templates, or workflows
- Mentions they wish they had help with a specific domain (design, testing, deployment, etc.)

## Commands

| Action  | Command                            |
| ------- | ---------------------------------- |
| Search  | `skills find "QUERY"`              |
| Install | `skills add owner/repo@skill-name` |
| Remove  | `skills remove <name>`             |
| Check   | `skills check`                     |
| Update  | `skills update`                    |

**Browse skills at:** https://skills.sh/

## How to Help Users Find Skills

### Step 1: Understand What They Need

When a user asks for help with something, identify:

1. The domain (e.g., React, testing, design, deployment)
2. The specific task (e.g., writing tests, creating animations, reviewing PRs)
3. Whether this is a common enough task that a skill likely exists

### Step 2: Search for Skills

Run the find command with a relevant query:

```bash
skills find "react performance"
skills find "pr review"
skills find "changelog"
```

The command will return results with install counts in `owner/repo@skill-name` format. Higher install counts generally indicate more reliable/popular skills.

### Step 3: Present Options to the User

When you find relevant skills, present them with:

1. The skill name and what it does
2. The install command
3. A link to learn more at skills.sh

**Never install without user confirmation.**

### Step 4: Install After Confirmation

```bash
skills add vercel-labs/agent-skills@vercel-react-best-practices
skills add skillhq/telegram@telegram
```

After installation, the skill's SKILL.md is placed in the workspace skills directory. Tell the user:

1. What was installed
2. What the skill does
3. That it's ready to use on the next message

## Common Skill Categories

| Category        | Example Queries                          |
| --------------- | ---------------------------------------- |
| Web Development | react, nextjs, typescript, css, tailwind |
| Testing         | testing, jest, playwright, e2e           |
| DevOps          | deploy, docker, kubernetes, ci-cd        |
| Documentation   | docs, readme, changelog, api-docs        |
| Code Quality    | review, lint, refactor, best-practices   |
| Design          | ui, ux, design-system, accessibility     |
| Productivity    | workflow, automation, git                |

## When a Skill Needs an npm Package

Some skills reference CLI tools or libraries. If a skill requires a tool that isn't installed:

1. Try `npm install -g <package-name>` for CLI tools
2. Try `npm install <package-name>` for libraries needed in the workspace
3. Tell the user what you're installing and why

Do NOT:

- Download binaries from arbitrary URLs
- Pipe remote scripts directly into a shell interpreter
- Install packages from untrusted sources outside npm

## When No Skills Are Found

If no relevant skills exist:

1. Acknowledge that no existing skill was found
2. Offer to help with the task directly using your general capabilities
3. Suggest the user can browse https://skills.sh/ for more options

## Important Rules

1. **Always search first** — present options to the user before installing
2. **Prefer high-install-count skills** — they're more likely to be well-maintained
3. **One skill at a time** — install and verify before adding more
4. **Tell the user what you're doing** — be transparent about searches and installs
5. **npm only for binaries** — if a skill needs a binary, install it via npm, never download directly
