import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, LogOut } from 'lucide-react'
import { storage } from '@/storage'
import api from '@/api'
import ProfileSection from '@/components/ProfileSection'
import PasswordSection from '@/components/PasswordSection'
import TwoFactorSection from '@/components/TwoFactorSection'
import SecurityKeysSection from '@/components/SecurityKeysSection'
import SessionsSection from '@/components/SessionsSection'
import { AliasesSection } from '@/components/AliasesSection'
import NotificationsSection from '@/components/NotificationsSection'
import AppearanceSection from '@/components/AppearanceSection'
import KeysSection from '@/components/KeysSection'
import RecoveryKeySection from '@/components/RecoveryKeySection'
import ExportSection from '@/components/ExportSection'
import ImportSection from '@/components/ImportSection'
import PostQuantumSection from '@/components/PostQuantumSection'
import DeletionLogSection from '@/components/DeletionLogSection'
import DeleteAccountSection from '@/components/DeleteAccountSection'

/**
 * Settings is a page, not a modal.
 *
 * It used to be a dialog called "OpenPGP" holding nine unrelated things: the back
 * button did nothing, a phone could not fill it, and nothing was findable. Four
 * groups, identity first and anything destructive last.
 */
const GROUPS = [
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'profile', label: 'Profile', title: 'Profile', note: 'The name people see when your mail arrives, and the signature added below it.', Component: ProfileSection },
      { id: 'password', label: 'Password', title: 'Password', note: 'What unlocks this account and the key behind it.', Component: PasswordSection },
      { id: 'two-factor', label: 'Two-factor', title: 'Two-factor authentication', note: 'A second proof at sign-in, so a stolen password is not enough on its own.', Component: TwoFactorSection },
      { id: 'security-keys', label: 'Security keys', title: 'Security keys', note: 'A YubiKey or another hardware key that proves it is you at sign-in, so a stolen password is not enough.', Component: SecurityKeysSection },
      { id: 'sessions', label: 'Signed-in devices', title: 'Signed-in devices', note: 'Every browser holding a session right now. You can end any of them.', Component: SessionsSection },
    ],
  },
  {
    id: 'mail',
    label: 'Mail',
    items: [
      { id: 'addresses', label: 'Addresses', title: 'Addresses', note: 'Extra addresses that deliver into this mailbox, and that replies can leave from.', Component: AliasesSection },
      { id: 'notifications', label: 'Notifications', title: 'New mail notifications', note: 'How this browser tells you mail arrived while the app is closed.', Component: NotificationsSection },
      { id: 'appearance', label: 'Appearance', title: 'Appearance', note: 'Theme and row density, stored on this device only.', Component: AppearanceSection },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    items: [
      { id: 'keys', label: 'Encryption keys', title: 'Encryption keys', note: 'The OpenPGP key that lets you exchange encrypted mail with other providers.', Component: KeysSection, takesEmail: true },
      // Sits directly under the keys it extends, because it is not a separate
      // feature: it is a stronger half of the same seal.
      { id: 'post-quantum', label: 'Post-quantum', title: 'Post-quantum protection', note: 'A second half to the key that seals new mail, so breaking RSA alone does not open it.', Component: PostQuantumSection },
      { id: 'deletion-log', label: 'Deletion log', title: 'Deletion log', note: 'Messages deleted from this mailbox, in a record that cannot be silently rewritten.', Component: DeletionLogSection },
      { id: 'recovery', label: 'Recovery', title: 'Recovery key', note: 'The only way back into encrypted mail if you forget your password.', Component: RecoveryKeySection },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    items: [
      { id: 'export', label: 'Export', title: 'Export', note: 'A copy of every message, in a format any mail program can read.', Component: ExportSection },
      // Import sits next to export on purpose: leaving and arriving should be
      // one pair of doors, not a feature on each side of the product.
      { id: 'import', label: 'Import', title: 'Import mail', note: 'Bring an archive from another provider into this mailbox.', Component: ImportSection },
      { id: 'delete', label: 'Delete account', title: 'Delete account', note: 'Removes the mailbox, the keys and every message. This cannot be undone.', Component: DeleteAccountSection, destructive: true },
    ],
  },
]

export default function Settings() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [active, setActive] = useState('profile')
  // On a phone the section list is an index, not a strip: one tap opens a section,
  // and "All settings" comes back. The strip scrolled horizontally and highlighted
  // like tabs while still showing every section stacked underneath, so "Export" and
  // "Delete account" were simply not findable.
  const [phone, setPhone] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  const [openSection, setOpenSection] = useState(null)

  const items = GROUPS.flatMap((g) => g.items)
  const opened = items.find((i) => i.id === openSection) ?? null

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = (e) => {
      setPhone(e.matches)
      if (!e.matches) setOpenSection(null)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!storage.getToken()) {
      navigate('/login', { replace: true })
      return
    }
    api
      .get('/user/me', { headers: { Authorization: `Bearer ${storage.getToken()}` } })
      .then((res) => setEmail(res.data?.email ?? res.data?.username ?? ''))
      .catch(() => { /* the page still works; the address is only shown in two places */ })
  }, [navigate])

  // A link to a section has to land on it. On a phone that means opening the section
  // itself, because nothing else is on screen.
  useEffect(() => {
    const jump = () => {
      const id = decodeURIComponent(window.location.hash.replace('#', ''))
      if (!id) return
      if (window.matchMedia('(max-width: 767px)').matches) {
        setOpenSection(id)
        window.scrollTo({ top: 0, behavior: 'auto' })
        return
      }
      const el = document.getElementById(id)
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY - 72
      window.scrollTo({ top, behavior: 'auto' })
      // The scroll spy only listens for scroll events, and a jump is not one:
      // without this the nav kept highlighting the section you started on.
      window.dispatchEvent(new Event('scroll'))
    }
    const timer = setTimeout(jump, 80)
    window.addEventListener('hashchange', jump)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('hashchange', jump)
    }
  }, [])

  // Mark the section being read. Cheap scroll spy: the last heading above the fold.
  useEffect(() => {
    const ids = items.map((i) => i.id)
    const onScroll = () => {
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 120) current = id
      }
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Keep the desktop rail's active row visible; a phone has no rail to scroll.
  useEffect(() => {
    const nav = document.getElementById('settings-nav')
    if (!nav || nav.scrollWidth <= nav.clientWidth) return
    const current = nav.querySelector('[aria-current="true"]')
    if (!current) return
    const n = nav.getBoundingClientRect(), c = current.getBoundingClientRect()
    if (c.left >= n.left && c.right <= n.right) return
    nav.scrollTo({ left: current.offsetLeft - 16, behavior: 'auto' })
  }, [active])

  const signOut = () => {
    storage.clear?.()
    navigate('/login', { replace: true })
  }

  // The rule cannot see JSX usage here: eslint-plugin-react is not installed, so
  // `<Component />` reads as an unused variable.
  // eslint-disable-next-line no-unused-vars
  const renderSection = ({ id, title, note, Component, takesEmail, destructive }) => (
    <section key={id} id={id} className="scroll-mt-24">
      {/* The phone's app bar already names this section; a second heading 40 px below it
          is the same word twice. The note stays, because it is the only explanation. */}
      {!phone && (
        <h2 className={`display text-[18px] ${destructive ? 'text-destructive' : 'text-ink-1'}`}>
          {title}
        </h2>
      )}
      <p className={`max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3 ${phone ? 'mb-3' : 'mt-1'}`}>
        {note}
      </p>
      <div
        className={`mt-4 rounded-xl border bg-card p-4 max-sm:p-3 ${
          destructive ? 'border-destructive/30' : 'border-line'
        }`}
      >
        <Component {...(takesEmail ? { accountEmail: email } : {})} />
      </div>
    </section>
  )

  return (
    <div className="settings-scope min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-[1080px] items-center gap-3 px-4">
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-ink-2 transition-colors duration-120 hover:bg-accent hover:text-ink-1 max-sm:min-h-11"
          >
            <ArrowLeft className="size-3.5" /> Mail
          </Link>
          <span className="display text-[16px] text-ink-1">
            {phone && opened ? opened.label : 'Settings'}
          </span>
          <span className="mono ml-auto hidden truncate text-[11.5px] text-ink-3 sm:inline">{email}</span>
          <button
            onClick={signOut}
            className="rounded-md p-2 text-ink-3 transition-colors duration-120 hover:bg-accent hover:text-ink-1 max-sm:ml-auto max-sm:p-3"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1080px] px-4 pb-24 pt-6 md:flex md:gap-12">
        {/* Wider windows keep the rail: it is a good map when there is room for one. */}
        <div className="relative hidden md:contents">
          <nav
            id="settings-nav"
            aria-label="Settings sections"
            className="custom-scrollbar md:sticky md:top-20 md:h-fit md:w-[188px] md:shrink-0 md:flex-col md:overflow-visible md:px-0"
          >
            {GROUPS.map((group) => (
              <div key={group.id} className="contents md:block md:pb-4">
                <p className="label hidden px-2 pb-1 md:block">{group.label}</p>
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={() => setActive(item.id)}
                    aria-current={active === item.id ? 'true' : undefined}
                    className={`block shrink-0 whitespace-nowrap rounded-md border-l-2 px-2.5 py-1.5 text-[12.5px] transition-colors duration-120 ${
                      active === item.id
                        ? 'border-primary bg-secondary font-medium text-ink-1'
                        : 'border-transparent text-ink-2 hover:bg-accent hover:text-ink-1'
                    }`}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </div>

        {/* Phone: an index of sections, each one tap away, then the section alone. */}
        {phone && !opened && (
          <div className="w-full space-y-5">
            {GROUPS.map((group) => (
              <div key={group.id}>
                <p className="label px-1 pb-2">{group.label}</p>
                <div className="grid grid-cols-2 gap-2">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setOpenSection(item.id)
                        setActive(item.id)
                        window.scrollTo({ top: 0, behavior: 'auto' })
                      }}
                      className={`flex min-h-[56px] items-center rounded-lg border border-line bg-card px-3 py-2.5 text-left transition-colors duration-120 active:bg-accent ${
                        item.destructive ? 'col-span-2 mt-1 border-destructive/30' : ''
                      }`}
                    >
                      {/* No description here: two columns truncate every one of them to an
                          ellipsis, which reads as broken. The opened section carries the
                          full note, above its controls. */}
                      <span
                        className={`text-[13.5px] leading-snug ${
                          item.destructive ? 'text-destructive' : 'text-ink-1'
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {phone && opened && (
          <div className="w-full">
            <button
              type="button"
              onClick={() => {
                setOpenSection(null)
                window.scrollTo({ top: 0, behavior: 'auto' })
              }}
              className="mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-[13px] text-ink-2 transition-colors duration-120 active:text-ink-1"
            >
              <span aria-hidden="true">←</span> All settings
            </button>
            <main className="min-w-0">{renderSection(opened)}</main>
          </div>
        )}

        {!phone && (
          <main className="min-w-0 flex-1 space-y-10">
            {GROUPS.map((group) => (
              <div key={group.id} className="space-y-10">
                {group.items.map(renderSection)}
              </div>
            ))}
          </main>
        )}
      </div>
    </div>
  )
}
