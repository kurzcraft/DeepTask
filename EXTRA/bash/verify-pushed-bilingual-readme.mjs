import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const root = "/media/kurz/aleber/vscode/deeptask"
const reportPath = `${root}/EXTRA/output/verify-pushed-bilingual-readme.json`
const statusPath = `${root}/EXTRA/output/verify-pushed-bilingual-readme.status`
const repository = "kurzgesagtcraft/deeptask"

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

mkdirSync(dirname(reportPath), { recursive: true })

try {
  const localHead = git("rev-parse", "HEAD")
  const remoteHead = git("ls-remote", "origin", "refs/heads/main").split(/\s+/)[0]
  const zh = git("show", `${remoteHead}:README.md`)
  const en = git("show", `${remoteHead}:README_EN.md`)
  const checks = {
    headsMatch: localHead === remoteHead,
    defaultIsChinese: zh.includes("面向长任务与真实工程交付"),
    chineseLinksEnglish: zh.includes('href="./README_EN.md"'),
    englishExists: en.includes("An AI coding agent engineered for long-running tasks"),
    englishLinksChinese: en.includes('href="./README.md"'),
    chineseIconPresent: zh.includes("src/assets/icons/kilo-dark.svg"),
    englishIconPresent: en.includes("src/assets/icons/kilo-dark.svg"),
  }
  const report = {
    repository,
    branch: "main",
    localHead,
    remoteHead,
    commitUrl: `https://github.com/${repository}/commit/${localHead}`,
    readmeUrl: `https://github.com/${repository}#readme`,
    englishReadmeUrl: `https://github.com/${repository}/blob/main/README_EN.md`,
    checks,
    passed: Object.values(checks).every(Boolean),
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(statusPath, report.passed ? "0\n" : "1\n")
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exitCode = 1
} catch (error) {
  const report = { passed: false, error: error instanceof Error ? error.message : String(error) }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(statusPath, "1\n")
  console.error(JSON.stringify(report, null, 2))
  process.exitCode = 1
}
