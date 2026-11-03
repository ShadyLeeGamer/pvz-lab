// The instructions a player starts with: a brief from ../prompts with the session filled in. {level}
// becomes the level, and {rules} the rules for this session's side, clock, speed and tools, so the
// player is only told about what it can actually do.
import type { Session, ToolName } from "./session.ts";

// The zombie side always plays in real time (session.ts), against plants that play on while it thinks.
function zombieRules({ speed, tools }: Session): string[] {
  const has = (tool: ToolName) => tools.includes(tool);
  const fast = speed > 1 ? ` It runs at ${speed} times normal speed.` : "";
  const costs = has("get_state") ? " get_state shows what each costs and which are ready to send." : "";
  return [
    `The game keeps running while you think: your zombies keep walking and the plants keep fighting, so the time between your moves is game time too.${fast}`,
    "Each wave pays you points when it arrives: what the game's own zombies in that wave would have cost. Spend them on that wave. Points still unspent when the next wave pays are lost.",
    `You can send the level's own zombie types, each for its cost. A type can't come before its first wave, except in the final wave, which allows every type.${costs}`,
    "Your zombies walk in from the right, in the row you choose. The game refuses a row a zombie can't use, such as dirt, or water before wave 6 for a zombie that only walks.",
    "In a level with bungee zombies, a bungee_zombie drops onto the tile you name and carries off the plant there.",
    "A huge wave pays you 7.5 seconds early, when its warning shows. Zombies you send during the warning are held, and walk on together with the wave's flag zombie, which the game still sends.",
    "Once a wave's points are spent, your zombies count as that wave: if the plants beat them down, the next wave comes early, as it does with the game's own waves. Until then, the next wave waits for its timer.",
    "The final wave is your last payday. Once it has arrived, the plants win as soon as no zombie is left on the lawn, so send its zombies during its warning or as soon as it arrives.",
    ...(has("wait") ? ["wait lets time pass, and ends early when a wave pays you or the level ends."] : []),
    "The lawn is a grid. Columns run from 0, next to the plants' house on the left, to 8 on the right, where your zombies walk in. Rows count from 0 at the top.",
    "Every tool tells you what happened and then shows the game.",
  ];
}

// The plants' side plays paused or in real time, with the tools its session lists.
function plantRules({ clock, speed, tools }: Session): string[] {
  const has = (tool: ToolName) => tools.includes(tool);
  const rules: string[] = [];

  if (has("start_level")) {
    rules.push("Start a level with start_level. From 1-8 on, a level first asks which seed packets to bring: start_level shows the choices and what each costs.");
  }
  if (has("choose_seeds")) {
    rules.push("The level waits at its seed chooser until you choose which seed packets to bring: choose_seeds shows the choices and what each costs, then picks them.");
  }
  if (clock === "waits") {
    rules.push("The game is paused while you think. Game time only passes when you call wait, and you choose how long each wait is.");
  } else {
    const fast = speed > 1 ? ` It runs at ${speed} times normal speed.` : "";
    rules.push(`The game keeps running while you think: zombies keep walking and sun keeps falling, so the time between your moves is game time too.${fast}`);
  }
  if (has("place_plant")) rules.push("Planting costs sun. After each use, a seed packet recharges before you can plant from it again.");
  if (has("dig_up")) rules.push("Digging up a plant with dig_up frees its tile, but gives no sun back.");
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

export function sessionRules(settings: Session): string[] {
  return settings.side === "zombies" ? zombieRules(settings) : plantRules(settings);
}

export function writeBrief(template: string, settings: Session): string {
  const rules = sessionRules(settings).map((rule) => `- ${rule}`).join("\n");
  const withLevel = settings.level === undefined ? template : template.replaceAll("{level}", String(settings.level));
  return withLevel.replaceAll("{rules}", rules);
}
