// Rule 20 — pin capability. Source: FluidNC/src/Pin.h (capabilities()) +
// the ESP32 capability table in ../pins. A gpio pin must exist and be usable on
// the board; a pull may only be requested where the pin supports one.
import { PIN_BY_NAME } from "../pins";
import { type Rule, type Finding, fmtPath, isNoPin, lc, parsePin } from "./_shared";

const rule: Rule = {
	id: "20-pin-capability",
	title: "Pin capability (Pin.h / ESP32 table)",
	run(ctx) {
		const out: Finding[] = [];
		for (const { raw, path } of ctx.pins) {
			const parsed = parsePin(raw);
			const base = parsed.base;
			if (isNoPin(base)) continue;
			if (!lc(base).startsWith("gpio.")) continue; // only gpio has a table
			const p = fmtPath(path);
			const def = PIN_BY_NAME.get(base);
			if (!def || def.restricted) {
				out.push({
					path: p,
					message: `Pin ${base} is not available on this board`,
					level: "error",
				});
			} else {
				if (parsed.pull && !def.pull) {
					out.push({
						path: p,
						message: `Pin ${base} has no internal pull resistor`,
						level: "warning",
					});
				}
				ctx.checked.add(p);
			}
		}
		return out;
	},
};
export default rule;
