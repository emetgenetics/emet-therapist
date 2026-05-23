import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import prisma from './db';
import { encrypt } from './encryption';

// Auto-detect NEXTAUTH_URL from Vercel env or fallback to local
const NEXTAUTH_URL = process.env.NEXTAUTH_URL 
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions['adapter'],
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        mfaToken: { label: 'MFA Code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Invalid credentials');
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.passwordHash) {
          throw new Error('Invalid credentials');
        }

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);

        if (!isValid) {
          throw new Error('Invalid credentials');
        }

        if (!user.isActive) {
          throw new Error('Account is disabled');
        }

        // If MFA is enabled, verify the token
        if (user.mfaEnabled && user.mfaSecret) {
          const mfaToken = credentials.mfaToken;
          if (!mfaToken) {
            throw new Error('MFA_REQUIRED');
          }

          const verified = speakeasy.totp.verify({
            secret: user.mfaSecret,
            encoding: 'base32',
            token: mfaToken,
            window: 1,
          });

          if (!verified) {
            throw new Error('Invalid MFA code');
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.isAdmin,
          mfaEnabled: user.mfaEnabled,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.isAdmin = (user as { isAdmin?: boolean }).isAdmin ?? false;
        token.mfaEnabled = (user as { mfaEnabled?: boolean }).mfaEnabled ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: string }).id = token.id as string;
        (session.user as { isAdmin: boolean }).isAdmin = token.isAdmin as boolean;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

// Helper to check if registrations are enabled
export async function isRegistrationEnabled(): Promise<boolean> {
  const setting = await prisma.appSettings.findUnique({
    where: { key: 'registrations_enabled' },
  });
  return setting?.value === true;
}

// Encrypt sensitive user data before saving
export function encryptUserData(data: { name?: string | null; phone?: string | null; emergencyContact?: string | null }) {
  return {
    name: data.name ? encrypt(data.name) : null,
    phone: data.phone ? encrypt(data.phone) : null,
    emergencyContact: data.emergencyContact ? encrypt(data.emergencyContact) : null,
  };
}
