import * as React from "react"
import { ContextMenu } from "radix-ui"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

const ContextMenuRoot = ContextMenu.Root
const ContextMenuTrigger = ContextMenu.Trigger
const ContextMenuGroup = ContextMenu.Group
const ContextMenuSub = ContextMenu.Sub
const ContextMenuPortal = ContextMenu.Portal

const ContextMenuSubTrigger = React.forwardRef(({ className, inset, children, ...props }, ref) => (
  <ContextMenu.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors focus:bg-accent focus:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto size-3 opacity-50" />
  </ContextMenu.SubTrigger>
))
ContextMenuSubTrigger.displayName = "ContextMenuSubTrigger"

const ContextMenuSubContent = React.forwardRef(({ className, ...props }, ref) => (
  <ContextMenu.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[10rem] overflow-hidden rounded-lg border border-line bg-popover backdrop-blur-xl p-1 shadow-2xl text-foreground",
      className
    )}
    {...props}
  />
))
ContextMenuSubContent.displayName = "ContextMenuSubContent"

const ContextMenuContent = React.forwardRef(({ className, ...props }, ref) => (
  <ContextMenu.Portal>
    <ContextMenu.Content
      ref={ref}
      className={cn(
        "z-50 min-w-[11rem] overflow-hidden rounded-lg border border-line bg-popover backdrop-blur-xl p-1 shadow-2xl text-foreground",
        className
      )}
      {...props}
    />
  </ContextMenu.Portal>
))
ContextMenuContent.displayName = "ContextMenuContent"

const ContextMenuItem = React.forwardRef(({ className, inset, destructive, ...props }, ref) => (
  <ContextMenu.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs outline-none transition-colors focus:bg-accent focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      inset && "pl-8",
      destructive
        ? "text-red-400/80 focus:bg-red-950/40 focus:text-red-300"
        : "text-foreground/80",
      className
    )}
    {...props}
  />
))
ContextMenuItem.displayName = "ContextMenuItem"

const ContextMenuSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <ContextMenu.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-line", className)}
    {...props}
  />
))
ContextMenuSeparator.displayName = "ContextMenuSeparator"

const ContextMenuLabel = React.forwardRef(({ className, inset, ...props }, ref) => (
  <ContextMenu.Label
    ref={ref}
    className={cn(
      "px-2.5 py-1 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider select-none",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
ContextMenuLabel.displayName = "ContextMenuLabel"

export {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuGroup,
  ContextMenuSub,
  ContextMenuPortal,
}
