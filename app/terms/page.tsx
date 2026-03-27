export const metadata = {
  title: 'Terms of Service | ruhrohhalp',
};

export default function TermsPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: March 27, 2026</p>

      <section className="space-y-4 text-gray-300">
        <h2 className="text-xl font-semibold text-white">1. Acceptance of Terms</h2>
        <p>
          By accessing or using ruhrohhalp (&quot;the Service&quot;), you agree to be bound by these
          Terms of Service. If you do not agree, do not use the Service.
        </p>

        <h2 className="text-xl font-semibold text-white">2. Description of Service</h2>
        <p>
          ruhrohhalp is a personal AI-powered dashboard for managing social media content,
          analytics, tasks, and creator workflows. The Service integrates with third-party
          platforms including TikTok, Instagram, and others via their official APIs.
        </p>

        <h2 className="text-xl font-semibold text-white">3. User Accounts</h2>
        <p>
          You are responsible for maintaining the confidentiality of your account credentials
          and for all activities that occur under your account.
        </p>

        <h2 className="text-xl font-semibold text-white">4. Third-Party Integrations</h2>
        <p>
          The Service connects to third-party platforms via OAuth. By authorizing these
          connections, you grant ruhrohhalp permission to access data as specified during
          the authorization flow. You may revoke access at any time through the respective
          platform&apos;s settings.
        </p>

        <h2 className="text-xl font-semibold text-white">5. Data Usage</h2>
        <p>
          Data retrieved from third-party platforms is used solely to provide the Service&apos;s
          features to you. We do not sell or share your data with third parties.
        </p>

        <h2 className="text-xl font-semibold text-white">6. Limitation of Liability</h2>
        <p>
          The Service is provided &quot;as is&quot; without warranties of any kind. We are not
          liable for any damages arising from your use of the Service.
        </p>

        <h2 className="text-xl font-semibold text-white">7. Changes to Terms</h2>
        <p>
          We may update these Terms at any time. Continued use of the Service after changes
          constitutes acceptance of the updated Terms.
        </p>

        <h2 className="text-xl font-semibold text-white">8. Contact</h2>
        <p>
          Questions about these Terms? Contact us at{' '}
          <a href="mailto:tylerjyoung5@gmail.com" className="text-blue-400 hover:underline">
            tylerjyoung5@gmail.com
          </a>
        </p>
      </section>
    </main>
  );
}
