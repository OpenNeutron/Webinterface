import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { ExternalLink } from 'lucide-react'
import { segmentLinks } from '@/emailParser'
import { looksEncrypted } from '@/lib/pgpRing'

// The OpenPGP library loads with the first encrypted message, not with the app.
const PgpBody = lazy(() => import('@/components/email/PgpBody').then((m) => ({ default: m.PgpBody })))

// Configure DOMPurify: strip scripts/event-handlers, force all links to open in new tab
const DOMPURIFY_CONFIG = {
  FORBID_TAGS: ['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['action', 'formaction'],
  ADD_ATTR: ['target', 'rel'],
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

// Pull the armour out of whichever part carries it: in an HTML part it arrives
// wrapped in tags, and decryptBody needs the bare block.
function extractArmor(value) {
  if (typeof value !== 'string' || !looksEncrypted(value)) return null
  const match = value.match(/-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/)
  return match ? match[0] : null
}

function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG)
}

// A message is written against a pixel canvas: 600px tables, 480px columns, 8px text.
// Every width is dropped and the message is allowed to reflow — inside its own frame it
// cannot drag the reader's column about, so the widths have nothing left to protect.
// What survives is the sender's structure, colours and type sizes; what goes is the
// fixed canvas, which is the thing that made a phone show half a sentence.
//
// `nowrap` is an attribute, not a style, and old mail puts it on cells so a single
// line of text holds a column open at any screen width. It always goes.
const CANVAS_WIDTH = 0

// Does the message dress itself? A newsletter declares a background and its own ink;
// our own compose does not, and rendering that on white paper made a dark app show a
// white slab with pale orange text on it — near-invisible, and the loudest thing on the
// screen. So: if the sender declares a background, their design wins; if not, the
// message is rendered on the app's paper, in the app's ink.
function declaresBackground(doc) {
  const hasBg = (el) => {
    if (!el) return false
    if (el.getAttribute && el.getAttribute('bgcolor')) return true
    const style = el.getAttribute && el.getAttribute('style')
    if (!style) return false
    return /(background|background-color)\s*:\s*(?!transparent|inherit|none)/i.test(style)
  }
  if (hasBg(doc.documentElement) || hasBg(doc.body)) return true
  for (const el of doc.body.querySelectorAll('[style],[bgcolor],table,td,div')) {
    if (hasBg(el)) return true
  }
  return false
}

function prepareMail(html, { senderThemed }) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of doc.body.querySelectorAll('*')) {
    el.removeAttribute('nowrap')

    const attr = el.getAttribute('width')
    if (attr && parseInt(attr, 10) >= CANVAS_WIDTH) el.removeAttribute('width')

    const style = el.getAttribute('style')
    if (!style) continue
    const kept = style
      .split(';')
      .map((decl) => decl.trim())
      .filter((decl) => {
        if (!decl) return false
        if (/^white-space\s*:\s*nowrap/i.test(decl)) return false
        // A colour written for a dark compose editor is illegible on the paper a
        // message without a background gets. The sender declared no look of their own,
        // so the app's ink applies.
        if (!senderThemed && /^(color|background|background-color)\s*:/i.test(decl)) return false
        const w = decl.match(/^width\s*:\s*(\d+)px/i)
        if (w && Number(w[1]) >= CANVAS_WIDTH) return false
        return true
      })
    if (kept.length) el.setAttribute('style', kept.join('; '))
    else el.removeAttribute('style')
  }
  return doc.body.innerHTML
}

// Heuristic: treat textBody as HTML if it starts with an HTML tag
function looksLikeHtml(text) {
  return /^\s*<[a-zA-Z]/.test(text)
}

const ATTR_RE = /^On .{3,300} wrote:\s*$/

function parseBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('>')) {
      const start = i
      while (i < lines.length && lines[i].startsWith('>')) i++
      blocks.push({ type: 'quote', lines: lines.slice(start, i) })
    } else if (ATTR_RE.test(line.trim()) && i + 1 < lines.length && lines[i + 1].startsWith('>')) {
      blocks.push({ type: 'attribution', content: line })
      i++
    } else {
      const start = i
      while (
        i < lines.length &&
        !lines[i].startsWith('>') &&
        !(ATTR_RE.test(lines[i].trim()) && i + 1 < lines.length && lines[i + 1].startsWith('>'))
      ) i++
      const content = lines.slice(start, i).join('\n')
      if (content.trim()) blocks.push({ type: 'text', content })
    }
  }
  return blocks
}

function stripQuotePrefix(line) {
  return line.replace(/^>+\s?/, '')
}

function TextWithLinks({ text }) {
  return segmentLinks(text).map((seg, i) =>
    seg.type === 'link' ? (
      <a
        key={i}
        href={seg.value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline decoration-primary/40 hover:decoration-primary inline-flex items-baseline gap-0.5 break-all"
      >
        {seg.value}
        <ExternalLink className="size-3 inline shrink-0 opacity-60 ml-0.5 self-center" />
      </a>
    ) : (
      <span key={i}>{seg.value}</span>
    ),
  )
}

// Mail gets its own viewport.
//
// The reader used to render mail straight into the page, which meant the message and
// the app fought over the same layout: a 600px table inside a scroll-area wrapper that
// sizes to its widest child widened the *column*, so the right edge was cut off while
// the page itself showed no overflow at all — invisible to every overflow check.
//
// So the message is rendered in a sandboxed frame at its own width, and the frame is
// then fitted to the column with one transform. Two passes:
//
//   1. Frame at the column width. Canvas widths (>=480px) were dropped by
//      prepareMail, so most mail reflows and is shown at 100%.
//   2. If the message still cannot fit — a 40-column table, an image grid — the frame
//      is widened to what it actually needs (capped at 900px) and scaled down to the
//      column, the way a PDF page fits a screen. Complete and uncut, never reflowed
//      into nonsense.
//
// Scripts cannot run here: the frame is sandboxed without `allow-scripts`, and
// `allow-same-origin` exists only so we can measure the document's height.
const FRAME_MAX_WIDTH = 900
const SENDER_PAPER = { bg: '#fff', ink: '#14150f', link: '#0a5f42', quote: '#5b5b52', rule: '#d6d3c8', scheme: 'light' }
const paperCss = (paper) => `
  :root { color-scheme: ${paper.scheme}; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; padding: 0; background: ${paper.bg}; color: ${paper.ink};
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  table { max-width: 100% !important; }
  td, th { overflow-wrap: anywhere; }
  img, video { max-width: 100% !important; height: auto !important; }
  /* Mail from a decade ago is set in 8px type. A floor on prose only: table cells keep
     the sender's sizes, because flattening those redraws their layout. */
  p, li, blockquote { font-size: max(13px, 1em) !important; }
  td p, th p { font-size: inherit !important; }
  a { color: ${paper.link}; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  blockquote { margin: .5em 0; padding-left: .75em; border-left: 2px solid ${paper.rule}; color: ${paper.quote}; }
  h1, h2, h3 { line-height: 1.3; }
`

function buildDocument(html, paper) {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>${paperCss(paper)}</style></head><body>${html}</body></html>`
}

// The app's own tokens, resolved once per render: inside the frame there are no
// variables to inherit, so the paper is passed in as literal colours.
function appPaper() {
  const cs = getComputedStyle(document.documentElement)
  const read = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback
  const dark = document.documentElement.dataset.theme !== 'light'
  return {
    bg: read('--color-background', dark ? '#10150f' : '#f6f6f0'),
    ink: read('--color-ink-1', dark ? '#e8ece2' : '#1a1c16'),
    link: read('--color-primary', '#8fd694'),
    quote: read('--color-ink-3', dark ? '#98a68e' : '#55604e'),
    rule: read('--color-line', dark ? '#27301f' : '#dcded4'),
    scheme: dark ? 'dark' : 'light',
  }
}

function MailFrame({ html, senderThemed }) {
  const wrapRef = useRef(null)
  const frameRef = useRef(null)
  const measureRef = useRef(null)
  const lastWidth = useRef(0)
  const [src, setSrc] = useState('')
  const [view, setView] = useState({ scale: 1, mode: 'fit', canFitWhole: false })
  const [override, setOverride] = useState(null)

  // A theme change has to rebuild the document: the paper colours are baked into it.
  const [paperKey, setPaperKey] = useState(0)
  useEffect(() => {
    const onAppearance = () => setPaperKey((k) => k + 1)
    window.addEventListener('sloth:appearance', onAppearance)
    return () => window.removeEventListener('sloth:appearance', onAppearance)
  }, [])

  useEffect(() => {
    const paper = senderThemed ? SENDER_PAPER : appPaper()
    const url = URL.createObjectURL(new Blob([buildDocument(html, paper)], { type: 'text/html' }))
    setSrc(url)
    setOverride(null)
    return () => URL.revokeObjectURL(url)
  }, [html, senderThemed, paperKey])

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    const frame = frameRef.current
    if (!wrap || !frame) return
    const doc = frame.contentDocument
    if (!doc || !doc.body) return

    const availW = Math.floor(wrap.clientWidth)
    if (!availW) return

    const docEl = doc.documentElement
    const bodyEl = doc.body

    // Clear whatever the previous pass left on the message before measuring it.
    bodyEl.style.transform = 'none'
    bodyEl.style.width = ''
    docEl.style.overflowX = ''
    frame.style.transform = 'none'
    frame.style.width = `${availW}px`
    frame.style.height = '10px'
    void frame.offsetHeight

    // The width the message insists on, measured in a frame exactly as wide as the
    // column. Mail that reflows answers `availW`; a fixed 600px newsletter answers 600.
    const naturalW = Math.max(docEl.scrollWidth, bodyEl.scrollWidth)
    const layoutW = Math.min(Math.max(naturalW, availW), FRAME_MAX_WIDTH)
    const fitScale = layoutW > availW + 2 ? Math.min(1, availW / layoutW) : 1

    // Height is measured at the width it will actually be laid out at, never at the
    // squeezed one, or the scale is computed from the wrong aspect ratio.
    if (layoutW > availW + 2) {
      bodyEl.style.width = `${layoutW}px`
      void frame.offsetHeight
    }
    const contentH = Math.max(docEl.scrollHeight, bodyEl.scrollHeight)

    const top = wrap.getBoundingClientRect().top
    const availH = Math.max(window.innerHeight - top - 20, 200)
    const wholeScale = Math.min(fitScale, availH / contentH)

    let scale = fitScale
    let mode = fitScale < 0.985 ? 'fit' : 'full'
    if (override === 'whole') {
      scale = wholeScale
      mode = 'whole'
    } else if (wholeScale >= 0.65) {
      // "The whole email on one screen" is the point of this reader, so a message that
      // fits at 70% or better is shown whole rather than scrolled. Below that the type
      // stops being text and the message keeps its width instead. The floor is 65%
      // because a 360x640 phone leaves 368px after the reader header: a 547px message
      // needs 67%, and refusing that means refusing on every small screen.
      scale = wholeScale
      mode = 'whole'
    }

    // Shrink the message *inside* a frame that is never wider than the column. Widening
    // the frame instead was the bug that put a 600px message into the reader's scroll
    // area — whose content wrapper is a table that sizes to its widest child — so the
    // whole page grew past the screen and the app's own header was cut off with it.
    if (scale < 1) {
      bodyEl.style.transform = `scale(${scale})`
      bodyEl.style.transformOrigin = 'top left'
      docEl.style.overflowX = 'hidden'
    }
    const renderedH = Math.ceil(contentH * scale)
    frame.style.height = `${renderedH}px`
    wrap.style.height = `${renderedH}px`
    wrap.style.overflowX = 'hidden'
    wrap.dataset.scale = scale.toFixed(3)
    wrap.dataset.mode = mode
    wrap.dataset.layout = String(Math.round(layoutW))
    wrap.dataset.content = `${Math.round(naturalW)}x${Math.round(contentH)}`

    lastWidth.current = availW
    setView({
      scale,
      mode,
      layout: Math.round(layoutW),
      canFitWhole: wholeScale >= 0.75 && wholeScale < fitScale - 0.02,
    })
  }, [override])

  useEffect(() => {
    measureRef.current = measure
  }, [measure])

  useEffect(() => {
    const wrap = wrapRef.current
    const frame = frameRef.current
    if (!wrap || !frame) return

    const run = () => measureRef.current?.()
    run()

    const ro = new ResizeObserver(() => {
      const w = Math.floor(wrap.clientWidth)
      if (w && w !== lastWidth.current) run()
    })
    ro.observe(wrap)
    window.addEventListener('resize', run)
    window.addEventListener('orientationchange', run)

    const doc = frame.contentDocument
    const imgs = doc ? [...doc.querySelectorAll('img')] : []
    imgs.forEach((img) => img.addEventListener('load', run))

    const timers = [150, 600, 1500, 3000].map((ms) => setTimeout(run, ms))
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', run)
      window.removeEventListener('orientationchange', run)
      imgs.forEach((img) => img.removeEventListener('load', run))
      timers.forEach(clearTimeout)
    }
  }, [src])


  return (
    <>
      <div ref={wrapRef} className="email-html-fit" style={{ overflowY: 'hidden' }}>
        <iframe
          ref={frameRef}
          src={src}
          title="Message body"
          onLoad={() => measureRef.current?.()}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          scrolling="no"
          className={`email-html-body block w-full border-0 ${senderThemed ? 'bg-white' : 'bg-background'}`}
          style={{ height: 10 }}
        />
      </div>
      {(view.scale < 0.72 || view.canFitWhole) && (
        <div className="mt-2 space-y-1.5">
          {view.scale < 0.72 && (
            // Only when the shrink is big enough to notice. A message fitted to 91% so
            // the whole thing lands on the screen needs no explaining; a fixed 620px
            // newsletter shown at 55% does, or the small type looks like a bug.
            <p className="text-[11.5px] text-ink-3">
              This message is laid out at {view.layout} px and shown at{' '}
              {Math.round(view.scale * 100)}% so none of it is cut off.
            </p>
          )}
          {view.canFitWhole && (
            <button
              type="button"
              onClick={() => setOverride(override === 'whole' ? null : 'whole')}
              className="min-h-11 w-full rounded-md border border-line px-3 text-[12.5px] text-ink-2 transition-colors duration-120 hover:bg-accent hover:text-ink-1"
            >
              {override === 'whole' ? 'Fit the width' : 'Fit the whole message on the screen'}
            </button>
          )}
        </div>
      )}
    </>
  )
}

export function EmailBody({ textBody, htmlBody, senderHint }) {
  // An OpenPGP message is ciphertext and needs its own reader.
  //
  // This must not depend on htmlBody being absent: the parser hands back an
  // htmlBody for nearly every message, and requiring its absence meant the
  // encrypted branch never ran -- the armour was rendered as ordinary body
  // text, which is exactly how "OpenPGP does not work" looked.
  const armored = extractArmor(htmlBody) || extractArmor(textBody)
  if (armored) {
    return (
      <Suspense fallback={<p className="text-[12.5px] text-ink-3">Opening the encrypted message…</p>}>
        <PgpBody armored={armored} senderHint={senderHint} />
      </Suspense>
    )
  }

  // Prefer explicit htmlBody; fall back to textBody that looks like HTML
  const resolvedHtml = htmlBody || (textBody && looksLikeHtml(textBody) ? textBody : null)

  if (resolvedHtml) {
    const clean = sanitizeHtml(resolvedHtml)
    const senderThemed = declaresBackground(new DOMParser().parseFromString(clean, 'text/html'))
    return <MailFrame html={prepareMail(clean, { senderThemed })} senderThemed={senderThemed} />
  }

  const text = textBody || ''
  const blocks = parseBlocks(text)

  return (
    <div className="email-text-body font-sans text-foreground/90 space-y-1">
      {blocks.map((block, i) => {
        if (block.type === 'attribution') {
          return (
            <p key={i} className="text-xs text-foreground/40 italic pt-4 pb-0.5 select-none">
              {block.content}
            </p>
          )
        }
        if (block.type === 'quote') {
          return (
            <blockquote
              key={i}
              className="border-l-2 border-foreground/20 pl-3 space-y-px"
            >
              {block.lines.map((line, j) => {
                const stripped = stripQuotePrefix(line)
                return (
                  <p key={j} className="text-sm text-foreground/40 whitespace-pre-wrap break-words">
                    {stripped.trim() ? <TextWithLinks text={stripped} /> : '\u00a0'}
                  </p>
                )
              })}
            </blockquote>
          )
        }
        return (
          <pre key={i} className="whitespace-pre-wrap break-words font-sans text-sm/relaxed">
            <TextWithLinks text={block.content} />
          </pre>
        )
      })}
    </div>
  )
}
