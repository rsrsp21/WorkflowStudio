'use client';

import { useEffect } from 'react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Workflow Studio route failed', { digest: error.digest, message: error.message }); }, [error]);
  return <main id="main-content" tabIndex={-1} className="app-error-page"><section role="alert"><span aria-hidden="true">!</span><h1>This screen could not load</h1><p>Your saved workflow and run history have not been removed. Retry the screen, or return to Studio and use the recovery action on the affected run.</p>{error.digest && <small>Reference: {error.digest}</small>}<div><button type="button" onClick={reset}>Try again</button><a href="/studio">Return to Studio</a></div></section></main>;
}
