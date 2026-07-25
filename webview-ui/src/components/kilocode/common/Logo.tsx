export default function Logo({ width = 100, height = 100 }: { width?: number; height?: number }) {
	return (
		<svg
			id="Deeptask_Branding"
			xmlns="http://www.w3.org/2000/svg"
			version="1.1"
			viewBox="0 0 256 256"
			className="mb-4 mt-4"
			width={width}
			height={height}
			role="img"
			aria-label="Deeptask">
			<path
				d="M128 10L62 220L128 182L128 10Z"
				fill="none"
				stroke="var(--vscode-descriptionForeground)"
				strokeWidth="10"
				strokeLinejoin="round"
			/>
			<path d="M128 10L194 220L128 182V10Z" fill="var(--vscode-descriptionForeground)" />
		</svg>
	)
}
