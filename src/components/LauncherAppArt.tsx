import type { FC } from 'react';

interface LauncherAppArtProps {
  id: string;
}

export const LauncherAppArt: FC<LauncherAppArtProps> = ({ id }) => (
  <svg
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
    className="launcher-art-svg"
  >
    {id === 'sales' && (
      <>
        <path d="M17 25h30l-2.5 29h-25L17 25Z" fill="#fff" />
        <path d="M24 26v-5a8 8 0 0 1 16 0v5" fill="none" stroke="#be123c" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M23 34h18v13H23z" fill="#fb7185" />
        <path d="M28 37c2 2 6 2 8 0" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M21 29h22" stroke="#fff" strokeWidth="2" opacity=".8" />
      </>
    )}
    {id === 'sales-history' && (
      <>
        <path d="M17 11h24l8 8v34H17z" fill="#fff" />
        <path d="M41 11v9h8" fill="#fecdd3" />
        <path d="M24 28h18M24 34h11" stroke="#be123c" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M25 46v-5h5v5M33 46v-9h5v9M41 46v-7h5v7" fill="#fb7185" />
      </>
    )}
    {id === 'sales-return' && (
      <>
        <path d="M20 11h23l7 8v34H20z" fill="#fff" />
        <path d="M43 11v9h7" fill="#fecdd3" />
        <path d="M26 27h16M26 33h12" stroke="#be123c" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M41 43a9 9 0 0 1-15 4l-2-2" fill="none" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
        <path d="m27 40-3 5 6 1" fill="#fb7185" />
      </>
    )}
    {id === 'purchase-return' && (
      <>
        <path d="m14 23 18-11 18 11-18 11z" fill="#fef3c7" />
        <path d="M14 23v22l18 11V34z" fill="#f59e0b" />
        <path d="M50 23v22L32 56V34z" fill="#b45309" />
        <path d="M38 40a10 10 0 0 1-17-7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <path d="m21 28-2 6 6-1" fill="#fff" />
        <path d="M32 34v12" stroke="#fff" strokeWidth="2" />
      </>
    )}
    {id === 'sales-order' && (
      <>
        <rect x="17" y="12" width="31" height="42" rx="4" fill="#fff" />
        <path d="M25 21h15M25 27h15" stroke="#be123c" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="24" y="34" width="18" height="12" rx="3" fill="#fb7185" />
        <path d="m28 40 3 3 7-7" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 16h21" stroke="#fecdd3" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {id === 'sales-quotation' && (
      <>
        <path d="M17 11h24l8 8v34H17z" fill="#fff" />
        <path d="M41 11v9h8" fill="#ddd6fe" />
        <path d="M24 28h17M24 34h17M24 40h10" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M36 47 47 36l4 4-11 11-5 1z" fill="#fbbf24" />
      </>
    )}
    {id === 'purchase-order' && (
      <>
        <path d="M18 11h23l8 8v34H18z" fill="#fff" />
        <path d="M41 11v9h8" fill="#bfdbfe" />
        <path d="M24 28h17M24 34h14" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="26" y="39" width="20" height="10" rx="2" fill="#fbbf24" />
        <path d="m26 42 10 5 10-5" fill="none" stroke="#fff" strokeWidth="1.8" />
      </>
    )}
    {id === 'goods-delivery' && (
      <>
        <path d="M8 20h29v25H8z" fill="#fff" />
        <path d="M37 28h11l8 9v8H37z" fill="#bfdbfe" />
        <path d="M40 31h6l6 6H40z" fill="#fff" />
        <path d="M12 25h20M12 30h15" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
        <circle cx="19" cy="47" r="5" fill="#1e3a8a" />
        <circle cx="19" cy="47" r="2" fill="#fff" />
        <circle cx="46" cy="47" r="5" fill="#1e3a8a" />
        <circle cx="46" cy="47" r="2" fill="#fff" />
      </>
    )}
    {id === 'sales-settings' && (
      <>
        <path d="M17 11h30v42H17z" fill="#fff" />
        <path d="M23 18h18M23 24h18" stroke="#be123c" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="32" cy="39" r="10" fill="#fb7185" />
        <path d="m28 44 8-10" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="29" cy="36" r="1.5" fill="#fff" />
        <circle cx="35" cy="42" r="1.5" fill="#fff" />
      </>
    )}
    {id === 'purchase' && (
      <>
        <path d="M20 11h20l9 9v34H20z" fill="#fff" />
        <path d="M40 11v10h9" fill="#bfdbfe" />
        <path d="M26 29h17M26 36h17M26 43h12" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
        <path d="M24 15h13" stroke="#dbeafe" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {id === 'purchase-history' && (
      <>
        <path d="M17 11h24l8 8v34H17z" fill="#fff" />
        <path d="M41 11v9h8" fill="#bfdbfe" />
        <path d="M24 28h18M24 34h14" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" />
        <path d="m25 45 5-5 5 3 8-8" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="43" cy="35" r="2" fill="#f59e0b" />
      </>
    )}
    {id === 'returns' && (
      <>
        <path d="M17 24a18 18 0 0 1 30-7l4 4" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <path d="m43 13 9 8-11 2" fill="#fff" />
        <path d="M47 40a18 18 0 0 1-30 7l-4-4" fill="none" stroke="#ffedd5" strokeWidth="5" strokeLinecap="round" />
        <path d="m21 51-9-8 11-2" fill="#ffedd5" />
        <rect x="25" y="25" width="14" height="14" rx="3" fill="#fff" />
        <path d="M28 29h8M28 33h8" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {id === 'documents' && (
      <>
        <path d="M15 17h27l8 8v29H15z" fill="#ddd6fe" />
        <path d="M20 11h25l7 8v31H20z" fill="#fff" />
        <path d="M45 11v9h7" fill="#ede9fe" />
        <path d="M26 29h19M26 35h19M26 41h13" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M25 15h14" stroke="#ede9fe" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {id === 'printer' && (
      <>
        <path d="M20 12h24v17H20z" fill="#fff" />
        <path d="M16 25h32a6 6 0 0 1 6 6v14H10V31a6 6 0 0 1 6-6z" fill="#bfdbfe" />
        <path d="M19 38h26v15H19z" fill="#fff" />
        <path d="M24 43h16M24 48h12M44 31h2" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M25 17h14M25 21h14" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {id === 'inventory' && (
      <>
        <path d="m13 23 19-11 19 11-19 11z" fill="#fef3c7" />
        <path d="M13 23v23l19 11V34z" fill="#f59e0b" />
        <path d="M51 23v23L32 57V34z" fill="#b45309" />
        <path d="m21 18 19 11M32 34v13" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity=".9" />
        <path d="m39 17 5 3" stroke="#92400e" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {id === 'files' && (
      <>
        <path d="M10 19a4 4 0 0 1 4-4h14l6 6h16a4 4 0 0 1 4 4v23a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z" fill="#facc15" />
        <path d="M11 25h42l-4 23a4 4 0 0 1-4 3H15a4 4 0 0 1-4-4z" fill="#fff" />
        <path d="M16 31h29M16 37h24M16 43h17" stroke="#0891b2" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M15 17h12l4 4H15z" fill="#fef3c7" />
      </>
    )}
    {id === 'reports' && (
      <>
        <rect x="11" y="12" width="42" height="40" rx="5" fill="#fff" />
        <path d="M17 44V33h7v11z" fill="#22c55e" />
        <path d="M28 44V24h7v20z" fill="#f97316" />
        <path d="M39 44V30h7v14z" fill="#3b82f6" />
        <path d="M16 47h32" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
        <path d="m18 27 9-5 8 3 10-8" fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="45" cy="17" r="2.5" fill="#7c3aed" />
      </>
    )}
    {id === 'accounts' && (
      <>
        <rect x="11" y="17" width="42" height="32" rx="6" fill="#fff" />
        <path d="M11 25h42v8H11z" fill="#1d4ed8" />
        <rect x="17" y="38" width="12" height="6" rx="2" fill="#fbbf24" />
        <path d="M35 41h11" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M17 13h28" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".75" />
      </>
    )}
    {id === 'settings' && (
      <>
        <path d="m28 10 8 0 2 6a17 17 0 0 1 4 2l6-2 4 7-4 4a18 18 0 0 1 0 5l4 5-4 7-6-2a17 17 0 0 1-4 2l-2 6h-8l-2-6a17 17 0 0 1-4-2l-6 2-4-7 4-5a18 18 0 0 1 0-5l-4-4 4-7 6 2a17 17 0 0 1 4-2z" fill="#fff" />
        <circle cx="32" cy="32" r="8" fill="#8b5cf6" />
        <circle cx="32" cy="32" r="4" fill="#ede9fe" />
        <path d="M27 13h5" stroke="#ede9fe" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {(id === 'organization' || id === 'organization-hr' || id === 'users') && (
      <>
        <circle cx="24" cy="23" r="8" fill="#fed7aa" />
        <circle cx="43" cy="25" r="7" fill="#fde68a" />
        <path d="M10 49a14 14 0 0 1 28 0v3H10z" fill="#fff" />
        <path d="M34 37a12 12 0 0 1 20 9v6H37v-3a17 17 0 0 0-3-12z" fill="#bfdbfe" />
        <path d="M17 20a7 7 0 0 1 13-2" fill="none" stroke="#7c2d12" strokeWidth="3" strokeLinecap="round" />
        <path d="M39 22a6 6 0 0 1 9-2" fill="none" stroke="#92400e" strokeWidth="2.5" strokeLinecap="round" />
      </>
    )}
    {id === 'organization-shift' && (
      <>
        <path d="M12 20a5 5 0 0 1 5-5h30a5 5 0 0 1 5 5v27a5 5 0 0 1-5 5H17a5 5 0 0 1-5-5z" fill="#fff" />
        <path d="M12 25h40v8H12z" fill="#7c3aed" />
        <path d="M42 35h13v12H42a6 6 0 0 1 0-12z" fill="#c4b5fd" />
        <circle cx="44" cy="41" r="1.8" fill="#5b21b6" />
        <path d="M20 20h18" stroke="#ddd6fe" strokeWidth="2.5" strokeLinecap="round" />
      </>
    )}
    {id === 'cashbook' && (
      <>
        <path d="M12 18a5 5 0 0 1 5-5h31a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H17a5 5 0 0 1-5-5z" fill="#fff" />
        <path d="M12 23h40v8H12z" fill="#0f766e" />
        <rect x="20" y="36" width="22" height="10" rx="3" fill="#99f6e4" />
        <path d="M25 41h12" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="45" cy="40" r="2" fill="#f59e0b" />
      </>
    )}
    {id === 'logout' && (
      <>
        <path d="M15 10h25a4 4 0 0 1 4 4v36H15z" fill="#fff" />
        <path d="M20 15h18v30H20z" fill="#fecdd3" />
        <circle cx="33" cy="30" r="1.8" fill="#be123c" />
        <path d="M29 32h25M46 24l8 8-8 8" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 14h4v33h-4z" fill="#fb7185" />
      </>
    )}
    {id === 'screen' && (
      <>
        <rect x="8" y="12" width="48" height="32" rx="5" fill="#fff" />
        <rect x="13" y="17" width="38" height="22" rx="2" fill="#bfdbfe" />
        <path d="M27 44v7M37 44v7M23 52h18" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <rect x="18" y="22" width="12" height="8" rx="2" fill="#2563eb" />
        <path d="M34 23h12M34 28h9M18 34h28" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {id === 'store' && (
      <>
        <path d="M14 27h36v26H14z" fill="#fff" />
        <path d="M10 27 16 13h32l6 14H10z" fill="#fef3c7" />
        <path d="M11 27h42a8 8 0 0 1-14 5 8 8 0 0 1-14 0 8 8 0 0 1-14-5z" fill="#fb7185" />
        <path d="M20 37h10v16H20zM35 37h10v8H35z" fill="#bfdbfe" />
        <path d="M35 49h10" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {id === 'database' && (
      <>
        <ellipse cx="32" cy="17" rx="20" ry="8" fill="#fff" />
        <path d="M12 17v12c0 4 9 8 20 8s20-4 20-8V17" fill="#bfdbfe" />
        <ellipse cx="32" cy="29" rx="20" ry="8" fill="#fff" />
        <path d="M12 29v12c0 4 9 8 20 8s20-4 20-8V29" fill="#93c5fd" />
        <ellipse cx="32" cy="41" rx="20" ry="8" fill="#dbeafe" />
        <path d="M15 18c3 2 8 4 17 4s14-2 17-4M15 30c3 2 8 4 17 4s14-2 17-4" fill="none" stroke="#2563eb" strokeWidth="2" />
      </>
    )}
    {id === 'updates' && (
      <>
        <path d="M18 25a16 16 0 0 1 28-8l4 4" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <path d="m43 13 9 8-11 2" fill="#fff" />
        <path d="M46 39a16 16 0 0 1-28 8l-4-4" fill="none" stroke="#dbeafe" strokeWidth="5" strokeLinecap="round" />
        <path d="m21 51-9-8 11-2" fill="#dbeafe" />
        <circle cx="32" cy="32" r="9" fill="#fff" />
        <path d="m28 32 3 3 6-7" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )}
  </svg>
);
