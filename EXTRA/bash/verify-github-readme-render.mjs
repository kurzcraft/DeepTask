import { execFileSync } from "node:child_process"

const owner = "kurzgesagtcraft"
const repo = "deeptask"
const apiBase = `https://api.github.com/repos/${owner}/${repo}`

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

async function request(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${url}: ${body}`)
  return body
}

const token = getToken()
if (!token) throw new Error("Missing GitHub credential")

const branch = JSON.parse(await request(`${apiBase}/branches/main`, token))
const readmeObject = JSON.parse(await request(`${apiBase}/contents/README.md?ref=main`, token))
const markdown = Buffer.from(readmeObject.content, "base64").toString("utf8")
const rendered = await request("https://api.github.com/markdown", token, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: markdown, mode: "gfm", context: `${owner}/${repo}` }),
})

const imageTags = [...rendered.matchAll(/<(?:img|source)\b[^>]*(?:src|srcset)="([^"]+)"[^>]*>/g)].map(
  (match) => match[1],
)

console.log(
  JSON.stringify(
    {
      branchCommit: branch.commit.sha,
      readmeSha: readmeObject.sha,
      usesBrokenDeeptaskJpg: markdown.includes("deeptask.jpg"),
      hasPicture: rendered.includes("<picture>"),
      renderedImageUrls: imageTags.slice(0, 6),
    },
    null,
    2,
  ),
)

const localHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
if (branch.commit.sha !== localHead) {
  throw new Error(`Remote commit ${branch.commit.sha} does not match local HEAD ${localHead}`)
}
if (markdown.includes("deeptask.jpg")) throw new Error("Remote README still references broken image")
if (!rendered.includes("<picture>")) throw new Error("GitHub removed the picture element")
if (imageTags.length < 3) throw new Error("GitHub did not render all theme-aware image resources")
