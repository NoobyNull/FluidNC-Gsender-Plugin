// Code written by: Claude (Anthropic), via Claude Code.
//
// Firmware-derived config validator: a TypeScript port of FluidNC's
// Configuration::Validator pass and the per-class validate() Assert()s that
// reject a bad config.yaml on boot.
//
// This is NOT bit-for-bit and does NOT auto-update from upstream (that would
// need the firmware itself, via WASM or a sim). It is a faithful port: every
// rule below cites the FluidNC source it came from, so re-syncing after Bart
// Dring changes the firmware is mechanical. Config format changes rarely.
//
// Sources (FluidNC/src): Configuration/Validator.cpp, Machine/MachineConfig.cpp,
// Motors/StandardStepper.cpp, Stepping.cpp, Pin.cpp/Pin.h.
import { PIN_BY_NAME, parsePin } from "./pins";

export type Level = "error" | "warning";
export interface Finding {
	path: string; // firmware-style, e.g. /axes/X/motor0/standard_stepper/step_pin
	message: string; // the firmware's own Assert message where possible
	level: Level;
}

type Cfg = Record<string, unknown>;
const isObj = (v: unknown): v is Cfg =>
	typeof v === "object" && v !== null && !Array.isArray(v);

// Firmware reports axis sections uppercase (/axes/X/…). Match that.
const fmtPath = (parts: (string | number)[]): string =>
	"/" +
	parts
		.map((p) =>
			typeof p === "string" && p.length === 1 && /[a-z]/.test(p)
				? p.toUpperCase()
				: String(p),
		)
		.join("/");

// Motor driver keys that extend StandardStepper (i.e. have step/dir pins).
// Source: FluidNC/src/Motors/*. Re-sync if drivers are added/renamed.
const STEPPER_DRIVERS = new Set([
	"standard_stepper",
	"stepstick",
	"tmc_2130",
	"tmc_2208",
	"tmc_2209",
	"tmc_5160",
]);

// engine name -> required step/dir pin prefix.
// Source: Motors/StandardStepper.cpp::validate:
//   type = strncmp(Stepping::_engine->name,"I2S",3)==0 ? "i2so" : "gpio"
const stepPinType = (engine: unknown): "gpio" | "i2so" =>
	typeof engine === "string" && engine.toUpperCase().startsWith("I2S")
		? "i2so"
		: "gpio";

const KNOWN_PIN_PREFIXES = ["gpio.", "i2so.", "i2si.", "uart_channel"];
const isNoPin = (b: string) => b === "" || b.toUpperCase() === "NO_PIN";
const lc = (s: string) => s.toLowerCase();

// Collect every "*_pin" leaf with its config path.
function collectPins(
	node: unknown,
	path: (string | number)[],
	out: { raw: string; path: (string | number)[] }[],
): { raw: string; path: (string | number)[] }[] {
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

/**
 * Validate a parsed FluidNC config the way the firmware would on boot.
 * Returns the findings the firmware's Validator/validate() pass would log.
 * Pin double-assignment is intentionally left to the live pin-conflict UI.
 */
export function validateConfig(config: Cfg): Finding[] {
	const findings: Finding[] = [];
	const engine = isObj(config.stepping)
		? (config.stepping as Cfg).engine
		: "RMT";
	const wantType = stepPinType(engine);

	// ---- Pin syntax + capability (Pin.cpp / Pin.h) ----
	for (const { raw, path } of collectPins(config, [], [])) {
		const base = parsePin(raw).base;
		if (isNoPin(base)) continue;
		const pathStr = fmtPath(path);

		// Unknown pin type (firmware: "Unknown pin type:<x>")
		if (!KNOWN_PIN_PREFIXES.some((pre) => lc(base).startsWith(pre))) {
			findings.push({
				path: pathStr,
				message: `Unknown pin type:${raw}`,
				level: "error",
			});
			continue;
		}

		// gpio pin must exist and be usable on the ESP32
		if (lc(base).startsWith("gpio.")) {
			const def = PIN_BY_NAME.get(base);
			if (!def || def.restricted) {
				findings.push({
					path: pathStr,
					message: `Pin ${base} is not available on this board`,
					level: "error",
				});
			} else if (parsePin(raw).pull && !def.pull) {
				findings.push({
					path: pathStr,
					message: `Pin ${base} has no internal pull resistor`,
					level: "warning",
				});
			}
		}
	}

	// ---- Stepper rules (Motors/StandardStepper.cpp::validate) ----
	const axes = isObj(config.axes) ? (config.axes as Cfg) : {};
	for (const [axis, aval] of Object.entries(axes)) {
		if (!isObj(aval)) continue;
		for (const mkey of Object.keys(aval)) {
			if (!/^motor\d+$/.test(mkey)) continue;
			const motor = (aval as Cfg)[mkey];
			if (!isObj(motor)) continue;
			for (const dkey of Object.keys(motor)) {
				if (!STEPPER_DRIVERS.has(dkey)) continue;
				const drv = (motor as Cfg)[dkey];
				if (!isObj(drv)) continue;
				const at = fmtPath(["axes", axis, mkey, dkey]);
				const step = parsePin(String((drv as Cfg).step_pin ?? "")).base;
				const dir = parsePin(String((drv as Cfg).direction_pin ?? "")).base;

				// step_pin must be configured
				if (isNoPin(step)) {
					findings.push({
						path: `${at}/step_pin`,
						message: "Step pin must be configured",
						level: "error",
					});
				} else if (!lc(step).startsWith("sim") && !lc(step).startsWith(wantType)) {
					// step pin type must match the stepping engine
					findings.push({
						path: `${at}/step_pin`,
						message: `Step pin ${step} type must be ${wantType}`,
						level: "error",
					});
				}
				// direction_pin, if present, must match too
				if (
					!isNoPin(dir) &&
					!lc(dir).startsWith("sim") &&
					!lc(dir).startsWith(wantType)
				) {
					findings.push({
						path: `${at}/direction_pin`,
						message: `Direction pin ${dir} type must be ${wantType}`,
						level: "error",
					});
				}
			}
		}
	}

	// ---- I2S engine needs an i2so bus (Stepping.cpp:45) ----
	if (wantType === "i2so" && !isObj(config.i2so)) {
		findings.push({
			path: "/stepping/engine",
			message: "I2SO bus must be configured for this stepping type",
			level: "error",
		});
	}

	return findings;
}
