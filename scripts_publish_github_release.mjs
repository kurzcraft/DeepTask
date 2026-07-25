import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const owner = "kurzgesagtcraft"
const repo = "deeptask"
const tagName = "v5.5.0"
const targetCommitish = "main"
const releaseName = "Deeptask 5.5.0"
const assetPath = path.resolve("deeptask-5.5.0.vsix")
const notesPath = path.resolve("DEEPTASK_RELEASE_5.5.0_NOTES.md")

function getGitHubToken() {
  const input = "protocol=https\nhost=github.com\n\n"
  const output = execFileSync("git", ["credential", "fill"], {
    input,
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

async function githubJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  })

  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    const message = typeof data === "object" && data?.message ? data.message : text
    throw new Error(`${response.status} ${response.statusText}: ${message}`)
  }

  return data
}

async function main() {
  if (!fs.existsSync(assetPath)) throw new Error(`Missing VSIX: ${assetPath}`)
  if (!fs.existsSync(notesPath)) throw new Error(`Missing release notes: ${notesPath}`)

  const token = getGitHubToken()
  if (!token) throw new Error("No GitHub token from environment or git credential helper")

  const body = fs.readFileSync(notesPath, "utf8")
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`
  let release = null

  try {
    release = await githubJson(`${apiBase}/releases/tags/${tagName}`, token)
    release = await githubJson(`${apiBase}/releases/${release.id}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: releaseName, body, draft: false, prerelease: false }),
    })
  } catch (error) {
    if (!String(error.message).startsWith("404 ")) throw error
    release = await githubJson(`${apiBase}/releases`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tagName,
        target_commitish: targetCommitish,
        name: releaseName,
        body,
        draft: false,
        prerelease: false,
      }),
    })
  }

  const assetName = path.basename(assetPath)
  for (const asset of release.assets || []) {
    if (asset.name === assetName) {
      await githubJson(`${apiBase}/releases/assets/${asset.id}`, token, { method: "DELETE" })
    }
  }

  const uploadUrl = release.upload_url.replace("{?name,label}", `?name=${encodeURIComponent(assetName)}`)
  const assetBytes = fs.readFileSync(assetPath)
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(assetBytes.length),
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: assetBytes,
  })

  const uploadText = await uploadResponse.text()
  if (!uploadResponse.ok) {
    let message = uploadText
    try {
      message = JSON.parse(uploadText).message || uploadText
    } catch {}
    throw new Error(`${uploadResponse.status} ${uploadResponse.statusText}: ${message}`)
  }

  const uploadedAsset = JSON.parse(uploadText)
  console.log(JSON.stringify({
    releaseUrl: release.html_url,
    tagName: release.tag_name,
    assetName: uploadedAsset.name,
    assetSize: uploadedAsset.size,
    assetUrl: uploadedAsset.browser_download_url,
  }, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
