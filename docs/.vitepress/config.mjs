import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Baselode',
  description: 'Open-source toolkit for the mineral exploration and mining industries',
  base: '/',

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/baselode_logo.png' }]
  ],

  themeConfig: {
    logo: '/baselode_logo.png',
    siteTitle: 'Baselode',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      {
        text: 'Guide',
        items: [
          { text: 'Python', link: '/guide/python' },
          { text: 'JavaScript', link: '/guide/javascript' },
          { text: 'Core Photo Viewer', link: '/guide/core-photo-viewer' }
        ]
      },
      { text: 'Demos', link: '/demos' },
      { text: 'Release Notes', link: '/release-notes' },
      {
        text: 'API Reference',
        items: [
          { text: 'Python API', link: '/api/python' },
          { text: 'JavaScript API', link: '/api/javascript' }
        ]
      },
      {
        text: 'GitHub',
        link: 'https://github.com/darkmine-oss/baselode'
      }
    ],

    sidebar: {
      '/getting-started': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Overview', link: '/getting-started' },
            { text: 'Python Guide', link: '/guide/python' },
            { text: 'JavaScript Guide', link: '/guide/javascript' },
            { text: 'Demos', link: '/demos' }
          ]
        }
      ],
      '/guide/': [
        {
          text: 'Python',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guide/python' },
            { text: 'Data Loading', link: '/guide/python#data-loading' },
            { text: 'Desurveying', link: '/guide/python#desurveying' },
            { text: 'Visualization', link: '/guide/python#visualization' },
            { text: 'Plotly Templates', link: '/guide/python#plotly-templates' },
            { text: 'Colour Mapping', link: '/guide/python#colour-mapping' }
          ]
        },
        {
          text: 'JavaScript',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guide/javascript' },
            { text: 'Data Loading', link: '/guide/javascript#data-loading' },
            { text: 'Desurveying', link: '/guide/javascript#desurveying' },
            { text: 'Visualization', link: '/guide/javascript#visualization' },
            { text: 'Plotly Templates', link: '/guide/javascript#plotly-templates' },
            { text: 'Colour Mapping', link: '/guide/javascript#colour-mapping' },
            { text: '3D Scene', link: '/guide/javascript#3d-scene' }
          ]
        },
        {
          text: 'Core Photo Viewer',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guide/core-photo-viewer' },
            { text: 'Preparing your data', link: '/guide/core-photo-viewer#preparing-your-data' },
            { text: 'Single hole', link: '/guide/core-photo-viewer#single-hole-corephotaviewer' },
            { text: 'Multiple photo sets', link: '/guide/core-photo-viewer#multiple-photo-sets-side-by-side-columns' },
            { text: 'Multiple datasets for one hole', link: '/guide/core-photo-viewer#multiple-datasets-for-one-hole' },
            { text: 'Comparing multiple holes', link: '/guide/core-photo-viewer#comparing-multiple-holes' },
            { text: 'Linked pan/zoom', link: '/guide/core-photo-viewer#linked-panzoom-across-independent-viewers' },
            { text: 'Filename conventions', link: '/guide/core-photo-viewer#filename-conventions' },
            { text: 'Local development', link: '/guide/core-photo-viewer#local-development' },
            { text: 'API reference', link: '/guide/core-photo-viewer#full-api-reference' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Python API', link: '/api/python' },
            { text: 'JavaScript API', link: '/api/javascript' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/darkmine-oss/baselode' }
    ],

    footer: {
      message: 'Released under the GPL-3.0-or-later License.',
      copyright: 'Copyright © 2026 <a href="https://darkmine.ai" target="_blank" rel="noopener">Darkmine Pty Ltd</a>'
    },

    search: {
      provider: 'local'
    }
  }
})
