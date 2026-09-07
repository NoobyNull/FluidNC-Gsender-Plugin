// Code written by: Claude (Anthropic), via Claude Code.
//
// Firmware-derived config validator: runs a top-down pipeline of one-rule-per-
// file rules (src/rules/NN-*.ts), each a faithful TS port of a FluidNC
// Configuration::Validator / validate() check, citing its firmware source.
//
// NOT bit-for-bit and NOT auto-updating (that needs the firmware itself, via
// WASM or the linux sim). Rules are ordered by their numeric filename prefix;
// the last rule (1000-unvalidated) is the failsafe that flags anything the
// earlier rules didn't vouch for. Add a rule = drop a new numbered file here
// and import it in order below.
import {
	type Cfg,
	type Finding,
	type Rule,
	type RuleContext,
	collectPins,
	isObj,
	stepPinType,
} from "./rules/_shared";

import rule10 from "./rules/10-pin-syntax";
import rule20 from "./rules/20-pin-capability";
import rule30 from "./rules/30-stepper-pins";
import rule40 from "./rules/40-i2s-bus";
// 1000 is the failsafe and MUST stay last (numbered far out so new rules slot
// in before it without renumbering).
import rule1000 from "./rules/1000-unvalidated";

// Top-down execution order.
const RULES: Rule[] = [rule10, rule20, rule30, rule40, rule1000];

export type { Finding };

/**
 * Validate a parsed FluidNC config the way the firmware would on boot.
 * Runs every rule top-down and concatenates their findings in order.
 */
export function validateConfig(config: Cfg): Finding[] {
	const engine = isObj(config.stepping) ? config.stepping.engine : "RMT";
	const ctx: RuleContext = {
		config,
		pinType: stepPinType(engine),
		pins: collectPins(config, [], []),
		checked: new Set<string>(),
	};
	return RULES.flatMap((r) => r.run(ctx));
}
