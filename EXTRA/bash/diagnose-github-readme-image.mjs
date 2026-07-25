import { execFileSync } from "node:child_process"

const owner = "kurzgesagtcraft"
const repo = "deeptask"
const ref = "main"

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

async function getJson(path, token) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${text}`)
  }
  return JSON.parse(text)
}

const token = getToken()
if (!token) throw new Error("Missing GitHub credential")

const repository = await getJson("", token)
const image = await getJson(`/contents/deeptask.jpg?ref=${ref}`, token)
const readme = await getJson(`/contents/README.md?ref=${ref}`, token)
const branch = await getJson(`/branches/${ref}`, token)

console.log(
  JSON.stringify(
    {
      repository: {
        private: repository.private,
        visibility: repository.visibility,
        defaultBranch: repository.default_branch,
        htmlUrl: repository.html_url,
      },
      branchCommit: branch.commit.sha,
      image: {
        name: image.name,
        path: image.path,
        size: image.size,
        sha: image.sha,
        downloadUrl: image.download_url,
      },
      readme: {
        size: readme.size,
        sha: readme.sha,
        downloadUrl: readme.download_url,
      },
    },
    null,
    2,
  ),
)
