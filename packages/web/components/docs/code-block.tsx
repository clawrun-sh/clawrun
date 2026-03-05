"use client";

import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { type ComponentProps, useCallback } from "react";

export function ClickableCodeBlock(props: ComponentProps<"pre">) {
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const btn = e.currentTarget.querySelector<HTMLButtonElement>("figure button");
    btn?.click();
  }, []);

  return (
    <div onClick={handleClick}>
      <CodeBlock {...props} className="bg-fd-secondary/50 [&_button]:cursor-pointer">
        <Pre>{props.children}</Pre>
      </CodeBlock>
    </div>
  );
}
