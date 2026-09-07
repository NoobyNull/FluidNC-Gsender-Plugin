// Runnable self-check for the firmware-derived validator: `npm run check`.
// Assertions mirror what the real FluidNC firmware prints for the same configs
// (verified against the linux sim). Keep these green when re-syncing rules.
import { validateConfig } from "./validate";
import { buildGuidedConfig } from "./guided";

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

// Failsafe (rule 1000): unknown top-level section flagged; known dynamic key not.
const unknown = validateConfig({
	stepping: { engine: "RMT" },
	uart1: { txd_pin: "gpio.1" },
	frobnicate: { foo: 1 },
});
ok(
	unknown.some(
		(f) => f.level === "warning" && /Unvalidated section "frobnicate"/.test(f.message),
	),
	"failsafe flags unknown section",
);
ok(
	!unknown.some((f) => /Unvalidated section "uart1"/.test(f.message)),
	"failsafe allows known dynamic key uart1",
);
// Case-insensitive: FluidNC keys like PWM:/UART1: (any case) are recognized.
const cased = validateConfig({
	PWM: { output_pin: "gpio.2" },
	UART1: { txd_pin: "gpio.1" },
});
ok(
	!cased.some((f) => /Unvalidated section/.test(f.message)),
	"failsafe is case-insensitive (PWM/UART1 not flagged)",
);

// Guided builder: structure + honors "no steps_per_mm" + scaffolds buses.
const g = buildGuidedConfig({
	name: "Router",
	units: "inch",
	driver: "tmc_2209",
	axisCount: 3,
	dualMotor: true,
	dualAxis: "y",
	homing: true,
	corner: "back-right",
	spindle: "vfd",
});
const gaxes = g.axes as Record<string, Record<string, unknown>>;
ok(!!(gaxes.x && gaxes.y && gaxes.z), "guided builds requested axes");
ok("motor1" in gaxes.y && !("motor1" in gaxes.x), "dual-motor adds motor1 to the chosen axis only");
ok(
	"limit_neg_pin" in (gaxes.x.motor0 as Record<string, unknown>),
	"guided homing scaffolds limit pins on the motor",
);
ok(
	!("steps_per_mm" in gaxes.x),
	"guided omits steps_per_mm (not fabricated)",
);
ok((g as Record<string, unknown>).report_inches === true, "guided honors inch units");
ok("Huanyang" in g && "uart2" in g, "guided VFD scaffolds its uart bus");
ok("uart1" in g, "guided TMC2209 scaffolds its uart bus (ports become selectable)");
ok(
	(gaxes.x.homing as Record<string, unknown>).positive_direction === true,
	"guided homing corner back-right -> X positive",
);
// Fresh guided config: only expected complaint is empty pins (a to-do list).
const gf = validateConfig(g);
ok(
	gf.filter((f) => f.level === "error").every((f) => /step pin/i.test(f.message)),
	"guided config's only errors are the pins to fill in",
);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
