import React from 'react';

export function DeraLedgerLogo({ className = "w-6 h-6", ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className} 
      {...props}
    >
      {/* 3D Folded "D" based on DeraLedger brand design */}
      
      {/* Left Pillar */}
      <path 
        d="M25 20 L40 20 L40 80 L25 70 Z" 
        fill="#6F2CFF" 
      />
      
      {/* Top Fold / Arch */}
      <path 
        d="M40 20 L75 35 C85 40, 90 50, 90 60 L70 50 C70 45, 65 38, 55 35 L40 30 Z" 
        fill="#8A55F7" 
      />
      
      {/* Bottom Fold / Return */}
      <path 
        d="M90 60 C90 75, 80 85, 60 95 L40 80 L55 75 C65 70, 70 60, 70 50 Z" 
        fill="#5D20D6" 
      />
      
      {/* Center connection detail to enhance 3D effect */}
      <path 
        d="M40 30 L55 35 L55 75 L40 80 Z" 
        fill="#E9D5FF" 
        opacity="0.1"
      />
    </svg>
  );
}
