import React from "react"
import { Mode, defaultModeSlug, getAllModes } from "@roo/modes"
import { ModeConfig } from "@roo-code/types"
import { SelectDropdown, DropdownOptionType } from "@/components/ui"
import type { DropdownOption } from "@/components/ui/select-dropdown" // kilocode_change
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"

interface KiloModeSelectorProps {
	value: Mode
	onChange: (value: Mode) => void
	modeShortcutText: string
	customModes?: ModeConfig[]
	disabled?: boolean
	title?: string
	triggerClassName?: string
	initiallyOpen?: boolean
}

export const KiloModeSelector = ({
	value,
	onChange,
	modeShortcutText,
	customModes,
	disabled = false,
	title,
	triggerClassName,
	initiallyOpen,
}: KiloModeSelectorProps) => {
	const { t } = useAppTranslation()
	const allModes = React.useMemo(() => getAllModes(customModes), [customModes])

	// Group modes by source
	// kilocode_change: the current mode is pinned to the top of the list so the
	// user immediately sees what is active without scanning the whole list.
	const { organizationModes, otherModes } = React.useMemo(() => {
		const orgModes = allModes.filter((mode) => mode.source === "organization" && mode.slug !== value)
		const other = allModes
			.filter((mode) => mode.source !== "organization" && mode.slug !== value)
			.slice()
			.sort((a, b) => {
				// Evolve series: higher numbers first so the newest fork shows above its predecessors.
				const num = (slug: string) => {
					const m = slug.match(/^evolve-(\d+)$/)
					return m ? Number(m[1]) : -1
				}
				const na = num(a.slug)
				const nb = num(b.slug)
				if (na >= 0 && nb >= 0) return nb - na
				if (na >= 0) return -1
				if (nb >= 0) return 1
				return 0
			})
		return { organizationModes: orgModes, otherModes: other }
	}, [allModes, value])

	const currentMode = React.useMemo(() => allModes.find((mode) => mode.slug === value), [allModes, value])

	const handleChange = React.useCallback(
		(selectedValue: string) => {
			const newMode = selectedValue as Mode
			onChange(newMode)
			vscode.postMessage({ type: "mode", text: selectedValue })
		},
		[onChange],
	)

	// Build options with organization modes grouped separately
	const options = React.useMemo(() => {
		const opts: DropdownOption[] = [
			{
				value: "shortcut",
				label: modeShortcutText,
				disabled: true,
				type: DropdownOptionType.SHORTCUT,
			},
		]

		// kilocode_change: pin the current mode as the very first selectable row.
		if (currentMode) {
			opts.push({
				value: currentMode.slug,
				label: currentMode.name,
				codicon: currentMode.iconName,
				description: currentMode.description,
				type: DropdownOptionType.ITEM,
			})
			opts.push({
				value: "sep-current",
				label: t("chat:separator"),
				type: DropdownOptionType.SEPARATOR,
			})
		}

		// Add organization modes section if any exist
		if (organizationModes.length > 0) {
			// Add header as a disabled item
			opts.push({
				value: "org-header",
				label: t("chat:modeSelector.organizationModes"),
				disabled: true,
				type: DropdownOptionType.SHORTCUT,
			})
			opts.push(
				...organizationModes.map((mode) => ({
					value: mode.slug,
					label: mode.name,
					codicon: mode.iconName || "codicon-organization",
					description: mode.description,
					type: DropdownOptionType.ITEM,
				})),
			)
			opts.push({
				value: "sep-org",
				label: t("chat:separator"),
				type: DropdownOptionType.SEPARATOR,
			})
		}

		// Add other modes
		opts.push(
			...otherModes.map((mode) => ({
				value: mode.slug,
				label: mode.name,
				codicon: mode.iconName,
				description: mode.description,
				type: DropdownOptionType.ITEM,
			})),
		)

		opts.push(
			{
				value: "sep-1",
				label: t("chat:separator"),
				type: DropdownOptionType.SEPARATOR,
			},
			{
				value: "promptsButtonClicked",
				label: t("chat:edit"),
				type: DropdownOptionType.ACTION,
			},
		)

		return opts
	}, [organizationModes, otherModes, modeShortcutText, t])

	return (
		<SelectDropdown
			value={allModes.find((m) => m.slug === value)?.slug ?? defaultModeSlug}
			title={title || t("chat:selectMode")}
			disabled={disabled}
			initiallyOpen={initiallyOpen}
			options={options}
			onChange={handleChange}
			shortcutText={modeShortcutText}
			triggerClassName={cn(
				"w-full bg-[var(--background)] border-[var(--vscode-input-border)] hover:bg-[var(--color-vscode-list-hoverBackground)]",
				triggerClassName,
			)}
		/>
	)
}

export default KiloModeSelector
