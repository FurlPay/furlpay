import type { Config } from 'tailwindcss';

export const furlpayPreset = {
  theme: {
    extend: {
      colors: {
        furlpay: {
          primary: '#10B981',
          dark: '#064E3B',
          accent: '#34D399',
          bg: '#0F172A',
          surface: '#1E293B',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    }
  }
} satisfies Partial<Config>;
