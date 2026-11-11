// The command line a Claude player starts with: locked down to its MCP server's tools, with the model
// picked for its side if any, and the MCP config that points it at its seat. The end-to-end tests play
// with scripted players in its place.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { claudeArgs, playerEnvironment, playerMcpConfig, type PlayerSpec } from "../src/player.ts";
import { loadSession } from "../src/session.ts";

const session = await loadSession(fileURLToPath(new URL("../sessions/1-8-single-actions.json", import.meta.url)));
const spec: PlayerSpec = {
  side: "plants",
  session,
  brief: "The brief.",
  prompt: "Play the level.",
  url: "http://127.0.0.1:5000/mcp/plants/token",
  dir: "C:\\runs\\match\\plants",
};

describe("playerMcpConfig", () => {
  it("gives a player its seat on the host's MCP server, over HTTP, and nothing else (D62)", () => {
    expect(JSON.parse(playerMcpConfig(spec.url))).toEqual({ mcpServers: { pvz: { type: "http", url: "http://127.0.0.1:5000/mcp/plants/token" } } });
  });
});

describe("claudeArgs", () => {
  it("starts Claude Code with only its MCP server's tools, never asking, with its brief and turn limit", () => {
    const args = claudeArgs(spec, "C:\\runs\\match\\plants\\mcp.json");
    expect(args.slice(0, 4)).toEqual(["-p", "Play the level.", "--system-prompt", "The brief."]);
    expect(args.join(" ")).toContain(`--tools  --mcp-config C:\\runs\\match\\plants\\mcp.json --strict-mcp-config --allowedTools mcp__pvz__* --permission-mode dontAsk`);
    expect(args.slice(args.indexOf("--max-turns"), args.indexOf("--max-turns") + 2)).toEqual(["--max-turns", String(session.settings.maxTurns)]);
    expect(args).not.toContain("--model"); // Claude Code's own default
  });

  it("gives it the model picked for its side (D61)", () => {
    const args = claudeArgs({ ...spec, model: "opus" }, "C:\\runs\\match\\plants\\mcp.json");
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "opus"]);
  });
});

describe("playerEnvironment", () => {
  it("starts a player as its own session on the subscription, with no memory or CLAUDE.md files and no updates of Claude Code", () => {
    const env = playerEnvironment({ PATH: "C:\\bin", ANTHROPIC_API_KEY: "key", CLAUDECODE: "1", CLAUDE_CONFIG_DIR: "C:\\profile" });
    expect(env).toEqual({
      PATH: "C:\\bin",
      CLAUDE_CONFIG_DIR: "C:\\profile", // your account's profile
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      DISABLE_AUTOUPDATER: "1",
    });
  });
});
