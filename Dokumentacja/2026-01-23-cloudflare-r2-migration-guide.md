# Cloudflare R2 + CDN Migration Guide

**Created:** 2026-01-23
**Author:** Claude (AI Assistant)
**Status:** Ready for future use
**Current setup:** Supabase Storage

---

## When to Migrate

Monitor these metrics in Supabase Dashboard → Settings → Billing:

| Metric | Supabase Pro Limit | Migrate When |
|--------|-------------------|--------------|
| Storage | 100 GB | > 80 GB used |
| Bandwidth | 250 GB/month | > 200 GB/month |
| Video count | N/A | > 10,000 videos |

**Signs you need to migrate:**
- Slow video loading times
- Approaching bandwidth limits
- Monthly costs exceeding $100 on Supabase

---

## Cost Comparison

| Provider | Storage | Bandwidth (Egress) | 10TB/month cost |
|----------|---------|-------------------|-----------------|
| Supabase Pro | $0.021/GB | $0.09/GB | ~$900/month |
| AWS S3 + CloudFront | $0.023/GB | $0.085/GB | ~$850/month |
| **Cloudflare R2 + CDN** | **$0.015/GB** | **FREE** | **~$150/month** |

**Cloudflare R2 wins** because egress (bandwidth) is FREE.

---

## Prerequisites

Before starting:
1. Cloudflare account (free to create)
2. Domain added to Cloudflare (for CDN)
3. ~2-4 hours for migration
4. Low-traffic time window (recommended)

---

## Step-by-Step Migration

### Step 1: Create Cloudflare R2 Bucket (5 minutes)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account → **R2** (left sidebar)
3. Click **Create bucket**
4. Name: `aimoviez-videos`
5. Location: **Automatic** (or choose closest to your users)
6. Click **Create bucket**

### Step 2: Get R2 API Credentials (5 minutes)

1. In R2 dashboard → **Manage R2 API Tokens**
2. Click **Create API token**
3. Name: `aimoviez-upload`
4. Permissions: **Object Read & Write**
5. Specify bucket: `aimoviez-videos`
6. Click **Create API Token**
7. **Save these values** (shown only once):
   - Access Key ID
   - Secret Access Key
   - Endpoint URL (format: `https://<account-id>.r2.cloudflarestorage.com`)

### Step 3: Add Environment Variables

Add to `.env.local` and Vercel environment variables:

```env
# Cloudflare R2 Configuration
CLOUDFLARE_R2_ACCESS_KEY_ID=your-access-key-id
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your-secret-access-key
CLOUDFLARE_R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
CLOUDFLARE_R2_BUCKET=aimoviez-videos
CLOUDFLARE_R2_PUBLIC_URL=https://videos.yourdomain.com
```

### Step 4: Set Up Custom Domain for R2 (10 minutes)

1. In R2 bucket settings → **Public Access**
2. Click **Connect Domain**
3. Enter: `videos.yourdomain.com`
4. Cloudflare automatically configures CDN
5. Wait for SSL certificate (1-2 minutes)

### Step 5: Update video-storage.ts

Replace or add to `/src/lib/video-storage.ts`:

```typescript
// Add R2 to storage provider options
const STORAGE_PROVIDER: 'supabase' | 'cloudinary' | 's3' | 'r2' = 'r2';

// Add R2 configuration
const R2_ENDPOINT = process.env.CLOUDFLARE_R2_ENDPOINT!;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET || 'aimoviez-videos';
const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL!;

// Add R2 upload function
async function uploadToR2(file: File, fileId: string): Promise<{ url: string; error?: string }> {
  try {
    // R2 uses S3-compatible API
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

    const s3Client = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
      },
    });

    const fileName = `clips/${fileId}.${file.name.split('.').pop()}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: fileName,
      Body: buffer,
      ContentType: file.type,
    });

    await s3Client.send(command);

    // Return public CDN URL
    const url = `${R2_PUBLIC_URL}/${fileName}`;
    return { url };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[R2 Upload Error]', message);
    return { url: '', error: message };
  }
}

// Add to switch statement in main upload handler:
case 'r2':
  uploadResult = await uploadToR2(file, fileId);
  break;
```

### Step 6: Install AWS SDK (Required for R2)

```bash
npm install @aws-sdk/client-s3
```

### Step 7: Migrate Existing Videos (1-2 hours)

Create migration script `/scripts/migrate-to-r2.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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

async function migrateVideos() {
  // Get all clips with Supabase URLs
  const { data: clips, error } = await supabase
    .from('tournament_clips')
    .select('id, video_url, thumbnail_url')
    .like('video_url', '%supabase%');

  if (error || !clips) {
    console.error('Failed to fetch clips:', error);
    return;
  }

  console.log(`Found ${clips.length} videos to migrate`);

  for (const clip of clips) {
    try {
      // Download from Supabase
      const response = await fetch(clip.video_url);
      const buffer = Buffer.from(await response.arrayBuffer());

      // Extract filename from URL
      const fileName = clip.video_url.split('/').pop();
      const r2Key = `clips/${fileName}`;

      // Upload to R2
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
        Key: r2Key,
        Body: buffer,
        ContentType: 'video/mp4',
      }));

      // Update database with new URL
      const newUrl = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/${r2Key}`;

      await supabase
        .from('tournament_clips')
        .update({ video_url: newUrl })
        .eq('id', clip.id);

      console.log(`Migrated: ${clip.id}`);
    } catch (err) {
      console.error(`Failed to migrate ${clip.id}:`, err);
    }
  }

  console.log('Migration complete!');
}

migrateVideos();
```

Run migration:
```bash
npx ts-node scripts/migrate-to-r2.ts
```

### Step 8: Update STORAGE_PROVIDER

In `/src/lib/video-storage.ts`, change:

```typescript
const STORAGE_PROVIDER: 'supabase' | 'cloudinary' | 's3' | 'r2' = 'r2';
```

### Step 9: Deploy and Test

1. Deploy to Vercel
2. Upload a test video
3. Verify video plays from new URL
4. Check Cloudflare R2 dashboard for the file

### Step 10: Clean Up (Optional, after verification)

After confirming everything works (wait 1-2 weeks):

1. Delete old videos from Supabase Storage
2. Downgrade Supabase plan if desired (keep database, remove storage)

---

## Verification Checklist

- [ ] R2 bucket created
- [ ] Custom domain configured (videos.yourdomain.com)
- [ ] SSL certificate active
- [ ] Environment variables set in Vercel
- [ ] AWS SDK installed
- [ ] Upload function added to video-storage.ts
- [ ] Test upload works
- [ ] Existing videos migrated
- [ ] Old videos still accessible during transition
- [ ] Video playback verified on all devices

---

## Rollback Plan

If something goes wrong:

1. Change `STORAGE_PROVIDER` back to `'supabase'`
2. Deploy
3. Old videos still work (URLs unchanged until migration)

---

## Cost Monitoring

After migration, monitor in Cloudflare Dashboard → R2:

- Storage used (GB)
- Class A operations (writes) - $4.50 per million
- Class B operations (reads) - $0.36 per million
- Egress - FREE

**Expected costs at scale:**
- 100K users: ~$20-50/month
- 1M users: ~$100-200/month
- 10M users: ~$500-1000/month

---

## Support Resources

- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
- [R2 S3 API Compatibility](https://developers.cloudflare.com/r2/api/s3/)
- [R2 Pricing](https://developers.cloudflare.com/r2/pricing/)

---

## Notes

- R2 is S3-compatible, so any S3 code/tools work
- Cloudflare CDN is automatic with custom domains
- No need to configure caching rules - Cloudflare handles it
- Videos are served from 300+ edge locations worldwide

---

*This document was prepared on 2026-01-23. Review and update before executing migration.*
