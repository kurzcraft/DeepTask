const fs = require("fs")

const file = "src/dist/extension.js"
let text = fs.readFileSync(file, "utf8")
const original = text

const replacements = [
	[
		'a=await Vz("","","","commit",{language:"zh-CN",localRulesToggleState:void 0,globalRulesToggleState:void 0})',
		'a=await Vz("","","","commit",{language:"en",localRulesToggleState:void 0,globalRulesToggleState:void 0})',
	],
	[
		"- ONLY Generate a clean conventional commit message as specified below\n- Use Simplified Chinese for the description and body by default, while keeping the Conventional Commit type and optional scope in English\n\n\\${gitContext}",
		"- ONLY Generate a clean conventional commit message as specified below\n\n\\${gitContext}",
	],
	[
		'a=void 0,o=new Promise(c=>{this.once("shell_execution_complete",p=>{a=p,c(p)})})',
		'o=new Promise(c=>{this.once("shell_execution_complete",p=>c(p))})',
	],
	[
		"this.terminal.setActiveStream(void 0),await this.waitForShellExecutionCompleteAfterStreamClose(o);let c=a===void 0;this.isHot=!1,I",
		"this.terminal.setActiveStream(void 0),await o,this.isHot=!1,I",
	],
	[
		'this.stopHotTimer();let p=this.removeEscapeSequences(this.fullOutput);c&&(p+=`\n<VSCE shell execution end event not received after stream closed; treated stream close as command completion.>`),this.emit("completed",p),this.emit("continue")}async waitForShellExecutionCompleteAfterStreamClose(e){await Promise.race([e.then(()=>{}),new Promise(r=>setTimeout(r,1e3))])}continue(){',
		'this.stopHotTimer(),this.emit("completed",this.removeEscapeSequences(this.fullOutput)),this.emit("continue")}continue(){',
	],
]

for (const [from, to] of replacements) {
	const count = text.split(from).length - 1
	console.log(from.slice(0, 80), count)
	if (count > 0) {
		text = text.replace(from, to)
	}
}

fs.writeFileSync(file, text)
console.log("changed", text !== original)
