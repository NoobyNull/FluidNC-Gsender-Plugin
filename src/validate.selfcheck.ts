// Runnable self-check for the firmware-derived validator: `npm run check`.
// Assertions mirror what the real FluidNC firmware prints for the same configs
// (verified against the linux sim). Keep these green when re-syncing rules.
import { validateConfig } from "./validate";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
	if (cond) pass++;
	else {
		fail++;
		console.log("FAIL:", msg);
	}
};

// Bad pin — matches the firmware's two messages exactly.
const bad = validateConfig({
	stepping: { engine: "RMT" },
	axes: { x: { motor0: { standard_stepper: { step_pin: "banana" } } } },
});
ok(
	bad.some((f) => f.message === "Unknown pin type:banana"),
	"unknown pin type flagged",
);
ok(
	bad.some((f) => /Step pin banana type must be gpio/.test(f.message)),
	"step pin type must be gpio",
);

// Clean gpio/RMT config — no errors.
const good = validateConfig({
	stepping: { engine: "RMT" },
	axes: {
		x: { motor0: { standard_stepper: { step_pin: "gpio.2", direction_pin: "gpio.5" } } },
	},
});
ok(good.filter((f) => f.level === "error").length === 0, "clean config passes");

// I2S engine: gpio step pin becomes wrong type + i2so bus required.
const i2s = validateConfig({
	stepping: { engine: "I2S_STREAM" },
	axes: { x: { motor0: { standard_stepper: { step_pin: "gpio.2" } } } },
});
ok(
	i2s.some((f) => /type must be i2so/.test(f.message)),
	"gpio step pin invalid under I2S",
);
ok(
	i2s.some((f) => /I2SO bus must be configured/.test(f.message)),
	"I2S engine requires i2so bus",
);

// Missing step pin.
const nostep = validateConfig({
	stepping: { engine: "RMT" },
	axes: { x: { motor0: { standard_stepper: { direction_pin: "gpio.2" } } } },
});
ok(
	nostep.some((f) => f.message === "Step pin must be configured"),
	"missing step pin flagged",
);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
