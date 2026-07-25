// kilocode_change - new file
import { containsDangerousSubstitution, getCommandDecision } from "../commands"

describe("getCommandDecision", () => {
	describe("piped commands with redirections", () => {
		it("should auto-approve piped command when allowlist contains redirection pattern", () => {
			// When the allowlist contains "pnpm compile 2>&1" and "head",
			// the command "pnpm compile 2>&1 | head -100" should be auto-approved
			const allowedCommands = ["pnpm compile 2>&1", "head"]
			const deniedCommands: string[] = []

			const result = getCommandDecision("pnpm compile 2>&1 | head -100", allowedCommands, deniedCommands)

			expect(result).toBe("auto_approve")
		})

		it("should auto-approve when allowlist has command without redirection and command uses redirection", () => {
			// When the allowlist contains "pnpm compile" (without redirection),
			// the command "pnpm compile 2>&1 | head -100" should still be auto-approved
			// because stripping the redirection from the command should match the allowlist
			const allowedCommands = ["pnpm compile", "head"]
			const deniedCommands: string[] = []

			const result = getCommandDecision("pnpm compile 2>&1 | head -100", allowedCommands, deniedCommands)

			expect(result).toBe("auto_approve")
		})
	})

	// kilocode_change start - quoted shell syntax safety scan
	describe("quoted shell syntax safety scan", () => {
		it("auto-approves node -e JavaScript containing zsh-like text when wildcard is allowed", () => {
			const command = `git status --short && git rev-parse --short HEAD && git log --oneline -5 && git ls-remote origin refs/heads/main && node -e "fetch('https://api.github.com/repos/kurzgesagtcraft/deeptask/releases/tags/v5.5.0').then(r=>r.json()).then(j=>{const a=(j.assets||[]).find(x=>x.name==='deeptask-5.5.0.vsix'); console.log(JSON.stringify({tag:j.tag_name, target:j.target_commitish, html_url:j.html_url, asset:a&&{name:a.name,size:a.size,url:a.browser_download_url,updated_at:a.updated_at}}, null, 2))})"`

			expect(containsDangerousSubstitution(command)).toBe(false)
			expect(getCommandDecision(command, ["*"], [])).toBe("auto_approve")
		})

		it("still detects dangerous parameter expansion inside double quotes", () => {
			const command = `echo "\${value@P}"`

			expect(containsDangerousSubstitution(command)).toBe(true)
			expect(getCommandDecision(command, ["*"], [])).toBe("ask_user")
		})

		it("still detects zsh process substitution outside quotes", () => {
			const command = `cat =(echo dangerous)`

			expect(containsDangerousSubstitution(command)).toBe(true)
			expect(getCommandDecision(command, ["*"], [])).toBe("ask_user")
		})
	})
	// kilocode_change end

	// kilocode_change start - multiline bash -lc auto approval
	describe("multiline bash -lc scripts", () => {
		it("auto-approves a single-quoted multiline bash -lc script when wildcard is allowed", () => {
			const command = `bash -lc 'set -euo pipefail
backup="任务记录/backup-$(date +%Y%m%d-%H%M%S).tar.gz"
missing_before=$(find /tmp/tasks -mindepth 1 -maxdepth 1 -type d ! -exec test -f "{}/api_conversation_history.json" \\; -print | wc -l)
find /tmp/tasks -mindepth 1 -maxdepth 1 -type d | while read -r taskDir; do
	 if [ ! -f "$taskDir/api_conversation_history.json" ]; then
	   printf "[]\\n" > "$taskDir/api_conversation_history.json"
	 fi
done
printf "%s\\n%s\\n" "$backup" "$missing_before"'`

			expect(getCommandDecision(command, ["*"], [])).toBe("auto_approve")
		})
	})
	// kilocode_change end

	// kilocode_change start - heredoc auto approval
	describe("heredoc command blocks", () => {
		it("auto-approves heredoc script creation followed by execution when wildcard is allowed", () => {
			const command = `cat > /tmp/test_auto_execute.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo ok
EOF
bash /tmp/test_auto_execute.sh`

			const result = getCommandDecision(command, ["*"], [])

			expect(result).toBe("auto_approve")
		})

		it("still blocks a denied command after a heredoc body", () => {
			const command = `cat > /tmp/test_auto_execute.sh <<'EOF'
echo ok
EOF
bash /tmp/test_auto_execute.sh`

			const result = getCommandDecision(command, ["*"], ["bash /tmp/test_auto_execute.sh"])

			expect(result).toBe("auto_deny")
		})

		it("auto-approves nested Python heredoc script content when wildcard is allowed", () => {
			const command = `cat > /tmp/ensure_disable_vscodium_kilocode.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
stamp="$(date +%Y%m%d-%H%M%S)"
out="/home/kurz/Obsidian/任务记录/vscodium-disable-kilocode-config-\${stamp}.txt"
state="/home/kurz/.config/VSCodium/User/globalStorage/state.vscdb"
backup="/home/kurz/Obsidian/任务记录/state.vscdb-before-disable-kilocode-\${stamp}"
cp "$state" "$backup"
python3 - <<'PY' "$state" "$out" "$backup"
import json, sqlite3, sys
state, out, backup = sys.argv[1:]
key = 'extensionsIdentifiers/disabled'
with open(out, 'w', encoding='utf-8') as f:
		  f.write(f'backup={backup}\\n')
		  f.write(f'{key}=value\\n')
PY
cat "$out"
EOF
bash /tmp/ensure_disable_vscodium_kilocode.sh`

			expect(getCommandDecision(command, ["*"], [])).toBe("auto_approve")
		})

		it("ignores dangerous-looking substitutions inside quoted heredoc body for safety scan", () => {
			const command = `cat > /tmp/body_text.sh <<'EOF'
	echo "\${value@P}"
	echo "\${value=\\x60id\\x60}"
	EOF
	bash /tmp/body_text.sh`

			expect(containsDangerousSubstitution(command)).toBe(false)
		})

		it("still detects dangerous substitutions inside unquoted heredoc body", () => {
			const command = `cat > /tmp/body_text.sh <<EOF
	echo "\${value@P}"
	EOF
	bash /tmp/body_text.sh`

			expect(containsDangerousSubstitution(command)).toBe(true)
		})

		it("still detects dangerous substitutions outside heredoc body", () => {
			const command = `echo "\${value@P}"
	cat > /tmp/body_text.sh <<'EOF'
	echo ok
	EOF`

			expect(containsDangerousSubstitution(command)).toBe(true)
		})
	})
	// kilocode_change end
})
