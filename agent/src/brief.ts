// The instructions a player starts with: a brief from ../prompts with the session filled in. {level}
// becomes the level, and {rules} the rules for this session's clock, speed and tools, so the player is
// only told about what it can actually do.
import type { Session, ToolName } from "./session.ts";

export function sessionRules({ clock, speed, tools }: Session): string[] {
  const has = (tool: ToolName) => tools.includes(tool);
  const rules: string[] = [];

  if (clock === "waits") {
    rules.push("The game is paused while you think. Game time only passes when you call wait, and you choose how long each wait is.");
  } else {
    const fast = speed > 1 ? ` It runs at ${speed} times normal speed.` : "";
    rules.push(`The game keeps running while you think: zombies keep walking and sun keeps falling, so the time between your moves is game time too.${fast}`);
  }
  if (has("place_plant")) rules.push("Planting costs sun. After each use, a seed packet recharges before you can plant from it again.");
  rules.push(
    has("collect_sun")
      ? "Sun drops onto the lawn during play. Collect it, or it fades away after a while."
      : "Sun drops onto the lawn during play and fades away after a while.",
  );
  const where = has("place_plant") ? " Plants can only go on some tiles, and the game tells you when a plant can't go somewhere." : "";
  rules.push(
    `The lawn is a grid. Columns run from 0, next to your house on the left, to 8, where zombies walk in on the right. Rows count from 0 at the top.${where}`,
  );
  rules.push("Every tool tells you what happened and then shows the game.");
  return rules;
}

export function writeBrief(template: string, settings: Session): string {
  const rules = sessionRules(settings).map((rule) => `- ${rule}`).join("\n");
  return template.replaceAll("{level}", String(settings.level)).replaceAll("{rules}", rules);
}
