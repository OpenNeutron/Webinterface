import { Link } from 'react-router-dom'
import EmptyArt from '@/components/EmptyArt'
import SlothMark from '@/components/SlothMark'
import { storage } from '@/storage'

/**
 * A route that does not exist used to render nothing at all — a blank page with
 * no way out. This says what happened and offers the two doors that exist.
 */
export default function NotFound() {
  const signedIn = !!storage.getToken?.()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="flex items-center gap-2 text-ink-2">
        <SlothMark className="size-6" />
        <span className="label">Sloth Lee Mail</span>
      </div>

      <EmptyArt kind="search" className="mt-10 h-16 w-[84px] text-ink-4" />

      <h1 className="display mt-5 text-[24px] text-ink-1">This page does not exist</h1>
      <p className="mt-2 max-w-[42ch] text-[13px] leading-relaxed text-ink-3">
        The link may be mistyped, or the page may have moved. Nothing was lost — your mail is
        where you left it.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          to={signedIn ? '/' : '/login'}
          className="rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity duration-120 hover:opacity-90"
        >
          {signedIn ? 'Back to the inbox' : 'Sign in'}
        </Link>
      </div>

      <p className="mono mt-10 text-[10.5px] uppercase tracking-[0.14em] text-ink-4">
        404 · slothlee.xyz
      </p>
    </div>
  )
}
