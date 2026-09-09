import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Radar, ArrowRight } from 'lucide-react';
import { auth } from '@/lib/auth';
import { isOnboarded } from '@/lib/db/users';
import { PLATFORMS } from '@/lib/search/platforms';
import { PlatformLogo } from '@/components/platforms/PlatformLogo';

// The public front door. Anyone signed in is sent straight to where they left
// off; everyone else sees what the product does and one way in.
export default async function LandingPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect((await isOnboarded(session.user.id)) ? '/dashboard' : '/onboarding');
  }

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <header className="max-w-content w-full mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-[5px] bg-ink text-white flex items-center justify-center">
            <Radar className="w-3.5 h-3.5" strokeWidth={2.5} />
          </span>
          <span className="text-label-sm">CandidateRadar</span>
        </div>
        <Link href="/signin" className="btn-ghost">
          Sign in
        </Link>
      </header>

      <main className="flex-1">
        <section className="max-w-content mx-auto px-6 pt-20 pb-16 grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-14 items-center">
          <div className="flex flex-col gap-6">
            <span className="eyebrow">Candidate sourcing from a job description</span>
            <h1 className="text-[44px] leading-[1.05] sm:text-[56px] font-semibold tracking-[-2px] [text-wrap:balance]">
              Find the people behind the job description.
            </h1>
            <p className="text-body-lg text-body max-w-[58ch]">
              Paste or upload a JD. CandidateRadar extracts the constraints, builds one approved X-Ray query per platform, searches each one
              individually, and indexes every profile the search engine returns — then keeps the whole session, shortlist and outreach history.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <Link href="/signin" className="btn-primary btn-lg">
                Continue with Google <ArrowRight className="w-4 h-4" />
              </Link>
              <a href="#how" className="btn-ghost btn-lg">
                How it works
              </a>
            </div>
            <p className="text-body-sm text-mute">You bring your own SerpAPI key. Nothing is scraped from behind a login.</p>
          </div>

          <div className="card p-5 flex flex-col gap-4">
            <div className="eyebrow">One search, nine sources</div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PLATFORMS.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 h-10 px-3 rounded-sm border border-hairline bg-elevated">
                  <PlatformLogo platform={p.id} size={14} />
                  <span className="text-body-sm text-ink truncate">{p.label}</span>
                </li>
              ))}
            </ul>
            <p className="text-body-xs text-mute">Each query is a fixed, reviewed template. You can read every string before it runs, edit it, or build your own.</p>
          </div>
        </section>

        <section id="how" className="border-t border-hairline">
          <div className="max-w-content mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              ['01', 'Ingest', 'Upload a PDF or DOCX, paste text, or describe the role to the agent. Title, seniority, location, skills and domain are extracted; soft skills are kept for scoring, never searched.'],
              ['02', 'Query & search', 'Approved X-Ray templates are filled from the constraints and your additional details, fitted to Google’s 32-word limit, and searched one by one with live progress and a per-query receipt.'],
              ['03', 'Index & reach out', 'Every profile the engine returns is stored in the session. Score sorts, it never hides. Shortlist, take notes, and draft outreach in your organisation’s name.'],
            ].map(([n, h, body]) => (
              <div key={n} className="flex flex-col gap-2">
                <span className="eyebrow">{n}</span>
                <h2 className="text-heading-md">{h}</h2>
                <p className="text-body-sm text-body">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="max-w-content mx-auto px-6 h-14 flex items-center justify-between text-body-xs text-mute">
          <span>CandidateRadar</span>
          <Link href="/signin" className="hover:text-ink">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
