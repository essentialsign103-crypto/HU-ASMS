/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@hu-asms/types',
    '@hu-asms/validation',
    '@hu-asms/shared',
    '@hu-asms/database'
  ],
};

export default nextConfig;
