import { useState } from 'react'
import './App.css'
import ImageCanvas from './components/ImageCanvas'
import ColorPicker from './components/ColorPicker'

function App() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [selectedColor, setSelectedColor] = useState<string>('#ffffff')

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setSelectedImage(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  return (
    <div className="app-container">
      <h1>Interior Design Color Visualizer</h1>
      <div className="main-content">
        <div className="controls-panel">
          <div className="upload-section">
            <h2>Upload Image</h2>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="file-input"
            />
          </div>
          <div className="color-picker-section">
            <h2>Select Wall Color</h2>
            <ColorPicker
              value={selectedColor}
              onChange={setSelectedColor}
            />
            <p className="instructions">
              Click and drag on the walls to apply the selected color
            </p>
          </div>
        </div>
        <div className="canvas-container">
          {selectedImage ? (
            <ImageCanvas
              imageUrl={selectedImage}
              selectedColor={selectedColor}
            />
          ) : (
            <div className="upload-placeholder">
              <p>Upload an image to begin</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
