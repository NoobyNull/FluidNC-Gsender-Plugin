// Rule 30 — stepper step/direction pins.
// Source: FluidNC/src/Motors/StandardStepper.cpp::validate.
//   - step pin must be configured
//   - step/dir pin type must match the stepping engine (I2S* -> i2so, else gpio),
//     unless it's a "sim" pin.
import {
	type Rule,
	type Finding,
	STEPPER_DRIVERS,
	fmtPath,
	isObj,
	isNoPin,
	lc,
	parsePin,
} from "./_shared";

const rule: Rule = {
	id: "30-stepper-pins",
	title: "Stepper step/dir pins (StandardStepper.cpp)",
	run(ctx) {
		const out: Finding[] = [];
		const want = ctx.pinType;
		const axes = isObj(ctx.config.axes) ? ctx.config.axes : {};
		for (const [axis, aval] of Object.entries(axes)) {
			if (!isObj(aval)) continue;
			for (const mkey of Object.keys(aval)) {
				if (!/^motor\d+$/.test(mkey)) continue;
				const motor = aval[mkey];
				if (!isObj(motor)) continue;
				for (const dkey of Object.keys(motor)) {
					if (!STEPPER_DRIVERS.has(dkey)) continue;
					const drv = motor[dkey];
					if (!isObj(drv)) continue;
					const at = fmtPath(["axes", axis, mkey, dkey]);
					const step = parsePin(String(drv.step_pin ?? "")).base;
					const dir = parsePin(String(drv.direction_pin ?? "")).base;

					if (isNoPin(step)) {
						out.push({
							path: `${at}/step_pin`,
							message: "Step pin must be configured",
							level: "error",
						});
					} else if (!lc(step).startsWith("sim") && !lc(step).startsWith(want)) {
						out.push({
							path: `${at}/step_pin`,
							message: `Step pin ${step} type must be ${want}`,
							level: "error",
						});
					}
					ctx.checked.add(`${at}/step_pin`);

					if (
						!isNoPin(dir) &&
						!lc(dir).startsWith("sim") &&
						!lc(dir).startsWith(want)
					) {
						out.push({
							path: `${at}/direction_pin`,
							message: `Direction pin ${dir} type must be ${want}`,
							level: "error",
						});
					}
					ctx.checked.add(`${at}/direction_pin`);
				}
			}
		}
		return out;
	},
};
export default rule;
