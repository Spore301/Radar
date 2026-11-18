import type { Metadata } from 'next';
import Link from 'next/link';
import { RadrLogo } from '@/components/brand/RadrLogo';
import { PRODUCT_OWNER, TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Terms of Use · RADR.',
  description: 'Terms of use and disclaimer for RADR., a candidate sourcing product in testing.',
};

// Public: readable before sign-in, linked from the sign-in page, the landing
// footer and the app sidebar. Deliberately plain English.
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="lp-container h-16 flex items-center justify-between">
        <Link href="/" className="text-ink inline-flex items-center" aria-label="RADR. home">
          <RadrLogo height={18} />
        </Link>
        <Link href="/signin" className="btn-ghost">
          Sign in
        </Link>
      </header>

      <main className="lp-container pb-24">
        <article className="max-w-[72ch] flex flex-col gap-8">
          <div className="flex flex-col gap-3 pt-8">
            <span className="eyebrow">Legal</span>
            <h1 className="text-[32px] leading-10 font-semibold tracking-[-1.28px]">Terms of Use and Disclaimer</h1>
            <p className="text-body-sm text-mute">
              Version {TERMS_VERSION} · effective {TERMS_EFFECTIVE_DATE}
            </p>
            <p className="text-body-lg text-body">
              RADR. is a candidate sourcing product that is currently <strong className="text-ink">in testing</strong>. It is made
              available so that invited testers can try it and report back. Please read this page before you use it.
            </p>
          </div>

          <Section title="1. Agreement">
            <p>
              By signing in to RADR., or by continuing to use it, you agree to these terms. If you do not agree, do not sign in, and stop
              using the product.
            </p>
            <p>
              If you signed in before this page was published, your continued use of RADR. after {TERMS_EFFECTIVE_DATE} is your
              agreement to these terms. If you would rather not agree, stop using the product and ask, through the Feedback page or the
              person who invited you, for your account and data to be removed.
            </p>
          </Section>

          <Section title="2. A product in testing">
            <p>
              RADR. is pre-release software. Features may be incomplete, may change without notice, may behave unexpectedly, and may be
              withdrawn. Search results, relevance scores and drafted messages are produced by automated systems and third-party
              services, and may be wrong, incomplete or out of date. Nothing RADR. shows you is advice, and every decision you make on
              the basis of it is your own.
            </p>
          </Section>

          <Section title="3. Your data during testing">
            <p>
              Sessions, job descriptions, indexed profiles, notes, outreach history, settings and feedback you submit are stored so the
              product can work and so problems can be investigated. During testing this data may be reset, migrated, corrupted or
              deleted, whether deliberately, as part of a change to the product, or by accident. <strong className="text-ink">Do not treat
              RADR. as the only copy of anything you need.</strong> Export or record elsewhere anything you cannot afford to lose.
            </p>
            <p>
              Screenshots attached to feedback are stored with the report. Take care not to include more personal information than
              the report needs.
            </p>
          </Section>

          <Section title="4. No warranty">
            <p>
              RADR. is provided <em>as is</em> and <em>as available</em>, without warranty of any kind, express or implied, including
              any warranty of merchantability, fitness for a particular purpose, accuracy, availability or non-infringement, to the
              fullest extent permitted by law.
            </p>
          </Section>

          <Section title="5. Limitation of liability">
            <p>
              To the fullest extent permitted by law, {PRODUCT_OWNER}, as the creator and operator of RADR., is not liable to you or to
              anyone else for any loss or damage arising out of or in connection with RADR. or its use, including without limitation:
            </p>
            <ul className="list-disc pl-5 flex flex-col gap-1.5">
              <li>loss of, damage to, or inability to access data, sessions, candidate records, notes or messages;</li>
              <li>downtime, interruptions, errors or the withdrawal of the product;</li>
              <li>decisions taken, messages sent or hires made or not made on the basis of what RADR. shows;</li>
              <li>charges incurred with third-party services you connect, such as SerpAPI or DeepSeek;</li>
              <li>any indirect, incidental, special, consequential or punitive loss, or any loss of profit, business or goodwill.</li>
            </ul>
            <p>
              Where the law does not allow liability to be excluded entirely, it is limited to the greatest extent the law permits.
              You have paid nothing for access to RADR. during testing, and that reflects the basis on which it is offered.
            </p>
          </Section>

          <Section title="6. Your responsibilities">
            <p>
              You are responsible for using RADR. lawfully and fairly. In particular you agree to:
            </p>
            <ul className="list-disc pl-5 flex flex-col gap-1.5">
              <li>use the product only for legitimate recruiting on behalf of an organisation you are authorised to recruit for;</li>
              <li>comply with the terms of the platforms whose public pages appear in results, and with applicable privacy and data
                protection law, when you view, store or contact the people RADR. finds;</li>
              <li>keep your Google account and any API keys you enter secure, and use those third-party services within their own terms
                and limits;</li>
              <li>not attempt to access another user&apos;s sessions, candidates or feedback, or to probe, disrupt or overload the
                service.</li>
            </ul>
          </Section>

          <Section title="7. Third-party services">
            <p>
              RADR. relies on Google for sign-in, on SerpAPI for search results, and on DeepSeek for language-model features. Each is
              governed by its own terms and privacy policy, and none is under the control of {PRODUCT_OWNER}. Keys you enter for those
              services are stored encrypted and used only to make requests on your behalf.
            </p>
          </Section>

          <Section title="8. Changes and contact">
            <p>
              These terms may change as the product develops. The version and effective date at the top of this page will change when
              they do, and continuing to use RADR. after a change is your agreement to the updated terms. Questions and requests,
              including a request to delete your account and data, can be sent through the Feedback page inside the product or to the
              person who invited you.
            </p>
          </Section>

          <p className="text-body-sm text-mute border-t border-hairline pt-6">
            RADR. is created and operated by {PRODUCT_OWNER}. Version {TERMS_VERSION}.
          </p>
        </article>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-heading-md text-ink">{title}</h2>
      <div className="flex flex-col gap-3 text-body-md text-body leading-relaxed">{children}</div>
    </section>
  );
}
