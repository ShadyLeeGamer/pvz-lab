// Turns Claude Code's stream-json output (one JSON event per line) into the lines `pnpm play` prints,
// so a run can be followed as it happens: what Claude says, each tool it calls, and the tool's answer.

const MAX_LINE = 300;

function oneLine(text: string): string {
  const flat = text.trim().replaceAll("\n", " ");
  return flat.length > MAX_LINE ? `${flat.slice(0, MAX_LINE)}...` : flat;
}

// A tool's answer arrives either as a string or as a list of content blocks.
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text))
    .join("\n");
}

export function describeEvent(event: any, serverName: string): string[] {
  if (event?.type === "system" && event.subtype === "init") return [`Claude Code ${event.claude_code_version} started: model ${event.model}`];
  if (event?.type === "result") return [`Claude Code finished: ${event.subtype}, ${event.num_turns} turns`];

  const lines: string[] = [];
  for (const part of event?.message?.content ?? []) {
    if (event.type === "assistant" && part.type === "text" && part.text.trim()) lines.push(`Claude: ${oneLine(part.text)}`);
    if (event.type === "assistant" && part.type === "tool_use") {
      lines.push(`  -> ${String(part.name).replace(`mcp__${serverName}__`, "")} ${JSON.stringify(part.input)}`);
    }
    // The first line of an answer says what happened; the rest is the game, which the window shows.
    if (event.type === "user" && part.type === "tool_result") lines.push(`  <- ${oneLine(resultText(part.content).split("\n")[0] ?? "")}`);
  }
  return lines;
}
