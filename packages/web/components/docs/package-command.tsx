import { highlight } from "fumadocs-core/highlight";
import { PackageCommandTabs } from "./package-command-client";
import type { ReactNode } from "react";

function transform(npm: string, target: "pnpm" | "bun"): string {
  let cmd = npm;

  if (target === "pnpm") {
    cmd = cmd.replace(/\bnpm install\b/g, "pnpm add");
    cmd = cmd.replace(/\bnpx\b/g, "pnpm dlx");
    cmd = cmd.replace(/\bnpm run\b/g, "pnpm");
  } else {
    cmd = cmd.replace(/\bnpm install\b/g, "bun add");
    cmd = cmd.replace(/\bnpx\b/g, "bunx");
    cmd = cmd.replace(/\bnpm run\b/g, "bun run");
  }

  return cmd;
}

// Strip the <pre> wrapper from Shiki output so CodeBlock/Pre can provide their own
const components = {
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
};

export async function PackageCommand({ cmd }: { cmd: string }) {
  const pnpmCmd = transform(cmd, "pnpm");
  const bunCmd = transform(cmd, "bun");

  const [npmCode, pnpmCode, bunCode] = await Promise.all([
    highlight(cmd, { lang: "bash", components }),
    highlight(pnpmCmd, { lang: "bash", components }),
    highlight(bunCmd, { lang: "bash", components }),
  ]);

  return (
    <PackageCommandTabs
      commands={[
        { code: npmCode, raw: cmd },
        { code: pnpmCode, raw: pnpmCmd },
        { code: bunCode, raw: bunCmd },
      ]}
    />
  );
}
