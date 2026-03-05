import { source } from "@/lib/source";
import { generateOGImage } from "fumadocs-ui/og";
import { notFound } from "next/navigation";

export async function GET(_req: Request, props: { params: Promise<{ slug: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return generateOGImage({
    title: page.data.title,
    description: page.data.description,
    site: "ClawRun",
  });
}

export function generateStaticParams() {
  return source.generateParams().filter((params) => params.slug && params.slug.length > 0);
}
