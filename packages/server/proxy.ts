import proxy from "@/lib/auth/middleware";

export default proxy;

// Turbopack requires static config — cannot re-export `config` from a library.
export const config = {
  matcher: ["/chat"],
};
