import Image from 'next/image';
import Link from 'next/link';

export default function ProductFooter() {
  return (
    <footer className="dash-product-footer">
      <Link className="dash-footer-brand" href="/studio"><Image src="/workflow-studio-logo.png" alt="" width={44} height={26} /><span>Workflow Studio</span></Link>
      <p>© Workflow Studio. All Rights Reserved.</p>
    </footer>
  );
}
