# Character Persistence System

## Technical Documentation v1.0

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Installation](#installation)
4. [Core Components](#core-components)
5. [Database Schema](#database-schema)
6. [API Reference](#api-reference)
7. [Frame Extraction Pipeline](#frame-extraction-pipeline)
8. [Character DNA Specification](#character-dna-specification)
9. [Video Generation Integration](#video-generation-integration)
10. [Voting System](#voting-system)
11. [Character Gallery & Licensing](#character-gallery--licensing)
12. [Usage Examples](#usage-examples)
13. [Troubleshooting](#troubleshooting)

---

## Overview

The Character Persistence System (CPS) solves the primary challenge in collaborative AI video creation: **maintaining visual consistency of characters across multiple contributors and clips**.

### The Problem

In collaborative AI video projects, each contributor generates clips independently. Without a persistence system:

- Character appearance drifts significantly between clips
- Hair color, clothing, facial features change unpredictably
- By clip 10, the character is unrecognizable from clip 1
- Story immersion breaks completely

### The Solution

CPS locks in a character's visual identity early in the story creation process, then enforces that identity across all future generations:

```
┌─────────────────────────────────────────────────────────────┐
│  Clips 1-3: Establish character appearance                  │
│  ├─ Multiple contributors submit clips                      │
│  ├─ System extracts best character frames                   │
│  └─ Community votes on canonical design                     │
├─────────────────────────────────────────────────────────────┤
│  Character DNA Created                                       │
│  ├─ Reference images locked (full body, face, profile)      │
│  ├─ Color palette extracted                                 │
│  ├─ Style description generated                             │
│  └─ Features list documented                                │
├─────────────────────────────────────────────────────────────┤
│  Clips 4+: Character-locked generation                      │
│  ├─ Every generation uses reference image as input          │
│  ├─ Style description auto-injected into prompts           │
│  └─ AI enforces visual consistency                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                            │
├─────────────────────────────────────────────────────────────┤
│  React UI        │  Mobile App      │  API Consumers        │
└────────┬─────────┴────────┬─────────┴────────┬──────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                     API GATEWAY                             │
├─────────────────────────────────────────────────────────────┤
│  Authentication  │  Rate Limiting   │  Request Routing      │
└────────┬─────────┴────────┬─────────┴────────┬──────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   CORE SERVICES                             │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  Frame       │  Voting      │  Character   │  Generation    │
│  Extraction  │  Service     │  DNA Store   │  Orchestrator  │
│  Service     │              │              │                │
└──────┬───────┴──────┬───────┴──────┬───────┴───────┬────────┘
       │              │              │               │
       ▼              ▼              ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│                   DATA LAYER                                │
├──────────────┬──────────────┬───────────────────────────────┤
│  PostgreSQL  │  Redis       │  S3 / Cloud Storage           │
│  (metadata)  │  (cache)     │  (images, videos)             │
└──────────────┴──────────────┴───────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│               EXTERNAL SERVICES                             │
├──────────────┬──────────────┬───────────────────────────────┤
│  Fal.ai      │  Replicate   │  RunwayML                     │
│  (Kling)     │  (various)   │  (Gen-3)                      │
└──────────────┴──────────────┴───────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | React, TailwindCSS | User interface |
| API | Node.js, Express | REST endpoints |
| Database | PostgreSQL | Persistent storage |
| Cache | Redis | Session data, vote counts |
| Storage | AWS S3 | Images, videos, DNA files |
| Processing | Python, OpenCV | Frame extraction |
| AI | Fal.ai, Replicate | Video generation |

---

## Installation

### Prerequisites

```bash
# Required software
node >= 18.0.0
python >= 3.10
ffmpeg >= 5.0
postgresql >= 14
redis >= 7.0
```

### Quick Start

```bash
# Clone repository
git clone https://github.com/your-org/character-persistence-system.git
cd character-persistence-system

# Install dependencies
npm install
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Initialize database
npm run db:migrate
npm run db:seed

# Start services
npm run dev
```

### Environment Variables

```bash
# .env file

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/cps
REDIS_URL=redis://localhost:6379

# Storage
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
S3_BUCKET=cps-storage

# AI Services
FAL_KEY=your_fal_key
REPLICATE_API_TOKEN=your_replicate_token

# Application
JWT_SECRET=your_jwt_secret
API_PORT=3000
```

---

## Core Components

### 1. Frame Extraction Service

Extracts the best character frames from video clips.

```javascript
// services/frameExtraction.js

const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const { FaceDetector } = require('./faceDetector');

class FrameExtractionService {
  constructor(config) {
    this.outputDir = config.outputDir;
    this.faceDetector = new FaceDetector();
    this.qualityThreshold = config.qualityThreshold || 0.7;
  }

  /**
   * Extract frames from a video clip
   * @param {string} videoPath - Path to video file
   * @param {number} clipId - Clip identifier
   * @returns {Promise<ExtractedFrame[]>}
   */
  async extractFrames(videoPath, clipId) {
    const frames = [];
    
    // Extract frames at 1fps
    const rawFrames = await this.extractRawFrames(videoPath, 1);
    
    for (const frame of rawFrames) {
      // Detect faces/characters
      const detections = await this.faceDetector.detect(frame.buffer);
      
      if (detections.length > 0) {
        // Calculate quality score
        const quality = await this.calculateQuality(frame.buffer, detections);
        
        // Determine if dominant (best) shot
        const isDominant = quality > 0.9 && this.isClearShot(detections);
        
        frames.push({
          id: `${clipId}_${frame.timestamp}`,
          clipId,
          timestamp: frame.timestamp,
          buffer: frame.buffer,
          quality: Math.round(quality * 100),
          dominant: isDominant,
          detections
        });
      }
    }
    
    // Sort by quality, return top frames
    return frames
      .sort((a, b) => b.quality - a.quality)
      .slice(0, 10);
  }

  /**
   * Extract raw frames using FFmpeg
   */
  async extractRawFrames(videoPath, fps) {
    return new Promise((resolve, reject) => {
      const frames = [];
      
      ffmpeg(videoPath)
        .outputOptions([`-vf fps=${fps}`, '-f image2pipe', '-vcodec png'])
        .on('error', reject)
        .on('end', () => resolve(frames))
        .pipe()
        .on('data', (chunk) => {
          frames.push({
            timestamp: this.formatTimestamp(frames.length / fps),
            buffer: chunk
          });
        });
    });
  }

  /**
   * Calculate frame quality score
   * Factors: sharpness, lighting, face visibility, composition
   */
  async calculateQuality(buffer, detections) {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    
    // Sharpness (Laplacian variance)
    const sharpness = await this.measureSharpness(buffer);
    
    // Lighting (histogram analysis)
    const lighting = await this.analyzeLighting(buffer);
    
    // Face visibility (detection confidence)
    const faceScore = detections.reduce((sum, d) => sum + d.confidence, 0) / detections.length;
    
    // Composition (rule of thirds, centering)
    const composition = this.scoreComposition(detections, metadata);
    
    // Weighted average
    return (
      sharpness * 0.3 +
      lighting * 0.2 +
      faceScore * 0.35 +
      composition * 0.15
    );
  }

  /**
   * Check if frame is a clear, unobstructed shot
   */
  isClearShot(detections) {
    if (detections.length !== 1) return false;
    
    const detection = detections[0];
    return (
      detection.confidence > 0.95 &&
      detection.boundingBox.width > 100 &&
      !detection.occluded
    );
  }

  formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

module.exports = { FrameExtractionService };
```

### 2. Character DNA Service

Creates and manages character DNA files.

```javascript
// services/characterDNA.js

const ColorThief = require('colorthief');
const { ClipEmbedder } = require('./clipEmbedder');

class CharacterDNAService {
  constructor(storage, db) {
    this.storage = storage;
    this.db = db;
    this.clipEmbedder = new ClipEmbedder();
  }

  /**
   * Create Character DNA from selected frames
   * @param {Object} params
   * @returns {Promise<CharacterDNA>}
   */
  async createDNA({
    storyId,
    characterName,
    frames,
    creatorId,
    votes
  }) {
    // Categorize frames by type
    const categorized = this.categorizeFrames(frames);
    
    // Upload reference images
    const referenceImages = await this.uploadReferenceImages(storyId, characterName, categorized);
    
    // Extract color palette
    const colorPalette = await this.extractColorPalette(frames);
    
    // Generate style description
    const styleDescription = await this.generateStyleDescription(frames, colorPalette);
    
    // Extract locked features
    const lockedFeatures = await this.extractLockedFeatures(frames, styleDescription);
    
    // Create DNA object
    const dna = {
      character_id: this.generateCharacterId(characterName),
      name: characterName,
      story_id: storyId,
      status: 'canonical',
      reference_images: referenceImages,
      style_description: styleDescription,
      color_palette: colorPalette,
      locked_features: lockedFeatures,
      created_from_clip: frames[0].clipId,
      total_votes: votes,
      clips_used: 0,
      creator_id: creatorId,
      created_at: new Date().toISOString()
    };
    
    // Save to database
    const saved = await this.db.characters.create(dna);
    
    // Upload DNA file to storage
    await this.storage.upload(
      `characters/${dna.character_id}/dna.json`,
      JSON.stringify(dna, null, 2)
    );
    
    return saved;
  }

  /**
   * Categorize frames into full body, face, and profile shots
   */
  categorizeFrames(frames) {
    const categories = {
      full_body: null,
      face_closeup: null,
      side_profile: null
    };
    
    for (const frame of frames) {
      const detection = frame.detections[0];
      
      if (!detection) continue;
      
      // Full body: detection covers < 40% of frame
      if (detection.coverage < 0.4 && !categories.full_body) {
        categories.full_body = frame;
      }
      // Face closeup: frontal, high confidence
      else if (detection.pose === 'frontal' && detection.confidence > 0.95 && !categories.face_closeup) {
        categories.face_closeup = frame;
      }
      // Side profile
      else if (['left', 'right'].includes(detection.pose) && !categories.side_profile) {
        categories.side_profile = frame;
      }
    }
    
    return categories;
  }

  /**
   * Extract dominant colors from character regions
   */
  async extractColorPalette(frames) {
    const palette = {
      hair: null,
      skin: null,
      clothing_primary: null,
      clothing_secondary: null,
      accessory: null
    };
    
    for (const frame of frames) {
      const detection = frame.detections[0];
      if (!detection || !detection.segmentation) continue;
      
      // Extract colors from segmented regions
      const regions = detection.segmentation;
      
      if (regions.hair && !palette.hair) {
        palette.hair = await this.getDominantColor(frame.buffer, regions.hair);
      }
      if (regions.skin && !palette.skin) {
        palette.skin = await this.getDominantColor(frame.buffer, regions.skin);
      }
      if (regions.torso && !palette.clothing_primary) {
        palette.clothing_primary = await this.getDominantColor(frame.buffer, regions.torso);
      }
    }
    
    return palette;
  }

  /**
   * Get dominant color from image region
   */
  async getDominantColor(buffer, mask) {
    const color = await ColorThief.getColor(buffer, { region: mask });
    return this.rgbToHex(color);
  }

  /**
   * Generate natural language style description
   */
  async generateStyleDescription(frames, colorPalette) {
    // Use CLIP to generate embeddings
    const embeddings = await Promise.all(
      frames.map(f => this.clipEmbedder.embed(f.buffer))
    );
    
    // Analyze visual attributes
    const attributes = await this.analyzeAttributes(embeddings);
    
    // Compose description
    const parts = [
      attributes.style, // e.g., "Photorealistic"
      attributes.hairDescription, // e.g., "blonde shoulder-length hair"
      attributes.bodyType, // e.g., "athletic build"
      attributes.age, // e.g., "30s"
      attributes.clothingDescription // e.g., "blue armor with gold trim"
    ];
    
    return parts.filter(Boolean).join(', ');
  }

  /**
   * Extract specific lockable features
   */
  async extractLockedFeatures(frames, styleDescription) {
    const features = [];
    
    // Parse from style description
    const descFeatures = this.parseDescriptionFeatures(styleDescription);
    features.push(...descFeatures);
    
    // Add detected accessories, scars, etc.
    for (const frame of frames) {
      const detection = frame.detections[0];
      if (detection?.attributes) {
        if (detection.attributes.scar) {
          features.push(`scar on ${detection.attributes.scar.location}`);
        }
        if (detection.attributes.glasses) {
          features.push(detection.attributes.glasses.type);
        }
        if (detection.attributes.beard) {
          features.push(`${detection.attributes.beard.style} beard`);
        }
      }
    }
    
    return [...new Set(features)]; // Deduplicate
  }

  generateCharacterId(name) {
    const slug = name.toLowerCase().replace(/\s+/g, '_');
    const random = Math.random().toString(36).substring(2, 5);
    return `${slug}_${random}`;
  }

  rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
}

module.exports = { CharacterDNAService };
```

### 3. Generation Orchestrator

Handles character-locked video generation.

```javascript
// services/generationOrchestrator.js

const fal = require('@fal-ai/serverless-client');

class GenerationOrchestrator {
  constructor(config, characterDNAService) {
    this.config = config;
    this.characterDNAService = characterDNAService;
    
    fal.config({
      credentials: config.falKey
    });
  }

  /**
   * Generate video clip with character lock
   * @param {Object} params
   * @returns {Promise<GenerationResult>}
   */
  async generateWithCharacterLock({
    characterId,
    prompt,
    duration = 5,
    aspectRatio = '16:9'
  }) {
    // Load character DNA
    const dna = await this.characterDNAService.getById(characterId);
    
    if (!dna) {
      throw new Error(`Character ${characterId} not found`);
    }
    
    // Build enhanced prompt
    const enhancedPrompt = this.buildPrompt(dna, prompt);
    
    // Select best reference image for the scene
    const referenceImage = await this.selectReferenceImage(dna, prompt);
    
    // Generate video
    const result = await fal.subscribe('fal-ai/kling-video/v1/standard/image-to-video', {
      input: {
        image_url: referenceImage,
        prompt: enhancedPrompt,
        negative_prompt: this.buildNegativePrompt(dna),
        duration: duration,
        aspect_ratio: aspectRatio
      },
      logs: true,
      onQueueUpdate: (update) => {
        console.log('Queue position:', update.position);
      }
    });
    
    // Calculate consistency score
    const consistencyScore = await this.calculateConsistencyScore(
      result.video.url,
      dna
    );
    
    // Update clips_used counter
    await this.characterDNAService.incrementClipsUsed(characterId);
    
    return {
      video_url: result.video.url,
      consistency_score: consistencyScore,
      character_id: characterId,
      prompt_used: enhancedPrompt,
      reference_image_used: referenceImage,
      duration,
      generated_at: new Date().toISOString()
    };
  }

  /**
   * Build enhanced prompt with character DNA
   */
  buildPrompt(dna, userPrompt) {
    // Start with style description
    let prompt = dna.style_description;
    
    // Add locked features for emphasis
    const featureEmphasis = dna.locked_features
      .slice(0, 3)
      .join(', ');
    
    if (featureEmphasis) {
      prompt += `. Character has ${featureEmphasis}`;
    }
    
    // Add user's scene prompt
    if (userPrompt) {
      prompt += `. ${userPrompt}`;
    }
    
    // Add quality tags
    prompt += '. High quality, cinematic, consistent character appearance';
    
    return prompt;
  }

  /**
   * Build negative prompt to prevent character drift
   */
  buildNegativePrompt(dna) {
    const negatives = [
      'different character',
      'different person',
      'changing appearance',
      'inconsistent features'
    ];
    
    // Add color negatives
    if (dna.color_palette.hair) {
      const oppositeHair = this.getOppositeHairColor(dna.color_palette.hair);
      negatives.push(`${oppositeHair} hair`);
    }
    
    // Add feature negatives
    if (dna.locked_features.includes('short beard')) {
      negatives.push('clean shaven', 'long beard');
    }
    
    return negatives.join(', ');
  }

  /**
   * Select best reference image based on scene requirements
   */
  async selectReferenceImage(dna, prompt) {
    const promptLower = prompt.toLowerCase();
    
    // Action scenes → full body
    if (this.containsActionWords(promptLower)) {
      return dna.reference_images.full_body;
    }
    
    // Dialogue/emotional scenes → face closeup
    if (this.containsDialogueWords(promptLower)) {
      return dna.reference_images.face_closeup;
    }
    
    // Default to full body
    return dna.reference_images.full_body;
  }

  /**
   * Calculate how well the generated video matches character DNA
   */
  async calculateConsistencyScore(videoUrl, dna) {
    // Extract frames from generated video
    const frames = await this.extractVideoFrames(videoUrl, 3);
    
    let totalScore = 0;
    
    for (const frame of frames) {
      // Compare with reference images using CLIP
      const similarity = await this.compareWithReferences(
        frame,
        dna.reference_images
      );
      
      // Check color consistency
      const colorMatch = await this.checkColorConsistency(
        frame,
        dna.color_palette
      );
      
      // Combined score
      totalScore += (similarity * 0.7 + colorMatch * 0.3);
    }
    
    return Math.round((totalScore / frames.length) * 100);
  }

  containsActionWords(prompt) {
    const actionWords = ['fight', 'run', 'jump', 'battle', 'chase', 'swing', 'throw'];
    return actionWords.some(word => prompt.includes(word));
  }

  containsDialogueWords(prompt) {
    const dialogueWords = ['speak', 'talk', 'say', 'whisper', 'shout', 'emotion', 'react'];
    return dialogueWords.some(word => prompt.includes(word));
  }
}

module.exports = { GenerationOrchestrator };
```

---

## Database Schema

### PostgreSQL Tables

```sql
-- Characters table
CREATE TABLE characters (
  id SERIAL PRIMARY KEY,
  character_id VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  story_id INTEGER REFERENCES stories(id),
  status VARCHAR(50) DEFAULT 'candidate', -- candidate, voting, canonical, archived
  style_description TEXT,
  color_palette JSONB,
  locked_features TEXT[],
  created_from_clip INTEGER,
  total_votes INTEGER DEFAULT 0,
  clips_used INTEGER DEFAULT 0,
  creator_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Reference images table
CREATE TABLE reference_images (
  id SERIAL PRIMARY KEY,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  image_type VARCHAR(50) NOT NULL, -- full_body, face_closeup, side_profile
  storage_url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Character submissions (for voting phase)
CREATE TABLE character_submissions (
  id SERIAL PRIMARY KEY,
  story_id INTEGER REFERENCES stories(id),
  submitter_id INTEGER REFERENCES users(id),
  frame_ids INTEGER[],
  style_description TEXT,
  vote_count INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Votes table
CREATE TABLE character_votes (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER REFERENCES character_submissions(id),
  voter_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(submission_id, voter_id) -- One vote per user per submission
);

-- Generated clips with character lock
CREATE TABLE generated_clips (
  id SERIAL PRIMARY KEY,
  story_id INTEGER REFERENCES stories(id),
  character_id INTEGER REFERENCES characters(id),
  prompt TEXT,
  video_url TEXT,
  consistency_score INTEGER,
  reference_image_used TEXT,
  creator_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Character licenses (for marketplace)
CREATE TABLE character_licenses (
  id SERIAL PRIMARY KEY,
  character_id INTEGER REFERENCES characters(id),
  licensee_id INTEGER REFERENCES users(id),
  license_type VARCHAR(50), -- single_use, unlimited, exclusive
  credits_paid INTEGER,
  royalty_rate DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_characters_story_id ON characters(story_id);
CREATE INDEX idx_characters_status ON characters(status);
CREATE INDEX idx_character_votes_submission ON character_votes(submission_id);
CREATE INDEX idx_generated_clips_character ON generated_clips(character_id);
```

---

## API Reference

### Characters Endpoints

#### Create Character Submission

```http
POST /api/v1/stories/{storyId}/characters/submissions
Authorization: Bearer {token}
Content-Type: application/json

{
  "frame_ids": [1, 3, 5],
  "style_description": "Battle-worn veteran knight"
}
```

**Response:**
```json
{
  "id": 123,
  "story_id": 47,
  "frame_ids": [1, 3, 5],
  "style_description": "Battle-worn veteran knight",
  "vote_count": 0,
  "status": "active",
  "created_at": "2024-01-15T10:30:00Z"
}
```

#### Vote for Submission

```http
POST /api/v1/characters/submissions/{submissionId}/vote
Authorization: Bearer {token}
```

**Response:**
```json
{
  "success": true,
  "new_vote_count": 235
}
```

#### Lock Character (Admin/Auto)

```http
POST /api/v1/stories/{storyId}/characters/lock
Authorization: Bearer {token}
Content-Type: application/json

{
  "submission_id": 123,
  "character_name": "Sir Aldric"
}
```

**Response:**
```json
{
  "character_id": "sir_aldric_a7x",
  "name": "Sir Aldric",
  "status": "canonical",
  "style_description": "Photorealistic blonde knight in blue armor with gold trim...",
  "color_palette": {
    "hair": "#D4AF37",
    "armor": "#1E3A8A",
    "trim": "#FFD700"
  },
  "locked_features": [
    "blonde shoulder-length hair",
    "short trimmed beard",
    "blue steel armor with gold accents"
  ],
  "reference_images": {
    "full_body": "https://storage.example.com/characters/sir_aldric_a7x/full_body.jpg",
    "face_closeup": "https://storage.example.com/characters/sir_aldric_a7x/face_closeup.jpg",
    "side_profile": "https://storage.example.com/characters/sir_aldric_a7x/side_profile.jpg"
  }
}
```

#### Get Character DNA

```http
GET /api/v1/characters/{characterId}
Authorization: Bearer {token}
```

**Response:**
```json
{
  "character_id": "sir_aldric_a7x",
  "name": "Sir Aldric",
  "story_id": 47,
  "story_name": "The Last Kingdom",
  "status": "canonical",
  "style_description": "Photorealistic blonde knight in blue armor with gold trim, short beard, 30s, athletic build, scar on left cheek",
  "color_palette": {
    "hair": "#D4AF37",
    "armor": "#1E3A8A",
    "trim": "#FFD700",
    "cape": "#DC2626",
    "skin": "#E8C4A0"
  },
  "locked_features": [
    "blonde shoulder-length hair",
    "short trimmed beard",
    "blue steel armor with gold accents",
    "red flowing cape",
    "scar on left cheek"
  ],
  "reference_images": {
    "full_body": "https://storage.example.com/...",
    "face_closeup": "https://storage.example.com/...",
    "side_profile": "https://storage.example.com/..."
  },
  "created_from_clip": 2,
  "total_votes": 847,
  "clips_used": 23,
  "creator": {
    "id": 42,
    "username": "StoryMaster_42"
  },
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Generation Endpoints

#### Generate with Character Lock

```http
POST /api/v1/generate
Authorization: Bearer {token}
Content-Type: application/json

{
  "character_id": "sir_aldric_a7x",
  "prompt": "The knight draws his sword and faces the dragon",
  "duration": 5,
  "aspect_ratio": "16:9"
}
```

**Response:**
```json
{
  "job_id": "gen_abc123",
  "status": "processing",
  "estimated_time": 120
}
```

#### Check Generation Status

```http
GET /api/v1/generate/{jobId}
Authorization: Bearer {token}
```

**Response (complete):**
```json
{
  "job_id": "gen_abc123",
  "status": "complete",
  "result": {
    "video_url": "https://storage.example.com/videos/gen_abc123.mp4",
    "consistency_score": 94,
    "character_id": "sir_aldric_a7x",
    "prompt_used": "Photorealistic blonde knight in blue armor... The knight draws his sword...",
    "reference_image_used": "full_body",
    "duration": 5,
    "generated_at": "2024-01-15T11:00:00Z"
  }
}
```

### Gallery Endpoints

#### List Gallery Characters

```http
GET /api/v1/gallery/characters?page=1&limit=20&sort=popular
Authorization: Bearer {token}
```

**Response:**
```json
{
  "characters": [
    {
      "character_id": "kira_h9k",
      "name": "Kira",
      "story_name": "Neon Streets",
      "clips_used": 45,
      "total_votes": 1567,
      "thumbnail_url": "https://...",
      "license_cost": 10
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156
  }
}
```

#### License Character

```http
POST /api/v1/characters/{characterId}/license
Authorization: Bearer {token}
Content-Type: application/json

{
  "license_type": "single_use"
}
```

**Response:**
```json
{
  "license_id": 789,
  "character_id": "kira_h9k",
  "license_type": "single_use",
  "credits_charged": 10,
  "valid_until": "2024-02-15T10:30:00Z"
}
```

---

## Frame Extraction Pipeline

### Processing Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    INPUT VIDEO CLIP                          │
│                    (MP4, MOV, WebM)                          │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  STEP 1: FRAME EXTRACTION (FFmpeg)                           │
│  ├─ Extract frames at 1-2 FPS                               │
│  ├─ Output: PNG frames with timestamps                      │
│  └─ Typically 5-10 frames per 5-second clip                 │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  STEP 2: FACE/BODY DETECTION (MediaPipe / YOLO)             │
│  ├─ Detect faces and bodies in each frame                   │
│  ├─ Calculate bounding boxes                                │
│  ├─ Determine pose (frontal, profile, etc.)                 │
│  └─ Output: Detection objects with confidence scores        │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  STEP 3: QUALITY SCORING                                     │
│  ├─ Sharpness (Laplacian variance)                          │
│  ├─ Lighting (histogram analysis)                           │
│  ├─ Face visibility (detection confidence)                  │
│  ├─ Composition (rule of thirds)                            │
│  └─ Output: Quality score 0-100                             │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  STEP 4: FRAME SELECTION                                     │
│  ├─ Sort by quality score                                   │
│  ├─ Filter duplicates (visual similarity)                   │
│  ├─ Mark "dominant" frames (quality > 90%)                  │
│  └─ Output: Top 6-10 candidate frames                       │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  OUTPUT: EXTRACTED FRAMES                                    │
│  {                                                           │
│    id: "clip1_00:02",                                       │
│    quality: 94,                                             │
│    dominant: true,                                          │
│    detections: [{...}]                                      │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
```

### Python Implementation

```python
# extraction/frame_extractor.py

import cv2
import numpy as np
from pathlib import Path
import mediapipe as mp
from dataclasses import dataclass
from typing import List, Optional
import subprocess
import json

@dataclass
class Detection:
    confidence: float
    bounding_box: dict
    pose: str  # frontal, left, right
    coverage: float  # % of frame covered
    occluded: bool

@dataclass
class ExtractedFrame:
    id: str
    clip_id: int
    timestamp: str
    path: Path
    quality: int
    dominant: bool
    detections: List[Detection]

class FrameExtractor:
    def __init__(self, output_dir: str, quality_threshold: float = 0.7):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.quality_threshold = quality_threshold
        
        # Initialize MediaPipe
        self.mp_face = mp.solutions.face_detection
        self.face_detection = self.mp_face.FaceDetection(
            model_selection=1,  # Full range model
            min_detection_confidence=0.5
        )
    
    def extract_from_video(self, video_path: str, clip_id: int, fps: float = 1.0) -> List[ExtractedFrame]:
        """Extract and analyze frames from video."""
        
        # Extract raw frames with FFmpeg
        frames_dir = self.output_dir / f"clip_{clip_id}"
        frames_dir.mkdir(exist_ok=True)
        
        subprocess.run([
            'ffmpeg', '-i', video_path,
            '-vf', f'fps={fps}',
            '-q:v', '2',
            str(frames_dir / 'frame_%04d.png')
        ], check=True, capture_output=True)
        
        # Process each frame
        extracted = []
        for frame_path in sorted(frames_dir.glob('frame_*.png')):
            frame_num = int(frame_path.stem.split('_')[1])
            timestamp = self._format_timestamp(frame_num / fps)
            
            # Load and analyze frame
            image = cv2.imread(str(frame_path))
            detections = self._detect_faces(image)
            
            if detections:
                quality = self._calculate_quality(image, detections)
                dominant = quality > 90 and self._is_clear_shot(detections)
                
                extracted.append(ExtractedFrame(
                    id=f"{clip_id}_{timestamp.replace(':', '')}",
                    clip_id=clip_id,
                    timestamp=timestamp,
                    path=frame_path,
                    quality=quality,
                    dominant=dominant,
                    detections=detections
                ))
        
        # Sort by quality and return top frames
        extracted.sort(key=lambda x: x.quality, reverse=True)
        return extracted[:10]
    
    def _detect_faces(self, image: np.ndarray) -> List[Detection]:
        """Detect faces using MediaPipe."""
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        results = self.face_detection.process(rgb)
        
        detections = []
        if results.detections:
            h, w = image.shape[:2]
            for detection in results.detections:
                bbox = detection.location_data.relative_bounding_box
                
                detections.append(Detection(
                    confidence=detection.score[0],
                    bounding_box={
                        'x': int(bbox.xmin * w),
                        'y': int(bbox.ymin * h),
                        'width': int(bbox.width * w),
                        'height': int(bbox.height * h)
                    },
                    pose=self._determine_pose(detection),
                    coverage=bbox.width * bbox.height,
                    occluded=False  # Simplified
                ))
        
        return detections
    
    def _calculate_quality(self, image: np.ndarray, detections: List[Detection]) -> int:
        """Calculate frame quality score (0-100)."""
        
        # Sharpness (Laplacian variance)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
        sharpness_score = min(sharpness / 500, 1.0)  # Normalize
        
        # Lighting (histogram spread)
        hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
        lighting_score = np.std(hist) / 1000  # Normalize
        lighting_score = min(lighting_score, 1.0)
        
        # Face confidence
        face_score = sum(d.confidence for d in detections) / len(detections)
        
        # Composition (face near center)
        h, w = image.shape[:2]
        center_x, center_y = w / 2, h / 2
        face = detections[0].bounding_box
        face_center_x = face['x'] + face['width'] / 2
        face_center_y = face['y'] + face['height'] / 2
        
        dist_from_center = np.sqrt(
            ((face_center_x - center_x) / w) ** 2 +
            ((face_center_y - center_y) / h) ** 2
        )
        composition_score = 1 - min(dist_from_center, 1.0)
        
        # Weighted average
        total = (
            sharpness_score * 0.3 +
            lighting_score * 0.2 +
            face_score * 0.35 +
            composition_score * 0.15
        )
        
        return int(total * 100)
    
    def _is_clear_shot(self, detections: List[Detection]) -> bool:
        """Check if frame has clear, unobstructed subject."""
        if len(detections) != 1:
            return False
        
        d = detections[0]
        return (
            d.confidence > 0.95 and
            d.bounding_box['width'] > 100 and
            not d.occluded
        )
    
    def _determine_pose(self, detection) -> str:
        """Determine face pose from keypoints."""
        # Simplified - in production, use landmarks
        return 'frontal'
    
    def _format_timestamp(self, seconds: float) -> str:
        mins = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{mins:02d}:{secs:02d}"


# Usage example
if __name__ == "__main__":
    extractor = FrameExtractor("./extracted_frames")
    frames = extractor.extract_from_video("clip_001.mp4", clip_id=1)
    
    for frame in frames:
        print(f"{frame.timestamp}: Quality {frame.quality}% {'[BEST]' if frame.dominant else ''}")
```

---

## Character DNA Specification

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CharacterDNA",
  "type": "object",
  "required": [
    "character_id",
    "name",
    "reference_images",
    "style_description",
    "color_palette",
    "locked_features"
  ],
  "properties": {
    "character_id": {
      "type": "string",
      "pattern": "^[a-z0-9_]+$",
      "description": "Unique identifier (slug format)"
    },
    "name": {
      "type": "string",
      "maxLength": 100,
      "description": "Character display name"
    },
    "story_id": {
      "type": "integer",
      "description": "Parent story ID"
    },
    "status": {
      "type": "string",
      "enum": ["candidate", "voting", "canonical", "archived"],
      "default": "canonical"
    },
    "reference_images": {
      "type": "object",
      "required": ["full_body"],
      "properties": {
        "full_body": {
          "type": "string",
          "format": "uri",
          "description": "Full body reference shot"
        },
        "face_closeup": {
          "type": "string",
          "format": "uri",
          "description": "Face closeup shot"
        },
        "side_profile": {
          "type": "string",
          "format": "uri",
          "description": "Side profile shot"
        }
      }
    },
    "style_description": {
      "type": "string",
      "maxLength": 500,
      "description": "Natural language description for prompt injection"
    },
    "color_palette": {
      "type": "object",
      "additionalProperties": {
        "type": "string",
        "pattern": "^#[0-9A-Fa-f]{6}$"
      },
      "description": "Hex color codes for key features"
    },
    "locked_features": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1,
      "maxItems": 10,
      "description": "Specific visual features to maintain"
    },
    "created_from_clip": {
      "type": "integer",
      "description": "Source clip ID"
    },
    "total_votes": {
      "type": "integer",
      "minimum": 0,
      "default": 0
    },
    "clips_used": {
      "type": "integer",
      "minimum": 0,
      "default": 0
    },
    "creator_id": {
      "type": "integer",
      "description": "User who created/locked the character"
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

### Example DNA File

```json
{
  "character_id": "sir_aldric_a7x",
  "name": "Sir Aldric",
  "story_id": 47,
  "status": "canonical",
  "reference_images": {
    "full_body": "https://storage.example.com/characters/sir_aldric_a7x/full_body.jpg",
    "face_closeup": "https://storage.example.com/characters/sir_aldric_a7x/face_closeup.jpg",
    "side_profile": "https://storage.example.com/characters/sir_aldric_a7x/side_profile.jpg"
  },
  "style_description": "Photorealistic blonde knight in blue armor with gold trim, short beard, 30s, athletic build, scar on left cheek",
  "color_palette": {
    "hair": "#D4AF37",
    "armor": "#1E3A8A",
    "trim": "#FFD700",
    "cape": "#DC2626",
    "skin": "#E8C4A0"
  },
  "locked_features": [
    "blonde shoulder-length hair",
    "short trimmed beard",
    "blue steel armor with gold accents",
    "red flowing cape",
    "scar on left cheek"
  ],
  "created_from_clip": 2,
  "total_votes": 847,
  "clips_used": 23,
  "creator_id": 42,
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

## Video Generation Integration

### Supported Providers

| Provider | Model | Best For | Character Lock Support |
|----------|-------|----------|------------------------|
| Fal.ai | Kling v1 | General purpose | ✅ Image-to-video |
| Replicate | Wan2.1 | Stylized content | ✅ Image-to-video |
| RunwayML | Gen-3 Alpha | Cinematic | ✅ Image-to-video |
| Luma | Dream Machine | Fast iteration | ⚠️ Limited |

### Provider Abstraction

```javascript
// services/providers/index.js

const { FalProvider } = require('./fal');
const { ReplicateProvider } = require('./replicate');
const { RunwayProvider } = require('./runway');

class VideoGeneratorFactory {
  static create(provider, config) {
    switch (provider) {
      case 'fal':
        return new FalProvider(config);
      case 'replicate':
        return new ReplicateProvider(config);
      case 'runway':
        return new RunwayProvider(config);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
}

// Provider interface
class BaseVideoProvider {
  async generate({ referenceImage, prompt, negativePrompt, duration, aspectRatio }) {
    throw new Error('Not implemented');
  }
  
  async checkStatus(jobId) {
    throw new Error('Not implemented');
  }
  
  supportsCharacterLock() {
    return false;
  }
}

// Fal.ai implementation
class FalProvider extends BaseVideoProvider {
  constructor(config) {
    super();
    this.fal = require('@fal-ai/serverless-client');
    this.fal.config({ credentials: config.apiKey });
  }
  
  async generate({ referenceImage, prompt, negativePrompt, duration, aspectRatio }) {
    const result = await this.fal.subscribe('fal-ai/kling-video/v1/standard/image-to-video', {
      input: {
        image_url: referenceImage,
        prompt: prompt,
        negative_prompt: negativePrompt,
        duration: duration,
        aspect_ratio: aspectRatio
      }
    });
    
    return {
      jobId: result.request_id,
      videoUrl: result.video?.url,
      status: result.video ? 'complete' : 'processing'
    };
  }
  
  supportsCharacterLock() {
    return true;
  }
}

module.exports = { VideoGeneratorFactory, BaseVideoProvider };
```

---

## Voting System

### Voting Rules

1. **Eligibility**: Only registered users can vote
2. **One Vote Per Submission**: Users can vote for one submission per character slot
3. **Voting Period**: 24-72 hours or until threshold reached
4. **Threshold**: Winner declared at 50% + 1 of total votes OR time expiry
5. **Tie Breaking**: Most recent votes wins, or admin decides

### Implementation

```javascript
// services/votingService.js

class VotingService {
  constructor(db, redis, config) {
    this.db = db;
    this.redis = redis;
    this.votingDuration = config.votingDuration || 24 * 60 * 60 * 1000; // 24 hours
    this.winThreshold = config.winThreshold || 0.5;
  }

  /**
   * Start voting period for a story's character
   */
  async startVoting(storyId, characterSlot) {
    const submissions = await this.db.characterSubmissions.findAll({
      where: { story_id: storyId, status: 'active' }
    });
    
    if (submissions.length < 2) {
      throw new Error('Need at least 2 submissions to start voting');
    }
    
    // Create voting session
    const session = await this.db.votingSessions.create({
      story_id: storyId,
      character_slot: characterSlot,
      submissions: submissions.map(s => s.id),
      starts_at: new Date(),
      ends_at: new Date(Date.now() + this.votingDuration),
      status: 'active'
    });
    
    // Initialize vote counters in Redis
    for (const sub of submissions) {
      await this.redis.set(`votes:${session.id}:${sub.id}`, 0);
    }
    
    return session;
  }

  /**
   * Cast a vote
   */
  async castVote(sessionId, submissionId, userId) {
    // Check if session is active
    const session = await this.db.votingSessions.findByPk(sessionId);
    if (!session || session.status !== 'active') {
      throw new Error('Voting session is not active');
    }
    
    // Check if user already voted
    const existingVote = await this.db.characterVotes.findOne({
      where: { session_id: sessionId, voter_id: userId }
    });
    
    if (existingVote) {
      throw new Error('User has already voted in this session');
    }
    
    // Record vote
    await this.db.characterVotes.create({
      session_id: sessionId,
      submission_id: submissionId,
      voter_id: userId
    });
    
    // Increment counter in Redis
    const newCount = await this.redis.incr(`votes:${sessionId}:${submissionId}`);
    
    // Update database periodically
    await this.db.characterSubmissions.increment('vote_count', {
      where: { id: submissionId }
    });
    
    // Check if threshold reached
    await this.checkThreshold(sessionId);
    
    return { success: true, newVoteCount: newCount };
  }

  /**
   * Check if voting threshold is reached
   */
  async checkThreshold(sessionId) {
    const session = await this.db.votingSessions.findByPk(sessionId);
    const totalVotes = await this.db.characterVotes.count({
      where: { session_id: sessionId }
    });
    
    // Get vote counts for each submission
    const submissions = session.submissions;
    const voteCounts = await Promise.all(
      submissions.map(async (subId) => ({
        id: subId,
        votes: parseInt(await this.redis.get(`votes:${sessionId}:${subId}`)) || 0
      }))
    );
    
    // Check for majority winner
    const threshold = Math.floor(totalVotes * this.winThreshold) + 1;
    const winner = voteCounts.find(s => s.votes >= threshold);
    
    if (winner) {
      await this.declareWinner(sessionId, winner.id);
    }
  }

  /**
   * Declare voting winner and lock character
   */
  async declareWinner(sessionId, submissionId) {
    const session = await this.db.votingSessions.findByPk(sessionId);
    
    // Update session
    await session.update({
      status: 'complete',
      winner_id: submissionId,
      ended_at: new Date()
    });
    
    // Trigger character lock
    const submission = await this.db.characterSubmissions.findByPk(submissionId);
    
    // Emit event for character DNA creation
    this.emit('voting:winner', {
      sessionId,
      storyId: session.story_id,
      submissionId,
      frames: submission.frame_ids,
      votes: submission.vote_count
    });
  }

  /**
   * Get current voting status
   */
  async getVotingStatus(sessionId) {
    const session = await this.db.votingSessions.findByPk(sessionId);
    
    const submissions = await Promise.all(
      session.submissions.map(async (subId) => {
        const sub = await this.db.characterSubmissions.findByPk(subId);
        const votes = parseInt(await this.redis.get(`votes:${sessionId}:${subId}`)) || 0;
        
        return {
          id: subId,
          creator: sub.submitter_id,
          style: sub.style_description,
          votes,
          percentage: 0 // Calculated below
        };
      })
    );
    
    const totalVotes = submissions.reduce((sum, s) => sum + s.votes, 0);
    submissions.forEach(s => {
      s.percentage = totalVotes > 0 ? Math.round((s.votes / totalVotes) * 100) : 0;
    });
    
    return {
      session_id: sessionId,
      status: session.status,
      total_votes: totalVotes,
      submissions: submissions.sort((a, b) => b.votes - a.votes),
      ends_at: session.ends_at,
      time_remaining: Math.max(0, new Date(session.ends_at) - new Date())
    };
  }
}

module.exports = { VotingService };
```

---

## Character Gallery & Licensing

### Licensing Tiers

| Tier | Cost | Usage | Royalty |
|------|------|-------|---------|
| Single Use | 10 credits | 1 clip | 20% to creator |
| Pack (10) | 80 credits | 10 clips | 15% to creator |
| Unlimited | 500 credits | Unlimited | 10% to creator |
| Exclusive | Negotiated | Your story only | 50% to creator |

### Marketplace Implementation

```javascript
// services/marketplaceService.js

class MarketplaceService {
  constructor(db, paymentService) {
    this.db = db;
    this.paymentService = paymentService;
    
    this.licenseTiers = {
      single_use: { cost: 10, uses: 1, royaltyRate: 0.20 },
      pack_10: { cost: 80, uses: 10, royaltyRate: 0.15 },
      unlimited: { cost: 500, uses: Infinity, royaltyRate: 0.10 },
      exclusive: { cost: null, uses: Infinity, royaltyRate: 0.50 }
    };
  }

  /**
   * List characters available for licensing
   */
  async listAvailableCharacters({ page = 1, limit = 20, sort = 'popular' }) {
    const orderBy = {
      popular: [['total_votes', 'DESC']],
      recent: [['created_at', 'DESC']],
      used: [['clips_used', 'DESC']]
    }[sort] || [['total_votes', 'DESC']];
    
    const characters = await this.db.characters.findAndCountAll({
      where: {
        status: 'canonical',
        allow_licensing: true
      },
      include: [{
        model: this.db.stories,
        attributes: ['id', 'title']
      }],
      order: orderBy,
      limit,
      offset: (page - 1) * limit
    });
    
    return {
      characters: characters.rows.map(c => ({
        character_id: c.character_id,
        name: c.name,
        story_name: c.story?.title,
        clips_used: c.clips_used,
        total_votes: c.total_votes,
        thumbnail_url: c.reference_images.face_closeup,
        license_cost: this.licenseTiers.single_use.cost
      })),
      pagination: {
        page,
        limit,
        total: characters.count
      }
    };
  }

  /**
   * Purchase a license for a character
   */
  async purchaseLicense(characterId, userId, licenseType) {
    const tier = this.licenseTiers[licenseType];
    if (!tier) {
      throw new Error(`Invalid license type: ${licenseType}`);
    }
    
    const character = await this.db.characters.findOne({
      where: { character_id: characterId }
    });
    
    if (!character || !character.allow_licensing) {
      throw new Error('Character not available for licensing');
    }
    
    // Check user has enough credits
    const user = await this.db.users.findByPk(userId);
    if (user.credits < tier.cost) {
      throw new Error('Insufficient credits');
    }
    
    // Process payment
    await this.paymentService.deductCredits(userId, tier.cost);
    
    // Pay royalty to creator
    const royalty = Math.floor(tier.cost * tier.royaltyRate);
    await this.paymentService.addCredits(character.creator_id, royalty);
    
    // Create license record
    const license = await this.db.characterLicenses.create({
      character_id: character.id,
      licensee_id: userId,
      license_type: licenseType,
      credits_paid: tier.cost,
      royalty_paid: royalty,
      uses_remaining: tier.uses,
      created_at: new Date(),
      expires_at: this.calculateExpiry(licenseType)
    });
    
    return {
      license_id: license.id,
      character_id: characterId,
      license_type: licenseType,
      uses_remaining: license.uses_remaining,
      valid_until: license.expires_at
    };
  }

  /**
   * Check if user has valid license for character
   */
  async checkLicense(characterId, userId) {
    const character = await this.db.characters.findOne({
      where: { character_id: characterId }
    });
    
    // Creator always has access
    if (character.creator_id === userId) {
      return { valid: true, type: 'creator' };
    }
    
    // Same story always has access
    const userStories = await this.db.storyContributors.findAll({
      where: { user_id: userId }
    });
    
    if (userStories.some(s => s.story_id === character.story_id)) {
      return { valid: true, type: 'story_contributor' };
    }
    
    // Check purchased license
    const license = await this.db.characterLicenses.findOne({
      where: {
        character_id: character.id,
        licensee_id: userId,
        uses_remaining: { [Op.gt]: 0 },
        expires_at: { [Op.gt]: new Date() }
      }
    });
    
    if (license) {
      return {
        valid: true,
        type: 'licensed',
        uses_remaining: license.uses_remaining
      };
    }
    
    return { valid: false };
  }

  /**
   * Consume one use of a license
   */
  async consumeLicenseUse(characterId, userId) {
    const check = await this.checkLicense(characterId, userId);
    
    if (!check.valid) {
      throw new Error('No valid license');
    }
    
    if (check.type === 'licensed') {
      await this.db.characterLicenses.decrement('uses_remaining', {
        where: {
          character_id: characterId,
          licensee_id: userId
        }
      });
    }
    
    return true;
  }

  calculateExpiry(licenseType) {
    const durations = {
      single_use: 30 * 24 * 60 * 60 * 1000, // 30 days
      pack_10: 90 * 24 * 60 * 60 * 1000, // 90 days
      unlimited: 365 * 24 * 60 * 60 * 1000, // 1 year
      exclusive: null // Negotiated
    };
    
    const duration = durations[licenseType];
    return duration ? new Date(Date.now() + duration) : null;
  }
}

module.exports = { MarketplaceService };
```

---

## Usage Examples

### Complete Workflow Example

```javascript
// Example: Full character persistence workflow

const { FrameExtractionService } = require('./services/frameExtraction');
const { CharacterDNAService } = require('./services/characterDNA');
const { VotingService } = require('./services/votingService');
const { GenerationOrchestrator } = require('./services/generationOrchestrator');

async function characterPersistenceWorkflow(storyId) {
  
  // ============================================
  // PHASE 1: FRAME EXTRACTION (Clips 1-3)
  // ============================================
  
  const frameExtractor = new FrameExtractionService({ outputDir: './frames' });
  
  // Extract frames from first 3 clips
  const clip1Frames = await frameExtractor.extractFrames('./clips/clip_001.mp4', 1);
  const clip2Frames = await frameExtractor.extractFrames('./clips/clip_002.mp4', 2);
  const clip3Frames = await frameExtractor.extractFrames('./clips/clip_003.mp4', 3);
  
  const allFrames = [...clip1Frames, ...clip2Frames, ...clip3Frames];
  console.log(`Extracted ${allFrames.length} candidate frames`);
  
  // ============================================
  // PHASE 2: COMMUNITY SUBMISSIONS
  // ============================================
  
  // Different contributors select their preferred frames
  const submissionA = {
    submitter_id: 101,
    frame_ids: [1, 3, 5],
    style_description: 'Rugged warrior look'
  };
  
  const submissionB = {
    submitter_id: 102,
    frame_ids: [2, 4, 6],
    style_description: 'Noble knight aesthetic'
  };
  
  // ============================================
  // PHASE 3: VOTING
  // ============================================
  
  const votingService = new VotingService(db, redis, config);
  
  // Start voting
  const session = await votingService.startVoting(storyId, 'protagonist');
  console.log(`Voting started, ends at ${session.ends_at}`);
  
  // Users vote (simulated)
  await votingService.castVote(session.id, submissionA.id, 201);
  await votingService.castVote(session.id, submissionA.id, 202);
  await votingService.castVote(session.id, submissionB.id, 203);
  // ... more votes
  
  // Check status
  const status = await votingService.getVotingStatus(session.id);
  console.log(`Current leader: Submission ${status.submissions[0].id} with ${status.submissions[0].votes} votes`);
  
  // ============================================
  // PHASE 4: CHARACTER LOCK
  // ============================================
  
  // When voting completes, winner is locked
  const dnaService = new CharacterDNAService(storage, db);
  
  const characterDNA = await dnaService.createDNA({
    storyId,
    characterName: 'Sir Aldric',
    frames: winningSubmission.frames,
    creatorId: winningSubmission.submitter_id,
    votes: winningSubmission.vote_count
  });
  
  console.log(`Character locked: ${characterDNA.character_id}`);
  console.log(`Style: ${characterDNA.style_description}`);
  
  // ============================================
  // PHASE 5: GENERATION WITH CHARACTER LOCK
  // ============================================
  
  const generator = new GenerationOrchestrator(config, dnaService);
  
  // Any contributor can now generate with locked character
  const clip4 = await generator.generateWithCharacterLock({
    characterId: characterDNA.character_id,
    prompt: 'The knight draws his sword and faces the dragon',
    duration: 5
  });
  
  console.log(`Generated clip: ${clip4.video_url}`);
  console.log(`Consistency score: ${clip4.consistency_score}%`);
  
  // More clips by different contributors
  const clip5 = await generator.generateWithCharacterLock({
    characterId: characterDNA.character_id,
    prompt: 'The knight charges into battle on horseback',
    duration: 5
  });
  
  const clip6 = await generator.generateWithCharacterLock({
    characterId: characterDNA.character_id,
    prompt: 'The knight removes his helmet, revealing a weary face',
    duration: 5
  });
  
  // All clips maintain consistent character appearance!
  console.log('All clips generated with consistent character appearance');
}
```

### React Integration Example

```jsx
// components/CharacterLockWorkflow.jsx

import React, { useState, useEffect } from 'react';
import { useCharacterAPI } from '../hooks/useCharacterAPI';

export function CharacterLockWorkflow({ storyId }) {
  const [step, setStep] = useState('extract'); // extract | vote | locked | generate
  const [extractedFrames, setExtractedFrames] = useState([]);
  const [selectedFrames, setSelectedFrames] = useState([]);
  const [votingStatus, setVotingStatus] = useState(null);
  const [lockedCharacter, setLockedCharacter] = useState(null);
  
  const api = useCharacterAPI();
  
  // Step 1: Extract frames
  const handleExtract = async (clipIds) => {
    const frames = await api.extractFrames(storyId, clipIds);
    setExtractedFrames(frames);
  };
  
  // Step 2: Submit selection for voting
  const handleSubmit = async () => {
    await api.submitCharacter(storyId, {
      frame_ids: selectedFrames,
      style_description: 'My character design'
    });
    setStep('vote');
  };
  
  // Step 3: Vote
  const handleVote = async (submissionId) => {
    await api.castVote(votingStatus.session_id, submissionId);
    // Refresh status
    const status = await api.getVotingStatus(votingStatus.session_id);
    setVotingStatus(status);
  };
  
  // Step 4: Generate with locked character
  const handleGenerate = async (prompt) => {
    const result = await api.generateWithCharacter(lockedCharacter.character_id, prompt);
    return result;
  };
  
  return (
    <div className="character-workflow">
      {step === 'extract' && (
        <FrameExtractionStep
          frames={extractedFrames}
          selected={selectedFrames}
          onSelect={setSelectedFrames}
          onExtract={handleExtract}
          onSubmit={handleSubmit}
        />
      )}
      
      {step === 'vote' && (
        <VotingStep
          status={votingStatus}
          onVote={handleVote}
        />
      )}
      
      {step === 'locked' && (
        <CharacterDNAView
          character={lockedCharacter}
          onGenerate={() => setStep('generate')}
        />
      )}
      
      {step === 'generate' && (
        <GenerationStep
          character={lockedCharacter}
          onGenerate={handleGenerate}
        />
      )}
    </div>
  );
}
```

---

## Troubleshooting

### Common Issues

#### 1. Low Quality Frames Extracted

**Symptoms:** All extracted frames have quality scores below 70%

**Solutions:**
- Ensure source video is at least 720p
- Check lighting in original clips
- Increase extraction FPS to capture more candidates
- Adjust quality thresholds in config

```javascript
// Adjust extraction settings
const extractor = new FrameExtractionService({
  outputDir: './frames',
  qualityThreshold: 0.5, // Lower threshold
  extractionFps: 2 // More frames
});
```

#### 2. Character Drift Despite DNA Lock

**Symptoms:** Generated videos show character variations

**Solutions:**
- Use higher consistency weight in generation
- Ensure reference images are high quality
- Add more specific locked features
- Try different AI provider

```javascript
// Increase consistency enforcement
const result = await generator.generateWithCharacterLock({
  characterId: 'sir_aldric_a7x',
  prompt: 'The knight walks through the forest',
  consistencyWeight: 0.95, // Higher = stricter
  useAllReferences: true // Use all 3 reference images
});
```

#### 3. Voting Deadlock

**Symptoms:** No clear winner after voting period

**Solutions:**
- Extend voting period
- Lower win threshold
- Allow admin override
- Implement runoff voting

```javascript
// Handle deadlock
const votingService = new VotingService(db, redis, {
  votingDuration: 48 * 60 * 60 * 1000, // Extended to 48 hours
  winThreshold: 0.4, // Lower threshold
  allowAdminOverride: true
});
```

#### 4. Color Palette Mismatch

**Symptoms:** Extracted colors don't match visual appearance

**Solutions:**
- Use face/body segmentation before color extraction
- Sample from multiple frames
- Allow manual color correction

```javascript
// Manual color override
await dnaService.updateColorPalette(characterId, {
  hair: '#C4A000', // Corrected gold
  armor: '#1A3A8A' // Corrected blue
});
```

### Performance Optimization

```javascript
// Batch frame extraction
const batchExtract = async (clips) => {
  const results = await Promise.all(
    clips.map(clip => frameExtractor.extractFrames(clip.path, clip.id))
  );
  return results.flat();
};

// Cache character DNA
const getCachedDNA = async (characterId) => {
  const cached = await redis.get(`dna:${characterId}`);
  if (cached) return JSON.parse(cached);
  
  const dna = await dnaService.getById(characterId);
  await redis.setex(`dna:${characterId}`, 3600, JSON.stringify(dna));
  return dna;
};

// Pre-warm reference images
const prewarmReferences = async (characterId) => {
  const dna = await getCachedDNA(characterId);
  await Promise.all(
    Object.values(dna.reference_images).map(url => 
      fetch(url, { method: 'HEAD' }) // Warm CDN cache
    )
  );
};
```

---

## Appendix: Constants & Configuration

```javascript
// config/constants.js

module.exports = {
  // Frame extraction
  EXTRACTION_FPS: 1,
  MIN_QUALITY_SCORE: 70,
  MAX_FRAMES_PER_CLIP: 10,
  
  // Voting
  DEFAULT_VOTING_DURATION: 24 * 60 * 60 * 1000, // 24 hours
  WIN_THRESHOLD: 0.5,
  MIN_SUBMISSIONS_FOR_VOTING: 2,
  
  // Character DNA
  MAX_LOCKED_FEATURES: 10,
  STYLE_DESCRIPTION_MAX_LENGTH: 500,
  
  // Generation
  DEFAULT_VIDEO_DURATION: 5,
  DEFAULT_ASPECT_RATIO: '16:9',
  CONSISTENCY_WEIGHT: 0.9,
  
  // Licensing
  LICENSE_TIERS: {
    SINGLE_USE: { cost: 10, uses: 1, royalty: 0.20 },
    PACK_10: { cost: 80, uses: 10, royalty: 0.15 },
    UNLIMITED: { cost: 500, uses: Infinity, royalty: 0.10 }
  },
  
  // Storage
  S3_BUCKET: process.env.S3_BUCKET,
  REFERENCE_IMAGE_PREFIX: 'characters/',
  VIDEO_OUTPUT_PREFIX: 'generated/'
};
```

---

**Document Version:** 1.0  
**Last Updated:** 2024-01-15  
**Maintainer:** Platform Engineering Team
