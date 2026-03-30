/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  // Allow large API request bodies (for audio uploads)
  api: {
    bodyParser: {
      sizeLimit: "100mb",
    },
  },
};
export default nextConfig;
