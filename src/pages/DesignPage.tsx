import { useState, useRef } from 'react'
import ImageCanvas from '../components/ImageCanvas'
import ColorPicker from '../components/ColorPicker'
import WhiteBalanceControls, { type WhiteBalance } from '../components/WhiteBalanceControls'
import LightingSelector from '../components/LightingSelector'

export default function DesignPage() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [selectedColor, setSelectedColor] = useState<string>('#ffffff')
  const [whiteBalance, setWhiteBalance] = useState<WhiteBalance>({ r: 1, g: 1, b: 1 })
  const [lighting, setLighting] = useState('normal')
  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        const url = reader.result as string
        setSelectedImage(url)
        computeAutoWhiteBalance(url).then(setWhiteBalance)
      }
      reader.readAsDataURL(file)
    }
  }

  const computeAutoWhiteBalance = (url: string): Promise<WhiteBalance> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.src = url
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let r = 0, g = 0, b = 0
        const count = canvas.width * canvas.height
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
        }
        r /= count
        g /= count
        b /= count
        const gray = (r + g + b) / 3
        resolve({ r: gray / r, g: gray / g, b: gray / b })
      }
    })
  }

  return (
    <div className="main-content">
      <div className="controls-panel">
        <div className="upload-section panel-section">
          <h2>Load Image</h2>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="file-input"
          />
          <p className="local-note">All image processing happens locally in your browser.</p>
        </div>
        <div className="color-picker-section panel-section">
          <h2>Select Surface Color</h2>
          <ColorPicker
            value={selectedColor}
            onChange={setSelectedColor}
          />
          <p className="instructions">
            Hover over the image to highlight surfaces. Click to apply the color.
          </p>
        </div>
        <div className="white-balance-section panel-section">
          <h2>White Balance</h2>
          <WhiteBalanceControls
            value={whiteBalance}
            onChange={setWhiteBalance}
            onAuto={() => selectedImage && computeAutoWhiteBalance(selectedImage).then(setWhiteBalance)}
          />
        </div>
        <LightingSelector value={lighting} onChange={setLighting} className="panel-section" />
      </div>
      <div className="canvas-container">
        {selectedImage ? (
          <ImageCanvas
            imageUrl={selectedImage}
            selectedColor={selectedColor}
            whiteBalance={whiteBalance}
            lighting={lighting}
            sidebarContainer={sidebarRef.current}
          />
        ) : (
          <div className="upload-placeholder">
            <p>Load an image to begin</p>
          </div>
        )}
      </div>
      <div ref={sidebarRef} className="sidebar" />
    </div>
  )
}
