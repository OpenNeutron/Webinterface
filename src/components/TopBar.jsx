import { Search, ShieldCheck, Menu, Settings, LogOut, ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

/**
 * The chrome above the mail.
 *
 * Search is the only thing that grows; everything to its right is the account,
 * gathered behind one control so the bar does not turn into a row of adjectives.
 */
export function TopBar({
  searchQuery,
  onSearchChange,
  userEmail,
  isAdmin,
  serverStatus,
  onLogout,
  onRetryServer,
  onOpenNav,
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3 md:px-4">
        <button
          onClick={onOpenNav}
          className="rounded-md p-2 text-ink-2 transition-colors duration-120 hover:bg-accent hover:text-ink-1 md:hidden"
          aria-label="Open folders"
        >
          <Menu className="size-5" />
        </button>

        <div className="relative w-full max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            placeholder="Search mail"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 w-full rounded-lg border border-line bg-secondary/50 pl-9 pr-14 text-[13px] text-ink-1 placeholder:text-ink-3 focus:border-line-strong focus:bg-secondary focus:outline-none max-sm:h-11"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 py-0.5 mono text-[10px] text-ink-3 sm:block">
            ⌘K
          </kbd>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <span className="mono hidden max-w-[200px] truncate pr-2 text-[11.5px] text-ink-3 lg:inline">
            {userEmail}
          </span>

          <DropdownMenuRoot>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1.5 rounded-md py-1.5 pl-2 pr-1.5 text-[12.5px] text-ink-2 transition-colors duration-120 hover:bg-accent hover:text-ink-1 max-sm:min-h-11"
                aria-label="Account menu"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold uppercase text-ink-2">
                  {(userEmail || '?').slice(0, 2)}
                </span>
                <ChevronDown className="size-3.5 text-ink-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/settings" className="flex items-center gap-2">
                  <Settings className="size-4" /> Settings
                </Link>
              </DropdownMenuItem>
              {isAdmin && (
                <>
                  <DropdownMenuItem asChild>
                    <Link to="/admin" className="flex items-center gap-2">
                      <ShieldCheck className="size-4" /> Admin panel
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem destructive onClick={onLogout}>
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuRoot>
        </div>
      </div>

      {serverStatus === 'unreachable' && (
        <div className="flex items-center gap-3 border-b border-destructive/30 bg-destructive/[0.08] px-4 py-2 text-[12.5px] text-destructive">
          <span className="flex-1">
            Cannot reach the server. This is a connection problem, not a lost mailbox — nothing has
            been deleted.
          </span>
          <button
            onClick={onRetryServer}
            className="shrink-0 rounded-md border border-destructive/40 px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-120 hover:bg-destructive/15"
          >
            Try again
          </button>
        </div>
      )}
    </>
  )
}
