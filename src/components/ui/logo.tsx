/**
 * Logo de Pecunia (même dessin que src/app/icon.svg) : un P dont la boucle est un anneau de budget,
 * avec un € au centre, comme une pièce.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <rect width="512" height="512" rx="116" fill="#148270" />
      <g fill="none" strokeWidth="56">
        <circle cx="256" cy="234" r="86" stroke="#fff" />
        <path d="M340.69 219.07A86 86 0 0 1 241.07 318.69" stroke="#8fd8c9" />
        <path d="M170 148v224" stroke="#fff" strokeLinecap="round" />
      </g>
      <g fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round">
        <path d="M284.93 257.75A31 31 0 1 1 284.93 210.25" />
        <path d="M225 225h36M225 243h36" />
      </g>
    </svg>
  );
}
