import Link from "next/link";
import { Logo } from "@/components/logo";

const footerLinks = {
  Product: [
    { href: "/docs", label: "Documentation" },
    { href: "/docs", label: "Quickstart" },
    { href: "#features", label: "Features" },
  ],
  Developers: [
    {
      href: "https://github.com/clawrun-sh/clawrun",
      label: "GitHub",
      external: true,
    },
    { href: "/docs", label: "API Reference" },
    { href: "/docs", label: "Examples" },
  ],
  Community: [
    { href: "https://discord.gg/clawrun", label: "Discord", external: true },
    { href: "https://x.com/clawrun", label: "Twitter", external: true },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-border bg-secondary">
      <div className="mx-auto max-w-5xl px-6 py-12 min-[1088px]:px-0 md:py-16">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {/* Brand column */}
          <div className="col-span-2 sm:col-span-1">
            <div className="mb-3 flex items-center gap-2">
              <Logo size={16} className="text-primary" aria-hidden="true" />
              <span className="font-mono text-sm font-semibold text-heading">ClawRun</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Deploy and manage AI agents in secure sandboxes.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-heading">
                {title}
              </h3>
              <ul className="flex flex-col gap-2">
                {links.map((link) => (
                  <li key={link.label}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground no-underline transition-colors hover:text-heading"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground no-underline transition-colors hover:text-heading"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom row */}
        <div className="mt-10 border-t border-border pt-6">
          <span className="text-xs text-dim">
            &copy; {new Date().getFullYear()} ClawRun. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );
}
