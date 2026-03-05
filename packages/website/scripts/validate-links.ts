import { printErrors, scanURLs, readFiles, validateFiles } from "next-validate-link";

async function checkLinks() {
  const scanned = await scanURLs({
    preset: "next",
  });

  const files = await readFiles("content/docs/**/*.mdx", {
    pathToUrl: (path) => {
      // content/docs/getting-started/quickstart.mdx -> /docs/getting-started/quickstart
      // content/docs/index.mdx -> /docs
      const stripped = path
        .replace(/^content\/docs\//, "/docs/")
        .replace(/\/index\.mdx$/, "")
        .replace(/\.mdx$/, "");
      return stripped || "/docs";
    },
  });

  printErrors(
    await validateFiles(files, {
      scanned,
      markdown: {
        components: {
          Card: { attributes: ["href"] },
        },
      },
      checkRelativePaths: "as-url",
    }),
    true,
  );
}

void checkLinks();
