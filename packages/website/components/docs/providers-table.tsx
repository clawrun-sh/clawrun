import { cloudProviders } from "@/components/icons/cloud-providers";

const providerStatus: Record<string, { status: string; description: string; href?: string }> = {
  Vercel: {
    status: "Supported",
    description: "Firecracker microVMs with sub-second cold start and filesystem snapshots",
    href: "https://vercel.com",
  },
  Cloudflare: { status: "Coming soon", description: "" },
  "Fly.io": { status: "Coming soon", description: "" },
  Netlify: { status: "Coming soon", description: "" },
};

const providers = cloudProviders
  .filter((p) => p.name in providerStatus)
  .map((p) => ({ ...p, ...providerStatus[p.name] }));

export function ProvidersTable() {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Status</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {providers.map(({ name, Logo, status, description, href }) => (
            <tr key={name}>
              <td>
                <span className="inline-flex items-center gap-2">
                  <Logo size={16} />
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {name}
                    </a>
                  ) : (
                    name
                  )}
                </span>
              </td>
              <td>{status}</td>
              <td>{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
