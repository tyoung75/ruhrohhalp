export const metadata = {
  title: 'Privacy Policy | ruhrohhalp',
};

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: March 27, 2026</p>
      <section className="space-y-4 text-gray-300">
        <h2 className="text-xl font-semibold text-white">1. Information We Collect</h2>
        <p>When you use ruhrohhalp, we collect information you provide directly (such as your name and email) and information retrieved from third-party platforms you authorize (such as TikTok profile data, video lists, and analytics).</p>
        <h2 className="text-xl font-semibold text-white">2. How We Use Your Information</h2>
        <p>We use your information solely to provide and improve the Service, including displaying your social media analytics, managing your content calendar, and powering creator workflow features. We do not sell your personal data.</p>
        <h2 className="text-xl font-semibold text-white">3. Third-Party Platform Data</h2>
        <p>When you connect a third-party account (e.g., TikTok), we access only the data scopes you authorize. This may include your public profile information, follower counts, video lists, and video performance metrics. This data is stored securely and is only accessible to you.</p>
        <h2 className="text-xl font-semibold text-white">4. Data Storage and Security</h2>
        <p>Your data is stored securely using industry-standard encryption. We use Supabase for database services with row-level security policies to ensure data isolation between users.</p>
        <h2 className="text-xl font-semibold text-white">5. Data Sharing</h2>
        <p>We do not share your personal data with third parties except as required by law or as necessary to provide the Service (e.g., hosting providers).</p>
        <h2 className="text-xl font-semibold text-white">6. Your Rights</h2>
        <p>You have the right to access, correct, or delete your personal data. You may revoke third-party platform access at any time through the respective platform&apos;s settings or through the ruhrohhalp settings page.</p>
        <h2 className="text-xl font-semibold text-white">7. Contact</h2>
        <p>For privacy-related inquiries, contact us at <a href="mailto:tylerjyoung5@gmail.com" className="text-blue-400 hover:underline">tylerjyoung5@gmail.com</a></p>
      </section>
    </main>
  );
}
