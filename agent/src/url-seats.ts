// URL seats: pnpm match serves a side's MCP server over HTTP on this PC, so any MCP app can take that
// seat by its link, http://127.0.0.1:<port>/mcp/<side>/<token>. Each seat has its own random token, made
// for this match only (D57), so a player can't reach the other side's seat by changing the side in its
// link. Only this PC can connect: the server listens on 127.0.0.1, the SDK's Express app turns away any
// Host but this PC's own names, and a request from a web page is refused unless the page is this server's
// own (Origin, D30).
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Response } from "express";
import { createSeatServer } from "./mcp/seat-server.ts";
import type { ToolContext } from "./mcp/shared.ts";
import type { Session, Side } from "./session.ts";

// What a URL seat plays with: its side's session, its brief, and the context its tools play in.
export interface SeatSpec {
  settings: Session;
  brief: string;
  context: ToolContext;
}

export interface UrlSeat {
  readonly side: Side;
  readonly url: string;
  // Tool calls made at the seat, counted as they arrive, so a long wait counts from its start (D56).
  toolCalls: number;
  app?: string; // the app at the seat, as it names itself when it connects, such as "claude-code 2.1.310"
}

export interface UrlSeats {
  seats: Map<Side, UrlSeat>;
  close(): Promise<void>;
}

interface Seat extends UrlSeat {
  token: string;
  spec: SeatSpec;
  current?: { server: McpServer; transport: StreamableHTTPServerTransport };
}

// A seat's token: 144 random bits, in characters a URL path takes as they are.
export function newToken(): string {
  return randomBytes(18).toString("base64url");
}

function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function refuse(res: Response, status: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

// Opens a seat for each side given, on a port the system picks. onJoin hears of each app that connects.
export async function openUrlSeats(specs: Map<Side, SeatSpec>, onJoin?: (side: Side, app: string) => void): Promise<UrlSeats> {
  const seats = new Map<Side, Seat>();
  const ownOrigins = new Set<string>();

  const app = createMcpExpressApp(); // on 127.0.0.1, with the SDK's Host check
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === undefined || ownOrigins.has(origin)) next();
    else refuse(res, 403, `Requests from ${origin} aren't allowed`);
  });
  app.all("/mcp/:side/:token", async (req, res) => {
    const seat = seats.get(req.params.side as Side);
    if (!seat || !sameToken(req.params.token, seat.token)) return refuse(res, 404, "There's no seat at this address");
    if (req.method === "POST" && isInitializeRequest(req.body)) {
      // Each initialize starts a new session for the seat, and ends the one it had (R39).
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      const server = createSeatServer(seat.spec.settings, seat.spec.brief, seat.spec.context, true);
      await server.connect(transport);
      const old = seat.current;
      seat.current = { server, transport };
      await old?.server.close();
      await transport.handleRequest(req, res, req.body);
      const client = server.server.getClientVersion();
      seat.app = client ? `${client.name} ${client.version}` : "An app";
      onJoin?.(seat.side, seat.app);
      return;
    }
    // A request for a session that has ended is answered 404, so its app starts a new one.
    if (!seat.current) return refuse(res, 404, "Session not found");
    if (req.method === "POST" && req.headers["mcp-session-id"] === seat.current.transport.sessionId) {
      const messages: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
      seat.toolCalls += messages.filter((message) => (message as { method?: string } | undefined)?.method === "tools/call").length;
    }
    await seat.current.transport.handleRequest(req, res, req.body);
  });

  const http = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", (error) => (error ? reject(error) : resolve(listening)));
  });
  const { port } = http.address() as AddressInfo;
  ownOrigins.add(`http://127.0.0.1:${port}`);
  ownOrigins.add(`http://localhost:${port}`);

  for (const [side, spec] of specs) {
    const token = newToken();
    seats.set(side, { side, url: `http://127.0.0.1:${port}/mcp/${side}/${token}`, toolCalls: 0, token, spec });
  }

  return {
    seats,
    async close() {
      for (const seat of seats.values()) await seat.current?.server.close();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

// The files an app finds the seat's link and brief in when it plays from the seat's own folder, by path
// within that folder: Antigravity's workspace config, VS Code's and Cursor's, AGENTS.md (agentsFile),
// which apps such as Antigravity put into their model's instructions themselves, and Antigravity's player
// agent (agyPlayerAgent). Each match writes them afresh.
export function seatFolderFiles(url: string, agents: string, side: Side): Record<string, string> {
  const json = (content: object) => `${JSON.stringify(content, null, 2)}\n`;
  return {
    ".agents/mcp_config.json": json({ mcpServers: { pvz: { serverUrl: url } } }),
    ".vscode/mcp.json": json({ servers: { pvz: { type: "http", url } } }),
    ".cursor/mcp.json": json({ mcpServers: { pvz: { url } } }),
    "AGENTS.md": agents,
    [`.agents/agents/pvz-${side}.md`]: agyPlayerAgent(side, agents),
  };
}

// The agent that plays a seat in Antigravity: a helper agent with no tools of its own, so only the seat's
// (no shell, files, web search or helpers of its own), and the seat's brief and tools as its instructions.
// Antigravity's chat hands it the game (agyLauncher): a chat never had the seat's tools itself, even when
// it waited, but a helper it starts has them from its first turn (Antigravity CLI 1.5.5, 11 Nov 2026).
export function agyPlayerAgent(side: Side, instructions: string): string {
  return [
    "---",
    `name: pvz-${side}`,
    `description: Plays the ${side} in this Plants vs. Zombies match with the game's tools. Hand it the whole game.`,
    "mainAgent: false",
    "subagent: true",
    "tools: []",
    "---",
    "",
    instructions,
  ].join("\n");
}

// The tools a seat offers, as an app that connects to it lists them.
export async function seatTools(spec: SeatSpec): Promise<Tool[]> {
  const server = createSeatServer(spec.settings, spec.brief, spec.context, true);
  const client = new Client({ name: "pvz-lab", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

interface JsonProperty {
  type?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  items?: JsonProperty;
}

// What a tool's argument takes, in words.
function kind(property: JsonProperty): string {
  const range = property.minimum !== undefined && property.maximum !== undefined ? ` from ${property.minimum} to ${property.maximum}` : "";
  if (property.enum) return `one of ${property.enum.join(", ")}`;
  if (property.type === "integer") return `whole number${range}`;
  if (property.type === "number") return `number${range}`;
  if (property.type === "string") return "text";
  if (property.type === "array") return `list of ${property.items ? kind(property.items) : "values"}`;
  return property.type ?? "value";
}

// A seat's AGENTS.md: its brief, then each of its tools and the arguments it takes. Antigravity doesn't
// hand its model the server's instructions or the tools' arguments: it saves them to files, which its
// player can't read, as file reads are denied (11 Nov 2026). Other apps get them from the server too.
export function agentsFile(brief: string, tools: Tool[]): string {
  const lines = [brief.trimEnd(), "", "## Your tools", ""];
  for (const tool of tools) {
    lines.push(`### ${tool.name}`, "");
    if (tool.description) lines.push(tool.description, "");
    const properties = Object.entries(tool.inputSchema.properties ?? {}) as [string, JsonProperty][];
    if (properties.length === 0) lines.push("It takes no arguments.");
    for (const [name, property] of properties) {
      const need = tool.inputSchema.required?.includes(name) ? "required" : "optional";
      lines.push(`- \`${name}\` (${kind(property)}, ${need})${property.description ? `: ${property.description}` : ""}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// Antigravity's settings for a player at the seat whose folder is given, for its session only. The seat's
// tools run without asking, and its own tools for commands, files and fetching pages are refused ("Deny >
// Ask > Allow"). Its web search has no rule: a search_web deny rule was ignored (Antigravity CLI 1.5.1,
// 6 Nov 2026). The folder is trusted for the session, so the seat loads at once: Antigravity 1.5.5 never
// loaded the seat of a folder trusted only once its chat had started (11 Nov 2026).
export function agySettings(folder: string): string {
  const permissions = { allow: ["mcp(pvz/*)"], deny: ["command(*)", "read_file(*)", "write_file(*)", "read_url(*)", "execute_url(*)"] };
  return `${JSON.stringify({ permissions, trustedWorkspaces: [folder] }, null, 2)}\n`;
}

// Antigravity CLI where its installer puts it, else on the PATH.
export function findAgy(): string {
  const installed = join(process.env.LOCALAPPDATA ?? "", "agy", "bin", "agy.exe");
  return existsSync(installed) ? installed : "agy";
}

// What the host prints so a person can put an app in a seat: commands that open Claude Code or
// Antigravity CLI locked down to the seat (D55), and the seat's folder, which other apps can open.
export function joinLines(side: Side, url: string, launchers: { claude: string; agy: string; folder: string }): string[] {
  return [
    `The ${side}' seat: ${url}`,
    `  Claude Code, locked down to this seat: run ${launchers.claude} in a new terminal.`,
    `  Antigravity CLI (Gemini), locked down to this seat but for web search: run ${launchers.agy} in a new terminal.`,
    `  VS Code and Cursor keep their own tools, so they aren't locked down: open ${launchers.folder}, whose .vscode and .cursor configs have this match's link.`,
  ];
}

// Folder, message and model as a Windows command file needs them.
const cmdFolder = (folder: string) => [`if not exist "${folder}" mkdir "${folder}"`, `cd /d "${folder}"`];
const cmdText = (text: string) => text.replaceAll("%", "%%").replaceAll('"', "'");
const cmdModel = (model: string | undefined) => (model ? ` --model "${model}"` : "");

// A Windows command file that opens Claude Code in a chat of its own at a seat, locked down like the
// players pnpm match starts itself (player.ts): only the seat's tools, so no files, shell or web; no
// memory or CLAUDE.md files; none of your settings; no API key, so it plays on your subscription; and no
// updates of Claude Code while it plays.
// claude is the program and any arguments before Claude Code's own, as findClaude() gives them. settings
// is its session settings (claudeSettings). folder is the seat's own folder, outside this repo, so no
// project files or settings. model, if given, is the one it plays with, as Claude Code names it (D61).
export function claudeLauncher(claude: string[], mcpConfig: string, settings: string, folder: string, side: Side, prompt: string, model?: string): string {
  return [
    "@echo off",
    `rem Opens Claude Code to play the ${side} at its seat in this match, locked down to the seat's tools.`,
    "setlocal",
    // None of the Claude Code variables of a session it may be opened from, as for the players pnpm match
    // starts itself, except CLAUDE_CONFIG_DIR, which picks your account's profile.
    `for /f "delims==" %%v in ('set CLAUDE 2^>nul') do if /i not "%%v"=="CLAUDE_CONFIG_DIR" set "%%v="`,
    "set ANTHROPIC_API_KEY=",
    "set ANTHROPIC_AUTH_TOKEN=",
    "set CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
    "set CLAUDE_CODE_DISABLE_CLAUDE_MDS=1",
    // A player that updated Claude Code mid-match left the program it ran from half replaced (11 Nov 2026).
    "set DISABLE_AUTOUPDATER=1",
    ...cmdFolder(folder),
    `${claude.map((part) => `"${part}"`).join(" ")}${cmdModel(model)} --settings "${settings}" --tools "" --mcp-config "${mcpConfig}" --strict-mcp-config --allowedTools "mcp__pvz__*" --permission-mode dontAsk --setting-sources project "${cmdText(prompt)}"`,
    "",
  ].join("\r\n");
}

// Claude Code's session settings for a chat at a seat: before each message is sent, a hook waits 2 s, by
// running node (the program at the given path). A chat sends its first message before it has connected to
// the seat, and so without the seat's tools; the seat connects within half a second. Two settings Claude
// Code documents for this didn't hold that first message back (MCP_CONNECTION_NONBLOCKING=0, alwaysLoad;
// Claude Code 2.1.310, 11 Nov 2026).
export function claudeSettings(node: string): string {
  const pause = { type: "command", command: `"${node.replaceAll("\\", "/")}" -e "setTimeout(() => {}, 2000)"` };
  return `${JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [pause] }] } }, null, 2)}\n`;
}

// The same for Antigravity CLI, which plays on your Google account: it starts in the seat's folder,
// whose .agents config has the seat's link, with agySettings for this session only, and the model given,
// as `agy models` names it. Its first message hands the game to the seat's player agent (agyPlayerAgent).
export function agyLauncher(agy: string, settings: string, folder: string, side: Side, prompt: string, model?: string): string {
  const handOver = `Hand the whole game to the pvz-${side} agent, with this task, and tell me what it does: ${prompt}`;
  return [
    "@echo off",
    `rem Opens Antigravity CLI to play the ${side} at its seat in this match, locked down to the seat's tools.`,
    "setlocal",
    ...cmdFolder(folder),
    `"${agy}" --settings "${settings}"${cmdModel(model)} -i "${cmdText(handOver)}"`,
    "",
  ].join("\r\n");
}

// The command that opens a launcher in a window of its own, with a title that tells the windows apart.
export function windowCommand(title: string, launcher: string): string {
  return `start "${title}" "${launcher}"`;
}

// Opens a launcher (claude.cmd or agy.cmd) in a window of its own, for --windows (D60). The window isn't
// this program's: it stays open after the match, so its chat can be read, until you close it.
export function openWindow(title: string, launcher: string, onError: (error: Error) => void): void {
  const opener = spawn(windowCommand(title, launcher), { shell: true, stdio: "ignore" });
  opener.on("error", onError);
}
