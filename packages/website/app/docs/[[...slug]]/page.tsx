import { source } from "@/lib/source";
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { SquarePen, MessageCircle } from "lucide-react";
import { ProvidersTable } from "@/components/docs/providers-table";
import { Mermaid } from "@/components/docs/mermaid";
import { ArchitectureDiagram } from "@/components/docs/architecture-diagram";
import { PackageCommand } from "@/components/docs/package-command";
import { ClickableCodeBlock } from "@/components/docs/code-block";
import { CronWakeDiagram } from "@/components/docs/cron-wake-diagram";
import { LifecycleDiagram } from "@/components/docs/lifecycle-diagram";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { TypeTable } from "fumadocs-ui/components/type-table";

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const editUrl = `https://github.com/clawrun-sh/clawrun/blob/main/packages/website/content/docs/${page.path}`;

  return (
    <DocsPage
      toc={page.data.toc}
      tableOfContent={{
        footer: (
          <div className="flex flex-col gap-2 border-t border-fd-border pt-3 mt-2">
            <a
              href={editUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-xs text-fd-muted-foreground hover:text-fd-foreground transition-colors"
            >
              <SquarePen className="size-3.5" />
              Edit this page
            </a>
            <a
              href="https://github.com/clawrun-sh/clawrun/discussions"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-xs text-fd-muted-foreground hover:text-fd-foreground transition-colors"
            >
              <MessageCircle className="size-3.5" />
              Feedback
            </a>
          </div>
        ),
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={{
            ...defaultMdxComponents,
            pre: ClickableCodeBlock,
            ProvidersTable,
            Mermaid,
            ArchitectureDiagram,
            PackageCommand,
            CronWakeDiagram,
            LifecycleDiagram,
            Steps,
            Step,
            TypeTable,
          }}
        />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const ogImage = `/docs-og/${page.slugs.join("/")}`;

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: ogImage,
    },
    twitter: {
      card: "summary_large_image",
      images: ogImage,
    },
  };
}
