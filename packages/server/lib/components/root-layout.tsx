import type { Metadata } from "next";
import { ThemeProvider } from "@clawrun/ui/components/theme-provider";

export const metadata: Metadata = {
  title: "ClawRun",
  description: "AI agent hosting platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="h-dvh overflow-hidden bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
