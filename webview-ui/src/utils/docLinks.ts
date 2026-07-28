// kilocode_change start
const DEEPTASK_USER_GUIDE_URL = "https://github.com/kurzcraft/DeepTask/blob/main/docs/deeptask/guides/USER_GUIDE.md"

/** Build a stable Deeptask documentation URL while preserving local section anchors. */
export function buildDocLink(path: string, _campaign: string): string {
	const [, hash] = path.replace(/^\//, "").split("#")
	return hash ? `${DEEPTASK_USER_GUIDE_URL}#${hash}` : DEEPTASK_USER_GUIDE_URL
}
// kilocode_change end
