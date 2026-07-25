// kilocode_change new file

import { parseCommand } from "../parse-command"

describe("parseCommand", () => {
	describe("basic command parsing", () => {
		it("parses a simple command", () => {
			expect(parseCommand("git status")).toEqual(["git status"])
		})

		it("parses chained commands with &&", () => {
			expect(parseCommand("git add . && git commit")).toEqual(["git add .", "git commit"])
		})

		it("parses chained commands with ||", () => {
			expect(parseCommand("git pull || git fetch")).toEqual(["git pull", "git fetch"])
		})

		it("parses commands separated by newlines", () => {
			expect(parseCommand("git status\ngit log")).toEqual(["git status", "git log"])
		})

		it("handles empty input", () => {
			expect(parseCommand("")).toEqual([])
			expect(parseCommand("   ")).toEqual([])
		})
	})

	describe("quoted strings", () => {
		it("preserves double-quoted strings", () => {
			expect(parseCommand('echo "hello world"')).toEqual(['echo "hello world"'])
		})

		// Note: shell-quote library strips single quotes, so we test that the content is preserved
		it("preserves content of single-quoted strings", () => {
			expect(parseCommand("echo 'hello world'")).toEqual(["echo hello world"])
		})
	})

	// kilocode_change start - tests for multi-line quoted strings
	describe("multi-line quoted strings", () => {
		it("preserves newlines within double quotes", () => {
			const command = `echo "Hello\nWorld"`
			const result = parseCommand(command)
			expect(result).toHaveLength(1)
			expect(result[0]).toContain("\n")
			expect(result[0]).toBe('echo "Hello\nWorld"')
		})

		// Note: shell-quote library strips single quotes, but newlines are still preserved
		it("preserves newlines within single quotes", () => {
			const command = `echo 'Hello\nWorld'`
			const result = parseCommand(command)
			expect(result).toHaveLength(1)
			expect(result[0]).toContain("\n")
			// Single quotes are stripped by shell-quote, but newline is preserved
			expect(result[0]).toBe("echo Hello\nWorld")
		})

		it("splits on newlines outside quotes but preserves newlines inside quotes", () => {
			const command = `echo "Hello\nWorld"\ngit status`
			const result = parseCommand(command)
			expect(result).toHaveLength(2)
			expect(result[0]).toBe('echo "Hello\nWorld"')
			expect(result[1]).toBe("git status")
		})

		it("handles git commit with multi-line message", () => {
			const command = `git commit -m "feat: title\n\n- point a\n- point b"`
			const result = parseCommand(command)
			expect(result).toHaveLength(1)
			expect(result[0]).toContain("\n")
			expect(result[0]).toContain("- point a")
			expect(result[0]).toContain("- point b")
		})

		it("handles complex git command chain with multi-line commit message", () => {
			const command = `cd /repo && git add . && git commit -m "feat: title\n\n- point a\n- point b"`
			const result = parseCommand(command)
			expect(result).toHaveLength(3)
			expect(result[0]).toBe("cd /repo")
			expect(result[1]).toBe("git add .")
			expect(result[2]).toContain("git commit -m")
			expect(result[2]).toContain("\n")
		})

		it("handles CRLF line endings in quotes", () => {
			const command = `echo "Hello\r\nWorld"`
			const result = parseCommand(command)
			expect(result).toHaveLength(1)
			expect(result[0]).toContain("\r\n")
		})
		it("keeps a multiline bash -lc single-quoted script as one command", () => {
			const command = `bash -lc 'set -euo pipefail
backup="任务记录/backup-$(date +%Y%m%d-%H%M%S).tar.gz"
find /tmp -mindepth 1 -maxdepth 1 -type d ! -exec test -f "{}/api_conversation_history.json" \\; -print | wc -l
printf "%s\\n" "$backup"'`

			const result = parseCommand(command)

			expect(result).toHaveLength(1)
			expect(result[0]).toContain("bash -lc")
			expect(result[0]).toContain("$(date +%Y%m%d-%H%M%S)")
			expect(result[0]).toContain("| wc -l")
			expect(result[0]).toContain('printf "%s\\n" "$backup"')
		})
	})
	// kilocode_change end

	// kilocode_change start - heredoc command blocks
	describe("heredoc command blocks", () => {
		it("keeps a heredoc body attached to its introducing command", () => {
			const command = `cat > /tmp/test_auto_execute.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo ok
EOF
bash /tmp/test_auto_execute.sh`

			expect(parseCommand(command)).toEqual([
				`cat > /tmp/test_auto_execute.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo ok
EOF`,
				"bash /tmp/test_auto_execute.sh",
			])
		})

		it("does not parse heredoc operators inside the heredoc body as current-shell delimiters", () => {
			const command = `cat > /tmp/test_nested.sh <<'EOF'
python3 - <<'PY'
print('ok')
PY
EOF
bash /tmp/test_nested.sh`

			expect(parseCommand(command)).toEqual([
				`cat > /tmp/test_nested.sh <<'EOF'
python3 - <<'PY'
print('ok')
PY
EOF`,
				"bash /tmp/test_nested.sh",
			])
		})
	})
	// kilocode_change end

	// kilocode_change start - command substitution assignment regression
	describe("command substitution assignments", () => {
		it("keeps command substitution assignment as part of the parent shell command", () => {
			const command = `latestLog=$(ls -t /home/kurz/Obsidian/任务记录/vscodium-code9-config-fix2-stable-backup-*.txt 2>/dev/null | head -1); echo "LOG=$latestLog"; tail -n 120 "$latestLog" 2>/dev/null || true; echo '## latest'; readlink -f /home/kurz/Obsidian/VSCodium配置备份/latest; echo '## latest files'; ls -l /home/kurz/Obsidian/VSCodium配置备份/latest/SHA256SUMS.txt /home/kurz/Obsidian/VSCodium配置备份/latest/extensions-list.txt 2>/dev/null`

			expect(parseCommand(command)).toEqual([
				"latestLog=$(ls -t /home/kurz/Obsidian/任务记录/vscodium-code9-config-fix2-stable-backup-*.txt 2>/dev/null | head -1)",
				'echo "LOG=$latestLog"',
				'tail -n 120 "$latestLog" 2>/dev/null',
				"true",
				"echo ## latest",
				"readlink -f /home/kurz/Obsidian/VSCodium配置备份/latest",
				"echo ## latest files",
				"ls -l /home/kurz/Obsidian/VSCodium配置备份/latest/SHA256SUMS.txt /home/kurz/Obsidian/VSCodium配置备份/latest/extensions-list.txt 2>/dev/null",
			])
		})
	})
	// kilocode_change end
})
