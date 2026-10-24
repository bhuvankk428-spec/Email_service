import type { NextConfig } from 'next';

const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    if (!apiProxyTarget) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxyTarget}/api/:path*`,
      },
    ];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
