import * as React from "react"
import { PortalProps } from "@radix-ui/react-portal"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

// kilocode_change start: popover stability — gate dismissal on real pointer input
const PopoverContent = React.forwardRef<
	React.ElementRef<typeof PopoverPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & Pick<PortalProps, "container">
>(({ className, align = "center", sideOffset = 4, container, onFocusOutside, onInteractOutside, ...props }, ref) => {
	const lastRealPointerRef = React.useRef(0)

	return (
		<PopoverPrimitive.Portal container={container}>
			<PopoverPrimitive.Content
				ref={ref}
				align={align}
				sideOffset={sideOffset}
				className={cn(
					"z-50 w-72 rounded-xs p-4 shadow-xs outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
					"bg-popover",
					"border border-vscode-focusBorder",
					"text-popover-foreground",
					className,
				)}
				// Background state pushes (streaming postMessage → React re-renders →
				// focus resets) must not dismiss popovers. A real user pointer press
				// outside arrives as Radix custom event "dismissableLayer.pointerDownOutside",
				// followed by a native focus change. Gate BOTH outside channels on the
				// same "recent real pointer" signal: synthetic (programmatic) focus
				// changes are ignored while genuine clicks still close the popover.
				onFocusOutside={(event) => {
					onFocusOutside?.(event)
					if (event.defaultPrevented) return
					// Only a focus change that immediately follows a real pointer press
					// may close the popover; everything else is treated as synthetic.
					if (Date.now() - lastRealPointerRef.current > 200) {
						event.preventDefault()
					}
				}}
				onInteractOutside={(event) => {
					onInteractOutside?.(event)
					if (event.defaultPrevented) return
					// Radix dispatches "dismissableLayer.pointerDownOutside" (real
					// pointer press) and "dismissableLayer.focusOutside" (focus change,
					// possibly synthetic). Only the pointer press closes the popover.
					if (event.type === "dismissableLayer.pointerDownOutside") {
						lastRealPointerRef.current = Date.now()
					} else {
						event.preventDefault()
					}
				}}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	)
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName
// kilocode_change end

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
