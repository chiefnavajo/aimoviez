# Enhanced Upload Area for AI Moviez 🎬

A modern, feature-rich upload component with drag-and-drop, video preview, and real-time validation.

## ✨ Features

### 🎯 Core Features
- **Drag & Drop Interface** - Intuitive drag-and-drop with visual feedback
- **Video Preview** - Built-in video player with play/pause and mute controls
- **Real-time Validation** - Instant feedback on file size, duration, format, and aspect ratio
- **Progress Indication** - Clear visual feedback during validation
- **Error Handling** - User-friendly error messages with actionable feedback
- **Metadata Display** - Shows video resolution, aspect ratio, and file size

### 🎨 Visual Design
- **Cyberpunk Theme** - Matches AI Moviez design system
- **Smooth Animations** - Powered by Framer Motion
- **Responsive Layout** - Works on all screen sizes
- **Glassmorphism** - Modern backdrop blur effects
- **Gradient Accents** - Cyan to violet gradient theme

### ✅ Validation Features
- File format validation (MP4, MOV, WebM)
- File size limits (configurable, default 100MB)
- Video duration validation (0.5s - 8s)
- Aspect ratio recommendations (9:16 for vertical video)
- Corrupted file detection

## 📦 Files Included

```
src/
├── components/
│   └── EnhancedUploadArea.tsx    # Main upload component
└── app/
    └── upload-demo/
        └── page.tsx               # Demo page with full example
```

## 🚀 Quick Start

### 1. Basic Usage

```tsx
import EnhancedUploadArea from '@/components/EnhancedUploadArea';

function MyUploadPage() {
  const handleFileSelect = (file: File, metadata: VideoMetadata) => {
    console.log('Selected file:', file);
    console.log('Video metadata:', metadata);
    // Handle the file upload here
  };

  return (
    <EnhancedUploadArea 
      onFileSelect={handleFileSelect}
      maxSizeMB={100}
      maxDurationSeconds={8}
      minDurationSeconds={0.5}
    />
  );
}
```

### 2. Full Integration Example

```tsx
'use client';

import { useState } from 'react';
import EnhancedUploadArea from '@/components/EnhancedUploadArea';

interface VideoMetadata {
  duration: number;
  size: number;
  width: number;
  height: number;
  aspectRatio: string;
}

export default function UploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);

  const handleFileSelect = (file: File, metadata: VideoMetadata) => {
    setSelectedFile(file);
    setVideoMetadata(metadata);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('video', selectedFile);
    
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    // Handle response
  };

  return (
    <div>
      <EnhancedUploadArea onFileSelect={handleFileSelect} />
      
      {selectedFile && (
        <button onClick={handleUpload}>
          Upload Video
        </button>
      )}
    </div>
  );
}
```

## 🎛️ Props API

### EnhancedUploadArea Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onFileSelect` | `(file: File, metadata: VideoMetadata) => void` | Required | Callback when a valid file is selected |
| `maxSizeMB` | `number` | `100` | Maximum file size in megabytes |
| `maxDurationSeconds` | `number` | `8` | Maximum video duration in seconds |
| `minDurationSeconds` | `number` | `0.5` | Minimum video duration in seconds |
| `acceptedFormats` | `string[]` | `['video/mp4', 'video/quicktime', 'video/webm']` | Accepted video MIME types |
| `className` | `string` | `''` | Additional CSS classes |

### VideoMetadata Type

```typescript
interface VideoMetadata {
  duration: number;      // Video duration in seconds
  size: number;         // File size in bytes
  width: number;        // Video width in pixels
  height: number;       // Video height in pixels
  aspectRatio: string;  // Calculated aspect ratio (e.g., "0.56")
}
```

## 🎨 Customization

### Custom Validation

```tsx
<EnhancedUploadArea 
  onFileSelect={handleFileSelect}
  maxSizeMB={50}                    // Smaller max size
  maxDurationSeconds={10}           // Longer videos
  minDurationSeconds={1}            // Minimum 1 second
  acceptedFormats={['video/mp4']}  // Only MP4
/>
```

### Styling

The component uses Tailwind CSS classes. Override styles with the `className` prop:

```tsx
<EnhancedUploadArea 
  onFileSelect={handleFileSelect}
  className="my-custom-class"
/>
```

## 🔧 Integration with Existing Upload System

### Replace Existing Upload Component

1. **Import the new component:**
```tsx
import EnhancedUploadArea from '@/components/EnhancedUploadArea';
```

2. **Update your upload page:**
```tsx
// Before
<UploadPanel onSubmit={handleSubmit} />

// After
<EnhancedUploadArea onFileSelect={handleFileSelect} />
```

3. **Adapt your submit handler:**
```tsx
const handleFileSelect = (file: File, metadata: VideoMetadata) => {
  // Metadata is now available immediately
  console.log('Video is', metadata.duration, 'seconds');
  
  // Store for later submission
  setSelectedFile(file);
  setVideoMeta(metadata);
};

const handleSubmit = async () => {
  // Your existing upload logic
  await uploadToServer(selectedFile, videoMeta);
};
```

## 📱 Mobile Support

The component is fully responsive and touch-friendly:
- Drag and drop works on desktop
- Click to browse works on all devices
- Video preview optimized for mobile with `playsInline`
- Touch-friendly controls

## ⚡ Performance

- **Lazy Loading** - Video metadata only loaded when needed
- **Memory Management** - Proper cleanup of object URLs
- **Smooth Animations** - Hardware-accelerated with Framer Motion
- **Optimized Re-renders** - Uses React.memo and useCallback

## 🐛 Error Handling

The component handles various error scenarios:

1. **Invalid Format** - Shows error if file type is not accepted
2. **File Too Large** - Alerts when file exceeds size limit
3. **Video Too Long/Short** - Validates duration against limits
4. **Corrupted Files** - Catches metadata loading errors
5. **Aspect Ratio** - Warns if not 9:16 (doesn't block upload)

## 🎬 Demo Page

A full demo is available at `/upload-demo`. To use it:

```bash
# Navigate to the demo
http://localhost:3000/upload-demo
```

The demo shows:
- Full upload workflow
- Form integration (title, description, genre)
- Submit button handling
- Success states

## 🔄 Migration from Old Component

### Old UploadPanel.tsx
```tsx
const [file, setFile] = useState<File | null>(null);

<UploadPanel 
  onSubmit={async (payload) => {
    // Handle upload
  }}
/>
```

### New EnhancedUploadArea
```tsx
const [file, setFile] = useState<File | null>(null);
const [metadata, setMetadata] = useState<VideoMetadata | null>(null);

<EnhancedUploadArea 
  onFileSelect={(file, meta) => {
    setFile(file);
    setMetadata(meta);
  }}
/>

// Then use the data when submitting
<button onClick={() => handleUpload(file, metadata)}>
  Submit
</button>
```

## 📚 Dependencies

Required packages (already in your project):
- `react` - Core React
- `framer-motion` - Animations
- `lucide-react` - Icons
- `tailwindcss` - Styling

## 🎯 Best Practices

1. **Always validate on the server** - Client-side validation is for UX only
2. **Use proper error handling** - Wrap uploads in try-catch blocks
3. **Show progress** - Keep users informed during upload
4. **Clean up resources** - Component handles URL cleanup automatically
5. **Test on mobile** - Ensure touch interactions work smoothly

## 🆘 Troubleshooting

### Video won't play in preview
- Check browser support for video format
- Ensure video is not DRM-protected
- Try with `muted` attribute (required for autoplay)

### Validation not working
- Check that video codec is supported
- Verify file is not corrupted
- Ensure proper MIME type

### Styling issues
- Verify Tailwind CSS is configured
- Check for conflicting CSS
- Ensure parent container has proper width

## 📄 License

This component is part of the AI Moviez project.

## 🤝 Contributing

To improve this component:
1. Test with various video formats
2. Add more validation rules if needed
3. Enhance accessibility features
4. Optimize performance further

---

Made with ❤️ for AI Moviez
