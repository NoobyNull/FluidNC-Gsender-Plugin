// Code written by: Claude (Anthropic), via Claude Code.
//
// Guided setup: turn a few basic answers into a bootable FluidNC starter config.
// Pins are left NO_PIN on purpose — the firmware validator then lists exactly
// which pins the user must fill, acting as a to-do list. steps_per_mm is
// deliberately omitted (machine-specific; the firmware default applies until the
// user calibrates) rather than fabricated from a guess.

export type Driver = "standard_stepper" | "stepstick" | "tmc_2209";
export type Spindle = "none" | "relay" | "pwm" | "vfd";
export type Corner = "front-left" | "front-right" | "back-left" | "back-right";

export interface GuidedAnswers {
	name: string;
	units: "mm" | "inch";
	driver: Driver;
	axisCount: number; // 3..6
	dualMotor: boolean; // gantry axis driven by two motors (motor0 + motor1)
	dualAxis: string; // which axis is dual (e.g. "y"), when dualMotor
	homing: boolean;
	corner: Corner; // which corner homing moves toward (only used when homing)
	spindle: Spindle;
}

export const AXIS_NAMES = ["x", "y", "z", "a", "b", "c"];

const driverBlock = (d: Driver): Record<string, unknown> => {
	if (d === "tmc_2209") {
		return {
			tmc_2209: {
				step_pin: "NO_PIN",
				direction_pin: "NO_PIN",
				uart_num: 1,
				addr: 0,
				r_sense_ohms: 0.11,
				run_amps: 0.5,
				hold_amps: 0.25,
				microsteps: 16,
			},
		};
	}
	if (d === "stepstick") {
		return {
			stepstick: {
				step_pin: "NO_PIN",
				direction_pin: "NO_PIN",
				disable_pin: "NO_PIN",
			},
		};
	}
	return {
		standard_stepper: {
			step_pin: "NO_PIN",
			direction_pin: "NO_PIN",
			disable_pin: "NO_PIN",
		},
	};
};

const spindleSnippet = (s: Spindle): Record<string, unknown> => {
	switch (s) {
		case "relay":
			return {
				relay: {
					output_pin: "NO_PIN",
					direction_pin: "NO_PIN",
					disable_with_s0: false,
					spinup_ms: 1000,
					spindown_ms: 1000,
				},
			};
		case "pwm":
			return {
				PWM: {
					pwm_hz: 5000,
					output_pin: "NO_PIN",
					enable_pin: "NO_PIN",
					direction_pin: "NO_PIN",
					speed_map: "0=0.000% 1000=100.000%",
				},
			};
		case "vfd":
			return {
				Huanyang: { uart_num: 2, modbus_id: 1 },
				uart2: {
					txd_pin: "NO_PIN",
					rxd_pin: "NO_PIN",
					rts_pin: "NO_PIN",
					baud: 9600,
					mode: "8N1",
				},
			};
		default:
			return {};
	}
};

// A bus section the chosen driver needs, so its ports actually exist in the
// editor (you can't pick a UART port until the uart bus is configured).
const driverBus = (d: Driver): Record<string, unknown> =>
	d === "tmc_2209"
		? {
				uart1: {
					txd_pin: "NO_PIN",
					rxd_pin: "NO_PIN",
					baud: 115200,
					mode: "8N1",
				},
			}
		: {};

export function buildGuidedConfig(a: GuidedAnswers): Record<string, unknown> {
	const axisCount = Math.min(6, Math.max(3, a.axisCount));
	// corner -> which way each axis homes. Z always homes up (positive).
	const posX = a.corner.endsWith("right");
	const posY = a.corner.startsWith("back");
	const axes: Record<string, unknown> = { shared_stepper_disable_pin: "NO_PIN" };
	AXIS_NAMES.slice(0, axisCount).forEach((ax) => {
		const isZ = ax === "z";
		// Conservative starter motion — safe/slow for a first boot; tune later.
		const axisCfg: Record<string, unknown> = {
			// steps_per_mm intentionally omitted (calibrate per machine).
			max_rate_mm_per_min: isZ ? 500 : 2000,
			acceleration_mm_per_sec2: isZ ? 25 : 50,
			max_travel_mm: isZ ? 100 : 200,
			motor0: driverBlock(a.driver),
		};
		// Dual-motor (gantry) axis: a second motor with its own driver + pins.
		if (a.dualMotor && ax === a.dualAxis) {
			axisCfg.motor1 = driverBlock(a.driver);
		}
		if (a.homing) {
			const pos = ax === "x" ? posX : ax === "y" ? posY : isZ ? true : false;
			axisCfg.homing = {
				cycle: isZ ? 1 : 2, // Z homes first
				positive_direction: pos,
				mpos_mm: pos ? (isZ ? 100 : 200) : 0,
			};
		}
		axes[ax] = axisCfg;
	});
	const cfg: Record<string, unknown> = {
		name: a.name || "My CNC",
		board: "None",
		stepping: {
			engine: "RMT",
			idle_ms: 250,
			pulse_us: 4,
			dir_delay_us: 0,
			disable_delay_us: 0,
		},
		axes,
		...driverBus(a.driver),
		...spindleSnippet(a.spindle),
	};
	if (a.units === "inch") cfg.report_inches = true;
	return cfg;
}
