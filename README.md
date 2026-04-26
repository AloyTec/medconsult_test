# MedConsult Voice Testing - Next.js 16

Real-time medical voice transcription with AI-powered clinical data extraction using OpenAI Realtime API.

## Features

- 🎤 **Real-time Voice Transcription**: Speech-to-text powered by OpenAI Whisper
- 🧠 **Automatic Data Extraction**: AI extracts structured clinical information
- 📊 **Confidence Scoring**: See how confident the system is about extracted data
- ⚡ **Fast Iteration**: Next.js 16 hot-reload for rapid development
- 🔐 **Privacy**: Data processed locally, no persistent storage
- 📱 **Responsive**: Works on desktop and tablets

## Quick Start

### 1. Prerequisites

- Node.js 18+ installed
- OpenAI API account with Realtime API access
- Modern browser with WebRTC support

### 2. Installation

```bash
cd medconsult_voice_testing
npm install
cp .env.example .env.local
```

### 3. Configure OpenAI API

1. Get your OpenAI API key from https://platform.openai.com/api-keys
2. Open `.env.local` and add:
```
NEXT_PUBLIC_OPENAI_API_KEY=sk_live_your_api_key_here
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Recording a Consultation

1. **Click "Start Recording"** - Requests microphone access (required)
2. **Speak naturally** - Describe the patient information and clinical findings
3. **Watch the transcript** - Text appears in real-time as you speak
4. **Review extracted data** - Clinical information appears in the "Extracted Clinical Data" section
5. **Click "Stop Recording"** - Ends the session and commits audio

### Understanding the Output

**Live Input**: Text currently being processed  
**Full Transcript**: Complete conversation transcript  
**Patient Info**: Extracted patient demographics  
**Clinical Sections**: Structured medical information  
**Confidence**: How confident the system is (0-100%)

### Data Format

Extracted data follows this schema:

```json
{
  "patientData": {
    "firstName": "Juan",
    "lastName": "Pérez",
    "age": 45,
    "rut": "12345678-9",
    "phone": "+56912345678",
    "email": "juan@example.com"
  },
  "sections": {
    "consultationReason": "Dolor de cabeza frecuente",
    "medicalHistory": "Antecedente de migrañas",
    "physicalExamination": "Presión arterial normal",
    "diagnosis": "Cefalea tensional",
    "treatmentPlan": "Analgésicos y reposo"
  },
  "confidence": 0.95,
  "extractedAt": "2026-04-25T14:30:00.000Z"
}
```

## Project Structure

```
medconsult_voice_testing/
├── app/
│   ├── layout.tsx              # Root layout with header/footer
│   ├── page.tsx                # Home page
│   ├── globals.css             # Tailwind CSS
│   └── components/
│       ├── VoiceRecorder.tsx   # Main recording UI
│       ├── ControlButtons.tsx  # Start/Stop/Pause buttons
│       ├── TranscriptDisplay.tsx # Text transcript
│       └── DataExtraction.tsx  # Extracted JSON display
├── lib/
│   ├── types.ts                # TypeScript interfaces
│   ├── extraction-schema.ts    # Zod validation schemas
│   ├── audio-capture.ts        # Microphone access
│   ├── openai-realtime.ts      # WebSocket client
│   └── hooks/
│       └── useVoiceRecording.ts # React hook
├── __tests__/
│   ├── extraction-schema.test.ts
│   ├── audio-capture.test.ts
│   └── useVoiceRecording.test.tsx
├── .env.local                  # Environment variables (local only)
├── .env.example                # Environment template
├── package.json
├── tsconfig.json
├── jest.config.js
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
└── README.md
```

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript
- **Styling**: Tailwind CSS v4
- **API**: OpenAI Realtime API (WebSocket)
- **Validation**: Zod v4
- **Testing**: Jest 30, React Testing Library
- **Audio**: Web Audio API, PCM16 encoding

## Available Scripts

```bash
npm run dev          # Start development server with hot-reload
npm run build        # Build for production
npm start            # Start production server
npm test             # Run Jest tests
npm test:watch       # Run tests in watch mode
npm test:coverage    # Generate coverage report
npm run lint         # Run linting
```

## API Integration

### OpenAI Realtime API

The app uses OpenAI's Realtime API for:
- Real-time speech-to-text transcription
- Voice activity detection (automatic silence handling)
- Response streaming

**Model**: `gpt-4o-realtime-preview-2024-12-17`  
**Audio Format**: PCM16 at 24kHz  
**Connection**: WebSocket (`wss://api.openai.com/v1/realtime`)

### Future Backend Integration

To integrate with the MedConsult backend:

```typescript
// After stopping recording
const response = await fetch(
  'https://api.medconsult.dev/clinic-consultation',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${doctorToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      patientData: extractedData.patientData,
      sections: extractedData.sections,
      transcript: fullTranscript,
    }),
  }
)
```

## Development

### Running Tests

```bash
npm test                  # Run all tests
npm test -- --watch      # Watch mode
npm test -- --coverage   # Coverage report
```

### Build for Production

```bash
npm run build
npm start
```

## Troubleshooting

### "API key not configured"
- Check `.env.local` file exists
- Verify `NEXT_PUBLIC_OPENAI_API_KEY` is set
- Restart dev server after changing env vars

### "WebSocket connection error"
- Check API key is valid
- Ensure browser has WebRTC support
- Check OpenAI API status at status.openai.com

### "Permission denied for microphone"
- Grant microphone access when prompted
- Check browser security settings
- Try in an incognito window

### "No text appearing while speaking"
- Ensure microphone is working (test in another app)
- Check audio input levels
- Try pausing and resuming recording

## Performance Notes

- Initial connection to OpenAI takes ~1-2s
- Transcription latency is typically 300-500ms
- Data extraction happens after speech pause detection
- Each consultation costs ~$0.01-0.05 in API usage

## Security & Privacy

- API key stored only in `.env.local` (not committed to git)
- Audio streamed directly to OpenAI (no local storage)
- Extracted data stays in browser unless sent to backend
- No personal data logged or persisted locally

## Next Steps

1. **Authenticate Users**: Integrate Firebase Auth for doctor login
2. **Backend Submission**: Connect to `/clinic-consultation` endpoint
3. **Persistence**: Save consultations to DynamoDB
4. **PDF Generation**: Generate consultation PDFs
5. **Real Deployment**: Deploy to Vercel with environment variables

## Resources

- [OpenAI Realtime API Docs](https://platform.openai.com/docs/guides/realtime)
- [Next.js 16 Documentation](https://nextjs.org/docs)
- [React 19 Documentation](https://react.dev)
- [Tailwind CSS v4](https://tailwindcss.com/docs/v4-upgrade-guide)
- [Flutter App Reference](../../medconsult_frontend)

## License

MIT

---

**Last Updated**: 2026-04-25  
**Version**: 1.0.0  
**Maintained By**: MedConsult Development Team
