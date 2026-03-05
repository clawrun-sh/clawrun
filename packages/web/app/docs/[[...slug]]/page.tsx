import { source } from "@/lib/source";
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { ProvidersTable } from "@/components/docs/providers-table";
import { Mermaid } from "@/components/docs/mermaid";
import { ArchitectureDiagram } from "@/components/docs/architecture-diagram";
import { PackageCommand } from "@/components/docs/package-command";
import { ClickableCodeBlock } from "@/components/docs/code-block";
import { CronWakeDiagram } from "@/components/docs/cron-wake-diagram";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { TypeTable } from "fumadocs-ui/components/type-table";

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents, pre: ClickableCodeBlock, ProvidersTable, Mermaid, ArchitectureDiagram, PackageCommand, CronWakeDiagram, Steps, Step, TypeTable }} />
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

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
