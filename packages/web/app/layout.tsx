import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import { geist, ibmPlexMono } from "@/lib/fonts";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import "./global.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://clawrun.sh"),
  title: {
    default: "ClawRun",
    template: "%s | ClawRun",
  },
  description:
    "Deploy and manage AI agents in secure sandboxes. ClawRun handles the full lifecycle — startup, keep-alive, snapshot/resume, and wake-on-message.",
  openGraph: {
    title: "ClawRun",
    description:
      "Deploy and manage AI agents in secure sandboxes. One config to deploy across any cloud.",
    url: "https://clawrun.sh",
    siteName: "ClawRun",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClawRun",
    description:
      "Deploy and manage AI agents in secure sandboxes. One config to deploy across any cloud.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${ibmPlexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <RootProvider theme={{ defaultTheme: "system" }}>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </RootProvider>
      </body>
    </html>
  );
}
