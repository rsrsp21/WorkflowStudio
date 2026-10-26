export type UiIconName = 'plus' | 'trash' | 'remove' | 'close' | 'search' | 'zoom-in' | 'zoom-out' | 'fit' | 'arrow-right' | 'input' | 'output' | 'skill' | 'user' | 'sign-out' | 'lock' | 'system' | 'sun' | 'moon' | 'eye' | 'eye-off' | 'link' | 'copy' | 'file' | 'code';

export default function UiIcon({ name }: { name: UiIconName }) {
  return (
    <svg className="dash-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'plus' ? (
        <path d="M12 5v14M5 12h14" />
      ) : name === 'trash' || name === 'remove' ? (
        <path d="M5 7h14M9 7V4.75h6V7M7.25 7l.8 12h7.9l.8-12" />
      ) : name === 'search' ? (
        <><circle cx="10.75" cy="10.75" r="6.25" /><path d="m15.5 15.5 4 4" /></>
      ) : name === 'zoom-in' || name === 'zoom-out' ? (
        <><circle cx="10.75" cy="10.75" r="6.25" /><path d="m15.5 15.5 4 4" /><path d="M7.75 10.75h6" />{name === 'zoom-in' && <path d="M10.75 7.75v6" />}</>
      ) : name === 'fit' ? (
        <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /><path d="M8 8h8v8H8z" /></>
      ) : name === 'arrow-right' ? (
        <path d="M6 12h13m-6-6 6 6-6 6" />
      ) : name === 'input' ? (
        <><path d="M4 5v14h6" /><path d="M7 12h13m-5-5 5 5-5 5" /></>
      ) : name === 'output' ? (
        <><path d="M20 5v14h-6" /><path d="M4 12h13m-5-5 5 5-5 5" /></>
      ) : name === 'skill' ? (
        <><path d="M8 3h8l1 5 4 4-4 4-1 5H8l-1-5-4-4 4-4 1-5Z" /><path d="m9 12 2 2 4-4" /></>
      ) : name === 'user' ? (
        <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>
      ) : name === 'sign-out' ? (
        <><path d="M10 5H5v14h5" /><path d="m14 8 4 4-4 4M18 12H9" /></>
      ) : name === 'lock' ? (
        <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>
      ) : name === 'link' ? (
        <><path d="M9.5 14.5 14.5 9.5" /><path d="M7.5 16.5 5.8 18.2a3.4 3.4 0 0 1-4.8-4.8l3.2-3.2A3.4 3.4 0 0 1 9 10" /><path d="m16.5 7.5 1.7-1.7A3.4 3.4 0 1 1 23 10.6l-3.2 3.2A3.4 3.4 0 0 1 15 14" /></>
      ) : name === 'copy' ? (
        <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>
      ) : name === 'file' ? (
        <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>
      ) : name === 'code' ? (
        <path d="m9 7-5 5 5 5m6-10 5 5-5 5" />
      ) : name === 'system' ? (
        <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></>
      ) : name === 'sun' ? (
        <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
      ) : name === 'moon' ? (
        <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />
      ) : name === 'eye' ? (
        <><path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>
      ) : name === 'eye-off' ? (
        <><path d="M3 3l18 18" /><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 8 10 8a18.7 18.7 0 0 1-2.1 3.2M6.2 6.2C3.5 8 2 12 2 12s3.5 8 10 8a9.8 9.8 0 0 0 4.1-.9" /></>
      ) : (
        <path d="m7 7 10 10M17 7 7 17" />
      )}
    </svg>
  );
}
