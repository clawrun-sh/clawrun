"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Sun, Moon, BookOpen, Rocket, Github, MessageCircle } from "lucide-react";
import { useState } from "react";
import { useTheme } from "next-themes";
import { Logo } from "@/components/logo";

const navLinks = [
  { href: "/docs", label: "Docs" },
  {
    href: "https://github.com/clawrun-sh/clawrun",
    label: "GitHub",
    external: true,
  },
];

export function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  const isDocs = pathname?.startsWith("/docs");

  if (isDocs) {
    return (
      <nav className="sticky top-0 z-40 w-full border-b border-border bg-background/95 font-mono backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <Logo size={18} className="text-primary" />
            <Link href="/" className="text-lg font-bold text-heading no-underline">
              ClawRun
            </Link>
            <a
              href="https://github.com/clawrun-sh/clawrun"
              target="_blank"
              rel="noopener noreferrer"
              className="border border-primary px-1.5 py-0.5 text-[10px] tracking-[0.1em] text-primary no-underline transition-colors hover:bg-primary/10"
            >
              BETA
            </a>
          </div>
          {/* Desktop */}
          <div className="hidden items-center gap-5 md:flex">
            <Link
              href="/docs"
              className={`inline-flex items-center gap-1.5 text-sm no-underline transition-colors hover:text-heading ${pathname === "/docs" ? "text-heading" : "text-dim"}`}
            >
              <BookOpen size={14} aria-hidden="true" />
              Docs
            </Link>
            <Link
              href="/docs/getting-started/quickstart"
              className={`inline-flex items-center gap-1.5 text-sm no-underline transition-colors hover:text-heading ${pathname?.startsWith("/docs/getting-started") ? "text-heading" : "text-dim"}`}
            >
              <Rocket size={14} aria-hidden="true" />
              Quickstart
            </Link>
            <a
              href="https://github.com/clawrun-sh/clawrun"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-dim no-underline transition-colors hover:text-heading"
              aria-label="GitHub (opens in new tab)"
            >
              <Github size={14} aria-hidden="true" />
              GitHub
            </a>
            <a
              href="https://discord.gg/Bm5P5Md2MY"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-dim no-underline transition-colors hover:text-heading"
              aria-label="Discord (opens in new tab)"
            >
              <MessageCircle size={14} aria-hidden="true" />
              Discord
            </a>
          </div>
          {/* Mobile */}
          <div className="flex items-center gap-3 md:hidden">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="cursor-pointer border-none bg-transparent p-0"
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? (
                <X size={22} className="text-foreground" aria-hidden="true" />
              ) : (
                <Menu size={22} className="text-foreground" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        {/* Mobile menu */}
        {menuOpen && (
          <div className="flex flex-col gap-4 border-t border-border bg-background px-6 py-5 md:hidden">
            <Link
              href="/docs"
              onClick={() => setMenuOpen(false)}
              className="inline-flex items-center gap-2 text-base text-muted-foreground no-underline transition-colors hover:text-heading"
            >
              <BookOpen size={16} aria-hidden="true" />
              Docs
            </Link>
            <Link
              href="/docs/getting-started/quickstart"
              onClick={() => setMenuOpen(false)}
              className="inline-flex items-center gap-2 text-base text-muted-foreground no-underline transition-colors hover:text-heading"
            >
              <Rocket size={16} aria-hidden="true" />
              Quickstart
            </Link>
            <a
              href="https://github.com/clawrun-sh/clawrun"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="inline-flex items-center gap-2 text-base text-muted-foreground no-underline transition-colors hover:text-heading"
            >
              <Github size={16} aria-hidden="true" />
              GitHub
            </a>
            <a
              href="https://discord.gg/Bm5P5Md2MY"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="inline-flex items-center gap-2 text-base text-muted-foreground no-underline transition-colors hover:text-heading"
            >
              <MessageCircle size={16} aria-hidden="true" />
              Discord
            </a>
          </div>
        )}
      </nav>
    );
  }

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-border bg-background/95 font-mono backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6 min-[1088px]:px-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <Logo size={18} className="text-primary" />
          <Link href="/" className="text-lg font-bold text-heading no-underline">
            ClawRun
          </Link>
          <a
            href="https://github.com/clawrun-sh/clawrun"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-primary px-1.5 py-0.5 text-[10px] tracking-[0.1em] text-primary no-underline transition-colors hover:bg-primary/10"
          >
            BETA
          </a>
        </div>

        {/* Desktop */}
        <div className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-dim no-underline transition-colors hover:text-heading"
                aria-label={`${link.label} (opens in new tab)`}
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm no-underline transition-colors hover:text-heading ${
                  pathname?.startsWith(link.href) ? "text-heading" : "text-dim"
                }`}
              >
                {link.label}
              </Link>
            ),
          )}
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="flex h-9 w-9 cursor-pointer items-center justify-center border border-border bg-transparent transition-all hover:border-dim hover:bg-surface-hover active:opacity-70"
            aria-label="Toggle theme"
          >
            {resolvedTheme === "dark" ? (
              <Sun size={16} className="text-muted-foreground" aria-hidden="true" />
            ) : (
              <Moon size={16} className="text-muted-foreground" aria-hidden="true" />
            )}
          </button>
          <Link
            href="/docs/getting-started/quickstart"
            className="border border-primary bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground no-underline transition-all hover:brightness-110 active:brightness-90"
          >
            Get Started
          </Link>
        </div>

        {/* Mobile */}
        <div className="flex items-center gap-3 md:hidden">
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="flex h-9 w-9 cursor-pointer items-center justify-center border border-border bg-transparent transition-all hover:border-dim hover:bg-surface-hover active:opacity-70"
            aria-label="Toggle theme"
          >
            {resolvedTheme === "dark" ? (
              <Sun size={16} className="text-muted-foreground" aria-hidden="true" />
            ) : (
              <Moon size={16} className="text-muted-foreground" aria-hidden="true" />
            )}
          </button>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="cursor-pointer border-none bg-transparent p-0"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? (
              <X size={22} className="text-foreground" aria-hidden="true" />
            ) : (
              <Menu size={22} className="text-foreground" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="flex flex-col gap-4 border-t border-border bg-background px-6 py-5 md:hidden">
          {navLinks.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
                className="text-base text-muted-foreground no-underline transition-colors hover:text-heading"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="text-base text-muted-foreground no-underline transition-colors hover:text-heading"
              >
                {link.label}
              </Link>
            ),
          )}
        </div>
      )}
    </nav>
  );
}
