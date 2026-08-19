import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],

  async redirects() {
    return [
      {
        // Recruitment link: /signup on whatever host serves the app goes to the sign-up form.
        // A temporary redirect on purpose — a permanent one is cached by browsers indefinitely,
        // so a later change of form would keep sending people who had followed the old link to
        // the old form, with nothing on our side able to correct it.
        source: "/signup",
        destination: "https://forms.gle/g2UHKXywzkKpHHEP7",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
