'use client';

import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const TRANSITION_DURATION_MS = 2350;
export const BRAND_TRANSITION_EVENT = 'workflow-studio:brand-transition';

export default function ScreenTransition() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(pathname === '/');
  const [cycle, setCycle] = useState(0);
  const startsOnLanding = useRef(pathname === '/');
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    function hideAfterAnimation() {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setVisible(false), TRANSITION_DURATION_MS);
    }

    function beginTransition() {
      setCycle((current) => current + 1);
      setVisible(true);
      hideAfterAnimation();
    }

    function handleDocumentClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest('a') : null;
      if (!target || target.target === '_blank' || target.hasAttribute('download')) return;
      if (target.textContent?.trim() !== 'Open graph') return;
      beginTransition();
    }

    if (startsOnLanding.current) hideAfterAnimation();
    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener(BRAND_TRANSITION_EVENT, beginTransition);
    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
      window.removeEventListener(BRAND_TRANSITION_EVENT, beginTransition);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  return <div className={visible ? 'screen-transition visible' : 'screen-transition'} aria-hidden={!visible}>
    <div className="screen-transition-lockup" key={cycle} role="status" aria-label="Loading Workflow Studio">
      <span className="screen-transition-brand">
        <Image className="screen-transition-mark" src="/workflow-studio-logo.png" alt="" width={260} height={142} priority />
        <span className="screen-transition-copy"><strong>Workflow Studio</strong></span>
      </span>
      <span className="screen-transition-brand screen-transition-shine" aria-hidden="true">
        <i className="screen-transition-mark-glow" />
        <span className="screen-transition-copy"><strong>Workflow Studio</strong></span>
      </span>
    </div>
  </div>;
}
