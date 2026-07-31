// Keep in sync with app/legal.tsx in the Expo app.
// If you edit one, edit the other.

export const LAST_UPDATED = "July 2026";

export const TERMS_OF_SERVICE = `Last updated: ${LAST_UPDATED}

1. Acceptance of Terms

By creating an account or using the Franchise app ("App"), you agree to these Terms of Service ("Terms"). If you do not agree, do not use the App.

2. Description of Service

Franchise is a fantasy sports application that allows users to create and join private leagues, draft players, manage rosters, trade with other users, and compete in fantasy matchups across one or more seasons. The App is a scorekeeping and league-administration tool and is provided for entertainment purposes only.

3. Eligibility and Account Registration

You must be at least 13 years old to use the App. You may create an account using an email address and password, or by signing in with a third-party identity provider such as Google or Apple (Sign in with Apple). If you use Sign in with Apple, you may choose to hide your email address; the App will still function normally with the private relay email Apple provides. We never receive your Google or Apple account password. You are responsible for maintaining the security of your account and the credentials of any third-party provider used to sign in.

4. User Conduct

You agree not to:
• Use the App for any unlawful purpose
• Attempt to gain unauthorized access to other users' accounts
• Interfere with or disrupt the App's functionality
• Use automated tools or bots to interact with the App
• Harass, abuse, or harm other users
• Impersonate another person or misrepresent your affiliation with anyone

5. Objectionable Content and Community Conduct

Franchise has zero tolerance for objectionable content and abusive behavior.

The App includes private league chat, direct messages between league members, and user-set team names and team logos. By using these features you agree not to post, upload, or transmit content that is unlawful, harassing, threatening, hateful, defamatory, obscene, sexually explicit, or that targets any person or group on the basis of race, ethnicity, national origin, religion, disability, gender, age, or sexual orientation.

We screen messages and team names automatically against a prohibited-content filter. Every message can be reported from within the App, and any user can be blocked at any time from Profile > Blocked Users. We review reports within 24 hours and will remove offending content and terminate the accounts of users who violate this section, without notice and at our sole discretion. Repeat or severe violations result in a permanent ban.

To report abuse, use the in-app reporting tool or email admin@franchisefantasy.co.

6. League Dues and Payments

Franchise does not accept, hold, process, transfer, or pay out money. Franchise charges no entry fee, takes no commission, offers no wagering, and awards no prizes. Outcomes in the App are determined solely by the real-world statistical performance of the athletes on a user's roster.

Some private leagues collect dues among their own members, entirely outside the App. Where a league does, the App provides an optional record-keeping tool: a commissioner may enter a dues amount and their own payment handle (for example, a Venmo, Cash App, or PayPal username), and members may mark themselves as paid. Any payment is made directly between users through that third party's own app and is subject to that third party's terms. Franchise is not a party to, guarantor of, or intermediary in any such arrangement, receives no funds, and has no ability to verify, reverse, or refund any payment. Disputes over league dues are between the members of that league.

You are responsible for ensuring that any private contest you organize complies with the laws of your jurisdiction.

7. Your Content

You retain ownership of the content you post in the App. You grant Franchise a non-exclusive, worldwide, royalty-free license to store, display, and transmit that content solely for the purpose of operating the App — for example, showing your message to the other members of your league. This license ends when you delete the content or your account, except for copies retained in moderation records or backups.

8. Intellectual Property and Non-Affiliation

The App, including its design, features, and content, is owned by Franchise. Franchise is an independent product and is not affiliated with, endorsed by, sponsored by, or otherwise associated with the NBA, WNBA, NFL, or any of their member teams, leagues, or players' associations. All team names, team logos, uniforms, and player names, images, and likenesses are the property and trademarks of their respective owners and are used for informational and entertainment purposes only.

9. Termination

We may suspend or terminate your account at any time for violation of these Terms. You may delete your account at any time from Profile > Delete Account.

10. Disclaimer of Warranties

The App is provided "as is" without warranties of any kind. We do not guarantee uninterrupted access, accuracy of statistics, or availability of features.

11. Limitation of Liability

To the maximum extent permitted by law, Franchise shall not be liable for any indirect, incidental, or consequential damages arising from your use of the App.

12. Changes to Terms

We may update these Terms at any time. Continued use of the App after changes constitutes acceptance of the updated Terms.

13. Contact

For questions about these Terms, contact us at admin@franchisefantasy.co.`;

export const PRIVACY_POLICY = `Last updated: ${LAST_UPDATED}

1. Information We Collect

Account Information: When you create an account with email and password, we collect your email address and a password hash (stored securely via Supabase Auth). If you sign in with a third-party identity provider (Google or Apple), we receive a unique user identifier from that provider and your email address (or, in the case of Sign in with Apple, an Apple private relay email if you choose to hide your real address). We never receive or store your Google or Apple account password. On first sign-in with Apple, you may also choose to share your name; if provided, we store it on your account profile.

Content You Create: league and direct chat messages, team names, poll responses, and any images you choose to attach to a message or use as a team logo. Images are read from your camera or photo library only at the moment you select one, and are visible to the members of the league you post them in. Camera and photo library access are optional — every other feature works without them.

League Payment Handles: if you are a commissioner and choose to use the optional league dues tracker, we store the payment handle you enter (for example, a Venmo username) and each member's self-reported paid or unpaid status. We never receive, process, or store payment card details, bank details, amounts transferred, or any transaction record.

Usage Data: We collect information about how you use the App, including league participation, roster changes, and trade activity. This data is used to provide the App's core functionality.

Device Information: We may collect device identifiers and push notification tokens to deliver notifications you've opted into.

2. How We Use Your Information

• To provide and maintain the App's functionality
• To authenticate you when you sign in (including via Google or Apple)
• To send push notifications you've enabled (draft alerts, trade updates, etc.)
• To display league standings, matchups, and statistics
• To keep leagues safe by screening content and reviewing abuse reports
• To communicate important account or service updates

We do not use your information for advertising, and we do not track you across other companies' apps or websites.

3. Data Sharing

We do not sell your personal information. We share data only with:
• Supabase (database, authentication, and file storage provider)
• Google and Apple (only when you choose to sign in with one of these providers; we exchange authentication tokens with them to verify your identity)
• Expo (push notification delivery)
• PostHog (product analytics — app usage and diagnostic events that help us improve the App)
• Other users in your league (team name, roster, trade history, chat messages, and any images you post — as part of gameplay)

We may also disclose information where required by law, or where necessary to investigate a safety report or protect the rights and safety of our users.

4. Safety and Moderation

To keep leagues safe, we automatically screen chat messages and team names against a prohibited-content filter before they are saved. When you report a message, we retain the reported message, the reason you selected, any details you add, and the identities of the reporting and reported users for as long as we need them to review and act on the report. You can block another user at any time from Profile > Blocked Users.

5. Push Notifications

The App uses push notifications with 11 configurable categories. You can enable or disable each category in Notification Preferences, or disable all notifications from your Profile page.

6. Data Retention

Your data is retained as long as your account is active. When you delete your account, we delete your personal data, team data, and push notification tokens. Moderation records relating to a report may be retained after deletion where needed to enforce our Terms.

7. Data Security

We use Supabase Row Level Security (RLS) to ensure users can only access data they are authorized to view. Authentication tokens are stored securely on your device.

8. Children's Privacy

The App is not intended for children under 13. We do not knowingly collect data from children under 13. If you believe a child under 13 has created an account, email us at admin@franchisefantasy.co and we will delete it.

9. Your Rights

You have the right to:
• Access your personal data (visible in your Profile)
• Delete your account and associated data (Profile > Delete Account)
• Control push notification preferences
• Export your data by emailing admin@franchisefantasy.co

10. Changes to This Policy

We may update this Privacy Policy at any time. We will notify you of material changes through the App.

11. Contact

For privacy questions or data requests, contact us at admin@franchisefantasy.co.`;
