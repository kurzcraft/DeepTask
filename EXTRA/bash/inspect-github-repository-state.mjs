import { execFileSync } from "node:child_process"

const apiUrl = "https://api.github.com/repos/kurzgesagtcraft/deeptask"

function getToken() {
  const output = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  })
  const fields = Object.fromEntries(
    output
      .trim()
      .split("\n")
      .map((line) => {
        const index = line.indexOf("=")
        return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)]
      }),
  )
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || fields.password
}

async function request(label, headers) {
  const response = await fetch(apiUrl, { headers })
  const text = await response.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {
    // Preserve the response text for diagnosis.
  }
  console.log(
    JSON.stringify(
      {
        label,
        status: response.status,
        body:
          typeof body === "object"
            ? {
                message: body.message,
                private: body.private,
                visibility: body.visibility,
                archived: body.archived,
                disabled: body.disabled,
                fork: body.fork,
                defaultBranch: body.default_branch,
                pushedAt: body.pushed_at,
                updatedAt: body.updated_at,
                permissions: body.permissions,
                securityAndAnalysis: body.security_and_analysis,
              }
            : body,
      },
      null,
      2,
    ),
  )
}

await request("anonymous", {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
})

const token = getToken()
if (!token) throw new Error("Missing GitHub credential")
await request("authenticated", {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
})
