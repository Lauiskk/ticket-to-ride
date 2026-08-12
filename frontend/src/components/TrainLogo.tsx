/**
 * Vintage steam train SVG logo for Ticket to Ride.
 * Inspired by classic board-game illustrations — detailed locomotive
 * with warm colors (gold, crimson, navy) matching the app theme.
 */
export function TrainLogo({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Ticket to Ride logo"
    >
      {/* Smoke */}
      <ellipse cx="14" cy="10" rx="4" ry="3" fill="#9CA3AF" opacity="0.5" />
      <ellipse cx="10" cy="7" rx="3" ry="2.5" fill="#9CA3AF" opacity="0.35" />
      <ellipse cx="17" cy="5" rx="2.5" ry="2" fill="#9CA3AF" opacity="0.25" />

      {/* Smokestack */}
      <rect x="12" y="14" width="5" height="10" rx="1" fill="#1a1a2e" />
      <rect x="10.5" y="12" width="8" height="3" rx="1.5" fill="#2d2d44" />
      <rect x="11.5" y="14" width="6" height="1" fill="#d4a017" />

      {/* Boiler (main body) */}
      <rect x="8" y="24" width="30" height="14" rx="7" fill="#8B1A1A" />
      <rect x="8" y="26" width="30" height="10" rx="5" fill="#B22222" />
      {/* Boiler bands */}
      <rect x="14" y="24" width="1.5" height="14" fill="#d4a017" />
      <rect x="22" y="24" width="1.5" height="14" fill="#d4a017" />
      <rect x="30" y="24" width="1.5" height="14" fill="#d4a017" />

      {/* Headlight */}
      <circle cx="9" cy="28" r="2.5" fill="#FCD34D" />
      <circle cx="9" cy="28" r="1.5" fill="#FEFCE8" />

      {/* Cab (engineer compartment) */}
      <rect x="36" y="18" width="16" height="22" rx="2" fill="#1E3A5F" />
      <rect x="37" y="19" width="14" height="10" rx="1" fill="#234B73" />
      {/* Cab roof */}
      <rect x="34" y="16" width="20" height="3" rx="1.5" fill="#1a1a2e" />
      <rect x="35" y="15" width="18" height="2" rx="1" fill="#2d2d44" />
      {/* Cab window */}
      <rect x="39" y="21" width="10" height="6" rx="1" fill="#87CEEB" opacity="0.7" />
      <rect x="39" y="21" width="10" height="1" fill="#87CEEB" opacity="0.9" />
      {/* Cab details */}
      <rect x="38" y="30" width="12" height="2" fill="#d4a017" />
      <circle cx="40" cy="36" r="1" fill="#d4a017" />
      <circle cx="48" cy="36" r="1" fill="#d4a017" />

      {/* Cow catcher (front) */}
      <polygon points="4,42 8,38 8,42" fill="#2d2d44" />
      <polygon points="4,42 8,42 8,44 5,44" fill="#1a1a2e" />

      {/* Frame/chassis */}
      <rect x="6" y="38" width="48" height="4" fill="#1a1a2e" />
      <rect x="6" y="38" width="48" height="1" fill="#d4a017" />

      {/* Wheels - large drive wheels */}
      <circle cx="18" cy="48" r="7" fill="#2d2d44" />
      <circle cx="18" cy="48" r="5.5" fill="#3d3d5c" />
      <circle cx="18" cy="48" r="4" fill="#1a1a2e" />
      <circle cx="18" cy="48" r="1.5" fill="#d4a017" />
      {/* Wheel spokes */}
      <line x1="18" y1="43" x2="18" y2="53" stroke="#d4a017" strokeWidth="0.6" />
      <line x1="13" y1="48" x2="23" y2="48" stroke="#d4a017" strokeWidth="0.6" />
      <line x1="14.5" y1="44.5" x2="21.5" y2="51.5" stroke="#d4a017" strokeWidth="0.6" />
      <line x1="21.5" y1="44.5" x2="14.5" y2="51.5" stroke="#d4a017" strokeWidth="0.6" />

      {/* Second large wheel */}
      <circle cx="34" cy="48" r="7" fill="#2d2d44" />
      <circle cx="34" cy="48" r="5.5" fill="#3d3d5c" />
      <circle cx="34" cy="48" r="4" fill="#1a1a2e" />
      <circle cx="34" cy="48" r="1.5" fill="#d4a017" />
      {/* Wheel spokes */}
      <line x1="34" y1="43" x2="34" y2="53" stroke="#d4a017" strokeWidth="0.6" />
      <line x1="29" y1="48" x2="39" y2="48" stroke="#d4a017" strokeWidth="0.6" />
      <line x1="30.5" y1="44.5" x2="37.5" y2="51.5" stroke="#d4a017" strokeWidth="0.6" />
      <line x1="37.5" y1="44.5" x2="30.5" y2="51.5" stroke="#d4a017" strokeWidth="0.6" />

      {/* Small rear wheel */}
      <circle cx="48" cy="48" r="4.5" fill="#2d2d44" />
      <circle cx="48" cy="48" r="3.5" fill="#3d3d5c" />
      <circle cx="48" cy="48" r="2.5" fill="#1a1a2e" />
      <circle cx="48" cy="48" r="1" fill="#d4a017" />

      {/* Connecting rod between wheels */}
      <rect x="16" y="47" width="20" height="1.2" rx="0.6" fill="#5a5a7a" />
      <circle cx="18" cy="47.6" r="1.2" fill="#d4a017" />
      <circle cx="34" cy="47.6" r="1.2" fill="#d4a017" />

      {/* Rail/track */}
      <rect x="0" y="54" width="64" height="2" fill="#4a4a6a" />
      <rect x="0" y="55" width="64" height="0.5" fill="#d4a017" opacity="0.5" />

      {/* Steam whistle */}
      <rect x="33" y="13" width="2" height="5" rx="1" fill="#d4a017" />
      <ellipse cx="34" cy="12" rx="1.5" ry="1" fill="#FCD34D" />
    </svg>
  );
}
