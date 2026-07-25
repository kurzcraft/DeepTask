import { useMemo, useState } from "react"

export const KiloLogo = () => {
	// kilocode_change start: Agent Manager uses the Deeptask icon injected by the webview host.
	const iconUri = useMemo(() => document.getElementById("root")?.dataset.deeptaskIconUri, [])
	const [imageFailed, setImageFailed] = useState(false)

	if (iconUri && !imageFailed) {
		return (
			<img
				src={iconUri}
				alt="Deeptask"
				onError={() => setImageFailed(true)}
				style={{
					display: "block",
					width: "100%",
					height: "100%",
					maxWidth: "100%",
					maxHeight: "100%",
					objectFit: "contain",
					borderRadius: 8,
				}}
			/>
		)
	}

	return (
		<svg
			aria-label="Deeptask"
			role="img"
			viewBox="0 0 48 48"
			width="100%"
			height="100%"
			style={{ display: "block", borderRadius: 8 }}>
			<rect width="48" height="48" rx="8" fill="var(--vscode-button-background)" />
			<path d="M14 12h14c5.5 0 10 4.5 10 10v4c0 5.5-4.5 10-10 10H14V12Zm8 7v10h5.5c1.9 0 3.5-1.6 3.5-3.5v-3c0-1.9-1.6-3.5-3.5-3.5H22Z" fill="var(--vscode-button-foreground)" />
		</svg>
	)
	// kilocode_change end
}
