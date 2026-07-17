import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <h1>⚽ Futebol</h1>
        <p>Jogo de futebol interativo</p>
      </div>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          Gols: {count}
        </button>
        <p>
          Clique para marcar um gol
        </p>
      </div>
    </>
  )
}

export default App
