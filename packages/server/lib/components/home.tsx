import { getRuntimeConfig } from "@clawrun/runtime";

export default function Home() {
  const config = getRuntimeConfig();
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1>ClawRun is running.</h1>
      <p>Agent: {config.agent.name}</p>
    </main>
  );
}
