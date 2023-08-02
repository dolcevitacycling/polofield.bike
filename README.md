# polofield.bike

[polofield.bike](https://polofield.bike) is deployed as a
[Cloudflare Worker](https://developers.cloudflare.com/workers/)
using [Hono](https://hono.dev/) for routing/jsx/templating support.

Currently all client-side code is written in plain javascript module
syntax with no types, bundler, or compiler. See `./static/js`.

[Prettier](https://prettier.io) is used for formatting

## Local dev runbook

Setup

```
npm install
```

Run dev server

```
npm run dev
```

Format code

```
npm run format
```

Run tests

```
npm run jest
```

## Deployment runbook

```
npm run deploy
```
