import { render } from 'preact'
import { App } from './ui/app'
import './styles.css'

render(<App />, document.getElementById('app')!)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => { /* offline is optional */ })
}
