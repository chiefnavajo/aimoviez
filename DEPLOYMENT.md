# 🚀 Deployment Guide for AiMoviez

This guide will help you deploy your AiMoviez application online.

## Prerequisites

1. **GitHub Account** - Your code should be in a GitHub repository
2. **Vercel Account** - Sign up at [vercel.com](https://vercel.com) (free tier available)
3. **Supabase Project** - Your database should be set up in Supabase

## Step 1: Prepare Your Repository

Make sure all your changes are committed and pushed to GitHub:

```bash
git add .
git commit -m "Remove vote button from story page and prepare for deployment"
git push origin main
```

## Step 2: Deploy to Vercel

### Option A: Deploy via Vercel Dashboard (Recommended)

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New Project"**
3. Import your GitHub repository
4. Vercel will auto-detect Next.js settings
5. Configure environment variables (see Step 3)
6. Click **"Deploy"**

### Option B: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy (follow prompts)
vercel

# For production deployment
vercel --prod
```

## Step 3: Configure Environment Variables

In your Vercel project settings, add these environment variables:

### Required Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# NextAuth
NEXTAUTH_URL=https://your-app.vercel.app
NEXTAUTH_SECRET=your-nextauth-secret-key

# Google OAuth (if using)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Allowed Emails (comma-separated)
ALLOWED_EMAILS=email1@example.com,email2@example.com
```

### Optional Variables

```env
# Pusher (for real-time features)
NEXT_PUBLIC_PUSHER_KEY=your-pusher-key
NEXT_PUBLIC_PUSHER_CLUSTER=your-pusher-cluster

# Pusher App ID and Secret (if using server-side)
PUSHER_APP_ID=your-pusher-app-id
PUSHER_SECRET=your-pusher-secret
```

### How to Add Environment Variables in Vercel

1. Go to your project in Vercel dashboard
2. Click **Settings** → **Environment Variables**
3. Add each variable with the appropriate value
4. Select environments (Production, Preview, Development)
5. Click **Save**

## Step 4: Generate NextAuth Secret

Generate a secure secret for NextAuth:

```bash
openssl rand -base64 32
```

Or use an online generator: https://generate-secret.vercel.app/32

Add this to your environment variables as `NEXTAUTH_SECRET`.

## Step 5: Configure Supabase

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **API**
3. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon/public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret!)

## Step 6: Set Up Database

Make sure all SQL migrations are applied in Supabase:

1. Go to **SQL Editor** in Supabase
2. Run these migrations in order:
   - `supabase/sql/2025-11-21-voting.sql`
   - `supabase/sql/CRITICAL-FIX-1-database-indexes.sql`
   - `supabase/sql/migration-comments.sql`
   - `supabase/sql/migration-genre-votes.sql`
   - `supabase/sql/migration-notifications.sql`
   - `supabase/sql/migration-critical-fixes.sql`

## Step 7: Configure CORS (if needed)

If you're using external APIs, make sure CORS is configured in:
- Supabase: **Settings** → **API** → **CORS**
- Add your Vercel domain to allowed origins

## Step 8: Deploy and Test

1. After deployment, Vercel will provide you with a URL like:
   ```
   https://your-app-name.vercel.app
   ```

2. Test your application:
   - ✅ Landing page loads
   - ✅ Authentication works
   - ✅ Dashboard loads clips
   - ✅ Story page works
   - ✅ Upload functionality works
   - ✅ Comments work

## Step 9: Custom Domain (Optional)

1. In Vercel dashboard, go to **Settings** → **Domains**
2. Add your custom domain
3. Follow DNS configuration instructions
4. Wait for DNS propagation (can take up to 48 hours)

## Troubleshooting

### Build Errors

If you get build errors:
1. Check **Deployments** tab in Vercel
2. Click on failed deployment to see logs
3. Common issues:
   - Missing environment variables
   - TypeScript errors
   - Missing dependencies

### Runtime Errors

1. Check **Functions** tab in Vercel for API route errors
2. Check browser console for client-side errors
3. Verify all environment variables are set correctly

### Database Connection Issues

1. Verify Supabase URL and keys are correct
2. Check Supabase project is active
3. Verify RLS (Row Level Security) policies are set up correctly

## Post-Deployment Checklist

- [ ] All environment variables are set
- [ ] Database migrations are applied
- [ ] Authentication works
- [ ] All pages load correctly
- [ ] API routes are working
- [ ] File uploads work (if using Supabase Storage)
- [ ] Real-time features work (if using Pusher)
- [ ] Cron jobs are configured (auto-advance slot)

## Monitoring

Vercel provides:
- **Analytics** - Track page views and performance
- **Logs** - View server logs and errors
- **Speed Insights** - Monitor page load times

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Supabase Documentation](https://supabase.com/docs)

---

Your app should now be live! 🎉








