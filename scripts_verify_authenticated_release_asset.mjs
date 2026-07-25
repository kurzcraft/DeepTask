import fs from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"

const owner = "kurzgesagtcraft"
const repo = "deeptask"
const tag = "v5.5.0"
const assetName = "deeptask-5.5.0.vsix"
const localPath = "deeptask-5.5.0.vsix"

function getToken() {
  const output = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  })
  const fields = Object.fromEntries(
    output.trim().split("\n").map((line) => {
      const index = line.indexOf("=")
      return [line.slice(0, index), line.slice(index + 1)]
    }),
  )
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || fields.password
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function main() {
  const token = getToken()
  if (!token) throw new Error("Missing GitHub credential")
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const releaseResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
    { headers },
  )
  if (!releaseResponse.ok) throw new Error(`Release lookup failed: ${releaseResponse.status}`)
  const release = await releaseResponse.json()
  const asset = release.assets.find((candidate) => candidate.name === assetName)
  if (!asset) throw new Error(`Missing release asset: ${assetName}`)

  const assetResponse = await fetch(asset.url, {
    headers: { ...headers, Accept: "application/octet-stream" },
  })
  if (!assetResponse.ok) throw new Error(`Asset download failed: ${assetResponse.status}`)

  const local = fs.readFileSync(localPath)
  const remote = Buffer.from(await assetResponse.arrayBuffer())
  if (!local.equals(remote)) throw new Error("Release asset does not match local VSIX")

  console.log(JSON.stringify({
    releaseUrl: release.html_url,
    assetId: asset.id,
    assetState: asset.state,
    localSize: local.length,
    remoteSize: remote.length,
    sha256: sha256(local),
  }, null, 2))
}

await main()
