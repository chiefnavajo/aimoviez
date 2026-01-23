# Cloudflare R2 Quick Start Guide

**Created:** 2026-01-23
**Full guide:** `2026-01-23-cloudflare-r2-migration-guide.md`

---

## Part 1: Switch to R2 (15 minutes)

### Step 1: Create R2 Bucket
1. Go to https://dash.cloudflare.com
2. Click **R2** in sidebar
3. **Create bucket** → name: `aimoviez-videos`

### Step 2: Get API Credentials
1. R2 → **Manage R2 API Tokens** → **Create API token**
2. Name: `aimoviez-upload`
3. Permissions: **Object Read & Write**
4. Bucket: `aimoviez-videos`
5. **Save these values** (shown only once):
   - Access Key ID
   - Secret Access Key
   - Account ID (from URL: `dash.cloudflare.com/<ACCOUNT_ID>/r2`)

### Step 3: Set Up CDN Domain
1. In bucket → **Settings** → **Public Access**
2. **Connect Domain** → `videos.yourdomain.com`
3. Wait for SSL (1-2 min)

### Step 4: Add Environment Variables
In **Vercel Dashboard** → Project → Settings → Environment Variables:

```
CLOUDFLARE_R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
CLOUDFLARE_R2_ACCESS_KEY_ID=<your-access-key>
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<your-secret-key>
CLOUDFLARE_R2_BUCKET=aimoviez-videos
CLOUDFLARE_R2_PUBLIC_URL=https://videos.yourdomain.com
```

### Step 5: Switch Provider
Edit `/src/lib/video-storage.ts` line 10:

```typescript
// Change from:
const STORAGE_PROVIDER: 'supabase' | 'cloudinary' | 's3' | 'r2' = 'supabase';

// To:
const STORAGE_PROVIDER: 'supabase' | 'cloudinary' | 's3' | 'r2' = 'r2';
```

### Step 6: Deploy
```bash
git add -A && git commit -m "Switch to Cloudflare R2" && git push
```

**Done!** New uploads now go to R2.

---

## Part 2: Migrate Existing Videos (1-2 hours)

### Step 1: Create Migration Script

Create file `scripts/migrate-to-r2.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET!;
const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL!;

async function migrateVideos() {
  console.log('Starting migration...');

  // Get all clips with Supabase URLs
  const { data: clips, error } = await supabase
    .from('tournament_clips')
    .select('id, video_url, thumbnail_url')
    .like('video_url', '%supabase%');

  if (error) {
    console.error('Failed to fetch clips:', error);
    return;
  }

  console.log(`Found ${clips?.length || 0} videos to migrate`);

  let migrated = 0;
  let failed = 0;

  for (const clip of clips || []) {
    try {
      // Download from Supabase
      console.log(`Downloading: ${clip.id}`);
      const response = await fetch(clip.video_url);

      if (!response.ok) {
        console.error(`Failed to download ${clip.id}: ${response.status}`);
        failed++;
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Extract filename
      const fileName = clip.video_url.split('/').pop() || `${clip.id}.mp4`;
      const r2Key = `clips/${fileName}`;

      // Upload to R2
      console.log(`Uploading to R2: ${r2Key}`);
      await s3Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: buffer,
        ContentType: 'video/mp4',
      }));

      // Update database with new URL
      const newUrl = `${R2_PUBLIC_URL}/${r2Key}`;

      const { error: updateError } = await supabase
        .from('tournament_clips')
        .update({ video_url: newUrl })
        .eq('id', clip.id);

      if (updateError) {
        console.error(`Failed to update DB for ${clip.id}:`, updateError);
        failed++;
        continue;
      }

      migrated++;
      console.log(`✓ Migrated: ${clip.id} (${migrated}/${clips.length})`);

    } catch (err) {
      console.error(`Failed to migrate ${clip.id}:`, err);
      failed++;
    }
  }

  console.log('\n========== MIGRATION COMPLETE ==========');
  console.log(`Migrated: ${migrated}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${clips?.length || 0}`);
}

migrateVideos();
```

### Step 2: Run Migration

```bash
# Install ts-node if needed
npm install -D ts-node

# Run migration
npx ts-node scripts/migrate-to-r2.ts
```

### Step 3: Verify

1. Check a few videos play correctly
2. Check Cloudflare R2 dashboard shows files
3. Check database URLs updated

### Step 4: Clean Up (After 1-2 weeks)

Once confirmed working:
1. Delete videos from Supabase Storage
2. Optionally downgrade Supabase plan

---

## Rollback (If Something Breaks)

```bash
# Revert to Supabase
git checkout src/lib/video-storage.ts
git commit -m "Revert to Supabase storage"
git push
```

Old Supabase videos still work until you delete them.

---

## Cost After Migration

| Scale | R2 Storage | Monthly Cost |
|-------|-----------|--------------|
| 10K videos | 100 GB | ~$1.50 |
| 100K videos | 1 TB | ~$15 |
| 1M videos | 10 TB | ~$150 |

Bandwidth: **FREE** (no egress fees)
