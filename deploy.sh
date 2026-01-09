#!/bin/bash

# Quick Deploy Script for AiMoviez
# Run: bash deploy.sh

echo "🚀 Deploying AiMoviez to Vercel..."

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "📦 Installing Vercel CLI..."
    npm i -g vercel
fi

# Check if logged in
if ! vercel whoami &> /dev/null; then
    echo "🔐 Logging in to Vercel..."
    vercel login
fi

# Deploy to production
echo "📤 Deploying to production..."
vercel --prod

echo "✅ Deployment complete!"
echo "🌐 Your app should be live at: https://your-app-name.vercel.app"













