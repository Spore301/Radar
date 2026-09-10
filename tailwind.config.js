/** @type {import('tailwindcss').Config} */
// Vercel / Geist design language (see DESIGN-vercel.md): one ink tone on a
// near-white canvas, hairline borders, 6px chrome, 12px cards, Geist type.
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // Class names also live in plain modules (src/lib/utils/tier.ts holds the
    // score-tier colours). Without this line those classes are purged and the
    // low tier's bar renders with no colour at all.
    './src/lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#fafafa',
        elevated: '#ffffff',
        ink: '#171717',
        body: '#4d4d4d',
        mute: '#8f8f8f',
        faint: '#a1a1a1',
        hairline: '#ebebeb',
        'hairline-soft': '#f2f2f2',
        link: '#0070f3',
        'link-deep': '#0761d1',
        'link-soft': '#d3e5ff',
        error: '#ee0000',
        'error-deep': '#c50000',
        'error-soft': '#fde7e7',
        warning: '#f5a623',
        'warning-soft': '#ffefcf',
        'warning-deep': '#ab570a',
      },
      borderRadius: {
        sm: '6px',
        md: '12px',
        lg: '16px',
        pill: '100px',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Geist', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Arial', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Geist scale: size / line-height / tracking
        'display-xl': ['48px', { lineHeight: '48px', letterSpacing: '-2.4px', fontWeight: '600' }],
        'heading-lg': ['32px', { lineHeight: '40px', letterSpacing: '-1.28px', fontWeight: '600' }],
        'heading-md': ['20px', { lineHeight: '28px', letterSpacing: '-0.4px', fontWeight: '600' }],
        'heading-sm': ['16px', { lineHeight: '24px', letterSpacing: '-0.32px', fontWeight: '600' }],
        'label-sm': ['14px', { lineHeight: '20px', letterSpacing: '-0.28px', fontWeight: '500' }],
        'body-lg': ['16px', { lineHeight: '24px' }],
        'body-md': ['14px', { lineHeight: '20px' }],
        'body-sm': ['12px', { lineHeight: '16px' }],
        'body-xs': ['11px', { lineHeight: '14px' }],
        eyebrow: ['12px', { lineHeight: '16px', letterSpacing: '0.04em', fontWeight: '500' }],
      },
      boxShadow: {
        whisper: '0 1px 1px rgba(0,0,0,0.04)',
        float: '0 2px 2px rgba(0,0,0,0.04), 0 8px 16px -4px rgba(0,0,0,0.10)',
        modal: '0 2px 2px rgba(0,0,0,0.04), 0 16px 40px -8px rgba(0,0,0,0.16)',
      },
      maxWidth: {
        content: '1200px',
      },
    },
  },
  plugins: [],
};
