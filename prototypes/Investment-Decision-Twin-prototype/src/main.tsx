import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import ThesisApp from './App'
import TaxTraceApp from './taxtrace/TaxTraceApp'
import { getPrototypeRoute } from './prototypeRoute'
import './styles.css'
import './prototypeSwitch.css'

function PrototypeRoot() {
  const [route, setRoute] = useState(() => getPrototypeRoute(window.location.hash))
  useEffect(() => {
    const update = () => setRoute(getPrototypeRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return <>
    {route === 'taxtrace' ? <TaxTraceApp/> : <ThesisApp/>}
    <nav className="prototype-switcher" aria-label="프로토타입 전환">
      <a className={route === 'thesis' ? 'active' : ''} href="#/thesis">01 투자 암묵지</a>
      <a className={route === 'taxtrace' ? 'active' : ''} href="#/taxtrace">02 TaxTrace</a>
    </nav>
  </>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrototypeRoot />
  </React.StrictMode>,
)
