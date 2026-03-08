import { Logo } from "./logo";

export default function ExpiredPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <h1 className="text-2xl font-semibold mb-3">Link expired</h1>
        <p className="text-muted-foreground text-[15px] leading-relaxed">
          This invite link has expired or is invalid.
          <br />
          Generate a new one from the CLI:
        </p>
        <code className="inline-block mt-4 px-4 py-2 rounded-md bg-muted border text-sm font-mono">
          clawrun web &lt;instance&gt;
        </code>
      </div>
      <a
        href="https://clawrun.sh"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-6 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
      >
        <Logo size={18} />
        <span className="font-medium">ClawRun</span>
      </a>
    </div>
  );
}
