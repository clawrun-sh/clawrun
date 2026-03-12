"use client";

import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { type ComponentProps, useCallback } from "react";

export function ClickableCodeBlock(props: ComponentProps<"pre">) {
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const btn = e.currentTarget.querySelector<HTMLButtonElement>("figure button");
    btn?.click();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const btn = e.currentTarget.querySelector<HTMLButtonElement>("figure button");
      btn?.click();
    }
  }, []);

  return (
    <div role="button" tabIndex={0} onClick={handleClick} onKeyDown={handleKeyDown}>
      <CodeBlock {...props} className="bg-fd-secondary/50 [&_button]:cursor-pointer">
        <Pre>{props.children}</Pre>
      </CodeBlock>
    </div>
  );
}
