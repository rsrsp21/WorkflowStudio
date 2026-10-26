'use client';

import Link from 'next/link';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body><main id="main-content" tabIndex={-1} className="app-error-page"><section role="alert"><span aria-hidden="true">!</span><h1>Workflow Studio needs to reload</h1><p>The application shell encountered an unexpected error. Persisted workflows and runs remain available.</p><div><button type="button" onClick={reset}>Reload application</button><Link href="/">Open home</Link></div></section></main></body></html>;
}
