// Rule 90 — FAILSAFE (must stay last). Nothing should pass silently unchecked.
// Two nets:
//   (a) any real pin no earlier rule vouched for -> "unvalidated pin"
//   (b) any top-level section the validator doesn't recognize (not in the
//       bundled schema, the curated FluidNC section list, or a known dynamic
//       pattern) -> "unvalidated section". This is what fires when Bart adds a
//       new section and no rule has been ported yet: it surfaces the unknown
//       instead of implying the config is fully validated.
import schemaJson from "../vendor/fluidnc-config-schema.json";
import { type Rule, type Finding, fmtPath, isNoPin, parsePin } from "./_shared";

// Curated FluidNC top-level sections (firmware config docs), supplementing the
// schema vocabulary in case the bundled schema is incomplete.
const CURATED = new Set([
	"name", "board", "meta",
	"arc_tolerance_mm", "junction_deviation_mm", "planner_blocks",
	"verbose_errors", "report_inches", "use_line_numbers",
	"enable_parking_override_control",
	"stepping", "axes", "kinematics",
	"i2so", "i2c", "spi", "sdcard", "onewire",
	"control", "probe", "macros", "start", "parking", "coolant",
	"user_outputs", "user_inputs", "status_outputs", "oled", "atc",
	// spindle types
	"PWM", "10V", "Laser", "NoSpindle", "BESC", "relay", "HBridge", "plasma",
	"Huanyang", "H2A", "YL620", "DeltaVFD", "NowForever",
]);
const DYNAMIC = /^(uart|uart_channel|spi)\d+$/;

// Flat vocabulary of every property name that appears anywhere in the schema.
function schemaVocab(): Set<string> {
	const out = new Set<string>();
	const walk = (n: unknown) => {
		if (n && typeof n === "object") {
			const o = n as Record<string, unknown>;
			if (o.properties && typeof o.properties === "object") {
				for (const k of Object.keys(o.properties)) out.add(k);
			}
			for (const v of Object.values(o)) walk(v);
		}
	};
	walk(schemaJson);
	return out;
}
let vocab: Set<string> | null = null;

const rule: Rule = {
	id: "90-unvalidated",
	title: "Failsafe — flag anything unvalidated",
	run(ctx) {
		const out: Finding[] = [];

		// (a) pins no rule vouched for
		for (const { raw, path } of ctx.pins) {
			if (isNoPin(parsePin(raw).base)) continue;
			const p = fmtPath(path);
			if (!ctx.checked.has(p)) {
				out.push({
					path: p,
					message: "Unvalidated pin — no rule verified this; the controller is the authority",
					level: "warning",
				});
			}
		}

		// (b) unrecognized top-level sections
		if (!vocab) vocab = schemaVocab();
		for (const key of Object.keys(ctx.config)) {
			if (CURATED.has(key) || DYNAMIC.test(key) || vocab.has(key)) continue;
			out.push({
				path: `/${key}`,
				message: `Unvalidated section "${key}" — not recognized; the validator may be out of date (the controller will decide)`,
				level: "warning",
			});
		}
		return out;
	},
};
export default rule;
