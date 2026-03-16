import type { MetadataRoute } from "next";
import { source } from "@/lib/source";

const BASE_URL = "https://clawrun.sh";

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = source.getPages().map((page) => ({
    url: `${BASE_URL}${page.url}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
  }));

  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
    },
    ...docs,
  ];
}
