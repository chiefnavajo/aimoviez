# ============================================================================
# CRITICAL FIX 2: ENVIRONMENT VARIABLES SETUP
# ============================================================================
# Complete guide to set all required environment variables
# ============================================================================

## ðŸ“‹ QUICK SETUP CHECKLIST

### Step 1: Copy this to your .env.local file:

```env
# ============================================================================
# CORE REQUIREMENTS (MUST HAVE)
# ============================================================================

# Supabase (Get from: https://app.supabase.com/project/_/settings/api)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...your-key-here

# Optional but recommended for RLS
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...your-anon-key

# ============================================================================
# ADMIN SECURITY (REQUIRED FOR PRODUCTION)
# ============================================================================

# Set to true in production!
ADMIN_TOKENS_ENABLED=true

# Generate with: openssl rand -hex 32
ADMIN_SECRET_KEY=your-32-character-secret-key-here-change-this-now

# Generate multiple tokens for different admin users
ADMIN_VALID_TOKENS=token1-here,token2-here,token3-here

# ============================================================================
# PUSHER (FOR REAL-TIME UPDATES)
# ============================================================================
# Get from: https://dashboard.pusher.com/

NEXT_PUBLIC_PUSHER_KEY=your-pusher-key
NEXT_PUBLIC_PUSHER_CLUSTER=us2
PUSHER_APP_ID=your-app-id
PUSHER_SECRET=your-pusher-secret

# ============================================================================
# RATE LIMITING & VOTING
# ============================================================================

RATE_LIMIT_ENABLED=true
RATE_LIMIT_PER_MINUTE=60
DAILY_VOTE_LIMIT=200
CLIP_POOL_SIZE=30

# ============================================================================
# CACHING
# ============================================================================

CACHE_TTL_STATS=300
CACHE_TTL_LEADERBOARD=60
CACHE_TTL_STORY=30
CACHE_TTL_CLIPS=120

# ============================================================================
# CORS
# ============================================================================

CORS_ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com

# ============================================================================
# NODE ENVIRONMENT
# ============================================================================

NODE_ENV=development  # Change to 'production' when deploying
```

---

## ðŸ”§ SETUP INSTRUCTIONS

### 1ï¸âƒ£ GET SUPABASE CREDENTIALS (2 minutes)

1. Go to: https://app.supabase.com
2. Select your project
3. Go to Settings â†’ API
4. Copy these values:
   - `Project URL` â†’ `NEXT_PUBLIC_SUPABASE_URL`
   - `service_role` key â†’ `SUPABASE_SERVICE_ROLE_KEY`
   - `anon` key â†’ `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2ï¸âƒ£ GENERATE ADMIN TOKENS (1 minute)

Run this command 3 times to generate secure tokens:

```bash
# Generate secure admin tokens
openssl rand -hex 32
```

Example output:
```
a4f5e8b2c9d1e3f7a8b4c6d8e2f4a6b8c1d3e5f7a9b2c4d6e8f1a3b5c7d9e2f4a6
```

Add these to `ADMIN_VALID_TOKENS` separated by commas.

### 3ï¸âƒ£ SETUP PUSHER (5 minutes)

1. Go to: https://dashboard.pusher.com
2. Click "Create app" (free tier is fine)
3. Choose:
   - Name: `aimoviez`
   - Cluster: `us2` (or closest to you)
   - Frontend: React
   - Backend: Node.js
4. Go to "App Keys" tab
5. Copy all 4 values to your .env.local

### 4ï¸âƒ£ QUICK VERIFICATION SCRIPT

Create this file as `verify-env.js` and run it:

```javascript
// verify-env.js
const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ADMIN_TOKENS_ENABLED',
  'ADMIN_SECRET_KEY',
  'ADMIN_VALID_TOKENS'
];

const recommended = [
  'NEXT_PUBLIC_PUSHER_KEY',
  'PUSHER_APP_ID',
  'PUSHER_SECRET',
  'RATE_LIMIT_ENABLED'
];

console.log('ðŸ” Checking environment variables...\n');

// Check required
console.log('REQUIRED:');
let missing = false;
required.forEach(key => {
  if (process.env[key]) {
    console.log(`âœ… ${key}: Set`);
  } else {
    console.log(`âŒ ${key}: MISSING`);
    missing = true;
  }
});

console.log('\nRECOMMENDED:');
recommended.forEach(key => {
  if (process.env[key]) {
    console.log(`âœ… ${key}: Set`);
  } else {
    console.log(`âš ï¸  ${key}: Missing (app will work but limited)`);
  }
});

if (missing) {
  console.log('\nâŒ Some required variables are missing!');
  process.exit(1);
} else {
  console.log('\nâœ… All required variables are set!');
}
```

Run with:
```bash
node verify-env.js
```

---

## ðŸš€ AUTOMATED SETUP SCRIPT

Save this as `setup-env.sh` and run it:

```bash
#!/bin/bash

echo "ðŸ”§ AiMoviez Environment Setup"
echo "============================="
echo ""

# Check if .env.local exists
if [ -f .env.local ]; then
    echo "âš ï¸  .env.local already exists. Creating backup..."
    cp .env.local .env.local.backup.$(date +%Y%m%d_%H%M%S)
fi

# Create .env.local if it doesn't exist
touch .env.local

# Function to add or update env variable
add_env() {
    local key=$1
    local value=$2
    if grep -q "^$key=" .env.local; then
        # Update existing
        sed -i.bak "s|^$key=.*|$key=$value|" .env.local
    else
        # Add new
        echo "$key=$value" >> .env.local
    fi
}

# Get Supabase URL
echo "ðŸ“¦ Supabase Setup"
echo -n "Enter your Supabase Project URL: "
read SUPABASE_URL
add_env "NEXT_PUBLIC_SUPABASE_URL" "$SUPABASE_URL"

echo -n "Enter your Supabase Service Role Key: "
read -s SUPABASE_KEY
echo ""
add_env "SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_KEY"

# Generate admin tokens
echo ""
echo "ðŸ” Admin Security"
echo "Generating secure admin tokens..."

SECRET_KEY=$(openssl rand -hex 32)
add_env "ADMIN_SECRET_KEY" "$SECRET_KEY"

TOKEN1=$(openssl rand -hex 32)
TOKEN2=$(openssl rand -hex 32)
TOKEN3=$(openssl rand -hex 32)
add_env "ADMIN_VALID_TOKENS" "$TOKEN1,$TOKEN2,$TOKEN3"
add_env "ADMIN_TOKENS_ENABLED" "true"

echo "âœ… Generated 3 admin tokens:"
echo "  Token 1: $TOKEN1"
echo "  Token 2: $TOKEN2"
echo "  Token 3: $TOKEN3"
echo ""
echo "Save these tokens! You'll need them for admin access."

# Pusher setup (optional)
echo ""
echo "ðŸ”„ Pusher Setup (for real-time updates)"
echo -n "Do you have a Pusher account? (y/n): "
read HAS_PUSHER

if [ "$HAS_PUSHER" = "y" ]; then
    echo -n "Enter Pusher Key: "
    read PUSHER_KEY
    add_env "NEXT_PUBLIC_PUSHER_KEY" "$PUSHER_KEY"
    
    echo -n "Enter Pusher Cluster: "
    read PUSHER_CLUSTER
    add_env "NEXT_PUBLIC_PUSHER_CLUSTER" "$PUSHER_CLUSTER"
    
    echo -n "Enter Pusher App ID: "
    read PUSHER_APP_ID
    add_env "PUSHER_APP_ID" "$PUSHER_APP_ID"
    
    echo -n "Enter Pusher Secret: "
    read -s PUSHER_SECRET
    echo ""
    add_env "PUSHER_SECRET" "$PUSHER_SECRET"
else
    echo "â„¹ï¸  Skipping Pusher setup. Real-time updates will be disabled."
fi

# Add default settings
echo ""
echo "âš™ï¸  Adding default settings..."

add_env "RATE_LIMIT_ENABLED" "true"
add_env "RATE_LIMIT_PER_MINUTE" "60"
add_env "DAILY_VOTE_LIMIT" "200"
add_env "CLIP_POOL_SIZE" "30"
add_env "NODE_ENV" "development"
add_env "CORS_ALLOWED_ORIGINS" "http://localhost:3000"

echo ""
echo "âœ… Environment setup complete!"
echo ""
echo "ðŸ“‹ Summary:"
echo "  - Supabase: Configured"
echo "  - Admin tokens: Generated (save them!)"
if [ "$HAS_PUSHER" = "y" ]; then
    echo "  - Pusher: Configured"
else
    echo "  - Pusher: Skipped"
fi
echo "  - Rate limiting: Enabled"
echo "  - CORS: Configured for localhost"
echo ""
echo "ðŸš€ You can now run: npm run dev"
```

Make it executable and run:
```bash
chmod +x setup-env.sh
./setup-env.sh
```

---

## ðŸ“ PRODUCTION CHECKLIST

Before deploying to production:

- [ ] Change `NODE_ENV` to `production`
- [ ] Update `CORS_ALLOWED_ORIGINS` with your domain
- [ ] Ensure `ADMIN_TOKENS_ENABLED=true`
- [ ] Use strong admin tokens (not defaults)
- [ ] Set up Pusher for real-time features
- [ ] Consider increasing `RATE_LIMIT_PER_MINUTE` for production
- [ ] Add error tracking (Sentry) credentials
- [ ] Add analytics (Mixpanel/PostHog) credentials

---

## ðŸ” SECURITY NOTES

1. **NEVER commit .env.local to git**
2. **Rotate admin tokens regularly**
3. **Use different tokens for different team members**
4. **Store production secrets in a vault (e.g., Vercel, AWS Secrets Manager)**
5. **Use environment-specific values (dev vs prod)**

---

## âœ… VERIFICATION

After setting up, test with:

```bash
# Test Supabase connection
curl http://localhost:3000/api/story

# Test admin protection
curl http://localhost:3000/api/admin/stats
# Should return 401

# Test with admin token (use one of your generated tokens)
curl http://localhost:3000/api/admin/stats \
  -H "x-api-key: your-token-here"
# Should return data
```

---

## ðŸŽ¯ DONE!

Your environment is now properly configured! Next: Fix video storage.