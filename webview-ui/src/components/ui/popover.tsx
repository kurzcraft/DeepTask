import * as React from "react"
import { PortalProps } from "@radix-ui/react-portal"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

// kilocode_change start: popover stability — native outside-close (right-corner design)
// Radix dismissableLayer close channels (focus/interact outside) proved unreliable in
// the real webview: synthetic focus resets during streaming re-renders dismissed
// popovers, and after gating those, real clicks outside stopped closing them. The
// bottom-right KiloRulesToggleModal has always been stable because it ignores Radix
// dismissal entirely and listens to native document pointerdown (useClickAway). This
// wrapper adopts the same design:
//   * Radix outside-dismissal channels are always prevented — Radix never closes
//     the popover on focus/interact events. Escape keeps working (keyboard).
//   * A native document pointerdown listener closes the popover when the press
//     lands outside BOTH the content and its trigger (trigger clicks keep their
//     built-in toggle behavior, so no double-toggle).
type NativePopoverController = {
	close: () => void
	registerTrigger: (node: HTMLElement | null) => void
	isTriggerNode: (node: Node) => boolean
}
const PopoverControllerContext = React.createContext<NativePopoverController | undefined>(undefined)

const PopoverRoot: React.FC<
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root> & { children?: React.ReactNode }
> = ({ open, onOpenChange, defaultOpen, ...props }) => {
	const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
	const isControlled = open !== undefined
	const triggerRef = React.useRef<HTMLElement | null>(null)

	const controller = React.useMemo<NativePopoverController>(
		() => ({
			close: () => {
				if (!isControlled) {
					setUncontrolledOpen(false)
				}
				onOpenChange?.(false)
			},
			registerTrigger: (node) => {
				triggerRef.current = node
			},
			isTriggerNode: (node) => {
				const trigger = triggerRef.current
				return !!trigger && (trigger === node || trigger.contains(node))
			},
		}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[isControlled, onOpenChange],
	)

	return (
		<PopoverControllerContext.Provider value={controller}>
			<PopoverPrimitive.Root
				open={isControlled ? open : uncontrolledOpen}
				onOpenChange={(next) => {
					if (!isControlled) {
						setUncontrolledOpen(next)
					}
					onOpenChange?.(next)
				}}
				{...props}
			/>
		</PopoverControllerContext.Provider>
	)
}

const Popover = PopoverRoot

const PopoverTrigger = React.forwardRef<React.ElementRef<typeof PopoverPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>>(
	({ ...props }, ref) => {
		const controller = React.useContext(PopoverControllerContext)
		const setRefs = React.useCallback(
			(node: HTMLButtonElement | null) => {
				controller?.registerTrigger(node)
				if (typeof ref === "function") {
					ref(node)
				} else if (ref) {
					;(ref as React.MutableRefObject<HTMLButtonElement | null>).current = node
				}
			},
			[controller, ref],
		)
		return <PopoverPrimitive.Trigger ref={setRefs} {...props} />
	},
)
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
	React.ElementRef<typeof PopoverPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & Pick<PortalProps, "container">
>(({ className, align = "center", sideOffset = 4, container, onPointerDownOutside, onFocusOutside, onInteractOutside, ...props }, ref) => {
	const controller = React.useContext(PopoverControllerContext)
	const contentRef = React.useRef<HTMLDivElement | null>(null)

	const setRefs = React.useCallback(
		(node: HTMLDivElement | null) => {
			contentRef.current = node
			if (typeof ref === "function") {
				ref(node)
			} else if (ref) {
				;(ref as React.MutableRefObject<HTMLDivElement | null>).current = node
			}
		},
		[ref],
	)

	React.useEffect(() => {
		if (!controller) return
		const doc = contentRef.current?.ownerDocument ?? document
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target
			const node = target instanceof Node ? target : null
			if (!node) return
			// Inside the content (including the popper positioning wrapper).
			let cursor: Node | null = node
			while (cursor) {
				if (cursor === contentRef.current) return
				if (cursor instanceof HTMLElement && cursor.hasAttribute("data-radix-popper-content-wrapper")) {
					return
				}
				cursor = cursor.parentNode
			}
			// Clicks on the trigger itself keep Radix's built-in toggle behavior.
			if (controller.isTriggerNode(node)) return
			controller.close()
		}
		doc.addEventListener("pointerdown", onPointerDown, true)
		return () => {
			doc.removeEventListener("pointerdown", onPointerDown, true)
		}
	}, [controller])

	return (
		<PopoverPrimitive.Portal container={container}>
			<PopoverPrimitive.Content
				ref={setRefs}
				align={align}
				sideOffset={sideOffset}
				className={cn(
					"z-50 w-72 rounded-xs p-4 shadow-xs outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
					"bg-popover",
					"border border-vscode-focusBorder",
					"text-popover-foreground",
					className,
				)}
				// Radix dismissableLayer channels are fully disabled: streaming
				// re-renders fire synthetic focus/interact events that either
				// wrongly dismiss the popover or, once gated, wrongly block real
				// clicks. Outside-close is handled natively by the document
				// pointerdown listener above (right-corner design).
				onPointerDownOutside={(event) => {
					onPointerDownOutside?.(event)
					event.preventDefault()
				}}
				onFocusOutside={(event) => {
					onFocusOutside?.(event)
					event.preventDefault()
				}}
				onInteractOutside={(event) => {
					onInteractOutside?.(event)
					event.preventDefault()
				}}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	)
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName
// kilocode_change end

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
