import proxy from "@clawrun/server/proxy";

export default proxy;

// Turbopack requires static config — cannot re-export `config` from a library.
export const config = {
  matcher: ["/chat"],
};
