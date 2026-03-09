import DefaultTheme from 'vitepress/theme'
import { inject } from '@vercel/analytics'
import './custom.css'

export default {
  ...DefaultTheme,
  enhanceApp() {
    inject()
  }
}
