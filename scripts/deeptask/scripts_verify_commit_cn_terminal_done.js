const fs = require("fs")

const extension = fs.readFileSync("src/dist/extension.js", "utf8")
const webview = fs.readFileSync("src/webview-ui/build/assets/index.js", "utf8")

const checks = {
	commitLanguageZh: extension.includes('language:"zh-CN",localRulesToggleState:void 0,globalRulesToggleState:void 0'),
	commitPromptZh: extension.includes("Use Simplified Chinese for the description and body by default"),
	terminalFallback: extension.includes("treated stream close as command completion"),
	terminalWaitMethod: extension.includes("waitForShellExecutionCompleteAfterStreamClose"),
	commandOutputSendFlag: webview.includes('as=$==="command_output"&&se'),
	commandOutputBypassQueue: webview.includes("if(!as&&(H||At||j.length>0))"),
	commandOutputButtonEnabled: webview.includes("sendingDisabled:H&&!as||qe"),
}

console.log(JSON.stringify(checks, null, 2))

if (!Object.values(checks).every(Boolean)) {
	process.exit(1)
}
