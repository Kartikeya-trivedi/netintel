import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { BrandLockup, Direction } from '../ui/Identity'
import './landing.css'

const APP_ENTRY = import.meta.env.MODE === 'static' ? '/graph' : '/findings'

const CHAPTERS = [
  {
    name: 'Connect',
    label: 'A lead worth checking',
    title: 'One name. Two case files.',
    body: 'Sameer Khan appears in two investigations. A shared name becomes an identity proposal for an investigator to review.',
    detail: 'Identity unreviewed',
    source: 'BM-1 ↔ BM-3',
    note: 'A possible connection, with its assumptions visible.',
    tone: 'amber',
  },
  {
    name: 'Challenge',
    label: 'Look beneath the link',
    title: 'Three reports. One origin.',
    body: 'The same tip appears in a diary and a bulletin. The shared origin counts once. A conflicting subscriber record stays in view.',
    detail: 'Attribution contested',
    source: 'Informant tip + 2 repeats',
    note: 'Independent sources matter more than repeated mentions.',
    tone: 'coral',
  },
  {
    name: 'Verify',
    label: 'The next useful question',
    title: 'Who used the number?',
    body: 'Who used 9867012345 on 8–12 May 2026? Check the subscriber history and supporting records before accepting the connection.',
    detail: 'Verification needed',
    source: '8–12 May 2026',
    note: 'Follow the check that could change the finding.',
    tone: 'blue',
  },
] as const

const FAQ = [
  {
    question: 'What evidence can I work with today?',
    answer:
      'Text reports, text-based PDFs and Word documents, plus CSV exports of bank transactions, call-detail records and subscriber records. Scanned documents still need OCR before they can be analysed.',
  },
  {
    question: 'What does network tracing actually do?',
    answer:
      'The Network → Trace view finds a path between two people in the imported case data and shows the evidence behind each hop. It analyses recorded relationships; it does not intercept internet traffic or locate a device live.',
  },
  {
    question: 'Can I review CCTV and camera recordings?',
    answer:
      'Not yet. Video upload, playback, timestamped clip review, camera maps, and footage search are not implemented in this version. The current workspace analyses documents and structured records.',
  },
  {
    question: 'Does it connect to cyber-cell systems?',
    answer:
      'The current tools support analysis of imported call and financial records. IPDR, IP and device correlation, packet analysis, and live cyber-cell or telecom integrations are not implemented.',
  },
  {
    question: 'Is this real case data?',
    answer:
      'No. Operation Broken Mirror and Operation Nightfall are synthetic demonstration cases. Names, numbers and records are fabricated. The live demo uses a selectable demo identity; production authentication is not implemented.',
  },
]

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const header = useRef<HTMLElement>(null)
  useEffect(() => {
    const title = document.title
    const themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )
    const themeColor = themeMeta?.content
    document.title = 'NetIntel — Evidence. In context.'
    if (themeMeta) themeMeta.content = '#0b0c0e'
    if (location.hash)
      requestAnimationFrame(() =>
        document.getElementById(location.hash.slice(1))?.scrollIntoView(),
      )
    else window.scrollTo(0, 0)
    return () => {
      document.title = title
      if (themeMeta && themeColor) themeMeta.content = themeColor
    }
  }, [])
  useEffect(() => {
    if (!menuOpen) return
    function dismiss(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !header.current?.contains(event.target)
      )
        setMenuOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [menuOpen])

  return (
    <div className="landing">
      <a className="landing-skip" href="#landing-main">
        Skip to content
      </a>
      <header
        ref={header}
        className="landing-header"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen) {
            setMenuOpen(false)
            menuButton.current?.focus()
          }
        }}
      >
        <div className="landing-nav-wrap">
          <Link to="/" className="landing-brand" aria-label="NetIntel home">
            <BrandLockup />
          </Link>
          <nav
            id="landing-navigation"
            className="landing-nav"
            aria-label="Product navigation"
            data-open={menuOpen}
          >
            <a href="#platform" onClick={() => setMenuOpen(false)}>
              Platform
            </a>
            <a href="#workflow" onClick={() => setMenuOpen(false)}>
              How it works
            </a>
            <a href="#capabilities" onClick={() => setMenuOpen(false)}>
              Capabilities
            </a>
          </nav>
          <Link className="landing-nav-cta" to={APP_ENTRY}>
            Open workspace <Direction kind="up-right" />
          </Link>
          <button
            ref={menuButton}
            className="landing-menu"
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="landing-navigation"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span />
            <span />
          </button>
        </div>
      </header>

      <main id="landing-main" tabIndex={-1}>
        <section
          className="landing-hero landing-width"
          aria-labelledby="landing-title"
        >
          <p className="landing-eyebrow">
            <span /> Evidence. In context.
          </p>
          <h1 id="landing-title">
            Connect the evidence.
            <br />
            <span>Keep the context.</span>
          </h1>
          <p className="landing-hero-copy">
            An investigation workspace for the connections between case files.
            <br className="landing-desktop-break" /> Follow people, calls and
            money back to the records behind them.
          </p>
          <div className="landing-actions">
            <Link className="landing-button" to={APP_ENTRY}>
              Explore the workspace <Direction kind="up-right" />
            </Link>
            <a className="landing-text-link" href="#walkthrough">
              See it in action <Direction kind="down" />
            </a>
          </div>
          <p className="landing-hero-note">
            Built for investigative work. Explore with synthetic case data.
          </p>
        </section>

        <section
          id="walkthrough"
          className="landing-width landing-demo-section"
          aria-label="Interactive product walkthrough"
        >
          <CaseWalkthrough />
          <div className="landing-demo-caption">
            <span>
              Operation Broken Mirror <span aria-hidden="true">/</span>{' '}
              Synthetic walkthrough
            </span>
            <span>One connection. Three ways to examine it.</span>
          </div>
        </section>

        <section
          className="landing-width landing-inputs"
          aria-label="Supported evidence formats"
        >
          <p>
            Start with the records
            <br />
            <strong>you already have.</strong>
          </p>
          <div>
            <span className="landing-format">
              TXT <i>/</i> PDF <i>/</i> DOCX
            </span>
            <span>Reports & statements</span>
          </div>
          <div>
            <span className="landing-format">
              CDR <i>/</i> CSV
            </span>
            <span>Calls & subscribers</span>
          </div>
          <div>
            <span className="landing-format">
              BANK <i>/</i> CSV
            </span>
            <span>Financial transactions</span>
          </div>
        </section>

        <section
          id="platform"
          className="landing-width landing-platform"
          aria-labelledby="platform-title"
        >
          <div className="landing-section-heading">
            <div>
              <p className="landing-kicker">01 / THE PLATFORM</p>
              <h2 id="platform-title">
                Make the connection.
                <br />
                <span>Understand its foundation.</span>
              </h2>
            </div>
            <p>
              A name on a page is a starting point. Bring the records together,
              inspect the relationships, and keep every finding connected to its
              source.
            </p>
          </div>
          <div className="landing-features">
            <article>
              <div className="landing-feature-visual">
                <BridgeFigure />
              </div>
              <h3>Find the people between the groups.</h3>
              <p>
                Explore communities, trace connections and inspect the people
                who bridge separate parts of a case.
              </p>
              <Link className="landing-feature-link" to="/graph">
                Explore the network <Direction />
              </Link>
            </article>
            <article>
              <div className="landing-feature-visual landing-source-visual">
                <div className="landing-source-top">
                  <span className="landing-source-format">CSV</span>
                  <span>
                    BM3_cdr_accused.csv<small>Original record · row 20</small>
                  </span>
                  <span className="landing-intact" aria-label="Original intact">
                    ✓
                  </span>
                </div>
                <p className="landing-source-quote">
                  9867012345 <span>called</span>
                  <br />
                  9765500321
                </p>
                <div className="landing-source-bottom">
                  <span>10 May 2026 · 20:36 IST</span>
                  <strong>349s</strong>
                </div>
              </div>
              <h3>Get back to the original.</h3>
              <p>
                Move from a relationship to the exact passage or row behind it.
                Keep reported claims distinct from system records.
              </p>
              <Link className="landing-feature-link" to="/documents">
                Read the sources <Direction />
              </Link>
            </article>
            <article>
              <div className="landing-feature-visual landing-lineage-visual">
                <div className="landing-origin">
                  <span className="landing-small-dot" />
                  Informant tip <small>Original</small>
                </div>
                <div className="landing-branches">
                  <div>
                    <span>Station diary</span>
                    <small>Repeats tip</small>
                  </div>
                  <div>
                    <span>District bulletin</span>
                    <small>Repeats tip</small>
                  </div>
                </div>
                <p>
                  <b>3</b> documents <span aria-hidden="true">→</span> <b>1</b>{' '}
                  origin
                </p>
              </div>
              <h3>See what the finding depends on.</h3>
              <p>
                Recognise repeated claims, surface competing identities, and
                test what changes when a source is withdrawn.
              </p>
              <Link className="landing-feature-link" to={APP_ENTRY}>
                Examine a finding <Direction />
              </Link>
            </article>
          </div>
        </section>

        <section
          id="workflow"
          className="landing-width landing-workflow"
          aria-labelledby="workflow-title"
        >
          <div className="landing-workflow-copy">
            <p className="landing-kicker">02 / THE WORKFLOW</p>
            <h2 id="workflow-title">
              Good questions
              <br />
              <span>move a case forward.</span>
            </h2>
            <p>
              Work from the connection to the uncertainty, then to the next
              check. The investigator stays in control of the decision.
            </p>
            <Link className="landing-text-link" to={APP_ENTRY}>
              Walk through a case <Direction />
            </Link>
          </div>
          <ol className="landing-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Bring the case files together.</h3>
                <p>
                  Find possible connections across the cases in your workspace,
                  with the source documents attached.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Challenge the explanation.</h3>
                <p>
                  Question an identity. Exclude a source. See which connections
                  still hold under those assumptions.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Choose what to verify next.</h3>
                <p>
                  Review checks that could change a finding, record your
                  reasoning, and export the evidence package.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section
          id="capabilities"
          className="landing-width landing-faq"
          aria-labelledby="capabilities-title"
        >
          <div>
            <p className="landing-kicker">03 / CURRENT CAPABILITIES</p>
            <h2 id="capabilities-title">
              A clear view of
              <br />
              <span>what’s inside.</span>
            </h2>
            <p>The working prototype, including its current boundaries.</p>
          </div>
          <div className="landing-questions">
            {FAQ.map((item) => (
              <details key={item.question}>
                <summary>
                  {item.question}
                  <span aria-hidden="true" />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          className="landing-width landing-closing"
          aria-labelledby="closing-title"
        >
          <div>
            <p className="landing-kicker">NETINTEL / INVESTIGATION WORKSPACE</p>
            <h2 id="closing-title">Start with a connection.</h2>
            <p>See what it rests on. Decide what to check next.</p>
          </div>
          <Link className="landing-button" to={APP_ENTRY}>
            Open the workspace <Direction kind="up-right" />
          </Link>
        </section>
      </main>
      <footer className="landing-width landing-footer">
        <Link to="/" className="landing-brand" aria-label="NetIntel home">
          <BrandLockup />
        </Link>
        <p>
          For authorised law-enforcement use.
          <br />
          All demonstration data is synthetic.
        </p>
        <div>
          <Link to="/graph">Network</Link>
          <Link to="/documents">Sources</Link>
          <a href="#capabilities">Capabilities</a>
        </div>
        <span>SIH26189</span>
      </footer>
    </div>
  )
}

function CaseWalkthrough() {
  const [step, setStep] = useState(0)
  const chapter = CHAPTERS[step]
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, at: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 2
          : (at + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3
    setStep(next)
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next].focus()
  }
  return (
    <div className="landing-product" data-step={step}>
      <div className="landing-product-bar">
        <div>
          <span className="landing-product-mark">N</span>
          <span>
            Broken Mirror{' '}
            <span className="landing-product-breadcrumb">/ Finding 01</span>
          </span>
        </div>
        <span className="landing-demo-label">
          <span /> Interactive walkthrough
        </span>
      </div>
      <div
        className="landing-demo-tabs"
        role="tablist"
        aria-label="Explore the investigation workflow"
      >
        {CHAPTERS.map((item, index) => (
          <button
            key={item.name}
            id={`walkthrough-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={step === index}
            aria-controls="walkthrough-panel"
            tabIndex={step === index ? 0 : -1}
            onKeyDown={(event) => navigateTabs(event, index)}
            onClick={() => setStep(index)}
          >
            <span>0{index + 1}</span>
            {item.name}
            <Direction />
          </button>
        ))}
      </div>
      <div
        className="landing-product-body"
        role="tabpanel"
        id="walkthrough-panel"
        aria-labelledby={`walkthrough-tab-${step}`}
      >
        <aside className="landing-case-list" aria-label="Synthetic case files">
          <p>
            CASE FILES <span>3</span>
          </p>
          <div>
            <span>BM-1</span>
            <strong>Loan-app extortion</strong>
            <small>Mumbai</small>
          </div>
          <div className="landing-case-muted">
            <span>BM-2</span>
            <strong>Fake job recruitment</strong>
            <small>Thane</small>
          </div>
          <div>
            <span>BM-3</span>
            <strong>Missing-women inquiry</strong>
            <small>Nashik</small>
          </div>
          <p className="landing-case-list-note">Cross-case investigation</p>
        </aside>
        <div className="landing-map">
          <div className="landing-map-header">
            <span>
              {
                [
                  'Connection under review',
                  'Evidence behind the connection',
                  'The event window',
                ][step]
              }
            </span>
            <span className={`landing-status landing-status-${chapter.tone}`}>
              {chapter.detail}
            </span>
          </div>
          {step === 0 ? (
            <>
              <CaseMap step={step} />
              <CaseMap step={step} compact />
            </>
          ) : step === 1 ? (
            <SourceFamilyScene />
          ) : (
            <VerificationScene />
          )}
          <div className="landing-map-legend">
            {step === 0 ? (
              <>
                <span>
                  <i /> Recorded relationship
                </span>
                <span>
                  <i /> Identity proposal
                </span>
              </>
            ) : (
              <span>
                {step === 1
                  ? '3 documents · 1 origin · conflicting record retained'
                  : 'The recorded events define the period to verify.'}
              </span>
            )}
          </div>
        </div>
        <aside
          className="landing-demo-reader"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="landing-reader-label">{chapter.label}</p>
          <span className={`landing-reader-index landing-tone-${chapter.tone}`}>
            0{step + 1}
          </span>
          <h3>{chapter.title}</h3>
          <p>{chapter.body}</p>
          <div className="landing-reader-source">
            <span className="landing-small-dot" />
            {chapter.source}
          </div>
          <p className="landing-reader-note">{chapter.note}</p>
        </aside>
      </div>
      <div className="landing-product-footer">
        <span>Illustrative view of a synthetic case</span>
        <Link to={APP_ENTRY}>
          Open full workspace <Direction kind="up-right" />
        </Link>
      </div>
    </div>
  )
}

function SourceFamilyScene() {
  return (
    <div className="landing-family-scene">
      <div className="landing-family-original">
        <span>ORIGINAL CLAIM</span>
        <strong>Informant tip</strong>
        <small>BM3_informant_tip_GD23.txt</small>
      </div>
      <div className="landing-family-copies">
        <div>
          <span>Station diary</span>
          <small>Repeats the tip</small>
        </div>
        <div>
          <span>District bulletin</span>
          <small>Repeats the tip</small>
        </div>
      </div>
      <div className="landing-family-conflict">
        <span>Conflicting record</span>
        <p>Subscriber history names a different holder.</p>
      </div>
    </div>
  )
}

function VerificationScene() {
  return (
    <div className="landing-verification-scene">
      <p>PHONE ATTRIBUTION</p>
      <strong>9867012345</strong>
      <div className="landing-event-window">
        <div>
          8–12 May 2026 <span>Event window</span>
        </div>
        <ol aria-label="Timeline from 7 to 13 May 2026">
          {[7, 8, 9, 10, 11, 12, 13].map((day) => (
            <li key={day} data-in-window={day >= 8 && day <= 12}>
              <i />
              <span>{day}</span>
            </li>
          ))}
        </ol>
        <p>May 2026</p>
      </div>
      <div className="landing-verification-question">
        <span>Next check</span>
        <p>Who used this number at the time?</p>
        <small>Pending verification</small>
      </div>
    </div>
  )
}

function CaseMap({
  step,
  compact = false,
}: {
  step: number
  compact?: boolean
}) {
  const a = compact ? { x: 64, y: 77 } : { x: 112, y: 137 }
  const b = compact ? { x: 244, y: 77 } : { x: 340, y: 137 }
  const c = compact ? { x: 244, y: 216 } : { x: 555, y: 137 }
  return (
    <svg
      className={compact ? 'landing-case-map-compact' : 'landing-case-map-wide'}
      viewBox={compact ? '0 0 320 278' : '0 0 660 300'}
      role="img"
      aria-label={`Synthetic connection: Sameer Khan in BM-1 may be the same person as Sameer Khan in BM-3, who is linked by call records to Pappu Shinde. ${step === 1 ? 'The identity and attribution are contested.' : step === 2 ? 'The next check is who used the phone during the event.' : 'The identity needs review.'}`}
    >
      <text
        x={a.x}
        y={compact ? 23 : 40}
        className="landing-map-case"
        textAnchor="middle"
      >
        CASE BM-1
      </text>
      <text
        x={compact ? b.x : 452}
        y={compact ? 23 : 40}
        className="landing-map-case"
        textAnchor="middle"
      >
        CASE BM-3
      </text>
      {!compact && <path d="M238 22V268" className="landing-map-divider" />}
      <path
        d={`M${a.x + 27} ${a.y}H${b.x - 27}`}
        className={`landing-map-link landing-map-proposal ${step === 1 ? 'landing-map-contested' : ''}`}
      />
      <text
        x={(a.x + b.x) / 2}
        y={a.y - 24}
        textAnchor="middle"
        className="landing-map-edge-label"
      >
        {step === 1 ? 'Question the identity' : 'Same person?'}
      </text>
      <path
        d={
          compact
            ? `M${b.x} ${b.y + 26}V${c.y - 27}`
            : `M${b.x + 27} ${b.y}H${c.x - 27}`
        }
        className="landing-map-link landing-map-record"
      />
      <text
        x={compact ? 188 : (b.x + c.x) / 2}
        y={compact ? 170 : 113}
        textAnchor="middle"
        className="landing-map-edge-label"
      >
        Call records
      </text>
      {[
        { ...a, initials: 'SK', name: 'Sameer Khan' },
        { ...b, initials: 'SK', name: 'Sameer Khan' },
        { ...c, initials: 'PS', name: 'Pappu Shinde' },
      ].map((node, index) => (
        <g
          key={index}
          className={`landing-map-person ${index === 1 ? 'landing-map-person-review' : ''}`}
        >
          <circle cx={node.x} cy={node.y} r="25" />
          <text
            x={node.x}
            y={node.y + 5}
            textAnchor="middle"
            className="landing-map-initials"
          >
            {node.initials}
          </text>
          <text
            x={node.x}
            y={node.y + 49}
            textAnchor="middle"
            className="landing-map-name"
          >
            {node.name}
          </text>
        </g>
      ))}
      {!compact && (
        <>
          <path
            d="M112 204V238M340 204V238M555 204V238"
            className="landing-map-stem"
          />
          <text
            x="112"
            y="259"
            className="landing-map-source"
            textAnchor="middle"
          >
            Report references
          </text>
          <text
            x="340"
            y="259"
            className={`landing-map-source ${step > 0 ? 'landing-map-source-active' : ''}`}
            textAnchor="middle"
          >
            {step === 0 ? 'Subscriber history' : 'Ownership disputed'}
          </text>
          <text
            x="555"
            y="259"
            className="landing-map-source"
            textAnchor="middle"
          >
            Original call rows
          </text>
        </>
      )}
    </svg>
  )
}

function BridgeFigure() {
  return (
    <svg
      viewBox="0 0 340 210"
      role="img"
      aria-label="Illustration of one broker connecting two groups of people"
    >
      <g className="landing-bridge-lines">
        <path d="M55 66 99 47 122 105 73 145 39 109 55 66 73 145M39 109 122 105M55 66 122 105M224 64 272 48 302 105 268 149 222 128 224 64 302 105M272 48 268 149M99 47 171 105 224 64M122 105 171 105 222 128M73 145 171 105 268 149" />
      </g>
      {[
        [55, 66],
        [99, 47],
        [122, 105],
        [73, 145],
        [39, 109],
        [224, 64],
        [272, 48],
        [302, 105],
        [268, 149],
        [222, 128],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="6" className="landing-bridge-node" />
      ))}
      <circle cx="171" cy="105" r="19" className="landing-bridge-broker" />
      <circle cx="171" cy="105" r="5" fill="#f1af91" />
      <path d="M171 132V169" className="landing-map-stem" />
      <text x="171" y="189" textAnchor="middle" className="landing-map-source">
        The connection between groups
      </text>
    </svg>
  )
}
