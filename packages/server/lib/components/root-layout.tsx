import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CloudClaw",
  description: "AI agent hosting platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
