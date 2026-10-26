import Image from 'next/image';
import Link from 'next/link';
import { getCurrentUser } from '@/src/auth/auth';
import SignOutButton from '@/src/components/sign-out-button';
import LandingThemeToggle from '@/src/components/landing-theme-toggle';
import CompanionDownload from '@/src/components/companion-download';
import styles from './landing.module.css';

type IconName = 'arrow' | 'branch' | 'check' | 'code' | 'eye' | 'folder' | 'lock' | 'play' | 'spark';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
    branch: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="18" cy="17" r="2" /><path d="M8 5h3a5 5 0 0 1 5 5v5M8 5v12h8" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    code: <><path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
    folder: <><path d="M3 6h7l2 2h9v10H3Z" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    play: <><path d="m9 7 8 5-8 5Z" /></>,
    spark: <><path d="m12 3 1.4 4.1L17 9l-3.6 1.9L12 15l-1.4-4.1L7 9l3.6-1.9L12 3ZM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15ZM19 13l.6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6L19 13Z" /></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

const capabilities: Array<[IconName, string, string]> = [
  ['spark', 'Create any workflow', 'Describe the outcome, stages, decisions, approvals, constraints, and outputs for any repeatable process.'],
  ['branch', 'Resolve what is unclear', 'Answer open questions, regenerate the proposal, or explicitly continue with unresolved items recorded.'],
  ['check', 'Approve a reusable definition', 'Review the complete graph and publish only the workflows your team is prepared to reuse.'],
  ['folder', 'Assign it to real projects', 'Keep the approved definition reusable while isolating each project’s inputs, permissions, and history.'],
  ['lock', 'Control every run', 'Enforce workspace access, allowed tools, retries, loop limits, and required human decisions.'],
  ['eye', 'Retain the evidence', 'Preserve the exact version, route, decisions, outputs, artifacts, and failures from every execution.']
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  const studioHref = user ? '/studio' : '/signup';
  return <div className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.brand} href={user ? '/studio' : '/'} aria-label={user ? 'Open Workflow Studio' : 'Workflow Studio home'}>
        <Image src="/workflow-studio-logo.png" alt="" width={66} height={36} priority />
        <span className={styles.brandCopy}><strong>Workflow Studio</strong></span>
      </Link>
      <nav aria-label="Landing page navigation">
        <a href="#capabilities">Capabilities</a>
        <a href="#how-it-works">How it works</a>
        {user ? <><Link className={styles.navCta} href="/studio">Open studio <Icon name="arrow" /></Link><SignOutButton className={styles.navButton} /></> : <Link href="/login">Log in</Link>}
        <LandingThemeToggle className={styles.themeToggle} />
      </nav>
    </header>

    <main id="main-content" tabIndex={-1}>
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroCopy}>
          <h1><span>Agent workflows</span><span>you can <em>see,</em></span><span><em>shape, and trust.</em></span></h1>
          <p>A governed workflow studio for agent work on real projects. Design the graph, control the harness, approve the decisions, and follow every run.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href={studioHref}>{user ? 'Open studio' : 'Start building'} <Icon name="arrow" /></Link>
            <a className={styles.secondaryCta} href="#how-it-works"><Icon name="play" /> See how it works</a>
          </div>
          <div className={styles.promiseRow}>
            <span><Icon name="check" /> Local project context</span>
            <span><Icon name="check" /> Explicit approvals</span>
            <span><Icon name="check" /> Traceable execution</span>
          </div>
          <CompanionDownload />
        </div>

        <div className={styles.productStageWrap}>
        <div className={styles.productStage} aria-label="Workflow graph preview">
          <div className={styles.stageBar}>
            <span className={styles.stageBrand}><Image src="/workflow-studio-logo.png" alt="" width={24} height={14} /> Requirements quality review</span>
            <span className={styles.ready}><i /> Graph ready</span>
          </div>
          <div className={styles.stageBody}>
            <div className={styles.stageRail}>
              <span className={styles.railActive}><Icon name="branch" /></span>
              <span><Icon name="code" /></span>
              <span><Icon name="lock" /></span>
              <span><Icon name="eye" /></span>
            </div>
            <div className={styles.canvas}>
              <div className={`${styles.node} ${styles.nodeOne}`}><i className={styles.nodeIcon}><Icon name="folder" /></i><div><b>Inspect project</b><small>Workspace · read-only</small></div><span>Complete</span></div>
              <div className={`${styles.node} ${styles.nodeTwo}`}><i className={styles.nodeIcon}><Icon name="spark" /></i><div><b>Assess requirements</b><small>Agent · 3 skills</small></div><span>Running</span></div>
              <div className={`${styles.node} ${styles.nodeThree}`}><i className={styles.nodeIcon}><Icon name="branch" /></i><div><b>Validate evidence</b><small>Decision</small></div></div>
              <div className={`${styles.node} ${styles.nodeFour}`}><i className={styles.nodeIcon}><Icon name="lock" /></i><div><b>Human approval</b><small>Required</small></div></div>
              <svg className={styles.connections} viewBox="0 0 760 430" preserveAspectRatio="none" aria-hidden="true">
                <path d="M226 105 C270 105 266 208 316 208" />
                <path className={styles.activePath} d="M467 208 C496 208 490 109 520 109" />
                <path className={styles.activePath} d="M467 208 C505 208 486 326 520 326" />
              </svg>
              <div className={styles.activityCard}>
                <header><span><i /> Live activity</span><small>00:42</small></header>
                <p><b>Assess requirements</b> is reviewing acceptance criteria</p>
                <div><span>Evidence linked</span><strong>18 / 24</strong></div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </section>

      <section className={styles.difference}>
        <p>Creation is open. Reuse is governed.</p>
        <h2>Turn a personal workflow into a trusted way of working.</h2>
        <div className={styles.comparison}>
          <div><span>Personal workflow</span><strong>Draft any process for your own task or experiment</strong></div>
          <i><Icon name="arrow" /></i>
          <div className={styles.comparisonActive}><span>Governed workflow</span><strong>Review → approve → assign to projects → run with controls → retain evidence</strong></div>
        </div>
      </section>

      <section className={styles.capabilities} id="capabilities">
        <div className={styles.sectionHeading}>
          <h2>The complete workflow lifecycle, in one place.</h2>
          <p>Workflow Studio connects process design with approval, project-specific control, execution, and evidence—without limiting what users can create.</p>
        </div>
        <div className={styles.capabilityGrid}>
          {capabilities.map(([icon, title, description], index) => <article key={title}>
            <span className={styles.capabilityIndex}>{String(index + 1).padStart(2, '0')}</span>
            <i><Icon name={icon} /></i>
            <h3>{title}</h3>
            <p>{description}</p>
          </article>)}
        </div>
      </section>

      <section className={styles.how} id="how-it-works">
        <div className={styles.howCopy}>
          <h2>From an idea to a trusted project run.</h2>
          <p>Anyone can create a draft. Clear review and assignment boundaries determine when it becomes a reusable team procedure.</p>
          <Link href={studioHref}>{user ? 'Open your workflows' : 'Create your first workflow'} <Icon name="arrow" /></Link>
        </div>
        <ol>
          <li><span>1</span><div><h3>Draft the procedure</h3><p>Describe the result, stages, decisions, approvals, constraints, and evidence the workflow should produce.</p></div></li>
          <li><span>2</span><div><h3>Resolve and approve</h3><p>Answer open questions, inspect the graph and skills, then approve the reusable definition independently of any project.</p></div></li>
          <li><span>3</span><div><h3>Assign, run, and trace</h3><p>Select a project, apply scoped permissions and inputs, follow execution, and retain its complete history.</p></div></li>
        </ol>
      </section>

      <section className={styles.finalCta}>
        <div className={styles.finalGlow} />
        <Image src="/workflow-studio-logo.png" alt="" width={112} height={61} />
        <h2>Build agents like systems,<br />not chat sessions.</h2>
        <p>Make the work explicit. Make the controls visible. Keep the human in charge.</p>
        <Link className={styles.primaryCta} href={studioHref}>{user ? 'Open Workflow Studio' : 'Create your account'} <Icon name="arrow" /></Link>
      </section>
    </main>

    <footer className={styles.footer}>
      <Link className={styles.brand} href={user ? '/studio' : '/'}><Image src="/workflow-studio-logo.png" alt="" width={58} height={30} /><span>Workflow Studio</span></Link>
      <p>© Workflow Studio. All Rights Reserved.</p>
    </footer>
  </div>;
}
