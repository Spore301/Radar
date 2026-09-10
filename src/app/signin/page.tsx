import { RadrLogo } from '@/components/brand/RadrLogo';
import { signIn } from '@/lib/auth';

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "That Google account isn't authorized for RADR. Ask a teammate for an invite, or sign in with your work Google account.",
  Configuration: 'Sign-in is misconfigured. Check the server logs.',
  Default: 'Something went wrong signing you in. Please try again.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
  const errorMessage = searchParams.error ? ERROR_MESSAGES[searchParams.error] ?? ERROR_MESSAGES.Default : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-canvas">
      <div className="w-full max-w-[360px] card p-8 flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="text-ink inline-flex">
            <RadrLogo height={22} />
          </span>
          <div>
            <h1 className="text-heading-md text-ink">Sign in</h1>
            <p className="text-body-sm text-body mt-1">Shared team workspace. Use your work Google account.</p>
          </div>
        </div>

        {errorMessage && <div className="px-3 py-2 rounded-sm bg-error-soft text-body-sm text-error-deep">{errorMessage}</div>}

        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: searchParams.callbackUrl || '/dashboard' });
          }}
        >
          <button type="submit" className="btn-primary btn-lg w-full">
            Continue with Google
          </button>
        </form>
      </div>
    </div>
  );
}
