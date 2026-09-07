// Code written by: Claude (Anthropic), via Claude Code.
//
// Shared types + pure helpers for the rule pipeline. Each rule lives in its own
// numbered file (10-, 20-, …) and is run top-down by ../validate.ts. The last
// rule (1000-unvalidated) is the failsafe: it flags anything the earlier rules
// didn't vouch for, so nothing passes silently unchecked.
import { parsePin } from "../pins";

export type Level = "error" | "warning";
export interface Finding {
	path: string; // firmware-style, e.g. /axes/X/motor0/standard_stepper/step_pin
	message: string;
	level: Level;
}

export type Cfg = Record<string, unknown>;
export interface PinLeaf {
	raw: string;
	path: (string | number)[];
}

export interface RuleContext {
	config: Cfg;
	/** Required step/dir pin prefix implied by stepping.engine ("gpio" | "i2so"). */
	pinType: "gpio" | "i2so";
	/** Every "*_pin" leaf in the config, precomputed once. */
	pins: PinLeaf[];
	/** Paths a rule has vouched for. The failsafe reports anything not in here. */
	checked: Set<string>;
}

export interface Rule {
	id: string; // e.g. "10-pin-syntax"
	title: string; // human label + firmware source
	run(ctx: RuleContext): Finding[];
}

export const isObj = (v: unknown): v is Cfg =>
	typeof v === "object" && v !== null && !Array.isArray(v);
export const lc = (s: string) => s.toLowerCase();
export const isNoPin = (b: string) => b === "" || b.toUpperCase() === "NO_PIN";

export const KNOWN_PIN_PREFIXES = ["gpio.", "i2so.", "i2si.", "uart_channel"];

// Motor driver keys that extend StandardStepper (have step/dir pins).
// Source: FluidNC/src/Motors/*. Re-sync if drivers are added/renamed.
export const STEPPER_DRIVERS = new Set([
	"standard_stepper",
	"stepstick",
	"tmc_2130",
	"tmc_2208",
	"tmc_2209",
	"tmc_5160",
]);

// Firmware reports axis sections uppercase (/axes/X/…). Match that.
export const fmtPath = (parts: (string | number)[]): string =>
	"/" +
	parts
		.map((p) =>
			typeof p === "string" && p.length === 1 && /[a-z]/.test(p)
				? p.toUpperCase()
				: String(p),
		)
		.join("/");

// engine name -> required step/dir pin prefix.
// Source: Motors/StandardStepper.cpp::validate.
export const stepPinType = (engine: unknown): "gpio" | "i2so" =>
	typeof engine === "string" && engine.toUpperCase().startsWith("I2S")
		? "i2so"
		: "gpio";

// Collect every "*_pin" leaf with its config path.
export function collectPins(
	node: unknown,
	path: (string | number)[],
	out: PinLeaf[],
): PinLeaf[] {
	if (isObj(node)) {
		for (const [k, v] of Object.entries(node)) {
			if (/_pin$/.test(k) && (typeof v === "string" || v == null)) {
				out.push({ raw: v == null ? "" : String(v), path: [...path, k] });
			} else {
				collectPins(v, [...path, k], out);
			}
		}
	} else if (Array.isArray(node)) {
		node.forEach((v, i) => collectPins(v, [...path, i], out));
	}
	return out;
}

export { parsePin };
