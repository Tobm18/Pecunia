/**
 * Logo de Pecunia (même dessin que src/app/icon.svg) : un P dont la boucle est un camembert de budget
 * (part menthe), avec un € découpé au centre.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <rect width="512" height="512" rx="116" fill="#148270" />
      <rect x="142" y="120" width="57" height="280" rx="28.5" fill="#fff" />
      <circle cx="257" cy="233" r="114" fill="#fff" />
      <path d="M257 233L369.27 213.2A114 114 0 0 1 237.2 345.27Z" fill="#8fd8c9" />
      <g fill="none" stroke="#148270" strokeLinecap="round">
        <path d="M300.65 267.65A49 49 0 1 1 300.65 198.35" strokeWidth="20" />
        <path d="M194 220h71M194 245h71" strokeWidth="12" />
      </g>
    </svg>
  );
}
