import { Workflow, Zap, Terminal } from "lucide-react";
import { Section } from "@/components/landing/section";
import { Hero } from "@/components/landing/hero";
import cliPkg from "../../../cli/package.json";

const cliVersion = cliPkg.version;
import { Stats } from "@/components/landing/stats";
import { Architecture } from "@/components/landing/architecture";
import { Features } from "@/components/landing/features";
import { Quickstart } from "@/components/landing/quickstart";

export default function HomePage() {
  return (
    <>
      <Section>
        <Hero version={cliVersion} />
      </Section>

      <Stats />

      <Section label="How it works" icon={Workflow} id="architecture">
        <Architecture />
      </Section>

      <Section label="Capabilities" icon={Zap} id="features" alt>
        <Features />
      </Section>

      <Section label="Quickstart" icon={Terminal} id="quickstart">
        <Quickstart />
      </Section>
    </>
  );
}
