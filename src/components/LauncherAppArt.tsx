import { useId, type FC } from 'react';

interface LauncherAppArtProps {
  id: string;
}

export const LauncherAppArt: FC<LauncherAppArtProps> = ({ id }) => {
  const uid = useId().replace(/:/g, '');
  const gPaper = `${uid}-paper`;
  const gGlass = `${uid}-glass`;
  const gGold = `${uid}-gold`;
  const gBlue = `${uid}-blue`;
  const gRose = `${uid}-rose`;
  const gEmerald = `${uid}-emerald`;
  const gViolet = `${uid}-violet`;
  const gTeal = `${uid}-teal`;

  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      shapeRendering="geometricPrecision"
      className="launcher-art-svg"
    >
      <defs>
        <linearGradient id={gPaper} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#eef2f7" />
        </linearGradient>
        <linearGradient id={gGlass} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.96" />
          <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.88" />
        </linearGradient>
        <linearGradient id={gGold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id={gBlue} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id={gRose} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fb7185" />
          <stop offset="100%" stopColor="#be123c" />
        </linearGradient>
        <linearGradient id={gEmerald} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#15803d" />
        </linearGradient>
        <linearGradient id={gViolet} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
        <linearGradient id={gTeal} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="100%" stopColor="#0f766e" />
        </linearGradient>
      </defs>

      {id === 'sales' && (
        <>
          <path d="M23 23v-4a9 9 0 0 1 18 0v4" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" opacity=".92" />
          <path d="M14 23h36l-3 30a4 4 0 0 1-4 3.5H21a4 4 0 0 1-4-3.5L14 23Z" fill={`url(#${gPaper})`} />
          <path d="M14 23h36l-.8 7H14.8z" fill="#ffe4e6" />
          <circle cx="24" cy="26.5" r="2" fill="#be123c" />
          <circle cx="40" cy="26.5" r="2" fill="#be123c" />
          <rect x="21" y="34" width="22" height="15" rx="4" fill={`url(#${gRose})`} />
          <path d="M27 38.5c1.8 2.4 8.2 2.4 10 0" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}

      {id === 'sales-history' && (
        <>
          <rect x="13" y="15" width="28" height="38" rx="4" fill="#ffe4e6" opacity=".6" />
          <path d="M17 10h23l9 9v35a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill={`url(#${gPaper})`} />
          <path d="M40 10v7a2 2 0 0 0 2 2h7z" fill="#fecdd3" />
          <path d="M21 24h16M21 29.5h11" stroke="#be123c" strokeWidth="2.4" strokeLinecap="round" />
          <rect x="21" y="39" width="5" height="9" rx="1.5" fill="#fda4af" />
          <rect x="29" y="34" width="5" height="14" rx="1.5" fill="#fb7185" />
          <rect x="37" y="36.5" width="5" height="11.5" rx="1.5" fill="#e11d48" />
        </>
      )}

      {id === 'sales-return' && (
        <>
          <path d="M16 10h24l9 9v34a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill={`url(#${gPaper})`} />
          <path d="M40 10v7a2 2 0 0 0 2 2h7z" fill="#fbcfe8" />
          <path d="M20 23h16M20 29h11" stroke="#be185d" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="38" cy="43" r="12" fill={`url(#${gRose})`} />
          <path d="M42 40a6.5 6.5 0 1 0-1.5 8.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <path d="m39 36 4.5 4-5 2z" fill="#fff" />
        </>
      )}

      {id === 'purchase-return' && (
        <>
          <path d="m13 22 19-11 19 11-19 11z" fill="#fef3c7" />
          <path d="M13 22v23l19 11V33z" fill="#f59e0b" />
          <path d="M51 22v23L32 56V33z" fill="#b45309" />
          <path d="m22.5 16.5 19 11" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity=".85" />
          <circle cx="43" cy="43" r="11.5" fill={`url(#${gPaper})`} />
          <path d="M46.5 40.5a5.8 5.8 0 1 0-1.2 7" fill="none" stroke="#c2410c" strokeWidth="2.6" strokeLinecap="round" />
          <path d="m43 37 4.2 3.5-4.5 2z" fill="#c2410c" />
        </>
      )}

      {id === 'sales-order' && (
        <>
          <rect x="15" y="12" width="34" height="43" rx="5" fill={`url(#${gPaper})`} />
          <rect x="24" y="8" width="16" height="7" rx="3.5" fill="#fecdd3" />
          <path d="M22 23h20M22 29h14" stroke="#be123c" strokeWidth="2.4" strokeLinecap="round" />
          <rect x="21" y="35" width="22" height="13" rx="3.5" fill={`url(#${gRose})`} />
          <path d="m27 41.5 3.5 3.5 7-7" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}

      {id === 'sales-quotation' && (
        <>
          <path d="M15 10h24l9 9v34a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill={`url(#${gPaper})`} />
          <path d="M39 10v7a2 2 0 0 0 2 2h7z" fill="#ddd6fe" />
          <path d="M20 25h17M20 31h17M20 37h11" stroke="#6d28d9" strokeWidth="2.4" strokeLinecap="round" />
          <path d="m35 49 12-12 5 5-12 12-6 1.2z" fill={`url(#${gGold})`} />
          <path d="m44 40 5 5" stroke="#fff" strokeWidth="1.8" />
        </>
      )}

      {id === 'purchase-order' && (
        <>
          <path d="M15 10h24l9 9v34a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill={`url(#${gPaper})`} />
          <path d="M39 10v7a2 2 0 0 0 2 2h7z" fill="#bfdbfe" />
          <path d="M20 25h18M20 31h13" stroke="#1d4ed8" strokeWidth="2.4" strokeLinecap="round" />
          <rect x="24" y="37" width="24" height="14" rx="3" fill={`url(#${gGold})`} />
          <path d="m25 39 11 7 11-7" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </>
      )}

      {id === 'purchase-quotation' && (
        <>
          <path d="M14 10h24l9 9v34a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill={`url(#${gPaper})`} />
          <path d="M38 10v7a2 2 0 0 0 2 2h7z" fill="#dbeafe" />
          <path d="M19 25h17M19 31h13M19 37h10" stroke="#1d4ed8" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="43" cy="44" r="10.5" fill={`url(#${gGold})`} />
          <path d="M43 38v12M39.5 41c.8-2 6-2 6.5.8.4 2.6-6.5 1.8-6 4.8.4 2.2 4.6 2.2 6.5 0" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </>
      )}

      {id === 'goods-delivery' && (
        <>
          <rect x="7" y="19" width="31" height="26" rx="4" fill={`url(#${gPaper})`} />
          <path d="M38 26h11l8 9v10H38z" fill="#bfdbfe" />
          <path d="M41 29h6.5l5.5 6H41z" fill="#fff" />
          <path d="M12 26h20M12 32h14" stroke="#2563eb" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M7 42h50v3H7z" fill="#1e40af" opacity=".25" />
          <circle cx="19" cy="47" r="5.5" fill="#1e3a8a" />
          <circle cx="19" cy="47" r="2.2" fill="#fff" />
          <circle cx="47" cy="47" r="5.5" fill="#1e3a8a" />
          <circle cx="47" cy="47" r="2.2" fill="#fff" />
        </>
      )}

      {id === 'goods-receipt' && (
        <>
          <rect x="8" y="20" width="29" height="26" rx="4" fill={`url(#${gPaper})`} />
          <path d="M37 27h10l9 9v10H37z" fill="#dcfce7" />
          <path d="M40 30h6l6 6H40z" fill="#fff" />
          <path d="M13 27h17M13 33h12" stroke="#15803d" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="19" cy="48" r="5.5" fill="#14532d" />
          <circle cx="19" cy="48" r="2.2" fill="#fff" />
          <circle cx="47" cy="48" r="5.5" fill="#14532d" />
          <circle cx="47" cy="48" r="2.2" fill="#fff" />
          <circle cx="46" cy="17" r="9" fill={`url(#${gEmerald})`} />
          <path d="m42 17 2.8 2.8 5.2-5.6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}

      {id === 'sales-settings' && (
        <>
          <rect x="14" y="10" width="36" height="44" rx="4" fill={`url(#${gPaper})`} />
          <path d="M21 18h22M21 24h16" stroke="#be123c" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="32" cy="39" r="11" fill={`url(#${gRose})`} />
          <path d="m27.5 43.5 9-9" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
          <circle cx="28" cy="35" r="1.8" fill="#fff" />
          <circle cx="36" cy="43" r="1.8" fill="#fff" />
        </>
      )}

      {id === 'purchase' && (
        <>
          <path d="M16 10h24l9 9v35a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill={`url(#${gPaper})`} />
          <path d="M40 10v7a2 2 0 0 0 2 2h7z" fill="#bfdbfe" />
          <rect x="20" y="21" width="12" height="4" rx="2" fill="#93c5fd" />
          <path d="M20 31h21M20 37h21M20 43h14" stroke="#1d4ed8" strokeWidth="2.6" strokeLinecap="round" />
        </>
      )}

      {id === 'purchase-history' && (
        <>
          <path d="M16 10h24l9 9v34a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill={`url(#${gPaper})`} />
          <path d="M40 10v7a2 2 0 0 0 2 2h7z" fill="#bfdbfe" />
          <path d="M20 24h18M20 30h13" stroke="#1d4ed8" strokeWidth="2.4" strokeLinecap="round" />
          <path d="m21 46 6.5-6.5 5 3.5 9-9" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="41.5" cy="34" r="2.8" fill="#f59e0b" />
        </>
      )}

      {id === 'returns' && (
        <>
          <path d="M16 24a18 18 0 0 1 31-7l4 4" fill="none" stroke="#fff" strokeWidth="4.8" strokeLinecap="round" />
          <path d="m43 13 9 8-11 2" fill="#fff" />
          <path d="M48 40a18 18 0 0 1-31 7l-4-4" fill="none" stroke="#fed7aa" strokeWidth="4.8" strokeLinecap="round" />
          <path d="m21 51-9-8 11-2" fill="#fed7aa" />
          <rect x="23" y="23" width="18" height="18" rx="4" fill={`url(#${gPaper})`} />
          <path d="M27.5 29h9M27.5 34.5h9" stroke="#ea580c" strokeWidth="2.3" strokeLinecap="round" />
        </>
      )}

      {id === 'documents' && (
        <>
          <path d="M13 16h27l8 8v30H13z" fill="#ddd6fe" />
          <path d="M19 10h25l8 8v32a3 3 0 0 1-3 3H19a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill={`url(#${gPaper})`} />
          <path d="M44 10v6a2 2 0 0 0 2 2h6z" fill="#c4b5fd" />
          <path d="M23 26h20M23 32h20M23 38h13" stroke="#6d28d9" strokeWidth="2.5" strokeLinecap="round" />
          <rect x="23" y="16" width="12" height="3.5" rx="1.75" fill="#a78bfa" />
        </>
      )}

      {id === 'printer' && (
        <>
          <rect x="19" y="10" width="26" height="17" rx="3" fill={`url(#${gPaper})`} />
          <path d="M24 15.5h16M24 20h12" stroke="#7c3aed" strokeWidth="2.2" strokeLinecap="round" />
          <rect x="10" y="23" width="44" height="22" rx="6" fill={`url(#${gBlue})`} />
          <circle cx="46" cy="29.5" r="2.2" fill="#4ade80" />
          <rect x="18" y="36" width="28" height="18" rx="2.5" fill={`url(#${gPaper})`} />
          <path d="M23 42h18M23 47h13" stroke="#2563eb" strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}

      {id === 'inventory' && (
        <>
          <path d="m12 22 20-11 20 11-20 11z" fill="#fef3c7" />
          <path d="M12 22v23l20 11V33z" fill="#f59e0b" />
          <path d="M52 22v23L32 56V33z" fill="#b45309" />
          <path d="m22 16.5 20 11v8l-5-2.8v-8l-15-8.2z" fill="#fff" opacity=".88" />
          <rect x="17" y="34" width="9" height="6" rx="1.5" fill="#fff" opacity=".9" />
        </>
      )}

      {id === 'files' && (
        <>
          <path d="M9 18a4.5 4.5 0 0 1 4.5-4.5h13.5l5.5 5.5H50.5A4.5 4.5 0 0 1 55 23.5V48a4.5 4.5 0 0 1-4.5 4.5h-37A4.5 4.5 0 0 1 9 48z" fill={`url(#${gGold})`} />
          <path d="M10 25h44l-3.5 23.5a4 4 0 0 1-4 3.5h-29a4 4 0 0 1-4-3.5z" fill={`url(#${gPaper})`} />
          <path d="M17 32h28M17 38h22M17 44h15" stroke="#0891b2" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}

      {id === 'reports' && (
        <>
          <rect x="10" y="11" width="44" height="42" rx="6" fill={`url(#${gPaper})`} />
          <rect x="16" y="34" width="7.5" height="12" rx="2" fill={`url(#${gEmerald})`} />
          <rect x="28" y="25" width="7.5" height="21" rx="2" fill={`url(#${gGold})`} />
          <rect x="40" y="29" width="7.5" height="17" rx="2" fill={`url(#${gBlue})`} />
          <path d="M15 48h34" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
          <path d="m17 26 10-6 9 3.5 11-8.5" fill="none" stroke="#6d28d9" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="47" cy="15" r="2.8" fill="#6d28d9" />
        </>
      )}

      {id === 'accounts' && (
        <>
          <rect x="9" y="15" width="46" height="34" rx="6" fill={`url(#${gPaper})`} />
          <path d="M9 23h46v8H9z" fill={`url(#${gBlue})`} />
          <rect x="15" y="36" width="13" height="8" rx="2.5" fill={`url(#${gGold})`} />
          <path d="M33 40h15" stroke="#64748b" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M16 19h14" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
        </>
      )}

      {id === 'settings' && (
        <>
          <path d="m27.5 9 9 0 2 6.2a17 17 0 0 1 4.2 1.8l6-2.4 4.5 7.8-4.4 4.4a18 18 0 0 1 0 5.2l4.4 4.6-4.5 7.8-6-2.4a17 17 0 0 1-4.2 1.8l-2 6.2h-9l-2-6.2a17 17 0 0 1-4.2-1.8l-6 2.4-4.5-7.8 4.4-4.6a18 18 0 0 1 0-5.2l-4.4-4.4 4.5-7.8 6 2.4a17 17 0 0 1 4.2-1.8z" fill={`url(#${gPaper})`} />
          <circle cx="32" cy="32" r="10.5" fill={`url(#${gViolet})`} />
          <circle cx="32" cy="32" r="5" fill="#fff" />
        </>
      )}

      {(id === 'organization' || id === 'organization-hr' || id === 'users') && (
        <>
          <circle cx="24" cy="22" r="8.5" fill="#fed7aa" />
          <path d="M16.5 19a7.5 7.5 0 0 1 14-2" fill="none" stroke="#9a3412" strokeWidth="2.8" strokeLinecap="round" />
          <circle cx="43.5" cy="24" r="7" fill="#fde68a" />
          <path d="M38 21a6 6 0 0 1 10-1.5" fill="none" stroke="#b45309" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M9 50a15 15 0 0 1 30 0v3H9z" fill={`url(#${gPaper})`} />
          <path d="M35 37a12 12 0 0 1 20 10v6H38v-3a17 17 0 0 0-3-13z" fill="#bfdbfe" />
        </>
      )}

      {id === 'salary-process' && (
        <>
          <circle cx="23" cy="22" r="8" fill="#fde68a" />
          <path d="M9 50a14 14 0 0 1 28 0v3H9z" fill={`url(#${gPaper})`} />
          <rect x="33" y="13" width="22" height="40" rx="5" fill={`url(#${gPaper})`} />
          <rect x="37" y="18" width="14" height="9" rx="2.5" fill={`url(#${gEmerald})`} />
          <circle cx="44" cy="22.5" r="2.2" fill="#dcfce7" />
          <path d="M39 34h10M39 40h10M39 46h6" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}

      {id === 'organization-shift' && (
        <>
          <rect x="11" y="14" width="42" height="37" rx="6" fill={`url(#${gPaper})`} />
          <path d="M11 22h42v8H11z" fill={`url(#${gViolet})`} />
          <rect x="40" y="34" width="16" height="12" rx="6" fill="#c4b5fd" />
          <circle cx="45.5" cy="40" r="2.2" fill="#4c1d95" />
          <path d="M18 39h14M18 44h10" stroke="#7c3aed" strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}

      {id === 'cashbook' && (
        <>
          <rect x="11" y="13" width="42" height="38" rx="6" fill={`url(#${gPaper})`} />
          <path d="M11 21h42v8H11z" fill={`url(#${gTeal})`} />
          <rect x="18" y="35" width="21" height="10" rx="3" fill="#99f6e4" />
          <path d="M23 40h11" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="46" cy="40" r="3" fill={`url(#${gGold})`} />
        </>
      )}

      {id === 'logout' && (
        <>
          <rect x="13" y="10" width="28" height="44" rx="4" fill={`url(#${gPaper})`} />
          <rect x="18" y="15" width="18" height="34" rx="2" fill="#ffe4e6" />
          <rect x="10" y="14" width="4.5" height="36" rx="2" fill="#fb7185" />
          <circle cx="32" cy="32" r="2" fill="#be123c" />
          <path d="M29 32h24M45 24l8 8-8 8" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}

      {id === 'screen' && (
        <>
          <rect x="7" y="11" width="50" height="34" rx="6" fill={`url(#${gPaper})`} />
          <rect x="12" y="16" width="40" height="24" rx="3" fill="#dbeafe" />
          <rect x="16" y="20" width="14" height="10" rx="2.5" fill={`url(#${gBlue})`} />
          <path d="M34 22h13M34 27h9M16 35h31" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M27 45v7M37 45v7M22 53h20" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
        </>
      )}

      {id === 'store' && (
        <>
          <rect x="13" y="27" width="38" height="27" rx="3" fill={`url(#${gPaper})`} />
          <path d="M9 27 15 12h34l6 15H9z" fill="#fef3c7" />
          <path d="M10 27h44a7.5 7.5 0 0 1-14.5 4.5 7.5 7.5 0 0 1-15 0A7.5 7.5 0 0 1 10 27z" fill={`url(#${gRose})`} />
          <rect x="19" y="36" width="11" height="18" rx="2" fill={`url(#${gBlue})`} />
          <rect x="34" y="36" width="11" height="9" rx="2" fill="#bfdbfe" />
          <path d="M34 49h11" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}

      {id === 'database' && (
        <>
          <path d="M12 29v13c0 4.5 9 8 20 8s20-3.5 20-8V29" fill="#60a5fa" />
          <ellipse cx="32" cy="29" rx="20" ry="7.5" fill="#dbeafe" />
          <path d="M12 17v12c0 4.5 9 8 20 8s20-3.5 20-8V17" fill="#93c5fd" />
          <ellipse cx="32" cy="17" rx="20" ry="7.5" fill={`url(#${gPaper})`} />
          <circle cx="44" cy="25" r="2" fill="#fff" />
          <circle cx="44" cy="37" r="2" fill="#fff" />
          <path d="M18 24h10M18 36h10" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}

      {id === 'updates' && (
        <>
          <path d="M17 24a17 17 0 0 1 29-8l4 4" fill="none" stroke="#fff" strokeWidth="4.8" strokeLinecap="round" />
          <path d="m43 12 9 8-11 2" fill="#fff" />
          <path d="M47 40a17 17 0 0 1-29 8l-4-4" fill="none" stroke="#dcfce7" strokeWidth="4.8" strokeLinecap="round" />
          <path d="m21 52-9-8 11-2" fill="#dcfce7" />
          <circle cx="32" cy="32" r="10.5" fill={`url(#${gPaper})`} />
          <path d="m27.5 32 3.2 3.2 6.3-6.8" fill="none" stroke="#15803d" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
};
