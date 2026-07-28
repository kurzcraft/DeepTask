const fs = require("fs")

const extensionFiles = ["src/dist/extension.js", "src/dist/agent-runtime-process.js"]

function replaceExact(text, from, to, label, expected = 1) {
	const count = text.split(from).length - 1
	if (count !== expected) {
		throw new Error(`${label}: expected ${expected} match(es), found ${count}`)
	}
	return text.replace(from, to)
}

function replaceIfPresent(text, from, to, label) {
	if (text.includes(to)) {
		console.log(`${label}: already patched`)
		return text
	}
	if (!text.includes(from)) {
		console.log(`${label}: source pattern not present, skipped`)
		return text
	}
	return replaceExact(text, from, to, label)
}

for (const file of extensionFiles) {
	if (!fs.existsSync(file)) {
		console.log(`skip missing ${file}`)
		continue
	}

	let text = fs.readFileSync(file, "utf8")
	const original = text

	text = replaceIfPresent(
		text,
		'a=await Vz("","","","commit",{language:"en",localRulesToggleState:void 0,globalRulesToggleState:void 0})',
		'a=await Vz("","","","commit",{language:"zh-CN",localRulesToggleState:void 0,globalRulesToggleState:void 0})',
		`${file} commit language`,
	)

	text = replaceIfPresent(
		text,
		"- ONLY Generate a clean conventional commit message as specified below\n\n\\${gitContext}",
		"- ONLY Generate a clean conventional commit message as specified below\n- Use Simplified Chinese for the description and body by default, while keeping the Conventional Commit type and optional scope in English\n\n\\${gitContext}",
		`${file} commit prompt`,
	)

	text = replaceIfPresent(
		text,
		'o=new Promise(c=>{this.once("shell_execution_complete",p=>c(p))})',
		'a=void 0,o=new Promise(c=>{this.once("shell_execution_complete",p=>{a=p,c(p)})})',
		`${file} shell completion details`,
	)

	text = replaceIfPresent(
		text,
		"this.terminal.setActiveStream(void 0),await o,this.isHot=!1,I",
		"this.terminal.setActiveStream(void 0),await this.waitForShellExecutionCompleteAfterStreamClose(o);let c=a===void 0;this.isHot=!1,I",
		`${file} shell completion wait`,
	)

	text = replaceIfPresent(
		text,
		'this.stopHotTimer(),this.emit("completed",this.removeEscapeSequences(this.fullOutput)),this.emit("continue")}continue(){',
		'this.stopHotTimer();let p=this.removeEscapeSequences(this.fullOutput);c&&(p+=`\n<VSCE shell execution end event not received after stream closed; treated stream close as command completion.>`),this.emit("completed",p),this.emit("continue")}async waitForShellExecutionCompleteAfterStreamClose(e){await Promise.race([e.then(()=>{}),new Promise(r=>setTimeout(r,1e3))])}continue(){',
		`${file} shell completion output`,
	)

	if (text !== original) {
		fs.writeFileSync(file, text)
		console.log(`patched ${file}`)
	} else {
		console.log(`no changes needed ${file}`)
	}
}
