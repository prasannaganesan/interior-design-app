# Interior Design App with Segment Anything Model

This is a React + TypeScript application that uses Meta's Segment Anything Model (SAM) for interior design visualization. The application runs entirely in the browser using ONNX Runtime Web for model inference.

## Features

- Interactive image segmentation using SAM
- Real-time visualization of segmented objects
- Browser-based ML inference using ONNX Runtime Web
- Modern React + TypeScript + Vite setup
- Photo-realistic recoloring that preserves surface shading

## Prerequisites

- Node.js 18+ 
- npm 9+

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd interior-design-app
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## Technical Details

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **ML Runtime**: ONNX Runtime Web
- **Model**: Segment Anything Model (SAM)
- **Key Dependencies**:
  - onnxruntime-web
  - react
  - typescript
  - vite

## Project Structure

```
interior-design-app/
├── src/
│   ├── components/     # React components
│   ├── lib/           # Core libraries and utilities
│   │   └── sam/       # SAM model integration
│   └── assets/        # Static assets
├── public/            # Public assets and WASM files
└── vite.config.ts     # Vite configuration
```

## Development

The project uses Vite for development with HMR (Hot Module Replacement) support. The development server can be started with:

```bash
npm run dev
```

## Building for Production

To create a production build:

```bash
npm run build
npm run preview  # to preview the build
```

## Enabling WebAssembly Multi-Threading

ONNX Runtime can leverage WebAssembly threads for better performance. Browsers
require the page to be **cross-origin isolated** to enable this feature. When
deploying to platforms like Vercel, ensure the following headers are served:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

If you cannot configure headers directly, you can register a small service
worker using [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker)
before loading the app:

```html
<script src="https://unpkg.com/coi-serviceworker" defer></script>
```

Once the page is cross-origin isolated, the app will use four WASM threads as
configured in `src/lib/sam/index.ts`.

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
