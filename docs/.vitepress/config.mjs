import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'EchoFox',
  description: 'Production-grade WhatsApp bot built on Baileys 7.x — AI + tooling + Telegram log bridge',
  base: '/EchoFox/',

  lastUpdated: true,
  cleanUrls: true,

  // v1.4.0: tolerate links to repo-root files (README, LICENSE, CONTRIBUTING,
  // SECURITY, DISCLAIMER, UPGRADE) that live outside the docs/ tree and so
  // can't be resolved by VitePress.
  ignoreDeadLinks: [
    // root-level files (README, LICENSE, etc.) reachable via any number of '../' hops
    /^(?:\.\.?\/)+(README|UPGRADE|CONTRIBUTING|SECURITY|DISCLAIMER|LICENSE|NOTICE)/i,
  ],

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Guide',         link: '/guide/getting-started' },
      { text: 'AI',            link: '/guide/ai' },
      { text: 'Telegram',      link: '/guide/telegram' },
      { text: 'Configuration', link: '/config' },
      { text: 'Architecture',  link: '/architecture' },
      { text: 'CI/CD',         link: '/deploy/ci-cd' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        collapsed: false,
        items: [
          { text: 'Introduction',  link: '/guide/introduction' },
          { text: 'Installation',  link: '/guide/installation' },
          { text: 'Quick Start',   link: '/guide/getting-started' },
        ],
      },
      {
        text: 'Features',
        collapsed: false,
        items: [
          { text: 'AI service (v1.2.0+)',     link: '/guide/ai' },
          { text: 'Telegram log bridge (v1.3.0+)', link: '/guide/telegram' },
          { text: 'Subscriptions',            link: '/guide/subscriptions' },
          { text: 'Dashboard',                link: '/guide/dashboard' },
          { text: 'Soak Testing',             link: '/guide/soak-testing' },
        ],
      },
      {
        text: 'Configuration',
        collapsed: false,
        items: [
          { text: 'Overview',     link: '/config' },
          { text: 'Bot Settings', link: '/config/bot' },
          { text: 'Store & Auth', link: '/config/store-auth' },
        ],
      },
      {
        text: 'Architecture',
        collapsed: true,
        items: [
          { text: 'Overview',         link: '/architecture' },
          { text: 'CI/CD Pipeline',   link: '/deploy/ci-cd' },
        ],
      },
      {
        text: 'Deployment',
        collapsed: true,
        items: [
          { text: 'Docker',                link: '/deploy/docker' },
          { text: 'Docker Compose',        link: '/deploy/docker-compose' },
          { text: 'Multi-arch images',     link: '/deploy/multi-arch' },
          { text: 'Podman',                link: '/deploy/podman' },
          { text: 'Troubleshooting',       link: '/deploy/troubleshooting' },
        ],
      },
      {
        text: 'Reference',
        collapsed: true,
        items: [
          { text: 'Command Catalogue', link: '/commands' },
          { text: 'Changelog',         link: '/changelog' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Cosm1cBug/EchoFox' },
    ],

    editLink: {
      pattern: 'https://github.com/Cosm1cBug/EchoFox/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },

    footer: {
      message:   'Released under the AGPL-3.0 License.',
      copyright: 'Copyright © 2026 COSM1CBUG',
    },
  },
})