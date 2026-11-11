// URL seats over real HTTP on this PC, with stand-in games: who can connect, what each seat offers, how
// its moves are counted, and how an app that connects again starts over. The end-to-end tests play a
// match through URL seats against the real game.
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { matchFromFlags, seatSession } from "../src/match.ts";
import type { Side } from "../src/session.ts";
import {
  agentsFile,
  agyLauncher,
  agySettings,
  claudeLauncher,
  claudeSettings,
  joinLines,
  openUrlSeats,
  seatFolderFiles,
  seatTools,
  windowCommand,
  type SeatSpec,
  type UrlSeats,
} from "../src/url-seats.ts";
import { sleep } from "../src/mcp/shared.ts";
import { fixture, fixtureAt } from "./fixtures/fixture.ts";
import { StandInGame } from "./stand-in-game.ts";

const match = matchFromFlags(["1-9", "--plants", "url", "--zombies", "url"]);
const opened: UrlSeats[] = [];
let moves: Record<string, unknown>[] = [];

// Each side's stand-in game shows that side's own view of 1-9 in versus, unless a test gives the zombies' own.
async function open(zombiesGame = new StandInGame(fixture("1-9-versus-midgame"))): Promise<UrlSeats> {
  const spec = (side: Side): SeatSpec => ({
    settings: seatSession(match, side, false),
    brief: `the ${side}' brief`,
    context: {
      game: side === "plants" ? new StandInGame(fixture("1-9-versus-plants")) : zombiesGame,
      clock: "realtime",
      speed: 1,
      log: (entry) => moves.push({ side, ...entry }),
    },
  });
  const seats = await openUrlSeats(
    new Map([
      ["plants", spec("plants")],
      ["zombies", spec("zombies")],
    ]),
  );
  opened.push(seats);
  return seats;
}

async function join(url: string, name = "test-app"): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client({ name, version: "1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  return { client, transport };
}

// Posts one MCP message straight to a seat's address, with the headers given, and returns the status.
function post(url: string, message: object, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const sent = request(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    sent.on("error", reject);
    sent.end(JSON.stringify(message));
  });
}

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } } };
const token = (url: string) => url.split("/").at(-1)!;

afterEach(async () => {
  for (const seats of opened.splice(0)) await seats.close();
  moves = [];
});

describe("URL seats", () => {
  it("gives each seat its own link, with a token made for this match, and only its side's tools and brief", async () => {
    const { seats } = await open();
    const plants = seats.get("plants")!;
    const zombies = seats.get("zombies")!;
    expect(plants.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/plants\/[A-Za-z0-9_-]{24}$/);
    expect(zombies.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/zombies\/[A-Za-z0-9_-]{24}$/);
    expect(token(plants.url)).not.toBe(token(zombies.url));
    // The next match's seats get new tokens (D57).
    const next = (await open()).seats;
    expect(token(next.get("plants")!.url)).not.toBe(token(plants.url));
    expect(token(next.get("zombies")!.url)).not.toBe(token(zombies.url));

    const atZombies = (await join(zombies.url)).client;
    expect((await atZombies.listTools()).tools.map((tool) => tool.name).sort()).toEqual(["get_state", "send_zombie", "wait"]);
    expect(atZombies.getInstructions()).toBe("the zombies' brief");
    const atPlants = (await join(plants.url)).client;
    expect((await atPlants.listTools()).tools.map((tool) => tool.name).sort()).toEqual(["collect_sun", "dig_up", "get_state", "place_plant", "wait"]);
    expect(atPlants.getInstructions()).toBe("the plants' brief");
  });

  it("turns away a wrong token, the other seat's token, a Host other than this PC's and a web page's Origin", async () => {
    const { seats } = await open();
    const zombies = seats.get("zombies")!.url;
    const { origin } = new URL(zombies);
    expect(await post(`${origin}/mcp/zombies/${"x".repeat(24)}`, initialize)).toBe(404);
    expect(await post(`${origin}/mcp/zombies/${token(seats.get("plants")!.url)}`, initialize)).toBe(404);
    expect(await post(`${origin}/mcp/umpire/${token(zombies)}`, initialize)).toBe(404);
    expect(await post(zombies, initialize, { host: "pvz.example.com" })).toBe(403);
    expect(await post(zombies, initialize, { origin: "https://pvz.example.com" })).toBe(403);
    // A command-line app sends no Origin; a page the server itself served would send its own.
    expect(await post(zombies, initialize)).toBe(200);
    expect(await post(zombies, initialize, { origin })).toBe(200);
  });

  it("counts each tool call as it arrives, before it's done, so a long wait counts from its start; connecting doesn't count", async () => {
    // The zombies' game has moved on half a second when the wait first looks again, a quarter of a second in.
    const seat = (await open(new StandInGame(fixture("1-9-versus-midgame"), fixtureAt("1-9-versus-midgame", 9601 + 50)))).seats.get("zombies")!;
    const { client } = await join(seat.url);
    await client.listTools();
    expect(seat.toolCalls).toBe(0);
    expect(seat.app).toBe("test-app 1.0");

    const waiting = client.callTool({ name: "wait", arguments: { seconds: 0.5 } });
    for (let i = 0; i < 40 && seat.toolCalls === 0; i++) await sleep(5);
    expect(seat.toolCalls).toBe(1);
    expect(moves).toEqual([]); // it's logged once it's done
    await waiting;
    await client.callTool({ name: "send_zombie", arguments: { zombie: "zombie", row: 2 } });
    expect(seat.toolCalls).toBe(2);
    expect(moves.map((move) => [move.side, move.tool])).toEqual([
      ["zombies", "wait"],
      ["zombies", "send_zombie"],
    ]);
  });

  it("gives an app that connects again a new session, and ends its old one (R39)", async () => {
    const seat = (await open()).seats.get("plants")!;
    const first = await join(seat.url, "first");
    const old = first.transport.sessionId!;
    const second = await join(seat.url, "second");
    expect(second.transport.sessionId).not.toBe(old);
    expect(seat.app).toBe("second 1.0");
    // A request in the old session is answered 404, which tells its app to start again.
    const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    expect(await post(seat.url, list, { "mcp-session-id": old, "mcp-protocol-version": "2025-06-18" })).toBe(404);
    expect((await second.client.listTools()).tools.length).toBe(5);
  });
});

describe("joining a URL seat", () => {
  const url = "http://127.0.0.1:50123/mcp/zombies/abc";

  const folder = "C:\\seats\\zombies";

  it("tells each app how to take the seat", () => {
    expect(joinLines("zombies", url, { claude: "C:\\runs\\match\\zombies\\claude.cmd", agy: "C:\\runs\\match\\zombies\\agy.cmd", folder })).toEqual([
      `The zombies' seat: ${url}`,
      "  Claude Code, locked down to this seat: run C:\\runs\\match\\zombies\\claude.cmd in a new terminal.",
      "  Antigravity CLI (Gemini), locked down to this seat but for web search: run C:\\runs\\match\\zombies\\agy.cmd in a new terminal.",
      "  VS Code and Cursor keep their own tools, so they aren't locked down: open C:\\seats\\zombies, whose .vscode and .cursor configs have this match's link.",
    ]);
  });

  it("lists the seat's brief, then each of its tools with the arguments it takes, for AGENTS.md", async () => {
    const spec: SeatSpec = {
      settings: seatSession(match, "zombies", false),
      brief: "the zombies' brief",
      context: { game: new StandInGame(fixture("1-9-versus-midgame")), clock: "realtime", speed: 1, log: () => {} },
    };
    const tools = await seatTools(spec);
    expect(tools.map((tool) => tool.name)).toEqual(["get_state", "send_zombie", "wait"]);
    const agents = agentsFile("The zombies' brief.\n", tools);
    expect(agents.startsWith("The zombies' brief.\n\n## Your tools\n\n### get_state\n")).toBe(true);
    expect(agents).toContain("### get_state\n\nShows your points");
    expect(agents).toContain("### send_zombie\n\nSends one of the level's zombies");
    expect(agents).toContain("- `zombie` (text, required): The zombie's name as get_state lists it, e.g. conehead_zombie.\n");
    expect(agents).toContain("- `row` (whole number from 0 to 5, required): Row, counting from 0 at the top.\n");
    expect(agents).toContain("- `col` (whole number from 0 to 8, optional): Only for bungee_zombie");
    expect(agents).toContain("- `seconds` (number from 0.1 to 30, required): Seconds of game time, from 0.1 to 30.\n");
    expect(agents.split("It takes no arguments.").length - 1).toBe(1); // get_state's
    expect(agents.endsWith("from 0.1 to 30.\n")).toBe(true);
  });

  it("writes the seat's link into its folder for Antigravity, VS Code and Cursor, each in its own format, AGENTS.md, and Antigravity's player agent", () => {
    const files = seatFolderFiles(url, "The zombies' brief and tools.\n", "zombies");
    expect(Object.keys(files).sort()).toEqual([".agents/agents/pvz-zombies.md", ".agents/mcp_config.json", ".cursor/mcp.json", ".vscode/mcp.json", "AGENTS.md"]);
    // Antigravity puts AGENTS.md into its model's instructions itself, as its player can't read files.
    expect(files["AGENTS.md"]).toBe("The zombies' brief and tools.\n");
    // Its chat hands the game to this helper agent, which has only the seat's tools and the brief as its instructions.
    expect(files[".agents/agents/pvz-zombies.md"]).toBe(
      [
        "---",
        "name: pvz-zombies",
        "description: Plays the zombies in this Plants vs. Zombies match with the game's tools. Hand it the whole game.",
        "mainAgent: false",
        "subagent: true",
        "tools: []",
        "---",
        "",
        "The zombies' brief and tools.\n",
      ].join("\n"),
    );
    expect(JSON.parse(files[".agents/mcp_config.json"]!)).toEqual({ mcpServers: { pvz: { serverUrl: url } } });
    expect(JSON.parse(files[".vscode/mcp.json"]!)).toEqual({ servers: { pvz: { type: "http", url } } });
    expect(JSON.parse(files[".cursor/mcp.json"]!)).toEqual({ mcpServers: { pvz: { url } } });
  });

  it("opens Claude Code locked down to the seat, as the players pnpm match launches are", () => {
    const lines = claudeLauncher(["C:\\bin\\claude.exe"], "C:\\runs\\match\\zombies\\mcp.json", "C:\\runs\\match\\zombies\\claude-settings.json", folder, "zombies", 'Play the zombies: 100% "now".').split("\r\n");
    expect(lines).toEqual([
      "@echo off",
      "rem Opens Claude Code to play the zombies at its seat in this match, locked down to the seat's tools.",
      "setlocal",
      `for /f "delims==" %%v in ('set CLAUDE 2^>nul') do if /i not "%%v"=="CLAUDE_CONFIG_DIR" set "%%v="`,
      "set ANTHROPIC_API_KEY=",
      "set ANTHROPIC_AUTH_TOKEN=",
      "set CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
      "set CLAUDE_CODE_DISABLE_CLAUDE_MDS=1",
      "set DISABLE_AUTOUPDATER=1",
      'if not exist "C:\\seats\\zombies" mkdir "C:\\seats\\zombies"',
      'cd /d "C:\\seats\\zombies"',
      '"C:\\bin\\claude.exe" --settings "C:\\runs\\match\\zombies\\claude-settings.json" --tools "" --mcp-config "C:\\runs\\match\\zombies\\mcp.json" --strict-mcp-config --allowedTools "mcp__pvz__*" --permission-mode dontAsk --setting-sources project "Play the zombies: 100%% \'now\'."',
      "",
    ]);
  });

  it("holds each of the chat's messages back 2 s, so its first one has the seat's tools", () => {
    expect(JSON.parse(claudeSettings("C:\\Program Files\\nodejs\\node.exe"))).toEqual({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: '"C:/Program Files/nodejs/node.exe" -e "setTimeout(() => {}, 2000)"' }] }] },
    });
  });

  it("opens Antigravity CLI in the seat's folder, with the seat's tools allowed and its own refused", () => {
    const lines = agyLauncher("C:\\bin\\agy.exe", "C:\\runs\\match\\zombies\\agy-settings.json", folder, "zombies", "Play the zombies.").split("\r\n");
    expect(lines).toEqual([
      "@echo off",
      "rem Opens Antigravity CLI to play the zombies at its seat in this match, locked down to the seat's tools.",
      "setlocal",
      'if not exist "C:\\seats\\zombies" mkdir "C:\\seats\\zombies"',
      'cd /d "C:\\seats\\zombies"',
      // Its first message hands the game to the seat's player agent.
      '"C:\\bin\\agy.exe" --settings "C:\\runs\\match\\zombies\\agy-settings.json" -i "Hand the whole game to the pvz-zombies agent, with this task, and tell me what it does: Play the zombies."',
      "",
    ]);
    // The seat's folder is trusted for the session, so its seat loads as the chat starts.
    expect(JSON.parse(agySettings(folder))).toEqual({
      permissions: { allow: ["mcp(pvz/*)"], deny: ["command(*)", "read_file(*)", "write_file(*)", "read_url(*)", "execute_url(*)"] },
      trustedWorkspaces: [folder],
    });
  });

  it("gives Claude Code and Antigravity CLI the model picked for the side, if any (D61)", () => {
    const claude = claudeLauncher(["C:\\bin\\claude.exe"], "C:\\runs\\match\\zombies\\mcp.json", "C:\\runs\\match\\zombies\\claude-settings.json", folder, "zombies", "Play the zombies.", "opus").split("\r\n");
    expect(claude.at(-2)).toBe(
      '"C:\\bin\\claude.exe" --model "opus" --settings "C:\\runs\\match\\zombies\\claude-settings.json" --tools "" --mcp-config "C:\\runs\\match\\zombies\\mcp.json" --strict-mcp-config --allowedTools "mcp__pvz__*" --permission-mode dontAsk --setting-sources project "Play the zombies."',
    );
    const agy = agyLauncher("C:\\bin\\agy.exe", "C:\\runs\\match\\zombies\\agy-settings.json", folder, "zombies", "Play the zombies.", "gpt-oss-120b-medium").split("\r\n");
    expect(agy.at(-2)).toBe(
      '"C:\\bin\\agy.exe" --settings "C:\\runs\\match\\zombies\\agy-settings.json" --model "gpt-oss-120b-medium" -i "Hand the whole game to the pvz-zombies agent, with this task, and tell me what it does: Play the zombies."',
    );
  });

  it("opens a launcher in a window of its own, titled after its side and app (D60)", () => {
    expect(windowCommand("pvz-lab zombies: Antigravity CLI", "C:\\runs\\a match\\zombies\\agy.cmd")).toBe('start "pvz-lab zombies: Antigravity CLI" "C:\\runs\\a match\\zombies\\agy.cmd"');
  });
});
