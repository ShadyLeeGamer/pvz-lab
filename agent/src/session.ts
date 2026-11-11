// A play session's settings: the side, the level, how game time behaves, and which tools Claude gets.
// Each session is a small JSON file in ../sessions, saved next to every run's log.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export const TOOL_NAMES = ["start_level", "choose_seeds", "ready", "get_state", "place_plant", "dig_up", "collect_sun", "wait", "send_zombie"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const MAX_SPEED = 50; // the game's fastest speed (kMaxSpeed in Clock.h)

export const SIDES = ["plants", "zombies"] as const;
export type Side = (typeof SIDES)[number];
// The tools each side may be given: ready, get_state and wait serve both, with each side's own view.
export const SIDE_TOOLS: Record<Side, readonly ToolName[]> = {
  plants: ["start_level", "choose_seeds", "ready", "get_state", "place_plant", "dig_up", "collect_sun", "wait"],
  zombies: ["ready", "get_state", "send_zombie", "wait"],
};

export const Session = z.object({
  // The side the player plays: the plants, or in a versus level the zombies.
  side: z.enum(SIDES).default("plants"),
  // Adventure level, as a number (1-50) or a name ("1-1"). A session for chat apps leaves it out (and
  // seeds too) and offers start_level instead, so the player starts the levels.
  level: z.union([z.number().int().min(1).max(50), z.string().regex(/^[1-5]-([1-9]|10)$/)]).optional(),
  // The seed packets to bring, by name, for levels that make you choose (1-8 onwards).
  seeds: z.array(z.string().min(1)).min(1).optional(),
  // "waits": the game is paused while Claude thinks, and time only passes when it waits.
  // "realtime": the game keeps running while Claude thinks.
  clock: z.enum(["waits", "realtime"]).default("waits"),
  // How fast game time runs whenever it runs: 1 is normal speed. With "waits" it only changes how
  // quickly a wait plays out; with "realtime" it changes how much thinking time Claude gets.
  speed: z.number().int().min(1).max(MAX_SPEED).default(1),
  tools: z
    .array(z.enum(TOOL_NAMES))
    .min(1)
    .refine((tools) => new Set(tools).size === tools.length, "each tool may only be listed once"),
  // The brief Claude gets at the start, relative to the session file. {level} and {rules} in it are
  // filled in from this session (see brief.ts).
  brief: z.string().min(1),
  // A cap on Claude's turns, so a confused run can't go on forever.
  maxTurns: z.number().int().positive().default(400),
})
  .refine((session) => session.clock !== "waits" || session.tools.includes("wait"), {
    message: 'with "clock": "waits", game time only passes when the player calls wait, so "tools" must include "wait"',
    path: ["tools"],
  })
  .refine((session) => !session.tools.includes("start_level") || (session.level === undefined && session.seeds === undefined), {
    message: 'with "start_level" the player picks the level and seeds, so leave out "level" and "seeds"',
    path: ["level"],
  })
  .refine((session) => session.tools.includes("start_level") || session.level !== undefined, {
    message: 'set "level", or offer "start_level" so the player can pick one',
    path: ["level"],
  })
  // choose_seeds is for a level someone else starts, such as a match's host: it waits at its seed
  // chooser for the player's pick.
  .refine((session) => !session.tools.includes("choose_seeds") || (session.level !== undefined && session.seeds === undefined), {
    message: 'with "choose_seeds" the player picks the seeds once the level is started for it, so set "level" and leave out "seeds"',
    path: ["tools"],
  })
  .refine((session) => session.tools.every((tool) => SIDE_TOOLS[session.side].includes(tool)), {
    message: 'the plants\' side takes start_level, choose_seeds, ready, get_state, place_plant, dig_up, collect_sun and wait; the zombies\' side takes ready, get_state, send_zombie and wait',
    path: ["tools"],
  })
  // The zombie side never starts a level or picks its seeds, and it can't hold the clock: the plants
  // play on while it thinks.
  .refine((session) => session.side === "plants" || (session.clock === "realtime" && session.seeds === undefined), {
    message: 'the zombies\' side plays in real time and brings no seeds: set "clock": "realtime" and leave out "seeds"',
    path: ["clock"],
  });
export type Session = z.infer<typeof Session>;

export interface LoadedSession {
  path: string;
  settings: Session;
  briefPath: string;
}

export async function loadSession(path: string): Promise<LoadedSession> {
  const fullPath = resolve(path);
  let json: unknown;
  try {
    json = JSON.parse(await readFile(fullPath, "utf8"));
  } catch (cause) {
    throw new Error(`couldn't read the session file ${fullPath}`, { cause });
  }
  const parsed = Session.safeParse(json);
  if (!parsed.success) throw new Error(`the session file ${fullPath} isn't valid:\n${z.prettifyError(parsed.error)}`);
  return { path: fullPath, settings: parsed.data, briefPath: resolve(dirname(fullPath), parsed.data.brief) };
}
