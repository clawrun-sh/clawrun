"use client";

import {
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
} from "fumadocs-ui/components/codeblock";
import type { ReactNode } from "react";
import { ClickableCodeBlock } from "./code-block";

const items = ["npm", "pnpm", "bun"] as const;

export function PackageCommandTabs({ commands }: { commands: { code: ReactNode; raw: string }[] }) {
  return (
    <CodeBlockTabs
      groupId="pkg"
      persist
      defaultValue="npm"
      className="[&_[role=tablist]_button]:cursor-pointer"
    >
      <CodeBlockTabsList>
        {items.map((name) => (
          <CodeBlockTabsTrigger key={name} value={name}>
            {name}
          </CodeBlockTabsTrigger>
        ))}
      </CodeBlockTabsList>
      {commands.map((cmd, i) => (
        <CodeBlockTab key={items[i]} value={items[i]}>
          <ClickableCodeBlock>{cmd.code}</ClickableCodeBlock>
        </CodeBlockTab>
      ))}
    </CodeBlockTabs>
  );
}
