import { ImageResponse } from 'next/og'

export const size = {
  width: 32,
  height: 32,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'white',
          borderRadius: '8px',
        }}
      >
        <svg 
          width="24" 
          height="24" 
          viewBox="0 0 100 100" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
        >
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
        </svg>
      </div>
    ),
    { ...size }
  )
}
