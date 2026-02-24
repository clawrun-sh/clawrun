import { getRuntimeConfig } from "@cloudclaw/runtime";

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
      <h1>CloudClaw is running.</h1>
      <p>Agent: {config.agent.name}</p>
    </main>
  );
}
