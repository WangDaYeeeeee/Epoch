import { readFileSync } from "node:fs";

const [command, file] = process.argv.slice(2);
if (!command || !file || !["start", "complete", "fail", "feedback", "materialize_draft", "evaluate_proposal"].includes(command)) {
  console.error("Usage: pnpm --filter @epoch/web agent <start|complete|fail|feedback|materialize_draft|evaluate_proposal> payload.json");
  process.exitCode = 2;
} else {
  const payload = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const response = await fetch(process.env.EPOCH_AGENT_GATEWAY_URL ?? "http://127.0.0.1:3000/api/v1/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: command, ...payload }),
  });
  const body = await response.text();
  if (!response.ok) process.exitCode = 1;
  console.log(body);
}
