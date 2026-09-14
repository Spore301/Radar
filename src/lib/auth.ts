import NextAuth, { type DefaultSession } from 'next-auth';
import Google, { GoogleProfile } from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from './db/client';

const ALLOWED_GOOGLE_DOMAIN = process.env.ALLOWED_GOOGLE_DOMAIN;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Database (not JWT) sessions: revoking access means deleting a row, and
  // "who did this" (Job.createdById, etc.) can trust the session is real.
  session: { strategy: 'database' },
  // Required outside Vercel — without it Auth.js rejects requests as coming
  // from an untrusted origin.
  trustHost: true,
  pages: {
    signIn: '/signin',
    // A rejected sign-in (signIn callback returns false) redirects here with
    // ?error=AccessDenied rather than Auth.js's default unstyled error page.
    error: '/signin',
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET,
      authorization: ALLOWED_GOOGLE_DOMAIN
        ? { params: { hd: ALLOWED_GOOGLE_DOMAIN } }
        : undefined,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'google') return false;

      // The `hd` (hosted-domain) claim comes from Google's verified ID token
      // and asserts which Google Workspace domain the account belongs to.
      // Deliberately not using `email.endsWith(domain)`: that's a check on a
      // user-controlled-looking string field where an anchoring mistake (e.g.
      // `.includes` instead of `.endsWith`, or matching without the leading
      // `@`) is an easy way to accidentally admit "evil-houseofedtech.in.co".
      // `hd` has no such footgun — it's either the exact verified domain or
      // absent (personal Gmail accounts don't have one at all).
      const googleProfile = profile as GoogleProfile | undefined;
      const hd = googleProfile?.hd;

      if (ALLOWED_GOOGLE_DOMAIN && hd === ALLOWED_GOOGLE_DOMAIN) {
        return true;
      }

      const email = (user.email ?? googleProfile?.email)?.toLowerCase();
      if (!email) return false;

      const invite = await prisma.invite.findUnique({ where: { email } });
      if (!invite) return false;

      await prisma.invite.update({ where: { email }, data: { usedAt: new Date() } });
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});

// Canonical Auth.js augmentation for adding a field to the session's user
// object — see https://authjs.dev/getting-started/typescript.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}
