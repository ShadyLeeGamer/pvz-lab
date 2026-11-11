// URL seats: pnpm match serves a side's MCP server over HTTP on this PC, so any MCP app can take that
// seat by its link, http://127.0.0.1:<port>/mcp/<side>/<token>. Each seat has its own random token, made
// for this match only (D57), so a player can't reach the other side's seat by changing the side in its
// link. Only this PC can connect: the server listens on 127.0.0.1, the SDK's Express app turns away any
// Host but this PC's own names, and a request from a web page is refused unless the page is this server's
// own (Origin, D30).
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
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

// The files an app finds the seat's link in when it plays from the seat's own folder, by path within
// that folder: Antigravity's workspace config, VS Code's and Cursor's. Each match writes them afresh.
export function seatFolderFiles(url: string): Record<string, string> {
  const json = (content: object) => `${JSON.stringify(content, null, 2)}\n`;
  return {
    ".agents/mcp_config.json": json({ mcpServers: { pvz: { serverUrl: url } } }),
    ".vscode/mcp.json": json({ servers: { pvz: { type: "http", url } } }),
    ".cursor/mcp.json": json({ mcpServers: { pvz: { url } } }),
  };
}

// Antigravity's permission rules for a player, for its session only: the seat's tools run without asking,
// and its own tools for commands, files and fetching pages are refused ("Deny > Ask > Allow"). Its web
// search has no rule: a search_web deny rule was ignored (Antigravity CLI 1.5.1, 6 Nov 2026).
export const AGY_SETTINGS = `${JSON.stringify(
  { permissions: { allow: ["mcp(pvz/*)"], deny: ["command(*)", "read_file(*)", "write_file(*)", "read_url(*)", "execute_url(*)"] } },
  null,
  2,
)}\n`;

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

// Folder and message as a Windows command file needs them.
const cmdFolder = (folder: string) => [`if not exist "${folder}" mkdir "${folder}"`, `cd /d "${folder}"`];
const cmdText = (text: string) => text.replaceAll("%", "%%").replaceAll('"', "'");

// A Windows command file that opens Claude Code in a chat of its own at a seat, locked down like the
// players pnpm match starts itself (player.ts): only the seat's tools, so no files, shell or web; no
// memory or CLAUDE.md files; none of your settings; and no API key, so it plays on your subscription.
// claude is the program and any arguments before Claude Code's own, as findClaude() gives them. folder
// is the seat's own folder, outside this repo, so no project files or settings.
export function claudeLauncher(claude: string[], mcpConfig: string, folder: string, side: Side, prompt: string): string {
  return [
    "@echo off",
    `rem Opens Claude Code to play the ${side} at its seat in this match, locked down to the seat's tools.`,
    "setlocal",
    "set ANTHROPIC_API_KEY=",
    "set ANTHROPIC_AUTH_TOKEN=",
    "set CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
    "set CLAUDE_CODE_DISABLE_CLAUDE_MDS=1",
    ...cmdFolder(folder),
    `${claude.map((part) => `"${part}"`).join(" ")} --tools "" --mcp-config "${mcpConfig}" --strict-mcp-config --allowedTools "mcp__pvz__*" --permission-mode dontAsk --setting-sources project "${cmdText(prompt)}"`,
    "",
  ].join("\r\n");
}

// The same for Antigravity CLI, which plays on your Google account: it starts in the seat's folder,
// whose .agents config has the seat's link, with AGY_SETTINGS for this session only.
export function agyLauncher(agy: string, settings: string, folder: string, side: Side, prompt: string): string {
  return [
    "@echo off",
    `rem Opens Antigravity CLI to play the ${side} at its seat in this match, locked down to the seat's tools.`,
    "setlocal",
    ...cmdFolder(folder),
    `"${agy}" --settings "${settings}" -i "${cmdText(prompt)}"`,
    "",
  ].join("\r\n");
}
