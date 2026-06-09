import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'EchoFox',
  description: 'Production-grade WhatsApp bot built on Baileys 7.x',
  base: '/',

  lastUpdated: true,
  cleanUrls: true,

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Configuration', link: '/config' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'CI/CD', link: '/ci-cd' }
    ],

    sidebar: [
      {
        text: 'Getting Started',
        collapsed: false,
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Quick Start', link: '/guide/getting-started' }
        ]
      },
      {
        text: 'Features',
        collapsed: false,
        items: [
          { text: 'Subscriptions', link: '/guide/subscriptions' },
          { text: 'Dashboard',     link: '/guide/dashboard' },
          { text: 'Soak Testing',  link: '/guide/soak-testing' }
        ]
      },
      {
        text: 'Configuration',
        collapsed: false,
        items: [
          { text: 'Overview',     link: '/config' },
          { text: 'Bot Settings', link: '/config/bot' },
          { text: 'Store & Auth', link: '/config/store-auth' }
        ]
      },
      {
        text: 'Architecture',
        collapsed: true,
        items: [
          { text: 'Overview',     link: '/architecture' },
          { text: 'CI/CD Pipeline', link: '/ci-cd' }
        ]
      },
      {
        text: 'Reference',
        collapsed: true,
        items: [
          { text: 'Command Catalogue', link: '/commands' },
          { text: 'Changelog',         link: '/changelog' }
        ]
      }
    ]

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Cosm1cBug/EchoFox' }
    ],

    editLink: {
      pattern: 'https://github.com/Cosm1cBug/EchoFox/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    search: {
      provider: 'local'
    },

    footer: {
      message: 'Released under the AGPL-3.0 License.',
      copyright: 'Copyright © 2026 COSM1CBUG'
    }
  }
})
